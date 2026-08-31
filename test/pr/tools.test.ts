import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluatePrReviewStatus,
  prReviewStatusTool,
  prReviewCommentsTool,
  prPostReplyTool,
  verifyRepoTool,
} from "../../extensions/pr/tools.js";
import { clearAuthCache } from "../../extensions/pr/auth.js";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    execFile: vi.fn((cmd, args, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      const cmdStr = (args || []).join(" ");
      if (cmd === "gh") {
        if (cmdStr.includes("pr view") && cmdStr.includes("--json headRefOid")) {
          cb?.(null, { stdout: "sha-test-123\n", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("repo view")) {
          cb?.(null, { stdout: "openshift/hypershift\n", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("api user")) {
          cb?.(null, { stdout: "test-agent\n", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("pulls/42/comments") || cmdStr.includes("pulls/10/comments")) {
          cb?.(null, { stdout: "[]", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("pulls/42/reviews") || cmdStr.includes("pulls/10/reviews")) {
          cb?.(null, { stdout: "[]", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("issues/42/comments") || cmdStr.includes("issues/10/comments")) {
          cb?.(null, { stdout: "[]", stderr: "" });
          return {} as any;
        }
        if (cmdStr.includes("pr checks")) {
          cb?.(null, { stdout: "[]", stderr: "" });
          return {} as any;
        }
        cb?.(null, { stdout: "{}", stderr: "" });
        return {} as any;
      }
      return actual.execFile(cmd, args, options, callback);
    }),
  };
});

describe("evaluatePrReviewStatus", () => {
  beforeEach(() => {
    clearAuthCache();
  });

  it("identifies actionable review comments for authorized authors", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr view") && cmd.includes("--json headRefOid")) {
        return "sha-123";
      }
      if (cmd.includes("pulls/10/comments")) {
        return JSON.stringify([
          {
            id: 1001,
            user: { login: "alice" },
            body: "Please fix this nil pointer check",
            path: "pkg/controller.go",
            line: 42,
            created_at: "2026-08-31T10:00:00Z",
          },
        ]);
      }
      if (cmd.includes("pulls/10/reviews")) return JSON.stringify([]);
      if (cmd.includes("issues/10/comments")) return JSON.stringify([]);
      if (cmd.includes("OWNERS_ALIASES")) throw new Error("404");
      if (cmd.includes("OWNERS")) {
        return "approvers:\n  - alice\n";
      }
      if (cmd.includes("pr checks")) {
        return JSON.stringify([]);
      }
      return "";
    });

    const status = await evaluatePrReviewStatus(
      "openshift",
      "hypershift",
      10,
      undefined,
      undefined,
      undefined,
      mockGh,
    );

    expect(status.comment_work).toBe(true);
    expect(status.ci_work).toBe(false);
    expect(status.work).toBe(true);
    expect(status.actionable_comments).toHaveLength(1);
    expect(status.actionable_comments[0]).toMatchObject({
      id: 1001,
      author: "alice",
      type: "review_comment",
      path: "pkg/controller.go",
      line: 42,
      category: "CHANGE_REQUEST",
    });
  });

  it("ignores slash commands, bot accounts, and acknowledgments", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr view") && cmd.includes("--json headRefOid")) {
        return "sha-123";
      }
      if (cmd.includes("pulls/10/comments")) {
        return JSON.stringify([
          {
            id: 1001,
            user: { login: "openshift-ci-robot" },
            body: "Test results: failed",
          },
          {
            id: 1002,
            user: { login: "alice" },
            body: "/lgtm\n/hold",
          },
          {
            id: 1003,
            user: { login: "alice" },
            body: "Thanks!",
          },
        ]);
      }
      if (cmd.includes("pulls/10/reviews")) return JSON.stringify([]);
      if (cmd.includes("issues/10/comments")) return JSON.stringify([]);
      if (cmd.includes("OWNERS")) return "approvers:\n  - alice\n";
      if (cmd.includes("pr checks")) return JSON.stringify([]);
      return "";
    });

    const status = await evaluatePrReviewStatus(
      "openshift",
      "hypershift",
      10,
      undefined,
      undefined,
      undefined,
      mockGh,
    );

    expect(status.comment_work).toBe(false);
    expect(status.actionable_comments).toHaveLength(0);
  });

  it("evaluates CI failures and detects new failures", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr view") && cmd.includes("--json headRefOid")) {
        return "sha-123";
      }
      if (cmd.includes("pulls/10/comments")) return JSON.stringify([]);
      if (cmd.includes("pulls/10/reviews")) return JSON.stringify([]);
      if (cmd.includes("issues/10/comments")) return JSON.stringify([]);
      if (cmd.includes("pr checks")) {
        return JSON.stringify([
          {
            name: "e2e-aws",
            state: "FAILURE",
            bucket: "fail",
            link: "https://prow.ci.openshift.org/view/gs/logs/123",
          },
          {
            name: "tide",
            state: "FAILURE",
            bucket: "fail",
          },
        ]);
      }
      return "";
    });

    const status = await evaluatePrReviewStatus(
      "openshift",
      "hypershift",
      10,
      undefined,
      undefined,
      undefined,
      mockGh,
    );

    expect(status.ci_work).toBe(true);
    expect(status.work).toBe(true);
    expect(status.failing_checks).toHaveLength(1);
    expect(status.failing_checks[0].name).toBe("e2e-aws");
  });

  it("does not flag CI work if same head SHA and same failing checks as previous", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const cmd = args.join(" ");
      if (cmd.includes("pr view") && cmd.includes("--json headRefOid")) {
        return "sha-123";
      }
      if (cmd.includes("pulls/10/comments")) return JSON.stringify([]);
      if (cmd.includes("pulls/10/reviews")) return JSON.stringify([]);
      if (cmd.includes("issues/10/comments")) return JSON.stringify([]);
      if (cmd.includes("pr checks")) {
        return JSON.stringify([
          {
            name: "e2e-aws",
            state: "FAILURE",
            bucket: "fail",
            link: "https://prow.ci.openshift.org/view/gs/logs/123",
          },
        ]);
      }
      return "";
    });

    const status = await evaluatePrReviewStatus(
      "openshift",
      "hypershift",
      10,
      [{ name: "e2e-aws", state: "FAILURE", bucket: "fail" }],
      "sha-123",
      undefined,
      mockGh,
    );

    expect(status.ci_work).toBe(false);
    expect(status.failing_checks).toHaveLength(1);
  });
});

