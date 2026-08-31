/**
 * Prow run failure-signature extraction (port of
 * openshift-eng/ai-helpers plugins/ci/scripts/classify-job-failures.py).
 *
 * Deliberate deviations from the upstream script:
 *  - No gcsweb HTML scraping. Artifacts are discovered via the public GCS
 *    JSON listing API and fetched from storage.googleapis.com.
 *  - Error hashes are sha256 hex (Node built-in) instead of MD5.
 *
 * All network I/O goes through the injectable Fetcher so tests run offline.
 */

import { createHash } from "node:crypto";

export type Fetcher = (
  url: string,
) => Promise<{ status: number; body: string }>;

const defaultFetcher: Fetcher = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};

export interface GcsRunRef {
  bucket: string;
  /** Intermediate path parts between bucket and job (e.g. "logs", "pr-logs/pull/..."). */
  path: string;
  buildId: string;
  jobName: string;
}

export interface RunSignature {
  buildId: string;
  failureType: "test_failure" | "infra_failure" | "success";
  /** Failed test names (test_failure only). */
  tests: string[];
  /** Normalized infra errors (infra_failure only). */
  errors: { message: string; hash: string }[];
}

const GCS_HOST = "https://storage.googleapis.com";
const GCS_JSON_BASE = "https://storage.googleapis.com/storage/v1";

const TEST_PATH_PATTERNS = [
  "e2e-",
  "openshift-e2e-test",
  "openshift-tests-",
  "monitor-test-",
];
const INFRA_STEP_PREFIXES = ["ipi-install", "gather-", "pull-ci-"];
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;

const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 4;
const JUNIT_MAX_FILES = 20;
const LOG_TAIL_LINES = 300;
const MESSAGE_MAX_CHARS = 300;

// ---------------------------------------------------------------------------
// URL / path parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Prow deck URL (`/view/gs/...`), a `gs://` URL, a
 * storage.googleapis.com URL, or a raw `bucket/path/.../JOB/BUILD_ID` string.
 */
export function prowUrlToGcsPath(input: string): GcsRunRef {
  let raw = input;
  if (raw.startsWith("gs://")) {
    raw = raw.slice("gs://".length);
  } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const marker = "/view/gs/";
    const idx = raw.indexOf(marker);
    if (idx !== -1) {
      raw = decodeURIComponent(raw.slice(idx + marker.length));
    } else if (
      raw.startsWith("http://storage.googleapis.com/") ||
      raw.startsWith("https://storage.googleapis.com/")
    ) {
      const marker = "storage.googleapis.com/";
      raw = raw.slice(raw.indexOf(marker) + marker.length);
    } else {
      throw new Error(`not a Prow deck URL or GCS path: ${input}`);
    }
  }
  raw = decodeURIComponent(raw).replace(/^\/+|\/+$/g, "");
  const parts = raw.split("/");
  if (parts.length < 3 || parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`GCS path needs bucket/.../JOB/BUILD_ID: ${input}`);
  }
  return {
    bucket: parts[0],
    path: parts.slice(1, -2).join("/"),
    buildId: parts[parts.length - 1],
    jobName: parts[parts.length - 2],
  };
}

const gcsObjectUrl = (bucket: string, name: string): string =>
  `${GCS_HOST}/${bucket}/${name}`;

const gcsListUrl = (bucket: string, prefix: string, pageToken?: string): string => {
  const params = new URLSearchParams({
    prefix,
    maxResults: String(LIST_PAGE_SIZE),
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `${GCS_JSON_BASE}/b/${bucket}/o?${params.toString()}`;
};

// ---------------------------------------------------------------------------
// Error normalization (port of upstream normalize_error)
// ---------------------------------------------------------------------------

export function normalizeErrorMessage(message: string): string {
  let normalized = message.replace(ANSI_ESCAPE_RE, "");
  normalized = normalized.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g,
    "",
  );
  normalized = normalized.replace(
    /\b\d+\.\d+\.\d+-\d+\.ci-\d{4}-\d{2}-\d{2}-\d{6}-[A-Za-z0-9-]+\b/g,
    "release-*",
  );
  normalized = normalized.replace(
    /\b\d+\.\d+\.\d+-\d+\.nightly-\d{4}-\d{2}-\d{2}-\d{6}\b/g,
    "release-*",
  );
  normalized = normalized.replace(/\btest-ci-op-[A-Za-z0-9-]+\b/g, "test-ci-op-*");
  normalized = normalized.replace(/\bci-op-[A-Za-z0-9-]+\b/g, "ci-op-*");
  normalized = normalized.replace(/\bbuild[-_][A-Za-z0-9_.-]+\b/g, "build-*");
  normalized = normalized.replace(/\bpod[-_][A-Za-z0-9_.-]+\b/g, "pod-*");
  normalized = normalized.replace(/\b[0-9a-f]{8,}\b/gi, "*");
  normalized = normalized.replace(
    /\b\d+(?:\.\d+)?\s*(?:m|Mi|Gi|Ki|G|M|cpu|cores?)\b/g,
    "*",
  );
  // Port of python str.strip(" :-"): drop leading/trailing space/colon/dash.
  normalized = normalized.replace(/\s+/g, " ").replace(/^[\s: -]+|[\s: -]+$/g, "");
  return normalized.slice(0, MESSAGE_MAX_CHARS);
}

export function hashError(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// JUnit parsing
// ---------------------------------------------------------------------------

function testcaseName(tag: string): string {
  const attr = (re: RegExp): string => {
    const m = tag.match(re);
    return m ? m[1].trim() : "";
  };
  const classname = attr(/classname="([^"]*)"/);
  // Leading non-word char so `name=` does not match inside `classname=`.
  const name = attr(/[^a-z]name="([^"]*)"/);
  if (classname && name) return `${classname} ${name}`;
  return name || classname;
}

