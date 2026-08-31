/**
 * CI failure classification and triage engine.
 *
 * Classifies PR CI failures into pr_caused, infrastructure, pre_existing,
 * flake, or out_of_scope per TRT-2831 guardrails.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { RunAnalysisResult } from "../prow/run-analysis.js";
import { analyzeProwRun } from "../prow/run-analysis.js";
import { checkIsOptionalProwJob } from "./optional.js";
import { getPrDiffFiles, type PrDiffContext } from "./diff.js";

const execFileAsync = promisify(execFile);

export type CiClassification =
  | "pr_caused"
  | "infrastructure"
  | "pre_existing"
  | "flake"
  | "out_of_scope";

export interface CiTriageVerdict {
  classification: CiClassification;
  action: "fix" | "report";
  reason: string;
  evidence: string;
}

export interface CiCheckInput {
  name: string;
  state: string;
  bucket: string;
  link?: string;
}

export interface CiTriageResultItem {
  name: string;
  link?: string;
  optional: boolean;
  classification: CiClassification;
  action: "fix" | "report";
  reason: string;
  evidence: string;
}

export interface CiTriageSummary {
  total: number;
  pr_caused: number;
  non_actionable: number;
  results: CiTriageResultItem[];
}

const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "Pipfile.lock",
  "poetry.lock",
  "Cargo.toml",
  "Cargo.lock",
]);

function isDependencyFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (DEPENDENCY_FILES.has(base)) return true;
  if (filePath.startsWith("vendor/") || filePath.startsWith("Godeps/")) return true;
  return false;
}

/**
 * Classify a single CI failure based on PR diff context, optional status, and Prow run analysis.
 */
export function classifyCiFailure(
  checkName: string,
  isOptional: boolean,
  analysis: RunAnalysisResult | null,
  diff: PrDiffContext | { changedFiles: string[]; changedPackages: string[] },
): CiTriageVerdict {
  const diffFiles = new Set(diff.changedFiles || []);
  const diffBasenames = new Set((diff.changedFiles || []).map((f) => path.basename(f)));
  const diffPkgs = new Set(diff.changedPackages || []);

  const allEvidenceLines: string[] = [];
  if (analysis) {
    for (const sig of analysis.signals) {
      allEvidenceLines.push(...sig.evidence);
    }
  }
  const evidenceText = allEvidenceLines.join("\n");

  // 1. Check for infrastructure failures
  if (analysis) {
    for (const sig of analysis.signals) {
      if (
        sig.name === "ci-infrastructure" ||
        sig.name === "cloud-provider" ||
        sig.name === "resource-exhaustion"
      ) {
        const primaryEvidence = sig.evidence.slice(0, 3).join("\n") || `${sig.name} error detected`;
        return {
          classification: "infrastructure",
          action: "report",
          reason: `Infrastructure failure (${sig.sub_category || sig.name})`,
          evidence: primaryEvidence,
        };
      }
    }

    const infraKeywords = [
      /pod_pending/i,
      /acquiring_lease/i,
      /acquiring_cluster_claim/i,
      /importing_release/i,
      /building_image/i,
      /resolving_step/i,
      /boskos/i,
    ];
    for (const kw of infraKeywords) {
      if (kw.test(evidenceText)) {
        return {
          classification: "infrastructure",
          action: "report",
          reason: "CI platform infrastructure failure",
          evidence: allEvidenceLines.find((l) => kw.test(l)) || "CI platform failure",
        };
      }
    }
  }

  // 2. Check for CVE / security audit findings on unchanged dependencies
  const isAuditOrLint = /audit|lint|security|vulnerability|cve/i.test(checkName);
  const mentionsCveOrAudit = /npm audit|yarn audit|vulnerabilit|cve-/i.test(evidenceText);
  if (isAuditOrLint || mentionsCveOrAudit) {
    const hasDepChanges = (diff.changedFiles || []).some(isDependencyFile);
    if (!hasDepChanges && mentionsCveOrAudit) {
      return {
        classification: "pre_existing",
        action: "report",
        reason: "Pre-existing CVE / dependency finding on unchanged dependencies",
        evidence: allEvidenceLines.find((l) => /audit|vulnerabilit|cve/i.test(l)) || evidenceText.slice(0, 200),
      };
    }
  }

  // 3. Check for PR diff overlap (pr_caused)
  let exactFileMatch: string | null = null;
  let packageMatch: string | null = null;
  let matchEvidence = "";

  if (analysis) {
    const failedTestNames = analysis.failed_tests || [];

    // Check failed test names against changed packages or changed file stems
    for (const testName of failedTestNames) {
      for (const pkg of diffPkgs) {
        if (testName.includes(pkg) || testName.includes(path.basename(pkg))) {
          packageMatch = pkg;
          matchEvidence = `Failed test: ${testName}`;
          break;
        }
      }
      for (const base of diffBasenames) {
        const stem = base.replace(/(_test)?\.[a-z]+$/, "");
        if (stem && stem.length > 3 && testName.toLowerCase().includes(stem.toLowerCase())) {
          exactFileMatch = base;
          matchEvidence = `Failed test: ${testName} (${base})`;
          break;
        }
      }
    }

    // Check signals evidence for exact modified file references
    for (const sig of analysis.signals) {
      for (const line of sig.evidence) {
        for (const f of diffFiles) {
          if (line.includes(f)) {
            exactFileMatch = f;
            matchEvidence = failedTestNames.length > 0 ? `${failedTestNames.join(", ")}: ${line}` : line;
            break;
          }
        }
        if (!exactFileMatch) {
          for (const baseName of diffBasenames) {
            if (baseName.endsWith(".go") || baseName.endsWith(".ts") || baseName.endsWith(".py")) {
              if (line.includes(baseName)) {
                exactFileMatch = baseName;
                matchEvidence = failedTestNames.length > 0 ? `${failedTestNames.join(", ")}: ${line}` : line;
                break;
              }
            }
          }
        }
        if (exactFileMatch) break;
      }
      if (exactFileMatch) break;
    }
  }

  // TRT-2831: Optional jobs require slam-dunk exact file match
  if (isOptional) {
    if (exactFileMatch) {
      return {
        classification: "pr_caused",
        action: "fix",
        reason: `Optional job with direct file match in PR diff: ${exactFileMatch}`,
        evidence: matchEvidence || `Failure references ${exactFileMatch}`,
      };
    }
    return {
      classification: "out_of_scope",
      action: "report",
      reason: "Optional check with no direct file match in PR diff (TRT-2831 guardrail)",
      evidence: matchEvidence || (analysis?.failed_tests?.[0] ? `Failed test: ${analysis.failed_tests[0]}` : "Optional job failure"),
    };
  }

  if (exactFileMatch || packageMatch) {
    return {
      classification: "pr_caused",
      action: "fix",
      reason: exactFileMatch
        ? `Error references modified file: ${exactFileMatch}`
        : `Failed test in modified package: ${packageMatch}`,
      evidence: matchEvidence || `Failure in ${exactFileMatch || packageMatch}`,
    };
  }

  // 4. Flake detection (disruption or flaky signal without diff match)
  if (analysis) {
    const isDisruption = analysis.signals.some((s) => s.name === "disruption");
    const isFlaky = analysis.signals.some((s) => s.name === "flaky");
    if (isDisruption || isFlaky) {
      const flakeLine =
        analysis.signals.find((s) => s.name === "disruption")?.evidence[0] ||
        analysis.signals.find((s) => s.name === "flaky")?.evidence[0] ||
        analysis.failed_tests[0] ||
        "Flaky test or disruption failure";
      return {
        classification: "flake",
        action: "report",
        reason: isDisruption ? "Backend disruption during test run" : "Known flaky test pattern without diff overlap",
        evidence: flakeLine,
      };
    }
  }

  // 5. Default when uncertain: pre_existing (report)
  const defaultEvidence =
    allEvidenceLines[0] ||
    analysis?.failed_tests[0] ||
    `Check ${checkName} failed without direct correlation to PR changes`;

  return {
    classification: "pre_existing",
    action: "report",
    reason: "No correlation with modified files in PR diff (defaulting to pre-existing)",
    evidence: defaultEvidence,
  };
}

