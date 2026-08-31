import { describe, it, expect } from "vitest";
import {
  detectPermafail,
  validatePermafailInputs,
  type PermafailVerdict,
} from "../extensions/prow/permafail.js";
import type { RunSignature } from "../extensions/prow/classify.js";

const testRun = (buildId: string, tests: string[]): RunSignature => ({
  buildId,
  failureType: "test_failure",
  tests,
  errors: [],
});

const infraRun = (buildId: string, errors: [string, string][]): RunSignature => ({
  buildId,
  failureType: "infra_failure",
  tests: [],
  errors: errors.map(([message, hash]) => ({ message, hash })),
});

const successRun = (buildId: string): RunSignature => ({
  buildId,
  failureType: "success",
  tests: [],
  errors: [],
});

const prowUrl = (buildId: string) =>
  `https://prow.ci.openshift.org/view/gs/test-platform-results/logs/pull-ci-openshift-origin-master-e2e-aws/${buildId}`;

// ---------------------------------------------------------------------------
// Upstream eval cases (ai-helpers plugins/ci/evals/cases/detect-permafail)
// ---------------------------------------------------------------------------

describe("upstream eval cases", () => {
  it("case-001: 2/10 same test across 10 runs is below the 7/10 threshold", () => {
    const signatures: RunSignature[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const test =
        i <= 2
          ? "TestNetworkPolicy"
          : `TestOther${i}`; // 8 distinct other tests
      signatures.push(testRun(`b${i}`, [test]));
    }
    const v = detectPermafail(signatures);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("test_failure");
    expect(v.match_ratio).toBe("2/10");
    expect(v.matching_runs).toBe(2);
    expect(v.comparable_runs).toBe(10);
    expect(v.threshold_required).toBe(7);
    expect(v.confidence).toBeGreaterThanOrEqual(0.65);
    expect(v.reason).toContain("2/10");
    expect(v.reason).toContain("TestNetworkPolicy");
  });

  it("case-002: 7/10 same test exactly meets the 70% threshold (permafail)", () => {
    const signatures: RunSignature[] = [];
    for (let i = 1; i <= 7; i += 1) signatures.push(testRun(`b${i}`, ["TestNetworkPolicy"]));
    for (const t of ["TestStorageClass", "TestPodEviction", "TestServiceMesh"]) {
      signatures.push(testRun(`b${signatures.length + 1}`, [t]));
    }
    const v = detectPermafail(signatures);
    expect(v.permafail).toBe(true);
    expect(v.failure_type).toBe("test_failure");
    expect(v.match_ratio).toBe("7/10");
    expect(v.matching_runs).toBe(7);
    expect(v.comparable_runs).toBe(10);
    expect(v.threshold_required).toBe(7);
    expect(v.confidence).toBeGreaterThanOrEqual(0.85);
    expect(v.reason).toContain("7/10 test_failure runs failed TestNetworkPolicy");
  });

  it("case-003: mixed — 4/4 same test with 3 diverse infra errors is permafail (test)", () => {
    const v = detectPermafail([
      testRun("b1", ["TestNetworkPolicy"]),
      testRun("b2", ["TestNetworkPolicy"]),
      testRun("b3", ["TestNetworkPolicy"]),
      testRun("b4", ["TestNetworkPolicy"]),
      infraRun("b5", [["cluster creation timeout", "h1"]]),
      infraRun("b6", [["AWS quota exceeded", "h2"]]),
      infraRun("b7", [["network unreachable", "h3"]]),
    ]);
    expect(v.permafail).toBe(true);
    expect(v.failure_type).toBe("test_failure");
    expect(v.match_ratio).toBe("4/4");
    expect(v.matching_runs).toBe(4);
    expect(v.comparable_runs).toBe(4);
    expect(v.threshold_required).toBe(4);
    expect(v.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("case-004: 1 test run + 6 diverse infra errors is not permafail (mixed)", () => {
    const v = detectPermafail([
      testRun("b1", ["TestNetworkPolicy"]),
      infraRun("b2", [["cluster creation timeout", "h1"]]),
      infraRun("b3", [["AWS quota exceeded", "h2"]]),
      infraRun("b4", [["network unreachable", "h3"]]),
      infraRun("b5", [["pod eviction", "h4"]]),
      infraRun("b6", [["storage failure", "h5"]]),
      infraRun("b7", [["DNS timeout", "h6"]]),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("mixed");
    expect(v.match_ratio).toBe("1/6");
    expect(v.matching_runs).toBe(1);
    expect(v.comparable_runs).toBe(6);
    expect(v.threshold_required).toBe(5);
    expect(v.confidence).toBeGreaterThanOrEqual(0.65);
    expect(v.reason).toContain("insufficient");
  });

  it("case-005: 1 test run + 5/6 identical infra error is permafail (infra)", () => {
    const v = detectPermafail([
      testRun("b1", ["TestNetworkPolicy"]),
      ...["b2", "b3", "b4", "b5", "b6"].map((id) =>
        infraRun(id, [["operator authentication timeout", "same"]]),
      ),
      infraRun("b7", [["DNS timeout", "other"]]),
    ]);
    expect(v.permafail).toBe(true);
    expect(v.failure_type).toBe("infra_failure");
    expect(v.match_ratio).toBe("5/6");
    expect(v.matching_runs).toBe(5);
    expect(v.comparable_runs).toBe(6);
    expect(v.threshold_required).toBe(5);
    expect(v.confidence).toBeGreaterThanOrEqual(0.85);
    expect(v.reason).toContain("5/6 infra_failure runs share the strongest error 'operator authentication timeout'");
  });

  it("case-006: 3 test runs with all-different tests is not permafail", () => {
    const v = detectPermafail([
      testRun("b1", ["[sig-storage] In-tree Volumes should store data", "[sig-storage] second storage test"]),
      testRun("b2", ["[Monitor:legacy-cvo-invariants] clusteroperator should stay Progressing=False"]),
      testRun("b3", ["[sig-network] egressfirewall should be created"]),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("test_failure");
    expect(v.comparable_runs).toBe(3);
    expect(v.threshold_required).toBe(3);
    expect(v.confidence).toBeGreaterThanOrEqual(0.7);
    // Upstream annotation expects "0/3"; the SKILL.md algorithm reports the
    // strongest single test (1/3) — see report discrepancy note.
    expect(v.match_ratio).toBe("1/3");
  });
});

// ---------------------------------------------------------------------------
// Threshold boundaries
// ---------------------------------------------------------------------------

describe("threshold boundaries", () => {
  it("N=3: all three test runs matching is permafail with 0.99 confidence", () => {
    const v = detectPermafail([
      testRun("b1", ["TestA"]),
      testRun("b2", ["TestA"]),
      testRun("b3", ["TestA"]),
    ]);
    expect(v.permafail).toBe(true);
    expect(v.match_ratio).toBe("3/3");
    expect(v.threshold_required).toBe(3);
    expect(v.confidence).toBe(0.99);
  });

  it("N=5 infra: 3/5 identical error is below the 4/5 threshold (not permafail)", () => {
    const v = detectPermafail([
      infraRun("b1", [["operator X timeout", "h"]]),
      infraRun("b2", [["operator X timeout", "h"]]),
      infraRun("b3", [["operator X timeout", "h"]]),
      infraRun("b4", [["random error one", "r1"]]),
      infraRun("b5", [["random error two", "r2"]]),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("infra_failure");
    expect(v.match_ratio).toBe("3/5");
    expect(v.threshold_required).toBe(4);
    expect(v.confidence).toBe(0.7);
  });

  it("N=6 test: 4/6 is below the ceil(6*0.7)=5 threshold (not permafail)", () => {
    const sigs = [
      ...[1, 2, 3, 4].map((i) => testRun(`b${i}`, ["TestA"])),
  testRun("b5", ["TestB"]),
      testRun("b6", ["TestC"]),
    ];
    const v = detectPermafail(sigs);
    expect(v.permafail).toBe(false);
    expect(v.match_ratio).toBe("4/6");
    expect(v.threshold_required).toBe(5);
  });

  it("N=7 test: 5/7 exactly meets the ceil(7*0.7)=5 threshold (permafail, 0.85)", () => {
    const sigs = [
      ...[1, 2, 3, 4, 5].map((i) => testRun(`b${i}`, ["TestA"])),
      testRun("b6", ["TestB"]),
      testRun("b7", ["TestC"]),
    ];
    const v = detectPermafail(sigs);
    expect(v.permafail).toBe(true);
    expect(v.match_ratio).toBe("5/7");
    expect(v.threshold_required).toBe(5);
    expect(v.confidence).toBe(0.85);
  });

  it("mixed both-meet: dominant pattern is the higher ratio, tie breaks to test_failure", () => {
    // 5/5 test (ratio 1.0, exceeds threshold 4) vs 3/3 infra (ratio 1.0) → tie → test_failure
    const v = detectPermafail([
      ...[1, 2, 3, 4, 5].map((i) => testRun(`b${i}`, ["TestA"])),
      ...["c1", "c2", "c3"].map((id) => infraRun(id, [["setup failed", "h"]])),
    ]);
    expect(v.permafail).toBe(true);
    expect(v.failure_type).toBe("test_failure");
    expect(v.match_ratio).toBe("5/5");
    expect(v.confidence).toBe(0.99);
  });

  it("mixed neither-meet: 2 distinct tests + 2 distinct infra errors (not permafail, mixed)", () => {
    const v = detectPermafail([
      testRun("b1", ["TestA"]),
      testRun("b2", ["TestB"]),
      infraRun("c1", [["error one", "h1"]]),
      infraRun("c2", [["error two", "h2"]]),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("mixed");
    expect(v.match_ratio).toBe("1/2");
    expect(v.threshold_required).toBe(2);
  });

  it("threshold exceeded (not identical): 8/10 gives 0.92 confidence", () => {
    const sigs = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
        // two tests in some runs so the runs are not all identical sets
        i % 2 === 0 ? testRun(`b${i}`, ["TestA", `Extra${i}`]) : testRun(`b${i}`, ["TestA"]),
      ),
      testRun("b9", ["TestX"]),
      testRun("b10", ["TestY"]),
    ];
    const v = detectPermafail(sigs);
    expect(v.permafail).toBe(true);
    expect(v.match_ratio).toBe("8/10");
    expect(v.confidence).toBe(0.92);
  });

  it("success runs do not count as comparable runs", () => {
    const v = detectPermafail([
      testRun("b1", ["TestA"]),
      testRun("b2", ["TestA"]),
      successRun("b3"),
      successRun("b4"),
    ]);
    expect(v.permafail).toBe(true);
    expect(v.match_ratio).toBe("2/2");
    expect(v.comparable_runs).toBe(2);
  });

  it("all-success input is a clear non-permafail verdict", () => {
    const v: PermafailVerdict = detectPermafail([
      successRun("b1"),
      successRun("b2"),
      successRun("b3"),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("mixed");
    expect(v.match_ratio).toBe("0/0");
    expect(v.matching_runs).toBe(0);
    expect(v.comparable_runs).toBe(0);
    expect(v.confidence).toBe(0.99);
    expect(v.reason).toContain("no failures");
  });

  it("single test failure plus successes is insufficient (not permafail)", () => {
    const v = detectPermafail([
      testRun("b1", ["TestA"]),
      successRun("b2"),
      successRun("b3"),
    ]);
    expect(v.permafail).toBe(false);
    expect(v.failure_type).toBe("test_failure");
    expect(v.reason).toContain("insufficient");
  });

  it("rejects fewer than 2 and more than 10 signatures", () => {
    expect(() => detectPermafail([testRun("b1", ["TestA"])])).toThrow(/2/);
    expect(() =>
      detectPermafail(Array.from({ length: 11 }, (_, i) => testRun(`b${i}`, ["TestA"]))),
    ).toThrow(/10/);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("validatePermafailInputs", () => {
  const goodUrls = [prowUrl("1"), prowUrl("2"), prowUrl("3")];

  it("accepts 2-10 valid Prow URLs with a job name", () => {
    const result = validatePermafailInputs(goodUrls, "pull-ci-openshift-origin-master-e2e-aws");
    expect(result).toEqual({ ok: true, urls: goodUrls, jobName: "pull-ci-openshift-origin-master-e2e-aws" });
  });

  it("rejects fewer than 2 URLs", () => {
    const result = validatePermafailInputs([prowUrl("1")], "job-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2/);
  });

  it("rejects more than 10 URLs", () => {
    const urls = Array.from({ length: 11 }, (_, i) => prowUrl(String(i)));
    const result = validatePermafailInputs(urls, "job-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/10/);
  });

  it("rejects URLs that do not match the Prow deck URL pattern", () => {
    const result = validatePermafailInputs(["https://example.com/x", prowUrl("2")], "job-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("https://example.com/x");
  });

  it("rejects empty job names", () => {
    const result = validatePermafailInputs(goodUrls, "");
    expect(result.ok).toBe(false);
  });
});
