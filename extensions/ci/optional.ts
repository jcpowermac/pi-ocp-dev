/**
 * ProwJob optional check detection.
 *
 * Checks if a Prow check is optional by fetching its prowjob.json from GCS/gcsweb.
 * A job is optional if spec.optional is true or the label prow.k8s.io/is-optional=true.
 */

import https from "node:https";
import { URL } from "node:url";

export const GCSWEB_PREFIX = "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/";
export const STORAGE_PREFIX = "https://storage.googleapis.com/";

export const ALLOWED_LINK_HOSTS = new Set([
  "prow.ci.openshift.org",
  "gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com",
  "storage.googleapis.com",
]);

const OPTIONAL_LABEL = "prow.k8s.io/is-optional";
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "pi-ocp-dev/optional-checker";

export function gcsPathFromLink(link: string): string | null {
  if (!link || link.includes("..")) return null;
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "https:" || !ALLOWED_LINK_HOSTS.has(parsed.hostname)) {
      return null;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    for (const marker of ["/view/gs/", "/view/gcs/", "/gcs/"]) {
      if (path.includes(marker)) {
        const gcsPath = path.split(marker)[1].replace(/^\/+|\/+$/g, "");
        if (gcsPath && !gcsPath.split("/").includes("..")) {
          return gcsPath;
        }
      }
    }
  } catch {}
  return null;
}

export function prowjobJsonUrls(link: string): string[] {
  const gcsPath = gcsPathFromLink(link);
  if (!gcsPath) return [];
  const suffix = `${gcsPath}/prowjob.json`;
  return [`${GCSWEB_PREFIX}${suffix}`, `${STORAGE_PREFIX}${suffix}`];
}

export function isOptionalProwJobData(prowjob: any): boolean {
  if (!prowjob || typeof prowjob !== "object") return false;
  if (prowjob.spec?.optional === true) return true;
  const labels = prowjob.metadata?.labels || {};
  return String(labels[OPTIONAL_LABEL] || "").toLowerCase() === "true";
}

export function fetchJson(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": USER_AGENT },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
    });

    req.on("error", reject);
  });
}

export async function checkIsOptionalProwJob(
  link: string,
  fetcher: (url: string) => Promise<any> = fetchJson,
): Promise<boolean> {
  const urls = prowjobJsonUrls(link);
  if (urls.length === 0) return false;

  for (const url of urls) {
    try {
      const data = await fetcher(url);
      if (data) {
        return isOptionalProwJobData(data);
      }
    } catch {}
  }

  return false;
}
