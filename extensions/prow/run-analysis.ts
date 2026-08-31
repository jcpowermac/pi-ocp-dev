/**
 * Prow run analysis layer: composes the classify.ts artifact fetchers with
 * the failure.ts signal scanner and the permafail.ts threshold engine.
 *
 * Exposes pure builders (testable without any network) plus two pipeline
 * entry points used by the analyze_prow_run / detect_permafail tools. All
 * network I/O goes through an injectable Fetcher so tests run offline.
 */

import {
  extractFailedTests,
  fetchRunSignature,
  prowUrlToGcsPath,
  type Fetcher,
  type GcsRunRef,
  type RunSignature,
} from "./classify.js";
import {
  candidateReferences,
  classifyJobTypes,
  scanFailureSignals,
  type Signal,
} from "./failure.js";
import {
  detectPermafail,
  validatePermafailInputs,
  type PermafailVerdict,
} from "./permafail.js";

const GCS_HOST = "https://storage.googleapis.com";
const BUILD_LOG_TAIL_LINES = 300;

export interface RunInputs {
  /** Failed e2e test names (junit failures minus passes). */
  failedTests: string[];
  /** Tail of build-log.txt (last 300 lines; [] when missing). */
  buildLogLines: string[];
}

export interface RunAnalysisResult {
  job_name: string;
  build_id: string;
  job_types: string[];
  failed_tests: string[];
  signals: Signal[];
  candidate_references: string[];
  artifact_paths: string[];
}

type FetchOpts = { fetcher?: Fetcher };

const defaultFetcher: Fetcher = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};

async function fetchText(fetcher: Fetcher, url: string): Promise<string | null> {
  const res = await fetcher(url);
  if (res.status < 200 || res.status >= 300) return null;
  return res.body;
}

const runPrefix = (ref: GcsRunRef): string =>
  [ref.path, ref.jobName, ref.buildId].filter(Boolean).join("/");

/**
 * Fetch the inputs for one run's signal scan: junit-derived failed tests
 * and the build-log tail (last 300 lines).
 */
export async function fetchRunInputs(
  ref: GcsRunRef,
  opts: FetchOpts = {},
): Promise<RunInputs> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const [failedTests, logBody] = await Promise.all([
    extractFailedTests(fetcher, ref),
    fetchText(fetcher, `${GCS_HOST}/${ref.bucket}/${runPrefix(ref)}/build-log.txt`),
  ]);
  const lines = logBody === null ? [] : logBody.split("\n");
  return { failedTests, buildLogLines: lines.slice(-BUILD_LOG_TAIL_LINES) };
}

/** Pure: build the compact analysis result from fetched inputs. */
export function buildRunAnalysis(ref: GcsRunRef, inputs: RunInputs): RunAnalysisResult {
  const jobTypes = classifyJobTypes(ref.jobName);
  const signals = scanFailureSignals({
    failedTests: inputs.failedTests,
    buildLogLines: inputs.buildLogLines,
    jobName: ref.jobName,
  });
  const base = `${GCS_HOST}/${ref.bucket}/${runPrefix(ref)}`;
  return {
    job_name: ref.jobName,
    build_id: ref.buildId,
    job_types: jobTypes,
    failed_tests: inputs.failedTests,
    signals,
    candidate_references: candidateReferences(jobTypes, signals),
    artifact_paths: [
      `${base}/build-log.txt`,
      `${base}/artifacts/`,
      `${base}/artifacts/gather-extra/artifacts/`,
      `${base}/artifacts/gather-extra/artifacts/audit_logs/`,
    ],
  };
}

/**
 * Full single-run pipeline from a Prow deck URL or GCS path. The URL is
 * structurally validated by `prowUrlToGcsPath` before any fetch happens.
 */
export async function analyzeProwRun(
  url: string,
  opts: FetchOpts = {},
): Promise<RunAnalysisResult> {
  const ref = prowUrlToGcsPath(url);
  const inputs = await fetchRunInputs(ref, opts);
  return buildRunAnalysis(ref, inputs);
}

/**
 * Full permafail pipeline: validate inputs, structurally route EVERY url
 * through `prowUrlToGcsPath` (so 2-3-segment urls are rejected before any
 * fetch), fetch one signature per run sequentially, apply the thresholds.
 */
export async function runPermafailAnalysis(
  urls: string[],
  jobName: string,
  opts: FetchOpts = {},
): Promise<PermafailVerdict> {
  const validated = validatePermafailInputs(urls, jobName);
  if (!validated.ok) throw new Error(validated.error);
  const refs = validated.urls.map((u) => {
    const ref = prowUrlToGcsPath(u);
    if (ref.jobName && ref.jobName.toLowerCase() !== jobName.toLowerCase()) {
      throw new Error(
        `job_name "${jobName}" does not match URL job name "${ref.jobName}" (${u})`,
      );
    }
    return ref;
  });
  const signatures: RunSignature[] = [];
  for (const ref of refs) {
    signatures.push(await fetchRunSignature(ref, opts));
  }
  return detectPermafail(signatures);
}
