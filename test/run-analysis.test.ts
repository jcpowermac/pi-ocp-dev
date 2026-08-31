import { describe, it, expect } from "vitest";
import {
  analyzeProwRun,
  buildRunAnalysis,
  fetchRunInputs,
  runPermafailAnalysis,
} from "../extensions/prow/run-analysis.js";
import { prowUrlToGcsPath, type Fetcher, type GcsRunRef } from "../extensions/prow/classify.js";

const ref: GcsRunRef = {
  bucket: "test-platform-results",
  path: "logs",
  jobName: "periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn",
  buildId: "123",
};

const JUNIT_NAME =
  "logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/run-01/openshift-e2e-test/artifacts/junit_framework.xml";

const JUNIT_XML = `<?xml version="1.0"?>
<testsuite name="e2e-aws-ovn">
  <testcase classname="TestNetwork" name="should route pods"><failure message="boom"/></testcase>
  <testcase classname="TestOk" name="passes"/>
  <testcase classname="TestFlake" name="flaky"><error message="transient"/></testcase>
  <testcase classname="TestFlake" name="flaky"/>
</testsuite>`;

const BUILD_LOG = [
  "Starting cluster deployment",
  "step ipi-install failed",
  "error: node worker-0 NotReady with DiskPressure",
  "waiting for cluster",
  "job finished",
].join("\n");

function fakeFetcher(overrides: Record<string, { status: number; body: string }> = {}): {
  fetcher: Fetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url.includes("/storage/v1/")) {
      return {
        status: 200,
        body: JSON.stringify({ items: [{ name: JUNIT_NAME }] }),
      };
    }
    for (const [name, res] of Object.entries(overrides)) {
      if (url.endsWith(name)) return res;
    }
    if (url.endsWith(JUNIT_NAME)) return { status: 200, body: JUNIT_XML };
    if (url.endsWith("build-log.txt")) return { status: 200, body: BUILD_LOG };
    return { status: 404, body: "" };
  };
  return { fetcher, calls };
}

