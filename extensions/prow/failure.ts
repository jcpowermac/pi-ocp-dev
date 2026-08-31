/**
 * Deterministic failure-signal scanner for Prow job runs.
 *
 * Pure (no network): classifies job names into environment types, scans
 * failed-test names and build-log lines for failure signals, and routes
 * signals to the prow-job-analysis reference docs. Heuristics are ported
 * from the ai-helpers CI plugin `prow-job-analysis` skill ("Step 3: Classify
 * Job Type from Name" and "Failure Routing Table").
 */

export interface Signal {
  name: string;
  evidence: string[];
}

export interface FailureScanInput {
  failedTests: string[];
  buildLogLines: string[];
  jobName: string;
}

// ---------------------------------------------------------------------------
// Job type classification (name-pattern table)
// ---------------------------------------------------------------------------

const JOB_TYPE_PATTERNS: { pattern: RegExp; type: string }[] = [
  { pattern: /upgrade/, type: "upgrade" },
  { pattern: /metal/, type: "metal" }, // covers baremetal
  { pattern: /hypershift/, type: "hypershift" },
  { pattern: /fips/, type: "fips" },
  { pattern: /ipv6|dualstack/, type: "ipv6" },
  { pattern: /single-node|\bsno\b/, type: "single-node" },
  { pattern: /^aggregated-/, type: "aggregated" },
  { pattern: /aws|gcp|azure/, type: "cloud" },
  { pattern: /techpreview/, type: "techpreview" },
  { pattern: /\brhcos9(?:_10)?|\brhcos10|\brt\b/, type: "rhcos" },
];

/** Classify a Prow job name into environment types (table order). */
export function classifyJobTypes(jobName: string): string[] {
  const name = jobName.toLowerCase();
  const types: string[] = [];
  for (const { pattern, type } of JOB_TYPE_PATTERNS) {
    if (pattern.test(name)) types.push(type);
  }
  return types;
}

// ---------------------------------------------------------------------------
// Failure signal scanning
// ---------------------------------------------------------------------------

const EVIDENCE_MAX_LINES = 3;
const EVIDENCE_MAX_CHARS = 200;

// Shared failure-word fragment used inside the signal regexes below.
const FAIL = "(fail\\w*|error|timed?[ _]out|exceeded)";

const INSTALL_TEST_RE = /install should succeed/i;
const INSTALL_LOG_RE = new RegExp(
  `((install|bootstrap|cluster-creation|ipi-install).{0,80}${FAIL})|(${FAIL}.{0,80}(install stage|install step|bootstrap|cluster creation))`,
  "i",
);
const TEST_EXT_RE =
  /tests-ext|extension[- _]?binary|(extract|discovery|version skew).{0,40}extension/i;
const DISRUPTION_RE = /disruption.{0,40}(interval|event|timeline)|api backends stopped/i;
const UPGRADE_RE =
  /(cvo|clusterversion).{0,60}(stuck|unable|failed|degraded)|mco.{0,60}(drain|reboot|stall)|machineconfig.{0,60}(drain|reboot|stall|stuck)|version skew|operator.{0,40}degraded/i;
const HYPERSHIFT_RE = /hypershift|hosted control plane|hcp/i;
const CLOUD_RE =
  /quota.{0,60}(exceed|insufficient)|exceeded.{0,40}quota|throttl|rate (limit|exceeded)|insufficient (instance )?capacity|provisioning.{0,40}(fail|error)/i;
const RESOURCE_RE =
  /oomkilled|out of memory|notready|memorypressure|diskpressure|pidpressure|unschedulable|evict/i;
const NETWORK_RE =
  /dns.{0,40}(fail|error|timeout)|no such host|nxdomain|ovn|image pull|pull image.{0,60}(fail|error|timeout)|registry.{0,40}(timeout|fail|error)|ingress.{0,40}(fail|error|timeout)/i;
const OS_RE =
  /cri-o|crun|kernel panic|networkmanager|selinux|systemd.{0,40}(fail|error)/i;
const CI_INFRA_RE =
  /lease.{0,60}(fail|error|timeout)|acquire.{0,40}lease|renew.{0,40}lease|ci-operator.{0,40}(fail|error|timeout)|step[- _]?registry.{0,40}(fail|error|timeout)/i;

const truncate = (line: string) => line.trim().slice(0, EVIDENCE_MAX_CHARS);
const fromLines = (lines: string[], re: RegExp): string[] =>
  lines.filter((l) => re.test(l)).map(truncate).slice(0, EVIDENCE_MAX_LINES);

/**
 * Scan failed tests and build-log lines for failure signals. Signals are
 * returned in a fixed order: install, install-metal, test-failure, flaky,
 * test-extension, disruption, upgrade, hypershift, aggregated,
 * cloud-provider, resource-exhaustion, networking, os-changes,
 * ci-infrastructure.
 */
