# Design Document: Deterministic Must-Gather Analysis for pi-ocp-dev

## 1. Overview and Goals

This design defines the architecture and implementation for integrating deterministic OpenShift must-gather diagnostic analysis into `pi-ocp-dev`.

### Core Goals
1. **Context Window Minimization**: Large OpenShift must-gather archives contain hundreds of megabytes of raw manifests and logs. This subsystem performs heavy file traversal, YAML/JSON parsing, and health correlation deterministically in TypeScript, returning concise summaries (typically ≤2–4 KB) to the LLM agent.
2. **Deterministic Execution**: Eliminate LLM hallucination or manual multi-step bash/grep workflows when analyzing cluster dumps. The tool reliably extracts operator health, pod failure loops, node pressures, etcd quorum, and warning events.
3. **100% Pure TypeScript Engine**: Reimplement all analysis logic in native TypeScript running within the Pi extension sandbox, removing Python runtime and PyYAML dependencies.
4. **Dual Input Support**: Support analyzing both local unpacked must-gather directories (or tarballs) and remote Prow CI run GCS artifacts fetched on-demand.
5. **Unified Tooling and Subagent Workflow**: Provide a single flexible `analyze_must_gather` tool, a `/must-gather` slash command, a `must-gather-analysis` skill, and an asynchronous `must-gather-analyst` subagent.

---

## 2. Architecture & Directory Layout

The must-gather subsystem lives under `extensions/must-gather/`, with associated skill, agent, and test suites:

```
extensions/must-gather/
├── index.ts               # Registers analyze_must_gather tool & /must-gather command
├── loader.ts              # Resolves local paths, tarballs, and remote Prow GCS must-gather artifacts
├── types.ts               # Shared data types for cluster summary, operators, pods, nodes, etc.
├── runner.ts              # Dispatches component parsers and synthesizes findings
├── command.ts             # Slash command parser and prompt generator
└── parsers/
    ├── clusterversion.ts  # Parses clusterversion.yaml
    ├── clusteroperators.ts# Parses clusteroperators/*.yaml
    ├── nodes.ts           # Parses core/nodes/*.yaml
    ├── pods.ts            # Parses namespaces/*/pods/*/*.yaml
    ├── events.ts          # Parses namespaces/*/core/events.yaml
    ├── etcd.ts            # Parses etcd_info/*.json
    ├── network.ts         # Parses network operator / connectivity check resources
    └── storage.ts         # Parses persistentvolumes & persistentvolumeclaims
skills/must-gather-analysis/
├── SKILL.md               # Diagnostic router for LLM agent
└── references/            # Targeted markdown reference guides for specific failure modes
agents/
└── must-gather-analyst.md # Subagent for deep async must-gather triage
test/
├── must-gather-loader.test.ts
├── must-gather-parsers.test.ts
└── must-gather-runner.test.ts
```

### Dependencies
- `yaml`: Standard, fast, pure TypeScript/JavaScript YAML parser for Node.

---

## 3. Data Flow & Loader Design

### 3.1 Input Resolution (`loader.ts`)
The loader accepts a source string and resolves it to a local unpacked must-gather directory:
1. **Local Directory**:
   - If pointing to the parent must-gather folder containing a hash subdirectory (e.g. `must-gather/registry-ci-...-sha256-...`), automatically locates the inner directory containing `cluster-scoped-resources/` or `namespaces/`.
   - If pointing directly to the unpacked directory, validates required subfolders.
2. **Local Tarball (`.tar`, `.tar.gz`)**:
   - Extracts into the disk cache (`~/.cache/pi-ocp-dev/must-gather/<hash>/`) and returns the extracted path.
3. **Remote Prow / GCS URL**:
   - Accepts a Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) or GCS path.
   - Discovers must-gather tarballs under the build's `artifacts/` tree (e.g. `artifacts/.../must-gather.tar` or `artifacts/.../gather-must-gather/`).
   - Downloads and uncompresses into the cache directory.

---

## 4. Component Parsers & Normalization

All parsers operate directly on the resolved must-gather filesystem path, reading only the necessary files and returning structured TypeScript objects:

### 4.1 ClusterVersion (`parsers/clusterversion.ts`)
- File: `cluster-scoped-resources/config.openshift.io/clusterversions/version.yaml`
- Extracts: Current version, desired version, update status, conditions (`Available`, `Progressing`, `Failing`, `RetrievedUpdates`), and enabled capabilities.

### 4.2 Cluster Operators (`parsers/clusteroperators.ts`)
- Directory: `cluster-scoped-resources/config.openshift.io/clusteroperators/*.yaml`
- Extracts: Name, version, `Available`, `Progressing`, `Degraded` condition booleans, condition transition timestamps, and detailed error messages for degraded/unavailable operators.

### 4.3 Nodes (`parsers/nodes.ts`)
- Directory: `cluster-scoped-resources/core/nodes/*.yaml`
- Extracts: Node names, readiness status, roles (`master`, `worker`), kubelet version, conditions (`DiskPressure`, `MemoryPressure`, `PIDPressure`, `NetworkUnavailable`), allocatable resources.

### 4.4 Pods (`parsers/pods.ts`)
- Directory: `namespaces/*/pods/*/*.yaml` or `namespaces/*/core/pods.yaml`
- Extracts: Namespace, name, status (`Running`, `CrashLoopBackOff`, `Pending`, `Error`), restart counts, ready containers vs total containers, reason for non-running pods, node placement.
- Problem categorization: CrashLooping, pending scheduling, image pull errors, unready containers.

