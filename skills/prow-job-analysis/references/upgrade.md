# Upgrade Failure Analysis Reference

Root-cause diagnosis for OpenShift CI upgrade jobs (`upgrade`, `upgrade-from-stable`, `upgrade-micro`).

## 1. Fast Triage Matrix: Upgrade Phases

| Upgrade Phase | Failure Signal | Primary Failure Area | Action / Where to Look |
|---|---|---|---|
| **Phase 1: Pre-Upgrade Install** | `install should succeed` fails before upgrade starts | Cluster installation on baseline version | Route to `install/general.md` (not an upgrade bug). |
| **Phase 2: Pre-Upgrade Health** | Baseline health checks fail | Initial payload unstable prior to upgrade initiation | Check baseline operator health in `oc_cmds/co`. |
| **Phase 3: Upgrade Orchestration** | CVO stuck `Progressing=True`, operator degraded, or node drain stall | CVO payload sync or MCO node drain/reboot failure | Inspect `clusterversion.yaml`, `clusteroperators.json`, `mcp.yaml`. |
| **Phase 4: Post-Upgrade Conformance** | Conformance e2e tests fail after upgrade completes | API incompatibility, regression in target payload, or version skew | Inspect JUnit test failures and target operator logs. |

---

## 2. Core Upgrade Failure Modes

### A. Cluster Version Operator (CVO) Blockers
- **Symptom:** `ClusterVersion` condition `Progressing=True` with message `Working towards <version>: N of M done` stuck indefinitely, or `Degraded=True`.
- **Mechanism:** CVO rolls out operators sequentially according to internal DAG. If an upstream operator fails to reconcile, all downstream operators are blocked.
- **Diagnosis:** Find the **first** degraded operator in `gather-extra/artifacts/oc_cmds/co` or `clusteroperators.json`. Check that operator's pod logs in `gather-extra/artifacts/pods/openshift-<operator>/`.

### B. Machine Config Operator (MCO) Node Drain / Reboot Stalls
- **Symptom:** `MachineConfigPool` (master or worker) reports `Degraded=True` or `Updating=True` stuck on a node; `machine-config-daemon` logs `drain failed` or `eviction timeout`.
- **Causes:**
  1. **PodDisruptionBudget (PDB) Deadlock:** A workload has `minAvailable` that cannot be satisfied during node drain.
  2. **Non-Evictable Pods:** Unmanaged standalone pods (no ReplicaSet/DaemonSet) or pods with local storage blocking eviction.
  3. **Node Reboot Hang:** Node cordon/drain succeeded, but node failed to reboot into new OS tree or lost network connectivity.
- **EUS Pause Exception:** In EUS-to-EUS upgrades (e.g. 4.14 → 4.16), worker MCP is intentionally `Paused=True` during control-plane upgrade.

### C. Version Skew & Removed APIs
- **Symptom:** Core services or tests fail with `404 Not Found` or `no matches for kind` against Kubernetes APIs.
- **Mechanism:** Target minor version removed deprecated APIs; operators or workloads still referencing old API groups fail post-upgrade.

---

## 3. Diagnostic Investigation Flow

```
1. Check ClusterVersion condition:
   $ oc get clusterversion -o yaml
   ├── Available=False / Degraded=True ──► Identify failing operator in .status.conditions.
   └── Progressing=True (Stuck) ──► Check which operator is currently being updated.

2. Check MachineConfigPool status:
   $ oc get mcp
   ├── master / worker Degraded=True ──► Inspect machine-config-daemon pod logs on stuck node.
   └── Updating=True (>45m) ──► Check node drain events for PDB blockers or unevictable pods.

3. Correlate with timeline:
   Check e2e-timelines_spyglass_*.json for OperatorStateChanged and NodeMonitor reboot windows.
```