describe("fetchRunInputs", () => {
  it("collects failed tests (failures minus passes) and the build-log tail", async () => {
    const { fetcher } = fakeFetcher();
    const inputs = await fetchRunInputs(ref, { fetcher });
    expect(inputs.failedTests).toEqual(["TestNetwork should route pods"]);
    expect(inputs.buildLogLines).toEqual(BUILD_LOG.split("\n"));
  });

  it("tails the build log to at most 300 lines", async () => {
    const longLog = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const { fetcher } = fakeFetcher({
      "build-log.txt": { status: 200, body: longLog },
    });
    const inputs = await fetchRunInputs(ref, { fetcher });
    expect(inputs.buildLogLines).toHaveLength(300);
    expect(inputs.buildLogLines[0]).toBe("line 100");
  });

  it("returns empty lines when the build log is missing (404)", async () => {
    const { fetcher } = fakeFetcher({
      "build-log.txt": { status: 404, body: "" },
    });
    const inputs = await fetchRunInputs(ref, { fetcher });
    expect(inputs.buildLogLines).toEqual([]);
  });

  it("returns empty failed tests when the run has no junit objects", async () => {
    const calls: string[] = [];
    // Empty listing: no junit objects.
    const fetcher: Fetcher = async (url) => {
      calls.push(url);
      if (url.includes("/storage/v1/")) {
        return { status: 200, body: JSON.stringify({ items: [] }) };
      }
      return { status: 200, body: BUILD_LOG };
    };
    const inputs = await fetchRunInputs(ref, { fetcher });
    expect(inputs.failedTests).toEqual([]);
    expect(inputs.buildLogLines.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("buildRunAnalysis", () => {
  it("returns the compact result object for a run with install + resource signals", () => {
    const result = buildRunAnalysis(ref, {
      failedTests: ["TestNetwork should route pods"],
      buildLogLines: BUILD_LOG.split("\n"),
    });
    expect(result.job_name).toBe(ref.jobName);
    expect(result.build_id).toBe("123");
    expect(result.job_types).toContain("cloud");
    expect(result.failed_tests).toEqual(["TestNetwork should route pods"]);
    const names = result.signals.map((s) => s.name);
    expect(names).toContain("install");
    expect(names).toContain("test-failure");
    expect(names).toContain("resource-exhaustion");
    expect(result.candidate_references).toContain("references/install/general.md");
    expect(result.candidate_references.length).toBeLessThanOrEqual(3);
    for (const signal of result.signals) {
      expect(signal.evidence.length).toBeLessThanOrEqual(3);
    }
    expect(result.artifact_paths).toEqual([
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/build-log.txt",
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/",
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/gather-extra/artifacts/",
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/gather-extra/artifacts/clusteroperators.json",
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/gather-extra/artifacts/audit_logs/",
      "https://storage.googleapis.com/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123/artifacts/junit_install.xml",
    ]);
  });

  it("includes disruption and aggregated artifact paths when applicable", () => {
    const aggRef: GcsRunRef = {
      bucket: "test-platform-results",
      path: "logs",
      jobName: "aggregated-ci-openshift-release-4.18-nightly-e2e-aws-ovn",
      buildId: "456",
    };
    const result = buildRunAnalysis(aggRef, {
      failedTests: [],
      buildLogLines: ["disruption interval 15s in openshift-etcd"],
    });
    expect(result.artifact_paths).toContain(
      "https://storage.googleapis.com/test-platform-results/logs/aggregated-ci-openshift-release-4.18-nightly-e2e-aws-ovn/456/artifacts/e2e-timelines_spyglass_*.json",
    );
    expect(result.artifact_paths).toContain(
      "https://storage.googleapis.com/test-platform-results/logs/aggregated-ci-openshift-release-4.18-nightly-e2e-aws-ovn/456/artifacts/aggregated-extra/",
    );
  });

  it("falls back to the artifacts doc when no signals are found", () => {
    const result = buildRunAnalysis(ref, {
      failedTests: [],
      buildLogLines: ["all good", "done"],
    });
    expect(result.signals).toEqual([]);
    expect(result.candidate_references).toEqual(["references/artifacts.md"]);
  });

  it("keeps the serialized result compact (target <=4 KB)", () => {
    const result = buildRunAnalysis(ref, {
      failedTests: ["TestNetwork should route pods"],
      buildLogLines: BUILD_LOG.split("\n"),
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4096);
  });
});

describe("analyzeProwRun", () => {
  it("runs the full pipeline from a Prow deck URL with an injected fetcher", async () => {
    const { fetcher, calls } = fakeFetcher();
    const result = await analyzeProwRun(
      "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn/123",
      { fetcher },
    );
    expect(result.job_name).toBe("periodic-ci-openshift-release-4.18-nightly-e2e-aws-ovn");
    expect(result.build_id).toBe("123");
    expect(result.failed_tests).toEqual(["TestNetwork should route pods"]);
    expect(calls.some((u) => u.includes("/storage/v1/"))).toBe(true);
  });

  it("rejects a malformed url before any fetch", async () => {
    const { fetcher, calls } = fakeFetcher();
    await expect(analyzeProwRun("https://example.com/nope", { fetcher })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("runPermafailAnalysis", () => {
  const validUrls = [
    "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/J/3",
    "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/J/2",
  ];

  it("rejects a 2-segment url before any fetcher call", async () => {
    const { fetcher, calls } = fakeFetcher();
    await expect(
      runPermafailAnalysis(
        ["https://prow.ci.openshift.org/view/gs/b/only-two-segs", validUrls[1]],
        "J",
        { fetcher },
      ),
    ).rejects.toThrow(/JOB\/BUILD_ID/);
    expect(calls).toEqual([]);
  });

  it("rejects out-of-range url counts via input validation", async () => {
    const { fetcher, calls } = fakeFetcher();
    await expect(runPermafailAnalysis([validUrls[0]], "J", { fetcher })).rejects.toThrow(
      /2-10 Prow URLs/,
    );
    expect(calls).toEqual([]);
  });

  it("returns a permafail verdict when the same test fails in all runs", async () => {
    const { fetcher } = fakeFetcher();
    const verdict = await runPermafailAnalysis(validUrls, "J", { fetcher });
    expect(verdict.permafail).toBe(true);
    expect(verdict.failure_type).toBe("test_failure");
    expect(verdict.matching_runs).toBe(2);
    expect(verdict.comparable_runs).toBe(2);
    expect(verdict.match_ratio).toBe("2/2");
    expect(verdict.reason).toContain("2/2");
  });

  it("rejects an empty job name", async () => {
    const { fetcher, calls } = fakeFetcher();
    await expect(runPermafailAnalysis(validUrls, "  ", { fetcher })).rejects.toThrow(
      /job_name/,
    );
    expect(calls).toEqual([]);
  });

  it("rejects a job_name that does not match the urls' parsed job names before any fetcher call", async () => {
    const { fetcher, calls } = fakeFetcher();
    // validUrls parse to jobName "J"; supplying a different name must throw
    // before any fetch, and the error must name both values.
    await expect(runPermafailAnalysis(validUrls, "other-job", { fetcher })).rejects.toThrow(
      /other-job[\s\S]*J/,
    );
    expect(calls).toEqual([]);
  });
});

describe("prowUrlToGcsPath integration", () => {
  it("parses the deck URL used by analyzeProwRun", () => {
    const parsed = prowUrlToGcsPath(
      "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/J/123",
    );
    expect(parsed).toEqual({ bucket: "test-platform-results", path: "logs", jobName: "J", buildId: "123" });
  });
});