export function scanFailureSignals(input: FailureScanInput): Signal[] {
  const { failedTests, buildLogLines, jobName } = input;
  const jobTypes = classifyJobTypes(jobName);
  const hasTests = failedTests.length > 0;
  const testEvidence = failedTests.map(truncate).slice(0, EVIDENCE_MAX_LINES);
  const signals: Signal[] = [];

  // install: failed test or install-stage error in the build log
  const installLogLines = fromLines(buildLogLines, INSTALL_LOG_RE);
  const installTestLine = failedTests.find((t) => INSTALL_TEST_RE.test(t));
  if (installTestLine || installLogLines.length > 0) {
    signals.push({
      name: "install",
      evidence: installTestLine ? [truncate(installTestLine), ...installLogLines] : installLogLines,
    });
  }

  // install-metal: install failure on a metal/baremetal job
  if (signals.some((s) => s.name === "install") && jobTypes.includes("metal")) {
    signals.push({
      name: "install-metal",
      evidence: signals.find((s) => s.name === "install")!.evidence,
    });
  }

  // test-failure + flaky: any failed test (flaky-identification is the triage entry)
  if (hasTests) {
    signals.push({ name: "test-failure", evidence: testEvidence });
    signals.push({ name: "flaky", evidence: testEvidence });
  }

  // test-extension: *-tests-ext / OTE extension binary errors
  const testExtLines = fromLines(buildLogLines, TEST_EXT_RE);
  if (testExtLines.length > 0) signals.push({ name: "test-extension", evidence: testExtLines });

  // disruption: interval/timeline markers
  const disruptionLines = fromLines(buildLogLines, DISRUPTION_RE);
  if (disruptionLines.length > 0) {
    signals.push({ name: "disruption", evidence: disruptionLines });
  }

  // upgrade: CVO/MCO/version-skew markers, or a failing upgrade job
  const upgradeLines = fromLines(buildLogLines, UPGRADE_RE);
  if (upgradeLines.length > 0) {
    signals.push({ name: "upgrade", evidence: upgradeLines });
  } else if (jobTypes.includes("upgrade") && hasTests) {
    signals.push({ name: "upgrade", evidence: testEvidence });
  }

  // hypershift / aggregated: failing job of that type
  if (
    jobTypes.includes("hypershift") &&
    (hasTests || buildLogLines.some((l) => HYPERSHIFT_RE.test(l) && /fail|error/i.test(l)))
  ) {
    const markerLines = fromLines(
      buildLogLines,
      /fail|error/i,
    ).filter((l) => HYPERSHIFT_RE.test(l));
    signals.push({
      name: "hypershift",
      evidence: markerLines.length > 0 ? markerLines : testEvidence,
    });
  }
  if (
    jobTypes.includes("aggregated") &&
    (hasTests || buildLogLines.some((l) => /fail|error/i.test(l)))
  ) {
    signals.push({ name: "aggregated", evidence: testEvidence });
  }

  // log-marker signals
  const markerSignals: [string, RegExp][] = [
    ["cloud-provider", CLOUD_RE],
    ["resource-exhaustion", RESOURCE_RE],
    ["networking", NETWORK_RE],
    ["os-changes", OS_RE],
    ["ci-infrastructure", CI_INFRA_RE],
  ];
  for (const [name, re] of markerSignals) {
    const lines = fromLines(buildLogLines, re);
    if (lines.length > 0) signals.push({ name, evidence: lines });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Reference routing
// ---------------------------------------------------------------------------

// Priority order mirrors the upstream routing table; flaky-test-identification
// is the triage entry for any failing test, install docs supersede the
// test-failure doc when the failure is the install itself.
const SIGNAL_REFERENCE_PRIORITY: [string, string][] = [
  ["flaky", "references/flaky-test-identification.md"],
  ["test-failure", "references/test-failure.md"],
  ["install", "references/install/general.md"],
  ["install-metal", "references/install/metal.md"],
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

// Job types that imply a reference doc even without a matching signal.
const JOB_TYPE_REFERENCE: [string, string][] = [
  ["upgrade", "references/upgrade.md"],
  ["hypershift", "references/hypershift.md"],
  ["aggregated", "references/aggregated.md"],
];

/**
 * Ordered 1-3 reference doc paths for a scan result. With no signals this
 * falls back to the artifacts doc.
 */
export function candidateReferences(
  jobTypes: string[],
  signals: Signal[],
): string[] {
  if (signals.length === 0) return ["references/artifacts.md"];

  const present = new Set(signals.map((s) => s.name));
  const installFailed = present.has("install");
  const refs: string[] = [];
  for (const [name, ref] of SIGNAL_REFERENCE_PRIORITY) {
    if (!present.has(name)) continue;
    // Install docs cover the failing install test; don't spend a slot on it.
    if (name === "test-failure" && installFailed) continue;
    refs.push(ref);
  }
  for (const [type, ref] of JOB_TYPE_REFERENCE) {
    if (jobTypes.includes(type) && !refs.includes(ref)) refs.push(ref);
  }
  return refs.slice(0, 3);
}
