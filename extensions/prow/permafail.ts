/**
 * Deterministic permafail threshold engine (port of the "Permafail Detection
 * Logic" sections of openshift-eng/ai-helpers plugins/ci/skills/
 * detect-permafail/SKILL.md).
 *
 * Pure functions over RunSignature values: no network I/O. Thresholds apply
 * per failure type against N = count of comparable runs of that type:
 *   N=2-3 → 100%; N=4-5 → ≥4; N=6-10 → ceil(N×0.7).
 * A type with fewer than 2 comparable runs can never establish a pattern
 * ("minimum runs requirement" from the upstream skill).
 */

import { groupErrors, type RunSignature } from "./classify.js";

export interface PermafailVerdict {
  permafail: boolean;
  failure_type: "test_failure" | "infra_failure" | "mixed";
  /** Slash-form ratio of the dominant (or strongest) pattern, e.g. "7/10". */
  match_ratio: string;
  matching_runs: number;
  comparable_runs: number;
  threshold_required: number;
  /** Confidence in the verdict: 0.99 / 0.92 / 0.85 / 0.88 / 0.70 (0.99 for all-success). */
  confidence: number;
  /** Slash-form ratios and the strongest pattern; includes "insufficient"
   *  when a failure type has fewer than 2 comparable runs. */
  reason: string;
}

export interface ValidatedPermafailInput {
  ok: true;
  urls: string[];
  jobName: string;
}

export interface InvalidPermafailInput {
  ok: false;
  error: string;
}

export type PermafailInputResult = ValidatedPermafailInput | InvalidPermafailInput;

const PROW_URL_RE =
  /^https:\/\/prow\.ci\.openshift\.org\/view\/gs\/[^/]+(\/[^/]+)+$/;

/**
 * Validate URL-based inputs before signature fetching (upstream Step 1).
 * Returns a discriminated result: `{ ok: true, urls, jobName }` on success,
 * `{ ok: false, error }` with a human-readable reason on failure.
 */
export function validatePermafailInputs(
  urls: string[],
  jobName: string,
): PermafailInputResult {
  if (!Array.isArray(urls)) {
    return { ok: false, error: "failure_urls must be an array of Prow URLs" };
  }
  if (urls.length < 2 || urls.length > 10) {
    return {
      ok: false,
      error: `failure_urls must contain 2-10 Prow URLs (got ${urls.length})`,
    };
  }
  for (const url of urls) {
    if (typeof url !== "string" || !PROW_URL_RE.test(url)) {
      return {
        ok: false,
        error: `URL does not match the Prow deck URL pattern (https://prow.ci.openshift.org/view/gs/<bucket>/<path>/<job-name>/<build-id>): ${url}`,
      };
    }
  }
  if (typeof jobName !== "string" || jobName.trim() === "") {
    return { ok: false, error: "job_name must be a non-empty string" };
  }
  return { ok: true, urls, jobName };
}

// ---------------------------------------------------------------------------
// Per-type pattern analysis
// ---------------------------------------------------------------------------

interface TypePattern {
  type: "test_failure" | "infra_failure";
  /** Number of comparable (failure) runs of this type. */
  n: number;
  /** Number of runs containing the strongest pattern. */
  matching: number;
  /** Threshold required for `n` comparable runs. */
  threshold: number;
  meets: boolean;
  /** True when every comparable run carries the identical pattern. */
  identical: boolean;
  /** Strongest test name or error message ("" when n === 0). */
  label: string;
}

function thresholdFor(n: number): number {
  if (n <= 3) return n; // 2-3 comparable runs: 100%
  if (n <= 5) return 4; // 4-5 comparable runs: 80%
  return Math.ceil(n * 0.7); // 6-10 comparable runs: 70%
}

/** Token-level Jaccard similarity, same rule as classify.ts groupErrors. */
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

function analyzeTestRuns(runs: RunSignature[]): TypePattern {
  const n = runs.length;
  if (n === 0) {
    return { type: "test_failure", n, matching: 0, threshold: 0, meets: false, identical: false, label: "" };
  }
  // Count runs containing each unique test name, first-occurrence order.
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const test of new Set(run.tests)) {
      counts.set(test, (counts.get(test) ?? 0) + 1);
    }
  }
  let label = "";
  let matching = 0;
  for (const [test, count] of counts) {
    if (count > matching) {
      matching = count;
      label = test;
    }
  }
  const threshold = thresholdFor(n);
  const identical = runs.every(
    (run) =>
      run.tests.length > 0 &&
      [...run.tests].sort().join("\u0000") === [...runs[0].tests].sort().join("\u0000"),
  );
  return {
    type: "test_failure",
    n,
    matching,
    threshold,
    meets: n >= 2 && matching >= threshold,
    identical,
    label,
  };
}

function analyzeInfraRuns(runs: RunSignature[]): TypePattern {
  const n = runs.length;
  if (n === 0) {
    return { type: "infra_failure", n, matching: 0, threshold: 0, meets: false, identical: false, label: "" };
  }
  const groups = groupErrors(runs.flatMap((run) => run.errors));
  // Assign each run's errors to the first matching group (exact hash or
  // >70% token similarity with the group's representative message).
  const runGroupIndex = runs.map((run) => {
    const seen = new Set<number>();
    for (const error of run.errors) {
      const idx = groups.findIndex(
        (g) => g.hash === error.hash || tokenSimilarity(g.message, error.message) > 0.7,
      );
      if (idx !== -1) seen.add(idx);
    }
    return seen;
  });
  let label = "";
  let matching = 0;
  groups.forEach((group, idx) => {
    const inGroup = runGroupIndex.filter((seen) => seen.has(idx)).length;
    if (inGroup > matching) {
      matching = inGroup;
      label = group.message;
    }
  });
  const threshold = thresholdFor(n);
  const identical =
    groups.length === 1 && runs.every((run) => run.errors.every((e) => e.hash === groups[0].hash));
  return {
    type: "infra_failure",
    n,
    matching,
    threshold,
    meets: n >= 2 && matching >= threshold,
    identical,
    label,
  };
}

