import { describe, it, expect, vi } from "vitest";
import {
  classifyCiFailure,
  triagePrCiFailures,
  postCiFailureReport,
  type CiCheckInput,
} from "../../extensions/ci/triage.js";
import type { RunAnalysisResult } from "../../extensions/prow/run-analysis.js";
import type { PrDiffContext } from "../../extensions/ci/diff.js";

describe("classifyCiFailure", () => {
  const diffContext: PrDiffContext = {
    baseBranch: "main",
    headSha: "abc1234",
    changedFiles: ["pkg/controllers/hostedcluster/controller.go", "pkg/controllers/hostedcluster/controller_test.go"],
    changedPackages: ["pkg/controllers/hostedcluster"],
  };

  it("classifies ci-infrastructure failures as infrastructure (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "periodic-ci-openshift-release-main-4.18-e2e-aws",
      build_id: "12345",
      job_types: ["cloud"],
      failed_tests: [],
      signals: [
        {
          name: "ci-infrastructure",
          evidence: ["error: acquiring lease for boskos failed", "ci-operator failed: pod_pending"],
        },
      ],
      candidate_references: ["references/ci-infrastructure-changes.md"],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("e2e-aws", false, analysis, diffContext);
    expect(verdict.classification).toBe("infrastructure");
    expect(verdict.action).toBe("report");
    expect(verdict.evidence).toContain("ci-operator");
  });

  it("classifies cloud quota and resource exhaustion as infrastructure (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "e2e-aws",
      build_id: "12345",
      job_types: ["cloud"],
      failed_tests: [],
      signals: [
        {
          name: "cloud-provider",
          sub_category: "aws-quota",
          evidence: ["RequestLimitExceeded: Cannot allocate vCPU in us-east-1"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("e2e-aws", false, analysis, diffContext);
    expect(verdict.classification).toBe("infrastructure");
    expect(verdict.action).toBe("report");
    expect(verdict.reason).toContain("quota");
  });

  it("classifies container OOM and node pressure as infrastructure (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "e2e-gcp",
      build_id: "12345",
      job_types: ["cloud"],
      failed_tests: [],
      signals: [
        {
          name: "resource-exhaustion",
          sub_category: "container-oom",
          evidence: ["OOMKilled: container exited with code 137"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("e2e-gcp", false, analysis, diffContext);
    expect(verdict.classification).toBe("infrastructure");
    expect(verdict.action).toBe("report");
  });

  it("classifies CVE and audit findings on unchanged dependencies as pre_existing (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "ci/prow/lint",
      build_id: "12345",
      job_types: [],
      failed_tests: [],
      signals: [
        {
          name: "test-failure",
          evidence: ["npm audit found 3 high severity vulnerabilities in tar package"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    // No package.json or dependencies in PR diff
    const verdict = classifyCiFailure("ci/prow/lint", false, analysis, diffContext);
    expect(verdict.classification).toBe("pre_existing");
    expect(verdict.action).toBe("report");
    expect(verdict.reason).toContain("CVE");
  });

  it("classifies failed test in modified package as pr_caused (fix)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "unit",
      build_id: "12345",
      job_types: [],
      failed_tests: ["TestHostedClusterReconcile_Delete"],
      signals: [
        {
          name: "test-failure",
          evidence: [
            "--- FAIL: TestHostedClusterReconcile_Delete (0.05s)",
            "    controller_test.go:88: expected status Ready got Error",
          ],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("unit", false, analysis, diffContext);
    expect(verdict.classification).toBe("pr_caused");
    expect(verdict.action).toBe("fix");
    expect(verdict.evidence).toContain("TestHostedClusterReconcile_Delete");
  });

  it("classifies compilation / linter error referencing changed file as pr_caused (fix)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "verify",
      build_id: "12345",
      job_types: [],
      failed_tests: [],
      signals: [
        {
          name: "test-failure",
          evidence: [
            "pkg/controllers/hostedcluster/controller.go:45:12: undefined: NonExistentHelper",
          ],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("verify", false, analysis, diffContext);
    expect(verdict.classification).toBe("pr_caused");
    expect(verdict.action).toBe("fix");
  });

  it("classifies disruption and flaky test signals without diff match as flake (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "e2e-aws-ovn",
      build_id: "12345",
      job_types: ["cloud"],
      failed_tests: ["[sig-network] Service backend disruption during rollout should remain < 5s"],
      signals: [
        {
          name: "disruption",
          evidence: ["disruption interval: openshift-ingress backend unreachable for 7.2s"],
        },
        {
          name: "flaky",
          evidence: ["[sig-network] Service backend disruption during rollout"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("e2e-aws-ovn", false, analysis, diffContext);
    expect(verdict.classification).toBe("flake");
    expect(verdict.action).toBe("report");
  });

  it("classifies optional job without diff match as out_of_scope (report)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "optional-e2e-metal",
      build_id: "12345",
      job_types: ["metal"],
      failed_tests: ["TestMetalBaremetalPlatformProvisioning"],
      signals: [
        {
          name: "test-failure",
          evidence: ["baremetal host failed to power on"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("optional-e2e-metal", true, analysis, diffContext);
    expect(verdict.classification).toBe("out_of_scope");
    expect(verdict.action).toBe("report");
    expect(verdict.reason).toContain("Optional check");
  });

  it("enforces TRT-2831 guardrail: optional job with slam-dunk exact file match is pr_caused (fix)", () => {
    const analysis: RunAnalysisResult = {
      job_name: "optional-unit-tests",
      build_id: "12345",
      job_types: [],
      failed_tests: ["TestHostedClusterValidation"],
      signals: [
        {
          name: "test-failure",
          evidence: [
            "pkg/controllers/hostedcluster/controller.go:120: nil pointer dereference",
          ],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("optional-unit-tests", true, analysis, diffContext);
    expect(verdict.classification).toBe("pr_caused");
    expect(verdict.action).toBe("fix");
  });

  it("defaults to pre_existing when uncertain and no diff match", () => {
    const analysis: RunAnalysisResult = {
      job_name: "e2e-unrelated",
      build_id: "12345",
      job_types: [],
      failed_tests: ["TestSomethingUnrelatedInStoragePkg"],
      signals: [
        {
          name: "test-failure",
          evidence: ["pkg/storage/ceph/driver.go: failure connecting to ceph"],
        },
      ],
      candidate_references: [],
      artifact_paths: [],
    };

    const verdict = classifyCiFailure("e2e-unrelated", false, analysis, diffContext);
    expect(verdict.classification).toBe("pre_existing");
    expect(verdict.action).toBe("report");
  });
});

describe("triagePrCiFailures", () => {
  it("processes failing checks and returns structured summary", async () => {
    const checks: CiCheckInput[] = [
      {
        name: "ci/prow/unit",
        state: "FAILURE",
        bucket: "fail",
        link: "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/unit/101",
      },
      {
        name: "ci/prow/e2e-aws",
        state: "FAILURE",
        bucket: "fail",
        link: "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/e2e-aws/102",
      },
      {
        name: "tide",
        state: "FAILURE",
        bucket: "fail",
      },
    ];

    const mockDiff: PrDiffContext = {
      baseBranch: "main",
      headSha: "111222",
      changedFiles: ["pkg/unit/helper.go"],
      changedPackages: ["pkg/unit"],
    };

    const mockDiffFn = vi.fn().mockResolvedValue(mockDiff);
    const mockOptionalFn = vi.fn().mockImplementation(async (link: string) => link.includes("e2e-aws"));
    const mockAnalyzeFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("unit")) {
        return {
          job_name: "unit",
          build_id: "101",
          job_types: [],
          failed_tests: ["TestHelper"],
          signals: [{ name: "test-failure", evidence: ["pkg/unit/helper.go:10: error"] }],
          candidate_references: [],
          artifact_paths: [],
        };
      }
      return {
        job_name: "e2e-aws",
        build_id: "102",
        job_types: ["cloud"],
        failed_tests: ["TestCluster"],
        signals: [{ name: "ci-infrastructure", evidence: ["lease acquisition timeout"] }],
        candidate_references: [],
        artifact_paths: [],
      };
    });

    const summary = await triagePrCiFailures(
      "openshift",
      "hypershift",
      123,
      checks,
      {
        getDiffFn: mockDiffFn,
        isOptionalFn: mockOptionalFn,
        analyzeProwFn: mockAnalyzeFn,
      },
    );

    expect(summary.total).toBe(2); // tide was ignored
    expect(summary.pr_caused).toBe(1);
    expect(summary.non_actionable).toBe(1);

    const unitResult = summary.results.find((r) => r.name === "ci/prow/unit")!;
    expect(unitResult.classification).toBe("pr_caused");
    expect(unitResult.action).toBe("fix");

    const e2eResult = summary.results.find((r) => r.name === "ci/prow/e2e-aws")!;
    expect(e2eResult.classification).toBe("infrastructure");
    expect(e2eResult.action).toBe("report");
  });
});

describe("postCiFailureReport", () => {
  it("formats template and posts PR comment via gh api", async () => {
    const mockGh = vi.fn().mockResolvedValue(
      JSON.stringify({ html_url: "https://github.com/openshift/hypershift/issues/123#issuecomment-999" }),
    );

    const res = await postCiFailureReport(
      "openshift",
      "hypershift",
      123,
      "ci/prow/lint",
      "pre_existing",
      "npm audit CVE on unchanged tar dependency",
      undefined,
      mockGh,
    );

    expect(res.success).toBe(true);
    expect(res.url).toBe("https://github.com/openshift/hypershift/issues/123#issuecomment-999");
    expect(mockGh).toHaveBeenCalledWith(
      expect.arrayContaining([
        "api",
        "repos/openshift/hypershift/issues/123/comments",
      ]),
    );
  });
});
