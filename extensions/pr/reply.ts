import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BOT_SIGNATURES = new Set([
  "hypershift-jira-solve-ci[bot]",
  "hypershift-jira-solve-ci",
  "github-actions",
  "github-actions[bot]",
]);

export const REPLY_SIGNATURES = [
  "*AI-assisted response*",
  "*AI-assisted response via Claude Code*",
  "*AI-assisted response via openshift-developer*",
];

export function isBotComment(login?: string, body?: string): boolean {
  if (login && BOT_SIGNATURES.has(login.toLowerCase())) return true;
  if (body && REPLY_SIGNATURES.some((sig) => body.includes(sig))) return true;
  return false;
}

export async function checkAlreadyReplied(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: string,
  type: string,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{ safe_to_reply: boolean; reason: string }> {
  const execGh =
    runGh ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args);
      return stdout;
    });

  if (type === "review_comment") {
    try {
      const raw = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
        "--paginate",
      ]);
      const comments = JSON.parse(raw);
      const targetId = Number(commentId);
      for (const c of comments) {
        if (c.in_reply_to_id === targetId && isBotComment(c.user?.login, c.body)) {
          return { safe_to_reply: false, reason: "bot_already_replied" };
        }
      }
      return { safe_to_reply: true, reason: "no_bot_reply_found" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  if (type === "issue_comment") {
    try {
      const raw = await execGh([
        "api",
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        "--paginate",
      ]);
      const comments = JSON.parse(raw);
      const target = comments.find((c: any) => String(c.id) === String(commentId));
      if (!target) return { safe_to_reply: true, reason: "comment_not_found" };

      for (const c of comments) {
        if (c.created_at > target.created_at && isBotComment(c.user?.login, c.body)) {
          return { safe_to_reply: false, reason: "bot_replied_after" };
        }
      }
      return { safe_to_reply: true, reason: "no_bot_reply_after" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  if (type === "review") {
    try {
      const reviewRaw = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews/${commentId}`,
      ]);
      const review = JSON.parse(reviewRaw);
      const submittedAt = review.submitted_at;
      if (!submittedAt) return { safe_to_reply: false, reason: "review_not_found" };

      const raw = await execGh([
        "api",
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        "--paginate",
      ]);
      const comments = JSON.parse(raw);
      for (const c of comments || []) {
        if (c.created_at > submittedAt && isBotComment(c.user?.login, c.body)) {
          return { safe_to_reply: false, reason: "bot_replied_after" };
        }
      }
      return { safe_to_reply: true, reason: "no_bot_reply_after" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  if (type === "review_thread") {
    const query = `
    query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            nodes {
              id
              isResolved
              comments(first: 100) {
                nodes {
                  id
                  author { login }
                  body
                  createdAt
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
    `;

    try {
      let cursor: string | null = null;
      while (true) {
        const args = [
          "api",
          "graphql",
          "-f",
          `query=${query}`,
          "-f",
          `owner=${owner}`,
          "-f",
          `repo=${repo}`,
          "-F",
          `number=${prNumber}`,
        ];
        if (cursor) args.push("-f", `cursor=${cursor}`);

        const resultRaw = await execGh(args);
        const result = JSON.parse(resultRaw);
        const threadsData = result.data?.repository?.pullRequest?.reviewThreads;
        const nodes = threadsData?.nodes || [];

        for (const thread of nodes) {
          if (thread.id === commentId) {
            if (thread.isResolved) {
              return { safe_to_reply: false, reason: "thread_resolved" };
            }
            for (const comment of thread.comments?.nodes || []) {
              if (isBotComment(comment.author?.login, comment.body)) {
                return { safe_to_reply: false, reason: "bot_already_replied" };
              }
            }
            return { safe_to_reply: true, reason: "no_bot_reply_found" };
          }
        }

        if (!threadsData?.pageInfo?.hasNextPage) break;
        cursor = threadsData.pageInfo.endCursor;
      }

      return { safe_to_reply: false, reason: "thread_not_found" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  return { safe_to_reply: true, reason: "default_safe" };
}

export async function postReply(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: string,
  type: string,
  body: string,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const check = await checkAlreadyReplied(owner, repo, prNumber, commentId, type, runGh);
  if (!check.safe_to_reply) {
    return { success: false, error: `Already replied or unsafe: ${check.reason}` };
  }

  const execGh =
    runGh ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args);
      return stdout;
    });

  const signedBody = `${body.trim()}\n\n---\n*AI-assisted response*`;

  try {
    if (type === "review_comment") {
      const out = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
        "-f",
        `body=${signedBody}`,
      ]);
      const res = JSON.parse(out);
      return { success: true, url: res.html_url };
    } else {
      const out = await execGh([
        "api",
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        "-f",
        `body=${signedBody}`,
      ]);
      const res = JSON.parse(out);
      return { success: true, url: res.html_url };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
