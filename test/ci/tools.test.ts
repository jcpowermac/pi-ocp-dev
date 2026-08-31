import { describe, it, expect, vi } from "vitest";
import { triagePrCiFailuresTool, postCiFailureReportTool } from "../../extensions/ci/tools.js";

describe("CI tools definitions", () => {
  it("defines triage_pr_ci_failures tool with correct schema", () => {
    expect(triagePrCiFailuresTool.name).toBe("triage_pr_ci_failures");
    expect(triagePrCiFailuresTool.description).toContain("TRT-2831");
  });

  it("defines post_ci_failure_report tool with correct schema", () => {
    expect(postCiFailureReportTool.name).toBe("post_ci_failure_report");
    expect(postCiFailureReportTool.description).toContain("non-actionable");
  });
});