describe("Tool definitions", () => {
  it("pr_review_status tool executes correctly", async () => {
    const res = await prReviewStatusTool.execute(
      "test-call-1",
      {
        prNumber: 42,
        repo: "openshift/hypershift",
      },
      undefined as any,
      undefined as any,
      undefined as any,
    );
    expect(res.content).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it("pr_review_comments tool executes correctly", async () => {
    const res = await prReviewCommentsTool.execute(
      "test-call-2",
      {
        prNumber: 42,
        repo: "openshift/hypershift",
      },
      undefined as any,
      undefined as any,
      undefined as any,
    );
    expect(res.content).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it("pr_post_reply tool validates parameters and responds", async () => {
    const res = await prPostReplyTool.execute(
      "test-call-3",
      {
        prNumber: 42,
        repo: "openshift/hypershift",
        commentId: "123",
        commentType: "review_comment",
        body: "Fixed in latest commit.",
      },
      undefined as any,
      undefined as any,
      undefined as any,
    );
    expect(res.content).toBeDefined();
    expect(res.details).toBeDefined();
  });

  it("verify_repo tool executes verification", async () => {
    const res = await verifyRepoTool.execute(
      "test-call-4",
      {
        commandOverride: "echo 'all tests pass'",
      },
      undefined as any,
      undefined as any,
      undefined as any,
    );

    expect(res.content[0].type).toBe("text");
    expect(res.details.pass).toBe(true);
  });
});
