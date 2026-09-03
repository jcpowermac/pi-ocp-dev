import { describe, it, expect, vi } from "vitest";
import registerExtension from "../extensions/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("Main extension entrypoint (extensions/index.ts)", () => {
  it("registers all tools, commands, and lifecycle hooks", () => {
    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];
    const registeredEvents: string[] = [];

    const mockPi: Partial<ExtensionAPI> = {
      registerTool: vi.fn((tool: any) => {
        registeredTools.push(tool.name);
      }),
      registerCommand: vi.fn((name: string) => {
        registeredCommands.push(name);
      }),
      on: vi.fn((event: any) => {
        registeredEvents.push(event);
      }),
    };

    registerExtension(mockPi as ExtensionAPI);

    // Verify Prow tools
    expect(registeredTools).toContain("prow_status");
    expect(registeredTools).toContain("prow_job");
    expect(registeredTools).toContain("prow_build_log");
    expect(registeredTools).toContain("analyze_prow_run");
    expect(registeredTools).toContain("detect_permafail");

    // Verify Must-Gather tools
    expect(registeredTools).toContain("analyze_must_gather");

    // Verify PR tools
    expect(registeredTools).toContain("pr_review_status");
    expect(registeredTools).toContain("pr_review_comments");
    expect(registeredTools).toContain("pr_post_reply");
    expect(registeredTools).toContain("verify_repo");

    // Verify CI tools
    expect(registeredTools).toContain("triage_pr_ci_failures");
    expect(registeredTools).toContain("post_ci_failure_report");

    // Verify Jira & PR creation tools
    expect(registeredTools).toContain("jira_get_issue");
    expect(registeredTools).toContain("create_pr_helper");

    // Verify commands
    expect(registeredCommands).toContain("prow");
    expect(registeredCommands).toContain("must-gather");

    // Verify lifecycle hook
    expect(registeredEvents).toContain("session_start");

    expect(registeredTools.length).toBe(15);
  });
});
