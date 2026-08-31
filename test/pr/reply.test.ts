import { describe, it, expect, vi } from "vitest";
import {
  isBotComment,
  checkAlreadyReplied,
  postReply,
} from "../../extensions/pr/reply.js";

describe("isBotComment", () => {
  it("detects known bot accounts", () => {
    expect(isBotComment("hypershift-jira-solve-ci[bot]", "")).toBe(true);
    expect(isBotComment("hypershift-jira-solve-ci", "")).toBe(true);
    expect(isBotComment("github-actions[bot]", "")).toBe(true);
    expect(isBotComment("github-actions", "")).toBe(true);
  });

  it("detects AI reply signatures in body", () => {
    expect(isBotComment("user123", "Done. Fixed.\n\n---\n*AI-assisted response*")).toBe(true);
    expect(isBotComment("user123", "Done.\n\n---\n*AI-assisted response via Claude Code*")).toBe(true);
    expect(isBotComment("user123", "Done.\n\n---\n*AI-assisted response via openshift-developer*")).toBe(true);
  });

  it("returns false for human comments without signature", () => {
    expect(isBotComment("alice", "Please fix this.")).toBe(false);
  });
});

describe("checkAlreadyReplied", () => {
  it("detects reply to review_comment", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 101, body: "Please fix", user: { login: "reviewer" } },
      { id: 102, in_reply_to_id: 101, body: "Done. Fixed.\n\n---\n*AI-assisted response*", user: { login: "bot" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "101", "review_comment", mockGh);
    expect(res.safe_to_reply).toBe(false);
    expect(res.reason).toBe("bot_already_replied");
  });

  it("allows replying to review_comment when no bot reply exists", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 101, body: "Please fix", user: { login: "reviewer" } },
      { id: 102, in_reply_to_id: 101, body: "I also wonder about this", user: { login: "other_reviewer" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "101", "review_comment", mockGh);
    expect(res.safe_to_reply).toBe(true);
    expect(res.reason).toBe("no_bot_reply_found");
  });

  it("detects bot reply after an issue_comment", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 201, created_at: "2026-08-31T10:00:00Z", body: "Please update docs", user: { login: "reviewer" } },
      { id: 202, created_at: "2026-08-31T10:05:00Z", body: "Done.\n\n---\n*AI-assisted response*", user: { login: "bot" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "201", "issue_comment", mockGh);
    expect(res.safe_to_reply).toBe(false);
    expect(res.reason).toBe("bot_replied_after");
  });

  it("allows replying to issue_comment when no bot reply exists after it", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 201, created_at: "2026-08-31T10:00:00Z", body: "Please update docs", user: { login: "reviewer" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "201", "issue_comment", mockGh);
    expect(res.safe_to_reply).toBe(true);
    expect(res.reason).toBe("no_bot_reply_after");
  });

  it("handles review_thread type checking GraphQL reviewThreads", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  id: "THREAD_123",
                  isResolved: false,
                  comments: {
                    nodes: [
                      { id: "C1", author: { login: "alice" }, body: "Please check", createdAt: "2026-08-31T10:00:00Z" },
                      { id: "C2", author: { login: "bot" }, body: "Done.\n\n---\n*AI-assisted response*", createdAt: "2026-08-31T10:05:00Z" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "THREAD_123", "review_thread", mockGh);
    expect(res.safe_to_reply).toBe(false);
    expect(res.reason).toBe("bot_already_replied");
  });

  it("detects resolved review_thread", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false },
              nodes: [
                {
                  id: "THREAD_RESOLVED",
                  isResolved: true,
                  comments: { nodes: [] },
                },
              ],
            },
          },
        },
      },
    }));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "THREAD_RESOLVED", "review_thread", mockGh);
    expect(res.safe_to_reply).toBe(false);
    expect(res.reason).toBe("thread_resolved");
  });
});

describe("postReply", () => {
  it("prevents posting duplicate replies", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 101, body: "Please fix", user: { login: "reviewer" } },
      { id: 102, in_reply_to_id: 101, body: "Done. Fixed.\n\n---\n*AI-assisted response*", user: { login: "bot" } },
    ]));

    const res = await postReply("openshift", "hypershift", 123, "101", "review_comment", "Done.", mockGh);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Already replied");
  });

  it("appends AI-assisted response footer and posts reply when safe", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.some((a) => a.includes("comments/101/replies"))) {
        return JSON.stringify({
          id: 103,
          html_url: "https://github.com/openshift/hypershift/pull/123#discussion_r103",
        });
      }
      if (args.some((a) => a.includes("pulls/123/comments"))) {
        return JSON.stringify([{ id: 101, body: "Please fix", user: { login: "reviewer" } }]);
      }
      return "{}";
    });

    const res = await postReply("openshift", "hypershift", 123, "101", "review_comment", "Done. Fixed nil check.", mockGh);
    expect(res.success).toBe(true);
    expect(res.url).toBe("https://github.com/openshift/hypershift/pull/123#discussion_r103");
  });
});