// ---------------------------------------------------------------------------
// Verdict assembly
// ---------------------------------------------------------------------------


function confidenceFor(trigger: TypePattern): number {
  if (trigger.identical) return 0.99;
  if (trigger.matching > trigger.threshold) return 0.92;
  return trigger.type === "test_failure" ? 0.85 : 0.88;
}

/**
 * Detect whether a set of run signatures forms a permafail pattern.
 *
 * `signatures` must contain 2-10 runs (success runs are ignored for
 * comparable-run counts). Throws on empty or oversized input.
 */
export function detectPermafail(signatures: RunSignature[]): PermafailVerdict {
  if (signatures.length < 2 || signatures.length > 10) {
    throw new Error(`detectPermafail requires 2-10 run signatures (got ${signatures.length})`);
  }

  const testP = analyzeTestRuns(signatures.filter((s) => s.failureType === "test_failure"));
  const infraP = analyzeInfraRuns(signatures.filter((s) => s.failureType === "infra_failure"));
  const permafail = testP.meets || infraP.meets;

  // Dominant pattern on permafail: higher ratio wins; tie → test_failure.
  const trigger: TypePattern | null = permafail
    ? dominantPattern(testP, infraP)
    : null;

  const failureType: PermafailVerdict["failure_type"] = permafail
    ? trigger!.type
    : testP.n > 0 && infraP.n > 0
      ? "mixed"
      : testP.n > 0
        ? "test_failure"
        : infraP.n > 0
          ? "infra_failure"
          : "mixed"; // all-success

  // Strongest overall pattern drives the ratio fields for non-permafail.
  const shown = trigger ?? strongestOverall(testP, infraP);

  const verdict: PermafailVerdict = {
    permafail,
    failure_type: failureType,
    match_ratio: `${shown.matching}/${shown.n}`,
    matching_runs: shown.matching,
    comparable_runs: shown.n,
    threshold_required: shown.threshold,
    confidence: permafail ? confidenceFor(trigger!) : shown.n === 0 ? 0.99 : 0.7,
    reason: buildReason(permafail, trigger, testP, infraP, signatures.length),
  };
  return verdict;
}

function dominantPattern(testP: TypePattern, infraP: TypePattern): TypePattern {
  if (!infraP.meets) return testP;
  if (!testP.meets) return infraP;
  const testRatio = testP.matching / testP.n;
  const infraRatio = infraP.matching / infraP.n;
  return testRatio >= infraRatio ? testP : infraP;
}

function strongestOverall(testP: TypePattern, infraP: TypePattern): TypePattern {
  // Only comparable types (n >= 2) can contribute a dominant pattern: an
  // insufficient type's trivial 1/1 ratio must not dominate (upstream eval
  // case-004 reports 1/6, not the 1/1 test ratio).
  let candidates = [testP, infraP].filter((p) => p.n >= 2);
  if (candidates.length === 0) {
    // No comparable group: fall back to any failure type (test preferred) so
    // the ratio fields still describe the strongest observed pattern.
    candidates = [testP, infraP].filter((p) => p.n >= 1);
  }
  if (candidates.length === 0) return testP; // all-success: 0/0
  // Higher ratio first, then more matches, then test_failure on tie.
  return candidates.reduce((best, p) => {
    const bestRatio = best.matching / best.n;
    const pRatio = p.matching / p.n;
    if (pRatio > bestRatio) return p;
    if (pRatio === bestRatio && p.matching > best.matching) return p;
    return best;
  }, candidates[0]);
}

function typeReason(p: TypePattern, permafail: boolean): string {
  const pattern =
    p.type === "test_failure"
      ? `${p.matching}/${p.n} ${p.type} runs failed ${p.label}`
      : `${p.matching}/${p.n} ${p.type} runs share the strongest error '${p.label}'`;
  if (permafail) {
    return `${pattern}, meeting the required ${p.threshold}/${p.n} threshold`;
  }
  if (p.n < 2) {
    return `${pattern} (insufficient comparable runs)`;
  }
  return `${pattern}, below the required ${p.threshold}/${p.n} threshold`;
}

function buildReason(
  permafail: boolean,
  trigger: TypePattern | null,
  testP: TypePattern,
  infraP: TypePattern,
  totalRuns: number,
): string {
  if (testP.n === 0 && infraP.n === 0) {
    return `All ${totalRuns} runs succeeded; no failures to analyze.`;
  }
  if (permafail && trigger) {
    let reason = typeReason(trigger, true);
    const other: TypePattern | null = trigger.type === "test_failure" ? infraP : testP;
    if (other.n > 0) {
      reason += other.meets
        ? ` Additionally, ${typeReason(other, true)}.`
        : ` ${other.n} additional ${other.type} run${other.n === 1 ? "" : "s"} did not show a consistent pattern and do not affect this verdict.`;
    }
    return reason;
  }
  const parts: string[] = [];
  if (testP.n > 0) parts.push(typeReason(testP, false));
  if (infraP.n > 0) parts.push(typeReason(infraP, false));
  const suffix =
    testP.n > 0 && infraP.n > 0
      ? "; no consistent pattern found in test failures or infrastructure failures."
      : ".";
  return parts.join(" and ") + suffix;
}
