import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAuthorizedAuthor } from "./auth.js";
import {
  isSlashCommandOnly,
  isPureAcknowledgment,
  categorizeComment,
  type CommentCategory,
} from "./comments.js";
import { checkAlreadyReplied, postReply } from "./reply.js";
import { runRepoVerification } from "./verify.js";

const execFileAsync = promisify(execFile);

export interface ActionableComment {
  id: number | string;
  author: string;
  type: "review_comment" | "issue_comment" | "review";
  path?: string;
  line?: number;
  category: CommentCategory;
  preview: string;
}

export interface FailingCheck {
  name: string;
  state: string;
  bucket: string;
  link?: string;
  optional?: boolean;
}

export interface PrReviewStatusResult {
  comment_work: boolean;
  ci_work: boolean;
  work: boolean;
  head_sha?: string;
  actionable_comment_count: number;
  actionable_comments: ActionableComment[];
  failing_checks: FailingCheck[];
}

export async function evaluatePrReviewStatus(
  owner: string,
  repo: string,
  prNumber: number,
  previousFailingChecks?: FailingCheck[],
  previousHeadSha?: string,
  agentLogin?: string,
  runGhRunner?: (args: string[]) => Promise<string>,
): Promise<PrReviewStatusResult> {
  const execGh =
    runGhRunner ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args);
      return stdout;
    });

  let currentHeadSha: string | undefined;
  try {
    const raw = await execGh([
      "pr",
      "view",
      String(prNumber),
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "headRefOid",
      "-q",
      ".headRefOid",
    ]);
    currentHeadSha = raw.trim();
  } catch {}

  let resolvedAgentLogin = agentLogin;
  if (!resolvedAgentLogin) {
    try {
      const userRaw = await execGh(["api", "user", "--jq", ".login"]);
      resolvedAgentLogin = userRaw.trim();
    } catch {}
  }

  const actionableComments: ActionableComment[] = [];

  // 1. Fetch inline review comments
  try {
    const raw = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      "--paginate",
    ]);
    const comments = JSON.parse(raw);
    for (const c of comments || []) {
      const login = c.user?.login;
      if (!login || login === resolvedAgentLogin) continue;
      const body = c.body || "";
      if (body.length > 5000) continue;
      if (isSlashCommandOnly(body) || isPureAcknowledgment(body)) continue;

      const auth = await isAuthorizedAuthor(owner, repo, login, { ghRunner: execGh });
      if (!auth.authorized) continue;

      const replied = await checkAlreadyReplied(
        owner,
        repo,
        prNumber,
        String(c.id),
        "review_comment",
        execGh,
      );
      if (!replied.safe_to_reply) continue;

      actionableComments.push({
        id: c.id,
        author: login,
        type: "review_comment",
        path: c.path,
        line: c.line ?? c.original_line,
        category: categorizeComment(body),
        preview: body.slice(0, 300),
      });
    }
  } catch {}

  // 2. Fetch reviews
  try {
    const raw = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      "--paginate",
    ]);
    const reviews = JSON.parse(raw);
    for (const r of reviews || []) {
      const login = r.user?.login;
      if (!login || login === resolvedAgentLogin) continue;
      if (r.state === "APPROVED" || r.state === "PENDING") continue;
      const body = r.body || "";
      if (!body.trim() || body.length > 5000) continue;
      if (isSlashCommandOnly(body) || isPureAcknowledgment(body)) continue;

      const auth = await isAuthorizedAuthor(owner, repo, login, { ghRunner: execGh });
      if (!auth.authorized) continue;

      const replied = await checkAlreadyReplied(
        owner,
        repo,
        prNumber,
        String(r.id),
        "review",
        execGh,
      );
      if (!replied.safe_to_reply) continue;

      actionableComments.push({
        id: r.id,
        author: login,
        type: "review",
        category: categorizeComment(body),
        preview: body.slice(0, 300),
      });
    }
  } catch {}

  // 3. Fetch issue conversation comments
  try {
    const raw = await execGh([
      "api",
      `repos/${owner}/${repo}/issues/${prNumber}/comments`,
      "--paginate",
    ]);
    const comments = JSON.parse(raw);
    for (const c of comments || []) {
      const login = c.user?.login;
      if (!login || login === resolvedAgentLogin) continue;
      const body = c.body || "";
      if (body.length > 5000) continue;
      if (isSlashCommandOnly(body) || isPureAcknowledgment(body)) continue;

      const auth = await isAuthorizedAuthor(owner, repo, login, { ghRunner: execGh });
      if (!auth.authorized) continue;

      const replied = await checkAlreadyReplied(
        owner,
        repo,
        prNumber,
        String(c.id),
        "issue_comment",
        execGh,
      );
      if (!replied.safe_to_reply) continue;

      actionableComments.push({
        id: c.id,
        author: login,
        type: "issue_comment",
        category: categorizeComment(body),
        preview: body.slice(0, 300),
      });
    }
  } catch {}

  // 4. Fetch CI checks
  const failingChecks: FailingCheck[] = [];
  try {
    const raw = await execGh([
      "pr",
      "checks",
      String(prNumber),
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "name,state,bucket,link",
    ]);
    const checks = JSON.parse(raw);
    for (const ch of checks || []) {
      if (ch.bucket === "fail" && ch.name !== "tide" && !ch.name?.endsWith("/tide")) {
        failingChecks.push({
          name: ch.name,
          state: ch.state || "FAILURE",
          bucket: ch.bucket || "fail",
          link: ch.link,
        });
      }
    }
  } catch {}

  // Evaluate CI work
  let ciWork = false;
  if (failingChecks.length > 0) {
    if (!previousFailingChecks || previousFailingChecks.length === 0) {
      ciWork = true;
    } else if (previousHeadSha && currentHeadSha && previousHeadSha !== currentHeadSha) {
      ciWork = true;
    } else {
      const prevNames = new Set(previousFailingChecks.map((c) => c.name));
      const currNames = new Set(failingChecks.map((c) => c.name));
      if (
        prevNames.size !== currNames.size ||
        [...currNames].some((n) => !prevNames.has(n))
      ) {
        ciWork = true;
      }
    }
  }

  const commentWork = actionableComments.length > 0;
  const work = commentWork || ciWork;

  return {
    comment_work: commentWork,
    ci_work: ciWork,
    work,
    head_sha: currentHeadSha,
    actionable_comment_count: actionableComments.length,
    actionable_comments: actionableComments,
    failing_checks: failingChecks,
  };
}

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