export interface TriageOptions {
  getDiffFn?: (owner: string, repo: string, prNumber: number) => Promise<PrDiffContext>;
  isOptionalFn?: (link: string) => Promise<boolean>;
  analyzeProwFn?: (url: string) => Promise<RunAnalysisResult>;
}

export async function triagePrCiFailures(
  owner: string,
  repo: string,
  prNumber: number,
  checks: CiCheckInput[],
  options?: TriageOptions,
): Promise<CiTriageSummary> {
  const getDiff = options?.getDiffFn ?? getPrDiffFiles;
  const isOptional = options?.isOptionalFn ?? checkIsOptionalProwJob;
  const analyzeProw = options?.analyzeProwFn ?? analyzeProwRun;

  const diff = await getDiff(owner, repo, prNumber);
  const results: CiTriageResultItem[] = [];

  for (const check of checks) {
    // Ignore tide
    if (check.name === "tide" || check.name.endsWith("/tide")) {
      continue;
    }
    if (check.bucket !== "fail" && check.state !== "FAILURE" && check.state !== "ERROR") {
      continue;
    }

    const opt = check.link ? await isOptional(check.link) : false;
    let analysis: RunAnalysisResult | null = null;
    if (check.link && check.link.includes("prow.ci.openshift.org")) {
      try {
        analysis = await analyzeProw(check.link);
      } catch {}
    }

    const verdict = classifyCiFailure(check.name, opt, analysis, diff);
    results.push({
      name: check.name,
      link: check.link,
      optional: opt,
      classification: verdict.classification,
      action: verdict.action,
      reason: verdict.reason,
      evidence: verdict.evidence,
    });
  }

  const prCausedCount = results.filter((r) => r.action === "fix").length;
  return {
    total: results.length,
    pr_caused: prCausedCount,
    non_actionable: results.length - prCausedCount,
    results,
  };
}

export async function postCiFailureReport(
  owner: string,
  repo: string,
  prNumber: number,
  checkName: string,
  classification: string,
  evidence: string,
  actionNeeded?: string,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const execGh =
    runGh ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args);
      return stdout;
    });

  const body = `**CI failure (not fixing):** ${checkName}

**Classification:** ${classification}

**Evidence:** ${evidence}

**Action needed:** ${actionNeeded || "Human or infra follow-up required — not addressed in this PR."}

---
*AI-assisted response*`;

  try {
    const raw = await execGh([
      "api",
      `repos/${owner}/${repo}/issues/${prNumber}/comments`,
      "-f",
      `body=${body}`,
    ]);
    const parsed = JSON.parse(raw);
    return {
      success: true,
      url: parsed.html_url,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Failed to post CI failure report: ${err?.message || err}`,
    };
  }
}
