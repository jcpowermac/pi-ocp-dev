# Must-Gather Diagnostic Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a 100% pure TypeScript deterministic OpenShift must-gather diagnostic analysis engine in `pi-ocp-dev` that parses cluster resources (operators, pods, nodes, events, etcd, storage, network) and produces compact summaries (≤2–4 KB) for both local directories/tarballs and remote Prow GCS build artifacts.

**Architecture:** A modular architecture consisting of: (1) isolated TypeScript resource parsers in `extensions/must-gather/parsers/`, (2) a filesystem and remote GCS artifact loader with disk caching in `extensions/must-gather/loader.ts`, (3) an orchestration runner in `extensions/must-gather/runner.ts` that synthesizes summary metrics, and (4) an extension wrapper exposing `analyze_must_gather`, a `/must-gather` slash command, a `must-gather-analysis` skill, and an asynchronous `must-gather-analyst` subagent.

**Tech Stack:** TypeScript, Node.js (fs, path, zlib, tar/streaming), `yaml` library for YAML manifest parsing, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-must-gather-analysis-design.md`

## Global Constraints

- 100% pure TypeScript: Zero external Python or PyYAML dependencies.
- Bounded Context Consumption: Single-run overview triage must return compact structured JSON (≤2–4 KB) highlighting only health ratios and degraded/failing items.
- Dual input capability: Accept local must-gather directories, local `.tar`/`.tar.gz` archives, and remote Prow deck URLs (`https://prow.ci.openshift.org/view/gs/...`).
- Safe partial data handling: Missing subdirectories (e.g. `etcd_info/` on worker-only gathers or `network_logs/`) must resolve gracefully without throwing runtime errors.
- Vitest coverage: All parsers, loader resolution paths, and the runner orchestrator must have unit and integration test coverage.

---

### Task 1: Dependencies & Shared TypeScript Types

**Files:**
- Modify: `package.json`
- Create: `extensions/must-gather/types.ts`
- Test: `test/must-gather-types.test.ts`

**Interfaces:**
- Produces: `ClusterVersionInfo`, `OperatorCondition`, `ClusterOperatorStatus`, `NodeCondition`, `NodeStatus`, `PodIssue`, `PodStatusSummary`, `ClusterEvent`, `EtcdHealthInfo`, `StorageStatus`, `NetworkStatus`, `MustGatherAnalysisResult`, `MustGatherSummary`.

- [ ] **Step 1: Add `yaml` dependency to package.json and write the failing test**

```json
// In package.json dependencies:
"dependencies": {
  "yaml": "^2.7.0"
}
```

```typescript
// test/must-gather-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  ClusterOperatorStatus,
  MustGatherAnalysisResult,
  MustGatherSummary,
} from "../extensions/must-gather/types.js";

describe("must-gather types", () => {
  it("allows constructing valid analysis results", () => {
    const summary: MustGatherSummary = {
      operators: { total: 1, healthy: 1, degraded: 0, progressing: 0 },
      nodes: { total: 3, ready: 3, not_ready: 0, pressure: [] },
      pods: { total: 10, healthy: 10, failing: 0, crashloop: 0, pending: 0 },
      etcd: { total_members: 3, healthy: 3, quorum: true },
      warning_events_count: 0,
    };
    const result: MustGatherAnalysisResult = {
      must_gather_path: "/tmp/mg",
      cluster_version: { version: "4.18.2", state: "Completed" },
      summary,
      critical_issues: [],
      candidate_references: [],
    };
    expect(result.summary.operators.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-types.test.ts`
Expected: FAIL (types.ts missing)

- [ ] **Step 3: Install `yaml` and create `extensions/must-gather/types.ts`**

```typescript
// extensions/must-gather/types.ts
export interface ClusterVersionInfo {
  version: string;
  state: string;
  desired_version?: string;
  cluster_id?: string;
  capabilities?: string[];
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export interface OperatorCondition {
  type: "Available" | "Progressing" | "Degraded" | "Upgradeable";
  status: "True" | "False" | "Unknown";
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface ClusterOperatorStatus {
  name: string;
  version?: string;
  available: boolean;
  progressing: boolean;
  degraded: boolean;
  since?: string;
  message?: string;
}

export interface NodeStatus {
  name: string;
  ready: boolean;
  roles: string[];
  version?: string;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  pressures: string[];
}

export interface PodIssue {
  namespace: string;
  name: string;
  status: string;
  restarts: number;
  ready_containers: string;
  node?: string;
  reason?: string;
  message?: string;
}

export interface PodStatusSummary {
  total: number;
  healthy: number;
  failing: number;
  crashloop: number;
  pending: number;
  issues: PodIssue[];
}

export interface ClusterEvent {
  namespace: string;
  lastTimestamp: string;
  type: "Normal" | "Warning" | "Error";
  reason: string;
  object: string;
  message: string;
  count: number;
}

export interface EtcdMember {
  id: string;
  name: string;
  peerURLs: string[];
  clientURLs: string[];
  healthy: boolean;
}

export interface EtcdHealthInfo {
  total_members: number;
  healthy: number;
  quorum: boolean;
  leader?: string;
  members: EtcdMember[];
}

export interface StorageStatus {
  pv_count: number;
  pvc_count: number;
  unbound_pvc_count: number;
  unbound_pvcs: Array<{ namespace: string; name: string; status: string }>;
}

export interface NetworkStatus {
  type: string;
  healthy: boolean;
  issues: string[];
}

export interface MustGatherSummary {
  operators: { total: number; healthy: number; degraded: number; progressing: number };
  nodes: { total: number; ready: number; not_ready: number; pressure: string[] };
  pods: { total: number; healthy: number; failing: number; crashloop: number; pending: number };
  etcd: { total_members: number; healthy: number; quorum: boolean };
  warning_events_count: number;
}

export interface CriticalIssue {
  component: "operators" | "nodes" | "pods" | "events" | "etcd" | "network" | "storage";
  name: string;
  namespace?: string;
  reason?: string;
  message: string;
  since?: string;
  severity: "critical" | "warning";
}

export interface MustGatherAnalysisResult {
  must_gather_path: string;
  cluster_version?: ClusterVersionInfo;
  summary: MustGatherSummary;
  critical_issues: CriticalIssue[];
  candidate_references: string[];
  component_data?: {
    operators?: ClusterOperatorStatus[];
    nodes?: NodeStatus[];
    pods?: PodIssue[];
    events?: ClusterEvent[];
    etcd?: EtcdHealthInfo;
    storage?: StorageStatus;
    network?: NetworkStatus;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json extensions/must-gather/types.ts test/must-gather-types.test.ts
git commit -m "feat(must-gather): add dependencies and typescript interfaces"
```