export const prReviewStatusTool = defineTool({
  name: "pr_review_status",
  label: "PR Review Status",
  description:
    "Evaluate whether a GitHub PR has unanswered authorized review comments or new required CI failures. Returns concise JSON with comment_work, ci_work, work, and lists of actionable items.",
  parameters: Type.Object({
    prNumber: Type.Optional(
      Type.Number({ description: "Pull request number (inferred from current branch if omitted)" }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository owner/repo (inferred from git remote if omitted)" }),
    ),
    previousFailingChecks: Type.Optional(
      Type.Array(
        Type.Object({
          name: Type.String(),
          state: Type.String(),
          bucket: Type.String(),
          link: Type.Optional(Type.String()),
        }),
        { description: "Previous failing checks array for change detection" },
      ),
    ),
    previousHeadSha: Type.Optional(
      Type.String({ description: "Previous commit SHA for change detection" }),
    ),
    agentLogin: Type.Optional(
      Type.String({ description: "GitHub login to ignore comments from (defaults to authenticated user)" }),
    ),
  }),
  async execute(_id, params) {
    const { owner, repoName, prNumber } = await resolvePrAndRepo(params);
    const result = await evaluatePrReviewStatus(
      owner,
      repoName,
      prNumber,
      params.previousFailingChecks as FailingCheck[],
      params.previousHeadSha,
      params.agentLogin,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
});

export const prReviewCommentsTool = defineTool({
  name: "pr_review_comments",
  label: "PR Review Comments",
  description:
    "Fetch and categorize all authorized, unanswered review comments from a pull request. Strips oversized responses and bots to minimize LLM context usage.",
  parameters: Type.Object({
    prNumber: Type.Optional(
      Type.Number({ description: "Pull request number (inferred if omitted)" }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository owner/repo (inferred if omitted)" }),
    ),
  }),
  async execute(_id, params) {
    const { owner, repoName, prNumber } = await resolvePrAndRepo(params);
    const status = await evaluatePrReviewStatus(owner, repoName, prNumber);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(status.actionable_comments, null, 2),
        },
      ],
      details: status.actionable_comments,
    };
  },
});

export const prPostReplyTool = defineTool({
  name: "pr_post_reply",
  label: "PR Post Reply",
  description:
    "Safely post an AI-assisted reply to a PR review comment or issue conversation comment. Enforces AI signature and prevents duplicate replies.",
  parameters: Type.Object({
    prNumber: Type.Number({ description: "Pull request number" }),
    commentId: Type.String({ description: "ID of the comment to reply to" }),
    commentType: Type.String({
      description: "Type of comment: 'review_comment' or 'issue_comment'",
    }),
    body: Type.String({ description: "Reply text (standard footer will be appended automatically)" }),
    repo: Type.Optional(
      Type.String({ description: "Repository in owner/repo format" }),
    ),
  }),
  async execute(_id, params) {
    const { owner, repoName, prNumber } = await resolvePrAndRepo(params);
    const res = await postReply(
      owner,
      repoName,
      prNumber,
      params.commentId,
      params.commentType,
      params.body,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
      details: res,
    };
  },
});

export const verifyRepoTool = defineTool({
  name: "verify_repo",
  label: "Verify Repo",
  description:
    "Auto-detect and execute repository verification commands (make verify, make lint, go test ./..., npm test) with bounded output summarization.",
  parameters: Type.Object({
    commandOverride: Type.Optional(
      Type.String({ description: "Explicit verification command to execute instead of auto-detecting" }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: "Command timeout in milliseconds (default: 900,000 / 15 minutes)" }),
    ),
  }),
  async execute(_id, params) {
    const res = await runRepoVerification(
      process.cwd(),
      params.commandOverride,
      params.timeoutMs,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `${res.summary}\nCommand: ${res.command}\n\n${res.outputSnippet}`,
        },
      ],
      details: res,
    };
  },
});
