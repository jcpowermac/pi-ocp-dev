import { describe, it, expect, vi } from "vitest";
import { getPrDiffFiles } from "../../extensions/ci/diff.js";

describe("getPrDiffFiles", () => {
  it("extracts baseBranch, headSha, changedFiles, and changedPackages", async () => {
    const mockGh = vi.fn().mockResolvedValue(
      JSON.stringify({
        baseRefName: "release-4.18",
        headRefOid: "abc123def",
        files: [
          { path: "pkg/controllers/cluster.go" },
          { path: "pkg/controllers/cluster_test.go" },
          { path: "cmd/main.go" },
          { path: "docs/readme.md" },
        ],
      }),
    );

    const result = await getPrDiffFiles("openshift", "hypershift", 1234, mockGh);
    expect(result.baseBranch).toBe("release-4.18");
    expect(result.headSha).toBe("abc123def");
    expect(result.changedFiles).toEqual([
      "pkg/controllers/cluster.go",
      "pkg/controllers/cluster_test.go",
      "cmd/main.go",
      "docs/readme.md",
    ]);
    expect(result.changedPackages.sort()).toEqual(["cmd", "pkg/controllers"].sort());
    expect(mockGh).toHaveBeenCalledWith([
      "pr",
      "view",
      "1234",
      "--repo",
      "openshift/hypershift",
      "--json",
      "baseRefName,headRefOid,files",
    ]);
  });

  it("handles empty files list and defaults base branch", async () => {
    const mockGh = vi.fn().mockResolvedValue(
      JSON.stringify({
        baseRefName: "",
        headRefOid: "head123",
        files: [],
      }),
    );

    const result = await getPrDiffFiles("openshift", "origin", 5678, mockGh);
    expect(result.baseBranch).toBe("main");
    expect(result.headSha).toBe("head123");
    expect(result.changedFiles).toEqual([]);
    expect(result.changedPackages).toEqual([]);
  });
});
