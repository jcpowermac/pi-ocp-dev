/**
 * Fetch Prow job data and build logs, with a 30-minute disk cache.
 *
 * Public Prow only (no auth). Ported from
 * vsphere-prow-summary/vsphere_monitor/fetcher.py.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PROW_URL =
  "https://prow.ci.openshift.org/prowjobs.js?omit=annotations,decoration_config,pod_spec";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 120_000;

export function cacheDir(): string {
  return process.env.PI_OCP_DEV_CACHE_DIR
    ?? join(homedir(), ".cache", "pi-ocp-dev");
}

function cachePath(url: string): string {
  const h = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return join(cacheDir(), `prowjobs_${h}.json`);
}

function cacheMetaPath(url: string): string {
  return `${cachePath(url)}.meta`;
}

function isCacheValid(url: string): boolean {
  const meta = cacheMetaPath(url);
  if (!existsSync(meta)) return false;
  try {
    const ts = Number(readFileSync(meta, "utf8").trim());
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function readCache(url: string): unknown {
  return JSON.parse(readFileSync(cachePath(url), "utf8"));
}

function writeCache(url: string, data: unknown): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath(url), JSON.stringify(data));
  writeFileSync(cacheMetaPath(url), String(Date.now()));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch prowjobs.js from the live API, using the disk cache unless
 * `refresh` is true.
 */
export async function fetchProwJobs(opts: {
  url?: string;
  refresh?: boolean;
} = {}): Promise<{ items: unknown[] }> {
  const url = opts.url ?? DEFAULT_PROW_URL;
  if (!opts.refresh && isCacheValid(url)) {
    return readCache(url) as { items: unknown[] };
  }
  const res = await fetchWithTimeout(url);
  const data = (await res.json()) as { items: unknown[] };
  writeCache(url, data);
  return data;
}

/** Load prow job data from a local JSON file (for offline testing). */
export function readProwJobsFile(path: string): { items: unknown[] } {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as { items: unknown[] };
  if (!Array.isArray(data.items)) {
    throw new Error(`File does not look like prowjobs JSON (missing items[]): ${path}`);
  }
  return data;
}

/**
 * Unified fetch: local file when provided, otherwise the (cached) API.
 */
export async function fetchProwData(opts: {
  file?: string;
  url?: string;
  refresh?: boolean;
} = {}): Promise<{ items: unknown[] }> {
  if (opts.file) {
    return readProwJobsFile(opts.file);
  }
  return fetchProwJobs({ url: opts.url, refresh: opts.refresh });
}

// ---------------------------------------------------------------------------
// Build log URL derivation (public GCS buckets)
// ---------------------------------------------------------------------------

/**
 * Extract the GCS object prefix from a Prow deck URL.
 * In:  https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/BUILD_ID
 * Out: test-platform-results/logs/JOB/BUILD_ID
 */
export function prowUrlToGcsPrefix(prowUrl: string): string | null {
  const marker = "/view/gs/";
  const idx = prowUrl.indexOf(marker);
  if (idx === -1) return null;
  return prowUrl.slice(idx + marker.length);
}

/**
 * Convert a Prow UI URL to the public GCS build-log.txt URL.
 * In:  https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/ID
 * Out: https://storage.googleapis.com/test-platform-results/logs/JOB/ID/build-log.txt
 */
export function prowUrlToBuildLogUrl(prowUrl: string): string | null {
  const gcsPath = prowUrlToGcsPrefix(prowUrl);
  if (gcsPath === null) return null;
  return `https://storage.googleapis.com/${gcsPath}/build-log.txt`;
}

/**
 * Fetch the tail of a Prow build log. Streams the log and keeps only the
 * last `maxLines` lines (build logs can be 10MB+). Returns { logUrl, lines };
 * on HTTP errors returns empty lines instead of throwing.
 */
export async function fetchBuildLogTail(
  prowUrl: string,
  maxLines = 2000,
): Promise<{ logUrl: string; lines: string[] }> {
  const logUrl = prowUrlToBuildLogUrl(prowUrl);
  if (logUrl === null) {
    throw new Error(`Cannot derive build-log URL from: ${prowUrl}`);
  }
  try {
    const res = await fetchWithTimeout(logUrl);
    const body = res.body;
    if (!body) return { logUrl, lines: [] };

    const tail: string[] = [];
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        tail.push(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (tail.length > maxLines) tail.shift();
      }
    }
    if (buf.length) tail.push(buf);
    return { logUrl, lines: tail.slice(-maxLines) };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message.startsWith("HTTP "))) {
      return { logUrl, lines: [] };
    }
    throw err;
  }
}
