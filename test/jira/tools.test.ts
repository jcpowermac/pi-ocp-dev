import { describe, it, expect, vi } from "vitest";
import { executeJiraGetIssue, executeCreatePrHelper } from "../../extensions/jira/tools.js";

describe("executeJiraGetIssue", () => {
  it("fetches and grooms Jira issue using provided runner", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      key: "OCPBUGS-1234",
      fields: {
        summary: "Fix nil pointer",
        issuetype: { name: "Bug" },
        description: "h2. Acceptance criteria\n* Must not fail",
      },
    });

    const result = await executeJiraGetIssue(
      { issueKey: "OCPBUGS-1234" },
      { fetchJira: mockFetcher },
    );

    expect(result.key).toBe("OCPBUGS-1234");
    expect(result.summary).toBe("Fix nil pointer");
    expect(result.acceptanceCriteria).toContain("Must not fail");
    expect(mockFetcher).toHaveBeenCalledWith("OCPBUGS-1234", undefined);
  });
});

describe("executeCreatePrHelper", () => {
  it("constructs correct title, body with footer, and arguments for gh pr create", async () => {
    const mockGh = vi.fn().mockResolvedValue("https://github.com/openshift/hypershift/pull/555\n");

    const result = await executeCreatePrHelper(
      {
        issueKey: "OCPBUGS-1234",
        summary: "Fix nil pointer in cluster controller",
        upstream: "openshift/hypershift",
        head: "fork-user:fix-1234",
        draft: true,
      },
      {
        ghRunner: mockGh,
        readFile: () => "## What this PR does\nFixes nil pointer",
      },
    );

    expect(result.url).toBe("https://github.com/openshift/hypershift/pull/555");
    expect(mockGh).toHaveBeenCalled();

    const args = mockGh.mock.calls[0][0];
    expect(args).toContain("pr");
    expect(args).toContain("create");
    expect(args).toContain("--title");
    expect(args[args.indexOf("--title") + 1]).toBe("OCPBUGS-1234: Fix nil pointer in cluster controller");
    expect(args).toContain("--repo");
    expect(args[args.indexOf("--repo") + 1]).toBe("openshift/hypershift");
    expect(args).toContain("--head");
    expect(args[args.indexOf("--head") + 1]).toBe("fork-user:fix-1234");
    expect(args).toContain("--draft");

    const bodyArg = args[args.indexOf("--body") + 1];
    expect(bodyArg).toContain("https://redhat.atlassian.net/browse/OCPBUGS-1234");
    expect(bodyArg).toContain("AI-assisted response via pi-ocp-dev");
  });
});
