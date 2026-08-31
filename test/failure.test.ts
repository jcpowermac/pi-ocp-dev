import { describe, it, expect } from "vitest";
import {
  classifyJobTypes,
  scanFailureSignals,
  candidateReferences,
} from "../extensions/prow/failure.js";

// ---------------------------------------------------------------------------
// classifyJobTypes — one case per row of the upstream name-pattern table,
// plus compound names.
// ---------------------------------------------------------------------------

describe("classifyJobTypes", () => {
  it("classifies upgrade jobs", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-upgrade-aws")).toContain(
      "upgrade",
    );
  });

  it("classifies metal and baremetal jobs as metal", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-metal")).toContain("metal");
    expect(classifyJobTypes("periodic-ci-openshift-4.17-baremetal")).toContain(
      "metal",
    );
  });

  it("classifies hypershift jobs", () => {
    expect(classifyJobTypes("periodic-ci-openshift-hypershift-4.17")).toContain(
      "hypershift",
    );
  });

  it("classifies fips jobs", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-fips")).toContain("fips");
  });

  it("classifies ipv6 and dualstack jobs", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-ipv6")).toContain("ipv6");
    expect(classifyJobTypes("periodic-ci-openshift-4.18-dualstack")).toContain(
      "ipv6",
    );
  });

  it("classifies single-node jobs (sno and single-node tokens)", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-sno")).toContain(
      "single-node",
    );
    expect(classifyJobTypes("periodic-ci-openshift-4.18-single-node")).toContain(
      "single-node",
    );
  });

  it("classifies aggregated- prefix jobs", () => {
    expect(classifyJobTypes("aggregated-ci-openshift-e2e-aws")).toContain(
      "aggregated",
    );
  });

  it("does not treat non-prefixed names as aggregated", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-aggregated-check")).not.toContain(
      "aggregated",
    );
  });

  it("classifies aws, gcp, and azure as cloud", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-aws")).toContain("cloud");
    expect(classifyJobTypes("periodic-ci-openshift-4.18-gcp")).toContain("cloud");
    expect(classifyJobTypes("periodic-ci-openshift-4.18-azure")).toContain("cloud");
  });

  it("classifies techpreview jobs", () => {
    expect(
      classifyJobTypes("periodic-ci-openshift-4.18-techpreview"),
    ).toContain("techpreview");
  });

  it("classifies rhcos9, rhcos10, rhcos9_10, and rt as rhcos", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-rhcos9")).toContain("rhcos");
    expect(classifyJobTypes("periodic-ci-openshift-4.18-rhcos10")).toContain("rhcos");
    expect(classifyJobTypes("periodic-ci-openshift-4.18-rhcos9_10")).toContain(
      "rhcos",
    );
    expect(classifyJobTypes("periodic-ci-openshift-4.18-rt")).toContain("rhcos");
  });

  it("does not match short tokens inside longer words", () => {
    // "start" contains "rt", "snownode-ish" words should not count as sno
    expect(classifyJobTypes("periodic-ci-openshift-4.18-start-job")).toEqual([]);
  });

  it("returns multiple types in table order for compound names", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-upgrade-metal-ipv6")).toEqual([
      "upgrade",
      "metal",
      "ipv6",
    ]);
  });

  it("returns an empty array for unknown names", () => {
    expect(classifyJobTypes("periodic-ci-openshift-4.18-e2e-libvirt")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scanFailureSignals — one case per signal name, plus compound cases.
// ---------------------------------------------------------------------------

const scan = (
  failedTests: string[] = [],
  buildLogLines: string[] = [],
  jobName = "periodic-ci-openshift-4.18-e2e-aws",
) => scanFailureSignals({ failedTests, buildLogLines, jobName });

const names = (signals: { name: string }[]) => signals.map((s) => s.name);

describe("scanFailureSignals", () => {
  it("returns no signals for a clean run", () => {
    expect(scan([], [])).toEqual([]);
  });

  it("emits test-failure and flaky for any failed test, with test names as evidence", () => {
    const signals = scan(["[sig-network] should serve endpoints"]);
    expect(names(signals)).toContain("test-failure");
    expect(names(signals)).toContain("flaky");
    const tf = signals.find((s) => s.name === "test-failure")!;
    expect(tf.evidence).toContain("[sig-network] should serve endpoints");
  });

  it("emits install for an 'install should succeed' failed test", () => {
    const signals = scan(["[sig-installer] install should succeed"]);
    expect(names(signals)).toContain("install");
  });

  it("emits install for install-stage errors in the build log", () => {
    const signals = scan([], ["F: install stage timed out after 30m"]);
    expect(names(signals)).toContain("install");
  });

  it("emits install-metal alongside install for metal jobs", () => {
    const signals = scan(
      ["install should succeed"],
      [],
      "periodic-ci-openshift-4.18-metal",
    );
    expect(names(signals)).toContain("install");
    expect(names(signals)).toContain("install-metal");
  });

  it("does not emit install-metal for non-metal jobs", () => {
    const signals = scan(["install should succeed"]);
    expect(names(signals)).not.toContain("install-metal");
  });

  it("emits test-extension for *-tests-ext / extension binary errors", () => {
    const signals = scan([], [
      "openshift-tests-ext: failed to extract extension binary",
    ]);
    expect(names(signals)).toContain("test-extension");
  });

  it("emits disruption for disruption interval/timeline markers", () => {
    const signals = scan([], [
      "E0721 disruption interval 12.4s in namespace openshift-etcd",
    ]);
    expect(names(signals)).toContain("disruption");
  });

  it("emits upgrade for CVO-stuck markers in an upgrade job", () => {
    const signals = scan(
      [],
      ["ClusterVersion 4.18.3-20260721 stuck: operators degraded"],
      "periodic-ci-openshift-4.18-upgrade-aws",
    );
    const up = signals.find((s) => s.name === "upgrade");
    expect(up).toBeDefined();
    expect(up!.evidence).toContain(
      "ClusterVersion 4.18.3-20260721 stuck: operators degraded",
    );
  });

  it("emits upgrade for a failing upgrade job even without markers", () => {
    const signals = scan(
      ["[sig-crio] container runtime should be stable"],
      [],
      "periodic-ci-openshift-4.18-upgrade-gcp",
    );
    expect(names(signals)).toContain("upgrade");
  });

  it("emits upgrade for MCO drain/reboot markers in non-upgrade jobs", () => {
    const signals = scan([], [
      "MCO: machineconfig drain stalled on node worker-1",
    ]);
    expect(names(signals)).toContain("upgrade");
  });

  it("emits hypershift for failing hypershift jobs", () => {
    const signals = scan(
      ["[sig-hypershift] hosted control plane should be ready"],
      [],
      "periodic-ci-openshift-hypershift-4.17",
    );
    expect(names(signals)).toContain("hypershift");
  });

  it("does not emit hypershift for non-hypershift jobs", () => {
    expect(names(scan(["some test failed"]))).not.toContain("hypershift");
  });

  it("emits aggregated for failing aggregated- jobs", () => {
    const signals = scan(
      ["child run 3 failed"],
      [],
      "aggregated-ci-openshift-e2e-aws",
    );
    expect(names(signals)).toContain("aggregated");
  });

  it("emits cloud-provider with sub_category for quota/throttling/provisioning errors", () => {
    const signals = scan([], [
      "aws: Error: QuotaExceeded: insufficient instance capacity in us-east-1",
    ]);
    const cp = signals.find((s) => s.name === "cloud-provider");
    expect(cp).toBeDefined();
    expect(cp?.sub_category).toBe("aws-quota");
  });

  it("emits resource-exhaustion with sub_category for container-oom and node-pressure", () => {
    const oom = scan([], ["pod etcd-0 killed: OOMKilled"]).find(
      (s) => s.name === "resource-exhaustion",
    );
    expect(oom?.sub_category).toBe("container-oom");

    const press = scan([], ["node worker-0 NotReady: MemoryPressure"]).find(
      (s) => s.name === "resource-exhaustion",
    );
    expect(press?.sub_category).toBe("node-pressure");
  });

  it("emits networking with sub_category for image-pull and dns", () => {
    const pull = scan([], ["Failed to pull image quay.io/app:latest: registry access timeout"]).find(
      (s) => s.name === "networking",
    );
    expect(pull?.sub_category).toBe("image-pull");

    const dns = scan([], ["DNS lookup failed: no such host for api.apps-ops"]).find(
      (s) => s.name === "networking",
    );
    expect(dns?.sub_category).toBe("dns-resolution");
  });

  it("emits resource-exhaustion for OOM / NotReady / disk pressure markers", () => {
    const signals = scan([], [
      "node worker-0 NotReady: MemoryPressure",
      "pod etcd-0 killed: OOMKilled",
      "Warning Unschedulable 0/3 nodes are available: disk full",
    ]);
    expect(names(signals)).toContain("resource-exhaustion");
  });

  it("emits networking for DNS/OVN/image-pull/registry/ingress errors", () => {
    const signals = scan([], [
      "Failed to pull image quay.io/app:latest: registry access timeout",
      "DNS lookup failed: no such host for api.apps-ops",
    ]);
    expect(names(signals)).toContain("networking");
  });

  it("emits os-changes for cri-o / kernel panic / SELinux markers", () => {
    const signals = scan([], ["kernel panic - not syncing: VFS: Unable to mount root fs"]);
    expect(names(signals)).toContain("os-changes");
  });

  it("emits ci-infrastructure for lease / ci-operator / step-registry errors", () => {
    const signals = scan([], [
      "could not acquire lease ci-op-lease after 30m",
      "ci-operator: error parsing step registry entries",
    ]);
    expect(names(signals)).toContain("ci-infrastructure");
  });

  it("caps evidence at 3 lines truncated to 200 chars", () => {
    const long = "k".repeat(300);
    const signals = scan(
      [],
      ["OOMKilled a", "OOMKilled b", "OOMKilled c", "OOMKilled d", "OOMKilled e"],
    );
    const re = signals.find((s) => s.name === "resource-exhaustion")!;
    expect(re.evidence).toHaveLength(3);
    // the long line, when present, must be truncated to 200 chars
    const sig2 = scan([], [long + " OOMKilled"])!;
    const line = sig2.find((s) => s.name === "resource-exhaustion")!.evidence[0];
    expect(line.length).toBeLessThanOrEqual(200);
  });

  it("caps install evidence at 3 lines when the install test and log lines both fail", () => {
    const signals = scan(
      ["[sig-installer] install should succeed"],
      [
        "bootstrap failed to pull image quay.io/openshift/installer:latest",
        "cluster-creation error: control plane did not become ready",
        "install stage timed out after 30m",
        "ipi-install step error: machine config daemon stuck",
      ],
    );
    const install = signals.find((s) => s.name === "install");
    expect(install).toBeDefined();
    expect(install!.evidence).toHaveLength(3);
    // the failed test name takes the first slot
    expect(install!.evidence[0]).toContain("install should succeed");
  });

  it("caps install-metal evidence at 3 lines for the same combination", () => {
    const signals = scan(
      ["[sig-installer] install should succeed"],
      [
        "bootstrap failed to pull image quay.io/openshift/installer:latest",
        "cluster-creation error: control plane did not become ready",
        "install stage timed out after 30m",
      ],
      "periodic-ci-openshift-4.18-metal",
    );
    const metal = signals.find((s) => s.name === "install-metal");
    expect(metal).toBeDefined();
    expect(metal!.evidence).toHaveLength(3);
  });

  it("emits multiple independent signals for compound failures", () => {
    const signals = scan(
      ["[sig-network] should serve endpoints"],
      [
        "Failed to pull image quay.io/app:latest: registry access timeout",
        "node worker-0 NotReady: MemoryPressure",
      ],
    );
    for (const expected of [
      "test-failure",
      "flaky",
      "networking",
      "resource-exhaustion",
    ]) {
      expect(names(signals)).toContain(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// candidateReferences — routing-table selection, ordering, and the 3-doc cap.
// ---------------------------------------------------------------------------

describe("candidateReferences", () => {
  it("falls back to the artifacts doc when there are no signals", () => {
    expect(candidateReferences([], [])).toEqual(["references/artifacts.md"]);
  });

  it("puts flaky-test-identification first whenever a plain test failed", () => {
    const signals = scan(["[sig-network] should serve endpoints"]);
    const refs = candidateReferences(classifyJobTypes("periodic-ci-openshift-4.18-e2e-aws"), signals);
    expect(refs[0]).toBe("references/flaky-test-identification.md");
    expect(refs).toContain("references/test-failure.md");
  });

  it("selects install general and metal docs for a metal install failure", () => {
    const signals = scan(["install should succeed"], [], "periodic-ci-openshift-4.18-metal");
    const refs = candidateReferences(
      classifyJobTypes("periodic-ci-openshift-4.18-metal"),
      signals,
    );
    expect(refs).toContain("references/install/general.md");
    expect(refs).toContain("references/install/metal.md");
  });

  it("routes each signal name to its routing-table reference", () => {
    const sig = (name: string) => [{ name, evidence: ["evidence line"] }];
    const cases: [string, string][] = [
      ["test-extension", "references/test-extension-binaries.md"],
      ["disruption", "references/disruption.md"],
      ["upgrade", "references/upgrade.md"],
      ["hypershift", "references/hypershift.md"],
      ["aggregated", "references/aggregated.md"],
      ["cloud-provider", "references/cloud-provider-errors.md"],
      ["resource-exhaustion", "references/resource-exhaustion.md"],
      ["networking", "references/networking.md"],
      ["os-changes", "references/operating-system-changes.md"],
      ["ci-infrastructure", "references/ci-infrastructure-changes.md"],
    ];
    for (const [signalName, expectedRef] of cases) {
      expect(candidateReferences([], sig(signalName))).toEqual([expectedRef]);
    }
  });

  it("caps results at 3 in priority order (flaky, test-failure, then routing order)", () => {
    const signals = scan(
      ["[sig-network] should serve endpoints"],
      ["MCO: machineconfig drain stalled on node worker-1", "dns lookup failed: no such host"],
      "periodic-ci-openshift-4.18-upgrade-aws",
    );
    const refs = candidateReferences(classifyJobTypes("periodic-ci-openshift-4.18-upgrade-aws"), signals);
    expect(refs).toHaveLength(3);
    expect(refs[0]).toBe("references/flaky-test-identification.md");
    expect(refs[1]).toBe("references/test-failure.md");
    expect(refs[2]).toBe("references/upgrade.md");
  });
});
