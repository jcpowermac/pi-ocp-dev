# Resource Exhaustion Reference

CPU, memory, disk, PID, etcd-space, and PVC exhaustion triage in OpenShift CI.

## 1. Two Failure Domains

| Domain | Where Detected | Typical Evidence | Root Cause / Ownership |
|---|---|---|---|
| **CI Build-Farm** | `build-log.txt`, `podinfo.json` | `pod_pending`, `sidecar` container `OOMKilled` (exit 137), truncated log | CI Infrastructure / build node capacity. Retry. |
| **Cluster Under Test** | `gather-extra/`, `must-gather/`, `e2e-timelines_spyglass_*.json` | Pods `OOMKilled`, nodes `MemoryPressure`/`DiskPressure`, etcd `alarm:NOSPACE` | Product bug, memory leak, or undersized cluster. |

---

## 2. Fast Triage Matrix

| Symptom / Log String | Sub-System | Diagnosis & Action |
|---|---|---|
| `reason: OOMKilled`, `exitCode: 137` | Container OOM | Container exceeded memory limit (`resources.limits.memory`). Check pod YAML `.status.containerStatuses[].lastState.terminated`. |
| `System OOM encountered`, `SystemOOM` event | Node-Level OOM | Node physical RAM exhausted; kernel killed victim process. Check `MemoryPressure` condition. |
| `MemoryPressure`, `DiskPressure`, `PIDPressure=True` | Kubelet Eviction | Node crossed eviction threshold; lowest-priority pods evicted (`phase: Failed, reason: Evicted`). |
| `The node was low on resource: ephemeral-storage` | Disk Full (NodeFS) | Test dumps, unbounded container logs, or large unpruned container images filled disk. |
| `mvcc: database space exceeded`, `alarm:NOSPACE` | etcd DB Exhaustion | etcd DB hit storage quota (~8 GiB). Controller hot-looping or object bloat. Writes rejected cluster-wide. |
| `FailedScheduling: Insufficient cpu/memory` | Scheduler | All nodes full or pod requests exceed allocatable capacity. |
| `ProvisioningFailed: failed to provision volume` | PVC / CSI Storage | StorageClass provisioner unresponsive, CSI driver crash, or cloud volume limit reached. |

---

## 3. Diagnostic Distinctions

- **Container Cgroup OOM vs Node OOM:**
  - *Cgroup OOM:* Single container terminated with `reason: OOMKilled`; node remains Ready and unpressured. Fix: Raise container limit or fix memory leak.
  - *Node OOM:* Journal has `Out of memory: Killed process` / `oom-kill:constraint=CONSTRAINT_NONE`, node shows `MemoryPressure`. Multiple unrelated pods restart. Fix: Right-size node or balance load.
- **Victim vs Trigger in Cascading Failures:**
  - When etcd hits `NOSPACE` or a node hits `MemoryPressure`, multiple dependent e2e tests will fail simultaneously.
  - Trace backwards in the timeline (`e2e-timelines_spyglass_*.json`) to find the **first** resource event. The earliest OOM/Eviction is the trigger; later test timeouts are victims.
