import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  triagePrCiFailures,
  postCiFailureReport,
  type CiCheckInput,
} from "./triage.js";

const execFileAsync = promisify(execFile);

async function resolvePrAndRepo(
  params: { prNumber?: number; repo?: string },
  execGh?: (args: string[]) => Promise<string>,
): Promise<{ owner: string; repoName: string; prNumber: number }> {
  const runner =
    execGh ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args);
      return stdout;
    });

  let repoStr = params.repo;
  if (!repoStr) {
    try {
      const out = await runner(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
      repoStr = out.trim();
    } catch {
      repoStr = "openshift/origin";
    }
  }

  let prNum = params.prNumber;
  if (!prNum) {
    try {
      const out = await runner(["pr", "view", "--json", "number", "-q", ".number"]);
      prNum = parseInt(out.trim(), 10);
    } catch {
      prNum = 1;
    }
  }

  const [owner, repoName] = (repoStr || "openshift/origin").split("/");
  return { owner: owner || "openshift", repoName: repoName || "origin", prNumber: prNum || 1 };
}

export const triagePrCiFailuresTool = defineTool({
  name: "triage_pr_ci_failures",
  label: "Triage PR CI Failures",
  description:
    "Deterministically triage and classify failing CI checks for a pull request against its diff. Identifies pr_caused failures vs non-actionable (infrastructure, pre_existing, flake, out_of_scope) per TRT-2831 guardrails.",
  parameters: Type.Object({
    prNumber: Type.Optional(
      Type.Number({ description: "Pull request number (inferred from current branch if omitted)" }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository in owner/repo format (inferred if omitted)" }),
    ),
    checks: Type.Optional(
      Type.Array(
        Type.Object({
          name: Type.String({ description: "Check name" }),
          state: Type.String({ description: "Check state (e.g. FAILURE, ERROR)" }),
          bucket: Type.String({ description: "Check bucket (e.g. fail)" }),
          link: Type.Optional(Type.String({ description: "Prow/job link URL" })),
        }),
        { description: "Optional list of check objects (fetched via gh pr checks if omitted)" },
      ),
    ),
  }),
  async execute(_id, params) {
    const { owner, repoName, prNumber } = await resolvePrAndRepo(params);

    let checksToTriage: CiCheckInput[] = params.checks as CiCheckInput[];
    if (!checksToTriage || checksToTriage.length === 0) {
      try {
        const { stdout } = await execFileAsync("gh", [
          "pr",
          "checks",
          String(prNumber),
          "--repo",
          `${owner}/${repoName}`,
          "--json",
          "name,state,bucket,link",
        ]);
        checksToTriage = JSON.parse(stdout);
      } catch (err: any) {
        throw new Error(`Failed to fetch PR checks for ${owner}/${repoName}#${prNumber}: ${err?.message || err}`);
      }
    }

    const summary = await triagePrCiFailures(owner, repoName, prNumber, checksToTriage);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      details: summary,
    };
  },
});

export const postCiFailureReportTool = defineTool({
  name: "post_ci_failure_report",
  label: "Post CI Failure Report",
  description:
    "Post a structured non-actionable CI failure explanation comment to the PR conversation with the standard AI signature.",
  parameters: Type.Object({
    prNumber: Type.Number({ description: "Pull request number" }),
    checkName: Type.String({ description: "Name of the failing CI check" }),
    classification: Type.String({
      description: "Failure classification: infrastructure, pre_existing, flake, or out_of_scope",
    }),
    evidence: Type.String({
      description: "1-3 sentences with job URL, error summary, and why this is not PR-caused",
    }),
    actionNeeded: Type.Optional(
      Type.String({ description: "Follow-up action description (optional)" }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository in owner/repo format" }),
    ),
  }),
  async execute(_id, params) {
    const { owner, repoName, prNumber } = await resolvePrAndRepo(params);
    const result = await postCiFailureReport(
      owner,
      repoName,
      prNumber,
      params.checkName,
      params.classification,
      params.evidence,
      params.actionNeeded,
    );
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        details: result,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Posted report for ${params.checkName} (${params.classification}) at ${result.url}`,
        },
      ],
      details: result,
    };
  },
});