/**
 * Collect test names that failed and never passed in one JUnit document.
 * Informing testcases are skipped (they do not determine job status).
 */
function junitFailuresAndPasses(xmlText: string): {
  failures: Set<string>;
  passes: Set<string>;
} {
  const failures = new Set<string>();
  const passes = new Set<string>();
  const blocks = xmlText.split(/<testcase[\s>]/).slice(1);
  for (const block of blocks) {
    const header = block.split(">", 1)[0] + ">";
    const name = testcaseName(header);
    if (!name) continue;
    const lifecycle = /lifecycle="([^"]*)"/.exec(header)?.[1] ?? "";
    if (lifecycle === "informing") continue;
    const failed =
      /<(failure|error)\b/.test(block) || /<(failure|error)\/>/.test(block);
    if (failed) {
      failures.add(name);
    } else if (!/<skipped\b/.test(block)) {
      passes.add(name);
    }
  }
  return { failures, passes };
}

/**
 * JUnit file filter (port of upstream is_test_junit): test-runner paths
 * only, no gather artifacts, excluding symptoms/operator summary files.
 */
function isTestJunit(objectName: string): boolean {
  const lower = objectName.toLowerCase();
  if (!lower.endsWith(".xml") || !lower.includes("junit")) return false;
  if (lower.endsWith("junit_symptoms.xml") || lower.endsWith("junit_operator.xml")) {
    return false;
  }
  if (lower.split("/").some((part) => part.startsWith("gather-"))) return false;
  return TEST_PATH_PATTERNS.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// Build log scanning (ports of upstream extract_error_line / step detection)
// ---------------------------------------------------------------------------

const FAIL_WORD_RE = /\b(error|failed|failure|timeout|timed out|exceeded|denied)\b/i;
const SKIP_LOG_LINE = /Reporting job state/;

const PRIORITY_ERROR_PATTERNS = [
  /failed to initialize the cluster/i,
  /unable to import .*release image/i,
  /cluster operator .*degraded/i,
  /\* could not run steps/i,
  /suite run returned error/i,
  /error running a test suite/i,
];

/**
 * Pick the most informative error line from the tail of a build log
 * (last 300 lines, error-keyword scan, priority patterns win).
 * The tail is scanned newest-first (port of upstream extract_error_line),
 * so both the priority match and the fallback return the most recent line.
 */
export function extractErrorLine(logLines: string[]): string {
  const candidates: string[] = [];
  for (const line of logLines.slice(-LOG_TAIL_LINES).reverse()) {
    const stripped = line.replace(ANSI_ESCAPE_RE, "").trim();
    if (!stripped || SKIP_LOG_LINE.test(stripped)) continue;
    if (FAIL_WORD_RE.test(stripped)) candidates.push(stripped);
  }
  if (candidates.length === 0) return "";
  for (const pattern of PRIORITY_ERROR_PATTERNS) {
    for (const candidate of candidates) {
      if (pattern.test(candidate)) return candidate;
    }
  }
  return candidates[0];
}

// [pattern, step-capture-group-index]
const STEP_FAIL_PATTERNS: [RegExp, number][] = [
  [/\bstep[- _]?([a-z0-9][a-z0-9-]*)\b[^|\n]*\b(fail\w*|error|timed?\s*out)\b/i, 1],
  [/\b(fail\w*|error)\b[^|\n]*\bstep[- _]?([a-z0-9][a-z0-9-]*)/i, 2],
];

/** Step names that a build log reports as failed. */
export function failingSteps(logLines: string[]): string[] {
  const steps = new Set<string>();
  for (const line of logLines) {
    for (const [pattern, group] of STEP_FAIL_PATTERNS) {
      const m = pattern.exec(line);
      const step = m?.[group];
      if (step) steps.add(step.toLowerCase());
    }
  }
  return [...steps];
}

export function isInfraStep(step: string): boolean {
  return INFRA_STEP_PREFIXES.some((prefix) => step.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Error grouping (upstream rule: exact hash match or >70% string similarity)
// ---------------------------------------------------------------------------

export interface ErrorGroup {
  /** Representative (first-seen) message of the group. */
  message: string;
  hash: string;
  count: number;
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Group errors by exact hash match or >70% token-level similarity with the
 * group's representative message. Groups keep first-occurrence order.
 */
export function groupErrors(
  errors: { message: string; hash: string }[],
): ErrorGroup[] {
  const groups: ErrorGroup[] = [];
  for (const error of errors) {
    const group = groups.find(
      (g) =>
        g.hash === error.hash ||
        tokenSimilarity(g.message, error.message) > 0.7,
    );
    if (group) {
      group.count += 1;
    } else {
      groups.push({ message: error.message, hash: error.hash, count: 1 });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Run signature fetch
// ---------------------------------------------------------------------------

async function fetchText(
  fetcher: Fetcher,
  url: string,
): Promise<string | null> {
  const res = await fetcher(url);
  if (res.status < 200 || res.status >= 300) return null;
  return res.body;
}

async function listRunObjects(
  fetcher: Fetcher,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const body = await fetchText(fetcher, gcsListUrl(bucket, prefix, pageToken));
    if (body === null) break;
    let data: { items?: { name?: string }[]; nextPageToken?: string };
    try {
      data = JSON.parse(body);
    } catch {
      break;
    }
    for (const item of data.items ?? []) {
      if (item.name) names.push(item.name);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return names;
}

/** Failed tests aggregated across all junit files: failures minus passes. */
export async function extractFailedTests(
  fetcher: Fetcher,
  ref: GcsRunRef,
): Promise<string[]> {
  const runRoot = [ref.path, ref.jobName, ref.buildId]
    .filter(Boolean)
    .join("/");
  const objects = await listRunObjects(
    fetcher,
    ref.bucket,
    `${runRoot}/artifacts/`,
  );
  const junitNames = objects
    .filter((name) => isTestJunit(name))
    .slice(0, JUNIT_MAX_FILES);
  if (junitNames.length === 0) return [];

  const allFailures = new Set<string>();
  const allPasses = new Set<string>();
  for (const name of junitNames) {
    const xmlText = await fetchText(fetcher, gcsObjectUrl(ref.bucket, name));
    if (xmlText === null) continue;
    const { failures, passes } = junitFailuresAndPasses(xmlText);
    for (const t of failures) allFailures.add(t);
    for (const t of passes) allPasses.add(t);
  }
  // Real failures: failed and never passed (flakes drop out).
  const real = [...allFailures].filter((t) => !allPasses.has(t));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const test of real) {
    const normalized = test.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped.sort();
}

/**
 * Extract a normalized failure signature for one Prow run from public GCS.
 * Accepts a pre-parsed `GcsRunRef` or anything `prowUrlToGcsPath` accepts.
 */
export async function fetchRunSignature(
  bucketPath: GcsRunRef | string,
  opts: { fetcher?: Fetcher } = {},
): Promise<RunSignature> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const ref =
    typeof bucketPath === "string" ? prowUrlToGcsPath(bucketPath) : bucketPath;
  const base = { buildId: ref.buildId } as const;

  const tests = await extractFailedTests(fetcher, ref);
  if (tests.length > 0) {
    return { ...base, failureType: "test_failure", tests, errors: [] };
  }

  const logBody = await fetchText(
    fetcher,
    gcsObjectUrl(
      ref.bucket,
      [ref.path, ref.jobName, ref.buildId].filter(Boolean).join("/") +
        "/build-log.txt",
    ),
  );
  const logLines = logBody === null ? [] : logBody.split("\n");

  const steps = failingSteps(logLines);
  const hasInfraStepFailure = steps.some(isInfraStep);
  const errorLine = extractErrorLine(logLines);
  if (hasInfraStepFailure || errorLine) {
    const message =
      normalizeErrorMessage(errorLine) ||
      `step ${steps.find(isInfraStep)} failed`;
    return {
      ...base,
      failureType: "infra_failure",
      tests: [],
      errors: [{ message, hash: hashError(message) }],
    };
  }
  return { ...base, failureType: "success", tests: [], errors: [] };
}