### 4.5 Events (`parsers/events.ts`)
- Files: `namespaces/*/core/events.yaml`
- Extracts: Warning and error events, timestamps, involved object kind/name, reason, message, recurrence count. Sorted chronologically (newest first).

### 4.6 etcd (`parsers/etcd.ts`)
- Files: `etcd_info/endpoint_health.json`, `etcd_info/member_list.json`, `etcd_info/endpoint_status.json`
- Extracts: Member count, healthy members, leader ID, database size, and quorum status (`healthy` / `degraded`).

### 4.7 Storage (`parsers/storage.ts`)
- Files: `cluster-scoped-resources/core/persistentvolumes/*.yaml`, `namespaces/*/core/persistentvolumeclaims.yaml`
- Extracts: Unbound PVCs, storage capacity, volume phases, claim mappings.

---

## 5. Tool Definition & Schema

### `analyze_must_gather`
```typescript
{
  name: "analyze_must_gather",
  label: "Analyze Must-Gather",
  description: "Deterministic analysis of OpenShift must-gather diagnostic data from a local folder, tarball, or remote Prow GCS artifact URL.",
  parameters: {
    source: {
      type: "string",
      description: "Local path to must-gather directory/tarball, or remote Prow deck URL (https://prow.ci.openshift.org/view/gs/...)."
    },
    component: {
      type: "string",
      enum: ["all", "operators", "pods", "nodes", "events", "etcd", "storage", "version"],
      description: "Component to analyze. Defaults to 'all'."
    },
    problemsOnly: {
      type: "boolean",
      description: "When true, filters results to only show unhealthy or degraded resources. Default is true for 'all'."
    },
    namespace: {
      type: "string",
      description: "Optional namespace filter for pods, events, and storage."
    },
    count: {
      type: "number",
      description: "Maximum number of items to return (e.g. for events or pods). Defaults to 50."
    }
  }
}
```

### Compact Summary Output Contract (JSON)
When `component: "all"`, returns a compact JSON payload:
```json
{
  "must_gather_path": "/path/to/extracted/must-gather",
  "cluster_version": {
    "version": "4.18.2",
    "state": "Completed"
  },
  "summary": {
    "operators": { "total": 30, "healthy": 28, "degraded": 2, "progressing": 1 },
    "nodes": { "total": 6, "ready": 5, "not_ready": 1, "pressure": ["worker-1 (MemoryPressure)"] },
    "pods": { "total": 240, "healthy": 235, "failing": 5, "crashloop": 2, "pending": 3 },
    "etcd": { "total_members": 3, "healthy": 3, "quorum": true },
    "warning_events_count": 14
  },
  "critical_issues": [
    {
      "component": "operators",
      "name": "authentication",
      "reason": "OAuthServerDeploymentDegraded",
      "message": "Deployment oauth-openshift is not available",
      "since": "2h"
    },
    {
      "component": "pods",
      "namespace": "openshift-authentication",
      "name": "oauth-openshift-78fbb44988-9k2l9",
      "status": "CrashLoopBackOff",
      "restarts": 15,
      "node": "worker-1"
    }
  ],
  "candidate_references": [
    "skills/must-gather-analysis/references/cluster-operators.md",
    "skills/must-gather-analysis/references/nodes.md"
  ]
}
```

---

## 6. Slash Command, Skill & Subagent

### 6.1 Slash Command `/must-gather` (`extensions/must-gather/command.ts`)
Provides quick prompt relay to the Pi agent:
- `/must-gather <path-or-url>` → Run `analyze_must_gather` with `component: "all"`
- `/must-gather <path-or-url> operators` → Run `analyze_must_gather` with `component: "operators"`
- `/must-gather <path-or-url> pods [namespace]` → Run `analyze_must_gather` with `component: "pods"`
- `/must-gather <path-or-url> etcd` → Run `analyze_must_gather` with `component: "etcd"`

### 6.2 Skill (`skills/must-gather-analysis/SKILL.md`)
Guides the agent through deterministic must-gather triage:
1. Run `analyze_must_gather` with the given source.
2. If issues are found, read at most 1–2 candidate reference files from `skills/must-gather-analysis/references/`.
3. Correlate degraded operators with pod crashloops and node conditions.
4. Output a concise triage report with Root Cause, Evidence, and Next Steps.

### 6.3 Subagent (`agents/must-gather-analyst.md`)
A dedicated asynchronous subagent configured with the `analyze_must_gather` tool for deep diagnostic analysis without cluttering the parent conversation.

---

## 7. Testing Strategy

1. **Parser Unit Tests (`test/must-gather-parsers.test.ts`)**:
   - Mock minimal YAML fixtures for `clusterversion`, `clusteroperators`, `nodes`, `pods`, `events`, and `etcd_info`.
   - Verify proper condition parsing, calculation of health ratios, and issue extraction.
2. **Loader Unit Tests (`test/must-gather-loader.test.ts`)**:
   - Test subfolder hash discovery, missing folder handling, tarball extraction caching, and mock GCS fetching.
3. **Runner Integration Tests (`test/must-gather-runner.test.ts`)**:
   - Verify `analyze_must_gather` with `problemsOnly: true`, specific component selections, and namespace filters.
4. **Command Unit Tests (`test/must-gather-command.test.ts`)**:
   - Verify argument parsing for `/must-gather` invocations.