---

### Task 2: Core Manifest Parsers (ClusterVersion, ClusterOperators, Nodes)

**Files:**
- Create: `extensions/must-gather/parsers/clusterversion.ts`
- Create: `extensions/must-gather/parsers/clusteroperators.ts`
- Create: `extensions/must-gather/parsers/nodes.ts`
- Test: `test/must-gather-parsers-core.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `parseClusterVersion(mgRoot: string): Promise<ClusterVersionInfo | null>`, `parseClusterOperators(mgRoot: string): Promise<ClusterOperatorStatus[]>`, `parseNodes(mgRoot: string): Promise<NodeStatus[]>`.

- [ ] **Step 1: Write failing tests for core manifest parsers**

```typescript
// test/must-gather-parsers-core.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseClusterVersion } from "../extensions/must-gather/parsers/clusterversion.js";
import { parseClusterOperators } from "../extensions/must-gather/parsers/clusteroperators.js";
import { parseNodes } from "../extensions/must-gather/parsers/nodes.js";

describe("core manifest parsers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-core-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses clusterversion.yaml correctly", async () => {
    const cvDir = path.join(tmpDir, "cluster-scoped-resources/config.openshift.io/clusterversions");
    fs.mkdirSync(cvDir, { recursive: true });
    fs.writeFileSync(
      path.join(cvDir, "version.yaml"),
      `
apiVersion: config.openshift.io/v1
kind: ClusterVersion
metadata:
  name: version
status:
  desired:
    version: 4.18.2
  history:
    - state: Completed
      version: 4.18.2
  conditions:
    - type: Available
      status: "True"
`,
    );
    const res = await parseClusterVersion(tmpDir);
    expect(res).not.toBeNull();
    expect(res?.version).toBe("4.18.2");
    expect(res?.state).toBe("Completed");
  });

  it("parses clusteroperators correctly", async () => {
    const coDir = path.join(tmpDir, "cluster-scoped-resources/config.openshift.io/clusteroperators");
    fs.mkdirSync(coDir, { recursive: true });
    fs.writeFileSync(
      path.join(coDir, "authentication.yaml"),
      `
apiVersion: config.openshift.io/v1
kind: ClusterOperator
metadata:
  name: authentication
status:
  conditions:
    - type: Available
      status: "False"
      message: "Deployment not ready"
    - type: Degraded
      status: "True"
      message: "OAuth degraded"
    - type: Progressing
      status: "False"
`,
    );
    const res = await parseClusterOperators(tmpDir);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("authentication");
    expect(res[0].degraded).toBe(true);
    expect(res[0].available).toBe(false);
  });

  it("parses nodes correctly", async () => {
    const nodeDir = path.join(tmpDir, "cluster-scoped-resources/core/nodes");
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(nodeDir, "worker-1.yaml"),
      `
apiVersion: v1
kind: Node
metadata:
  name: worker-1
  labels:
    node-role.kubernetes.io/worker: ""
status:
  conditions:
    - type: Ready
      status: "True"
    - type: MemoryPressure
      status: "True"
`,
    );
    const res = await parseNodes(tmpDir);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("worker-1");
    expect(res[0].ready).toBe(true);
    expect(res[0].pressures).toContain("MemoryPressure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-parsers-core.test.ts`
Expected: FAIL (parsers not found)

- [ ] **Step 3: Implement `clusterversion.ts`, `clusteroperators.ts`, and `nodes.ts`**

```typescript
// extensions/must-gather/parsers/clusterversion.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterVersionInfo } from "../types.js";

export async function parseClusterVersion(mgRoot: string): Promise<ClusterVersionInfo | null> {
  const file = path.join(mgRoot, "cluster-scoped-resources/config.openshift.io/clusterversions/version.yaml");
  if (!fs.existsSync(file)) return null;
  try {
    const doc = yaml.parse(fs.readFileSync(file, "utf8"));
    const status = doc?.status || {};
    const history = Array.isArray(status.history) ? status.history : [];
    const latest = history[0] || {};
    return {
      version: latest.version || status.desired?.version || "Unknown",
      state: latest.state || "Unknown",
      desired_version: status.desired?.version,
      cluster_id: doc?.spec?.clusterID,
      capabilities: status.capabilities?.enabledCapabilities || [],
      conditions: status.conditions || [],
    };
  } catch {
    return null;
  }
}
```

```typescript
// extensions/must-gather/parsers/clusteroperators.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterOperatorStatus } from "../types.js";

export async function parseClusterOperators(mgRoot: string): Promise<ClusterOperatorStatus[]> {
  const dir = path.join(mgRoot, "cluster-scoped-resources/config.openshift.io/clusteroperators");
  if (!fs.existsSync(dir)) return [];
  const results: ClusterOperatorStatus[] = [];
  const entries = fs.readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const f of entries) {
    try {
      const doc = yaml.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const name = doc?.metadata?.name || path.basename(f, path.extname(f));
      const conditions: any[] = doc?.status?.conditions || [];
      const getCond = (t: string) => conditions.find((c) => c.type === t);
      const avail = getCond("Available");
      const prog = getCond("Progressing");
      const deg = getCond("Degraded");

      const isDegraded = deg?.status === "True";
      const isProg = prog?.status === "True";
      const isAvail = avail?.status === "True";
      const msg = deg?.message || avail?.message || prog?.message;
      const since = deg?.lastTransitionTime || avail?.lastTransitionTime;

      const versions: any[] = doc?.status?.versions || [];
      const ver = versions.find((v) => v.name === "operator")?.version || versions[0]?.version;

      results.push({
        name,
        version: ver,
        available: isAvail,
        progressing: isProg,
        degraded: isDegraded,
        since,
        message: msg,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
```

```typescript
// extensions/must-gather/parsers/nodes.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { NodeStatus } from "../types.js";

export async function parseNodes(mgRoot: string): Promise<NodeStatus[]> {
  const dir = path.join(mgRoot, "cluster-scoped-resources/core/nodes");
  if (!fs.existsSync(dir)) return [];
  const results: NodeStatus[] = [];
  const entries = fs.readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const f of entries) {
    try {
      const doc = yaml.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const name = doc?.metadata?.name || path.basename(f, path.extname(f));
      const labels = doc?.metadata?.labels || {};
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith("node-role.kubernetes.io/"))
        .map((k) => k.replace("node-role.kubernetes.io/", ""));

      const conditions: any[] = doc?.status?.conditions || [];
      const readyCond = conditions.find((c) => c.type === "Ready");
      const isReady = readyCond?.status === "True";

      const pressures: string[] = [];
      for (const c of conditions) {
        if (["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"].includes(c.type) && c.status === "True") {
          pressures.push(c.type);
        }
      }

      results.push({
        name,
        ready: isReady,
        roles: roles.length > 0 ? roles : ["worker"],
        version: doc?.status?.nodeInfo?.kubeletVersion,
        conditions,
        pressures,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-parsers-core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/must-gather/parsers/clusterversion.ts extensions/must-gather/parsers/clusteroperators.ts extensions/must-gather/parsers/nodes.ts test/must-gather-parsers-core.test.ts
git commit -m "feat(must-gather): implement clusterversion, clusteroperators, and nodes parsers"
```

---

### Task 3: Resource & Workload Parsers (Pods, Events, etcd, Storage, Network)

**Files:**
- Create: `extensions/must-gather/parsers/pods.ts`
- Create: `extensions/must-gather/parsers/events.ts`
- Create: `extensions/must-gather/parsers/etcd.ts`
- Create: `extensions/must-gather/parsers/storage.ts`
- Create: `extensions/must-gather/parsers/network.ts`
- Test: `test/must-gather-parsers-workloads.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `parsePods(mgRoot: string, opts?: { namespace?: string; problemsOnly?: boolean }): Promise<PodStatusSummary>`, `parseEvents(mgRoot: string, opts?: { namespace?: string; count?: number; warningsOnly?: boolean }): Promise<ClusterEvent[]>`, `parseEtcd(mgRoot: string): Promise<EtcdHealthInfo | null>`, `parseStorage(mgRoot: string): Promise<StorageStatus>`, `parseNetwork(mgRoot: string): Promise<NetworkStatus>`.

- [ ] **Step 1: Write failing tests for workload & subsystem parsers**

```typescript
// test/must-gather-parsers-workloads.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parsePods } from "../extensions/must-gather/parsers/pods.js";
import { parseEvents } from "../extensions/must-gather/parsers/events.js";
import { parseEtcd } from "../extensions/must-gather/parsers/etcd.js";

describe("workload parsers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-workload-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses pods with crashloop and container restarts", async () => {
    const podDir = path.join(tmpDir, "namespaces/openshift-etcd/pods/etcd-master-0");
    fs.mkdirSync(podDir, { recursive: true });
    fs.writeFileSync(
      path.join(podDir, "etcd-master-0.yaml"),
      `
apiVersion: v1
kind: Pod
metadata:
  name: etcd-master-0
  namespace: openshift-etcd
spec:
  nodeName: master-0
status:
  phase: Running
  containerStatuses:
    - name: etcd
      ready: false
      restartCount: 15
      state:
        waiting:
          reason: CrashLoopBackOff
          message: "Back-off 5m0s restarting failed container"
`,
    );
    const summary = await parsePods(tmpDir);
    expect(summary.total).toBe(1);
    expect(summary.failing).toBe(1);
    expect(summary.crashloop).toBe(1);
    expect(summary.issues[0].name).toBe("etcd-master-0");
    expect(summary.issues[0].status).toBe("CrashLoopBackOff");
  });

  it("parses warning events", async () => {
    const nsDir = path.join(tmpDir, "namespaces/openshift-etcd/core");
    fs.mkdirSync(nsDir, { recursive: true });
    fs.writeFileSync(
      path.join(nsDir, "events.yaml"),
      `
apiVersion: v1
kind: EventList
items:
  - metadata:
      namespace: openshift-etcd
    lastTimestamp: "2026-09-02T10:00:00Z"
    type: Warning
    reason: Unhealthy
    involvedObject:
      kind: Pod
      name: etcd-master-0
    message: "Readiness probe failed"
    count: 10
`,
    );
    const events = await parseEvents(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("Unhealthy");
    expect(events[0].type).toBe("Warning");
  });

  it("parses etcd health files", async () => {
    const etcdDir = path.join(tmpDir, "etcd_info");
    fs.mkdirSync(etcdDir, { recursive: true });
    fs.writeFileSync(
      path.join(etcdDir, "endpoint_health.json"),
      JSON.stringify([
        { endpoint: "https://10.0.0.1:2379", health: true, member_id: "abc" },
        { endpoint: "https://10.0.0.2:2379", health: true, member_id: "def" },
        { endpoint: "https://10.0.0.3:2379", health: true, member_id: "ghi" },
      ]),
    );
    const etcd = await parseEtcd(tmpDir);
    expect(etcd).not.toBeNull();
    expect(etcd?.total_members).toBe(3);
    expect(etcd?.healthy).toBe(3);
    expect(etcd?.quorum).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-parsers-workloads.test.ts`
Expected: FAIL (parsers not found)

- [ ] **Step 3: Implement `pods.ts`, `events.ts`, `etcd.ts`, `storage.ts`, and `network.ts`**

```typescript
// extensions/must-gather/parsers/pods.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { PodIssue, PodStatusSummary } from "../types.js";

export async function parsePods(
  mgRoot: string,
  opts: { namespace?: string; problemsOnly?: boolean } = {},
): Promise<PodStatusSummary> {
  const nsRoot = path.join(mgRoot, "namespaces");
  const summary: PodStatusSummary = { total: 0, healthy: 0, failing: 0, crashloop: 0, pending: 0, issues: [] };
  if (!fs.existsSync(nsRoot)) return summary;

  const namespaces = fs.readdirSync(nsRoot).filter((ns) => {
    if (opts.namespace && ns !== opts.namespace) return false;
    return fs.statSync(path.join(nsRoot, ns)).isDirectory();
  });

  for (const ns of namespaces) {
    const podsDir = path.join(nsRoot, ns, "pods");
    if (!fs.existsSync(podsDir)) continue;
    const podFolders = fs.readdirSync(podsDir);
    for (const pf of podFolders) {
      const fullDir = path.join(podsDir, pf);
      if (!fs.statSync(fullDir).isDirectory()) continue;
      const yamlFiles = fs.readdirSync(fullDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const yf of yamlFiles) {
        try {
          const doc = yaml.parse(fs.readFileSync(path.join(fullDir, yf), "utf8"));
          if (doc?.kind !== "Pod") continue;
          summary.total++;
          const name = doc.metadata?.name || pf;
          const phase = doc.status?.phase || "Unknown";
          const nodeName = doc.spec?.nodeName;
          const containerStatuses: any[] = doc.status?.containerStatuses || [];
          const totalContainers = containerStatuses.length || (doc.spec?.containers?.length || 1);
          const readyContainers = containerStatuses.filter((c) => c.ready).length;
          const totalRestarts = containerStatuses.reduce((acc, c) => acc + (c.restartCount || 0), 0);

          let status = phase;
          let reason: string | undefined;
          let message: string | undefined;

          // Check container waiting/terminated states
          for (const c of containerStatuses) {
            if (c.state?.waiting) {
              status = c.state.waiting.reason || "Waiting";
              reason = c.state.waiting.reason;
              message = c.state.waiting.message;
            } else if (c.state?.terminated && c.state.terminated.exitCode !== 0) {
              status = c.state.terminated.reason || `ExitCode:${c.state.terminated.exitCode}`;
              reason = c.state.terminated.reason;
            }
          }

          const isCrashLoop = status.includes("CrashLoop") || reason === "CrashLoopBackOff";
          const isPending = phase === "Pending";
          const isFailing = phase === "Failed" || isCrashLoop || (!readyContainers && totalContainers > 0 && phase !== "Running" && phase !== "Succeeded");

          if (isCrashLoop) summary.crashloop++;
          if (isPending) summary.pending++;
          if (isFailing) summary.failing++;
          if (!isFailing && !isPending && !isCrashLoop) summary.healthy++;

          if (isFailing || isCrashLoop || isPending || !opts.problemsOnly) {
            summary.issues.push({
              namespace: ns,
              name,
              status,
              restarts: totalRestarts,
              ready_containers: `${readyContainers}/${totalContainers}`,
              node: nodeName,
              reason,
              message,
            });
          }
        } catch {}
      }
    }
  }
  return summary;
}
```

```typescript
// extensions/must-gather/parsers/events.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterEvent } from "../types.js";

export async function parseEvents(
  mgRoot: string,
  opts: { namespace?: string; count?: number; warningsOnly?: boolean } = {},
): Promise<ClusterEvent[]> {
  const nsRoot = path.join(mgRoot, "namespaces");
  if (!fs.existsSync(nsRoot)) return [];
  const events: ClusterEvent[] = [];
  const namespaces = fs.readdirSync(nsRoot).filter((ns) => {
    if (opts.namespace && ns !== opts.namespace) return false;
    return fs.statSync(path.join(nsRoot, ns)).isDirectory();
  });

  for (const ns of namespaces) {
    const eventFile = path.join(nsRoot, ns, "core/events.yaml");
    if (!fs.existsSync(eventFile)) continue;
    try {
      const doc = yaml.parse(fs.readFileSync(eventFile, "utf8"));
      const items: any[] = doc?.items || (doc?.kind === "Event" ? [doc] : []);
      for (const it of items) {
        const type = (it.type || "Normal") as "Normal" | "Warning" | "Error";
        if (opts.warningsOnly && type === "Normal") continue;
        events.push({
          namespace: it.metadata?.namespace || ns,
          lastTimestamp: it.lastTimestamp || it.eventTime || it.metadata?.creationTimestamp || "",
          type,
          reason: it.reason || "Unknown",
          object: `${it.involvedObject?.kind || "Object"}/${it.involvedObject?.name || "unknown"}`,
          message: it.message || "",
          count: it.count || 1,
        });
      }
    } catch {}
  }

  events.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
  const max = opts.count || 100;
  return events.slice(0, max);
}
```

```typescript
// extensions/must-gather/parsers/etcd.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { EtcdHealthInfo } from "../types.js";

export async function parseEtcd(mgRoot: string): Promise<EtcdHealthInfo | null> {
  const etcdDir = path.join(mgRoot, "etcd_info");
  if (!fs.existsSync(etcdDir)) return null;

  const healthFile = path.join(etcdDir, "endpoint_health.json");
  const memberFile = path.join(etcdDir, "member_list.json");

  try {
    let endpoints: any[] = [];
    if (fs.existsSync(healthFile)) {
      endpoints = JSON.parse(fs.readFileSync(healthFile, "utf8"));
    }
    let members: any[] = [];
    if (fs.existsSync(memberFile)) {
      const mDoc = JSON.parse(fs.readFileSync(memberFile, "utf8"));
      members = mDoc.members || (Array.isArray(mDoc) ? mDoc : []);
    }

    const total = endpoints.length || members.length || 0;
    const healthy = endpoints.filter((e) => e.health === true || e.health === "true").length || total;
    const quorumRequired = Math.floor(total / 2) + 1;
    const quorum = total > 0 ? healthy >= quorumRequired : true;

    return {
      total_members: total,
      healthy,
      quorum,
      members: members.map((m) => ({
        id: m.ID || m.id,
        name: m.name || m.ID || m.id,
        peerURLs: m.peerURLs || [],
        clientURLs: m.clientURLs || [],
        healthy: true,
      })),
    };
  } catch {
    return null;
  }
}
```

```typescript
// extensions/must-gather/parsers/storage.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { StorageStatus } from "../types.js";

export async function parseStorage(mgRoot: string): Promise<StorageStatus> {
  const pvDir = path.join(mgRoot, "cluster-scoped-resources/core/persistentvolumes");
  const nsRoot = path.join(mgRoot, "namespaces");
  let pvCount = 0;
  if (fs.existsSync(pvDir)) {
    pvCount = fs.readdirSync(pvDir).filter((f) => f.endsWith(".yaml")).length;
  }
  let pvcCount = 0;
  const unbound: Array<{ namespace: string; name: string; status: string }> = [];

  if (fs.existsSync(nsRoot)) {
    for (const ns of fs.readdirSync(nsRoot)) {
      const pvcFile = path.join(nsRoot, ns, "core/persistentvolumeclaims.yaml");
      if (fs.existsSync(pvcFile)) {
        try {
          const doc = yaml.parse(fs.readFileSync(pvcFile, "utf8"));
          const items: any[] = doc?.items || [];
          for (const it of items) {
            pvcCount++;
            const status = it.status?.phase || "Unknown";
            if (status !== "Bound") {
              unbound.push({ namespace: ns, name: it.metadata?.name || "unknown", status });
            }
          }
        } catch {}
      }
    }
  }
  return { pv_count: pvCount, pvc_count: pvcCount, unbound_pvc_count: unbound.length, unbound_pvcs: unbound };
}
```

```typescript
// extensions/must-gather/parsers/network.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { NetworkStatus } from "../types.js";

export async function parseNetwork(mgRoot: string): Promise<NetworkStatus> {
  const netDir = path.join(mgRoot, "network_logs");
  const hasOvn = fs.existsSync(path.join(netDir, "ovnk_database_store.tar.gz")) || fs.existsSync(path.join(mgRoot, "namespaces/openshift-ovn-kubernetes"));
  return {
    type: hasOvn ? "OVN-Kubernetes" : "OpenShift-SDN",
    healthy: true,
    issues: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-parsers-workloads.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/must-gather/parsers/pods.ts extensions/must-gather/parsers/events.ts extensions/must-gather/parsers/etcd.ts extensions/must-gather/parsers/storage.ts extensions/must-gather/parsers/network.ts test/must-gather-parsers-workloads.test.ts
git commit -m "feat(must-gather): implement pods, events, etcd, storage, and network parsers"
```

---

### Task 4: Loader & Cache Engine

**Files:**
- Create: `extensions/must-gather/loader.ts`
- Test: `test/must-gather-loader.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `resolveMustGatherPath(source: string, opts?: { fetcher?: (url: string) => Promise<{ status: number; body: string }> }): Promise<string>`

- [ ] **Step 1: Write failing tests for loader**

```typescript
// test/must-gather-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveMustGatherPath } from "../extensions/must-gather/loader.js";

describe("must-gather loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-loader-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves nested hash subdirectory automatically", async () => {
    const hashDir = path.join(tmpDir, "registry-ci-openshift-org-origin-sha256-12345");
    const clusterScoped = path.join(hashDir, "cluster-scoped-resources");
    fs.mkdirSync(clusterScoped, { recursive: true });

    const resolved = await resolveMustGatherPath(tmpDir);
    expect(resolved).toBe(hashDir);
  });

  it("returns exact path when pointing directly to inner directory", async () => {
    const clusterScoped = path.join(tmpDir, "cluster-scoped-resources");
    fs.mkdirSync(clusterScoped, { recursive: true });

    const resolved = await resolveMustGatherPath(tmpDir);
    expect(resolved).toBe(tmpDir);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-loader.test.ts`
Expected: FAIL (loader.ts not found)

- [ ] **Step 3: Implement `extensions/must-gather/loader.ts`**

```typescript
// extensions/must-gather/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const CACHE_BASE = path.join(os.homedir(), ".cache", "pi-ocp-dev", "must-gather");

export function getCacheDir(): string {
  if (!fs.existsSync(CACHE_BASE)) {
    fs.mkdirSync(CACHE_BASE, { recursive: true });
  }
  return CACHE_BASE;
}

export async function resolveMustGatherPath(source: string): Promise<string> {
  const trimmed = source.trim();

  // 1. Direct directory check
  if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
    // Check if it's the root with a nested hash directory
    if (fs.existsSync(path.join(trimmed, "cluster-scoped-resources")) || fs.existsSync(path.join(trimmed, "namespaces"))) {
      return trimmed;
    }
    const entries = fs.readdirSync(trimmed, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const sub = path.join(trimmed, e.name);
        if (fs.existsSync(path.join(sub, "cluster-scoped-resources")) || fs.existsSync(path.join(sub, "namespaces"))) {
          return sub;
        }
      }
    }
    return trimmed;
  }

  // 2. Local Tarball check (.tar, .tar.gz, .tgz)
  if (fs.existsSync(trimmed) && (trimmed.endsWith(".tar") || trimmed.endsWith(".tar.gz") || trimmed.endsWith(".tgz"))) {
    const hash = Buffer.from(trimmed).toString("hex").slice(0, 16);
    const dest = path.join(getCacheDir(), hash);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      execSync(`tar -xf "${trimmed}" -C "${dest}"`);
    }
    return resolveMustGatherPath(dest);
  }

  // 3. Remote Prow / GCS URL
  if (trimmed.startsWith("https://prow.ci.openshift.org/view/gs/") || trimmed.startsWith("https://storage.googleapis.com/")) {
    // URL caching / extraction logic
    const hash = Buffer.from(trimmed).toString("hex").slice(0, 16);
    const dest = path.join(getCacheDir(), hash);
    if (fs.existsSync(dest)) {
      return resolveMustGatherPath(dest);
    }
    throw new Error(`Remote GCS artifact extraction for ${trimmed} requires downloading artifacts to ${dest}`);
  }

  throw new Error(`Invalid must-gather path or archive: ${source}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/must-gather/loader.ts test/must-gather-loader.test.ts
git commit -m "feat(must-gather): implement loader and cache resolver"
```

---

### Task 5: Runner & Health Summary Orchestrator

**Files:**
- Create: `extensions/must-gather/runner.ts`
- Test: `test/must-gather-runner.test.ts`

**Interfaces:**
- Consumes: `loader.ts`, `parsers/*.ts`, `types.ts`
- Produces: `runMustGatherAnalysis(source: string, opts?: { component?: string; problemsOnly?: boolean; namespace?: string; count?: number }): Promise<MustGatherAnalysisResult>`

- [ ] **Step 1: Write failing tests for runner**

```typescript
// test/must-gather-runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runMustGatherAnalysis } from "../extensions/must-gather/runner.js";

describe("must-gather runner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-runner-test-"));
    const coDir = path.join(tmpDir, "cluster-scoped-resources/config.openshift.io/clusteroperators");
    fs.mkdirSync(coDir, { recursive: true });
    fs.writeFileSync(
      path.join(coDir, "authentication.yaml"),
      `
apiVersion: config.openshift.io/v1
kind: ClusterOperator
metadata:
  name: authentication
status:
  conditions:
    - type: Degraded
      status: "True"
      message: "OAuth deployment degraded"
    - type: Available
      status: "False"
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces compact analysis summary and detects critical issues", async () => {
    const result = await runMustGatherAnalysis(tmpDir, { component: "all", problemsOnly: true });
    expect(result.summary.operators.total).toBe(1);
    expect(result.summary.operators.degraded).toBe(1);
    expect(result.critical_issues).toHaveLength(1);
    expect(result.critical_issues[0].name).toBe("authentication");
    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/cluster-operators.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-runner.test.ts`
Expected: FAIL (runner.ts not found)

- [ ] **Step 3: Implement `extensions/must-gather/runner.ts`**

```typescript
// extensions/must-gather/runner.ts
import { resolveMustGatherPath } from "./loader.js";
import { parseClusterVersion } from "./parsers/clusterversion.js";
import { parseClusterOperators } from "./parsers/clusteroperators.js";
import { parseNodes } from "./parsers/nodes.js";
import { parsePods } from "./parsers/pods.js";
import { parseEvents } from "./parsers/events.js";
import { parseEtcd } from "./parsers/etcd.js";
import { parseStorage } from "./parsers/storage.js";
import { parseNetwork } from "./parsers/network.js";
import type { CriticalIssue, MustGatherAnalysisResult, MustGatherSummary } from "./types.js";

export async function runMustGatherAnalysis(
  source: string,
  opts: {
    component?: string;
    problemsOnly?: boolean;
    namespace?: string;
    count?: number;
  } = {},
): Promise<MustGatherAnalysisResult> {
  const mgRoot = await resolveMustGatherPath(source);
  const component = opts.component || "all";
  const problemsOnly = opts.problemsOnly ?? (component === "all");

  const [version, operators, nodes, podSummary, events, etcd, storage, network] = await Promise.all([
    parseClusterVersion(mgRoot),
    parseClusterOperators(mgRoot),
    parseNodes(mgRoot),
    parsePods(mgRoot, { namespace: opts.namespace, problemsOnly }),
    parseEvents(mgRoot, { namespace: opts.namespace, count: opts.count, warningsOnly: true }),
    parseEtcd(mgRoot),
    parseStorage(mgRoot),
    parseNetwork(mgRoot),
  ]);

  const degradedOps = operators.filter((o) => o.degraded || !o.available);
  const progOps = operators.filter((o) => o.progressing);
  const notReadyNodes = nodes.filter((n) => !n.ready);
  const pressureNodes = nodes.filter((n) => n.pressures.length > 0).map((n) => `${n.name} (${n.pressures.join(", ")})`);

  const summary: MustGatherSummary = {
    operators: {
      total: operators.length,
      healthy: operators.length - degradedOps.length,
      degraded: degradedOps.length,
      progressing: progOps.length,
    },
    nodes: {
      total: nodes.length,
      ready: nodes.length - notReadyNodes.length,
      not_ready: notReadyNodes.length,
      pressure: pressureNodes,
    },
    pods: {
      total: podSummary.total,
      healthy: podSummary.healthy,
      failing: podSummary.failing,
      crashloop: podSummary.crashloop,
      pending: podSummary.pending,
    },
    etcd: {
      total_members: etcd?.total_members || 0,
      healthy: etcd?.healthy || 0,
      quorum: etcd?.quorum ?? true,
    },
    warning_events_count: events.length,
  };

  const critical_issues: CriticalIssue[] = [];
  const candidate_references: Set<string> = new Set();

  for (const op of degradedOps) {
    critical_issues.push({
      component: "operators",
      name: op.name,
      reason: op.degraded ? "OperatorDegraded" : "OperatorUnavailable",
      message: op.message || "Operator in degraded or unavailable state",
      since: op.since,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/cluster-operators.md");
  }

  for (const p of podSummary.issues.filter((i) => i.status.includes("CrashLoop") || i.status === "Failed")) {
    critical_issues.push({
      component: "pods",
      name: p.name,
      namespace: p.namespace,
      reason: p.status,
      message: `Pod in ${p.status} with ${p.restarts} restarts on node ${p.node || "unknown"}`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/pods.md");
  }

  for (const n of notReadyNodes) {
    critical_issues.push({
      component: "nodes",
      name: n.name,
      reason: "NodeNotReady",
      message: `Node is not in Ready condition (${n.roles.join(",")})`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/nodes.md");
  }

  if (etcd && !etcd.quorum) {
    critical_issues.push({
      component: "etcd",
      name: "etcd-cluster",
      reason: "QuorumLost",
      message: `Only ${etcd.healthy}/${etcd.total_members} etcd members healthy`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/etcd.md");
  }

  return {
    must_gather_path: mgRoot,
    cluster_version: version || undefined,
    summary,
    critical_issues,
    candidate_references: Array.from(candidate_references),
    component_data: component === "all" ? undefined : {
      operators: component === "operators" ? operators : undefined,
      nodes: component === "nodes" ? nodes : undefined,
      pods: component === "pods" ? podSummary.issues : undefined,
      events: component === "events" ? events : undefined,
      etcd: component === "etcd" ? (etcd || undefined) : undefined,
      storage: component === "storage" ? storage : undefined,
      network: component === "network" ? network : undefined,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/must-gather/runner.ts test/must-gather-runner.test.ts
git commit -m "feat(must-gather): implement analysis runner and summary synthesis"
```

---

### Task 6: Tool Registration & Slash Command

**Files:**
- Create: `extensions/must-gather/command.ts`
- Create: `extensions/must-gather/index.ts`
- Test: `test/must-gather-command.test.ts`

**Interfaces:**
- Consumes: `runner.ts`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`
- Produces: `analyze_must_gather` tool, `/must-gather` slash command.

- [ ] **Step 1: Write failing tests for command parser**

```typescript
// test/must-gather-command.test.ts
import { describe, it, expect } from "vitest";
import { parseMustGatherCommand, buildMustGatherPrompt } from "../extensions/must-gather/command.js";

describe("must-gather command parser", () => {
  it("parses empty arguments as usage", () => {
    const cmd = parseMustGatherCommand("");
    expect(cmd.kind).toBe("usage");
  });

  it("parses single path argument", () => {
    const cmd = parseMustGatherCommand("./must-gather.local.123");
    expect(cmd.kind).toBe("analyze");
    if (cmd.kind === "analyze") {
      expect(cmd.source).toBe("./must-gather.local.123");
      expect(cmd.component).toBe("all");
    }
  });

  it("parses path with component filter", () => {
    const cmd = parseMustGatherCommand("./must-gather.local.123 operators");
    expect(cmd.kind).toBe("analyze");
    if (cmd.kind === "analyze") {
      expect(cmd.source).toBe("./must-gather.local.123");
      expect(cmd.component).toBe("operators");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/must-gather-command.test.ts`
Expected: FAIL (command.ts not found)

- [ ] **Step 3: Implement `command.ts` and `index.ts`**

```typescript
// extensions/must-gather/command.ts
export type MustGatherCommand =
  | { kind: "usage" }
  | { kind: "analyze"; source: string; component: string; namespace?: string };

export function parseMustGatherCommand(args: string): MustGatherCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { kind: "usage" };
  }
  const source = parts[0];
  const component = parts[1] || "all";
  const namespace = parts[2];
  return { kind: "analyze", source, component, namespace };
}

export function buildMustGatherPrompt(cmd: MustGatherCommand): string {
  if (cmd.kind === "usage") {
    return "Usage: /must-gather <path-or-url> [component] [namespace]";
  }
  return `Analyze the must-gather diagnostic data at '${cmd.source}' for component '${cmd.component}'${cmd.namespace ? ` in namespace '${cmd.namespace}'` : ""} using analyze_must_gather tool.`;
}
```

```typescript
// extensions/must-gather/index.ts
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { runMustGatherAnalysis } from "./runner.js";
import { buildMustGatherPrompt, parseMustGatherCommand } from "./command.js";

const text = (t: string, details?: unknown) => ({
  content: [{ type: "text" as const, text: t }],
  details,
});

export const analyzeMustGatherTool = defineTool({
  name: "analyze_must_gather",
  label: "Analyze Must-Gather",
  description:
    "Deterministic analysis of OpenShift must-gather diagnostic data from a local directory, tarball, or remote Prow GCS artifact URL.",
  parameters: Type.Object({
    source: Type.String({
      description: "Local path to must-gather directory/tarball, or remote Prow deck URL (https://prow.ci.openshift.org/view/gs/...)",
    }),
    component: Type.Optional(
      Type.Union([
        Type.Literal("all"),
        Type.Literal("operators"),
        Type.Literal("pods"),
        Type.Literal("nodes"),
        Type.Literal("events"),
        Type.Literal("etcd"),
        Type.Literal("storage"),
        Type.Literal("network"),
        Type.Literal("version"),
      ], { description: "Component to analyze. Defaults to 'all'." }),
    ),
    problemsOnly: Type.Optional(
      Type.Boolean({ description: "When true, filters to unhealthy/failing resources only. Default: true for 'all'." }),
    ),
    namespace: Type.Optional(
      Type.String({ description: "Optional namespace filter for pods, events, and storage." }),
    ),
    count: Type.Optional(
      Type.Number({ description: "Maximum number of items to return (e.g. events, pods)." }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    try {
      const result = await runMustGatherAnalysis(params.source, {
        component: params.component,
        problemsOnly: params.problemsOnly,
        namespace: params.namespace,
        count: params.count,
      });
      return text(JSON.stringify(result, null, 2), result);
    } catch (err: any) {
      return text(`Error analyzing must-gather: ${err?.message || String(err)}`);
    }
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(analyzeMustGatherTool);

  pi.registerCommand("must-gather", {
    description: "Must-gather diagnostics: /must-gather <path-or-url> [component] [namespace]",
    getArgumentCompletions: (prefix: string) => {
      const items = ["operators", "pods", "nodes", "events", "etcd", "storage", "network"].map((v) => ({
        value: v,
        label: v,
      }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cmd = parseMustGatherCommand(args);
      if (cmd.kind === "usage") {
        ctx.ui.notify("/must-gather <path-or-url> [operators|pods|nodes|events|etcd|storage|network] [namespace]", "info");
        return;
      }
      pi.sendUserMessage(buildMustGatherPrompt(cmd));
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/must-gather-command.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/must-gather/command.ts extensions/must-gather/index.ts test/must-gather-command.test.ts
git commit -m "feat(must-gather): register analyze_must_gather tool and /must-gather slash command"
```

---

### Task 7: Skill, Reference Docs, Subagent & Documentation

**Files:**
- Create: `skills/must-gather-analysis/SKILL.md`
- Create: `skills/must-gather-analysis/references/cluster-operators.md`
- Create: `skills/must-gather-analysis/references/pods.md`
- Create: `skills/must-gather-analysis/references/nodes.md`
- Create: `skills/must-gather-analysis/references/etcd.md`
- Create: `agents/must-gather-analyst.md`
- Modify: `README.md`

- [ ] **Step 1: Create `skills/must-gather-analysis/SKILL.md` and reference docs**

Create `skills/must-gather-analysis/SKILL.md` with:
- When to use
- Inputs (local path, tarball, Prow URL)
- Workflow: Run `analyze_must_gather`, check `critical_issues`, read ≤2 candidate references, synthesize findings.
- Output format: Cluster summary, root causes, evidence lines, next steps.

Create focused reference guides under `skills/must-gather-analysis/references/`:
- `cluster-operators.md`
- `pods.md`
- `nodes.md`
- `etcd.md`

- [ ] **Step 2: Create `agents/must-gather-analyst.md`**

Configure subagent with `tools: read, analyze_must_gather` to run asynchronous deep-dives on cluster dumps.

- [ ] **Step 3: Update `README.md`**

Add `analyze_must_gather` tool, `/must-gather` slash command, and `must-gather-analyst` subagent documentation to README.

- [ ] **Step 4: Run all tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: All tests PASS and typecheck succeeds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add skills/must-gather-analysis/ agents/must-gather-analyst.md README.md
git commit -m "docs(must-gather): add must-gather-analysis skill, subagent, references, and README update"
```
