# Artifacts Reference

GCS artifact layout and key file paths for OpenShift CI jobs on `storage.googleapis.com/test-platform-results`.

## 1. Top-Level GCS Structure

- **Periodics & Postsubmits:** `logs/{job-name}/{build-id}/`
- **Presubmits:** `pr-logs/pull/{org}_{repo}/{pr-number}/{job-name}/{build-id}/`

```text
{build-id}/
├── build-log.txt                  # ci-operator orchestration log
├── prowjob.json                   # Job metadata, spec, annotations, timing
├── podinfo.json                   # Pod lifecycle details, container exit codes / OOMs
├── finished.json / started.json   # Job status & start/finish timestamps
└── artifacts/
    ├── {target}/                  # Test step artifacts (keyed by --target)
    │   ├── gather-extra/          # Core cluster dumps (see below)
    │   ├── openshift-e2e-test/    # E2E test step logs and JUnit XMLs
    │   └── must-gather/           # Full must-gather archive (when collected)
    ├── ci-operator-step-graph.json
    └── e2e-timelines_spyglass_*.json  # Time-ordered timeline intervals
```

---

## 2. Key Diagnostic Files & Paths

| Diagnostic Target | File Path (relative to `{build-id}/artifacts/{target}/`) | Use / Contents |
|---|---|---|
| **Operator Status** | `gather-extra/artifacts/oc_cmds/co` or `clusteroperators.json` | Status of all ClusterOperators (`Available`, `Progressing`, `Degraded`). |
| **ClusterVersion** | `gather-extra/artifacts/oc_cmds/clusterversion` | Payload upgrade state, target release image, update history. |
| **Node State** | `gather-extra/artifacts/oc_cmds/nodes` | Node conditions (`Ready`, `MemoryPressure`, `DiskPressure`), OS versions. |
| **Cluster Events** | `gather-extra/artifacts/oc_cmds/events` | Warning events (`SystemOOM`, `FailedScheduling`, `Evicted`, `BackOff`). |
| **Pod Snapshots** | `gather-extra/artifacts/oc_cmds/pods` | All pods across namespaces, restart counts, `CrashLoopBackOff` status. |
| **JUnit XMLs** | `openshift-e2e-test/artifacts/junit_*.xml` | Passed/failed Ginkgo testcases, failure messages, stack traces. |
| **Timeline Intervals** | `**/e2e-timelines_spyglass_*.json` | Time-series intervals (`Disruption`, `OVSVswitchdLog`, `CPUMonitor`, `Alert`). |
| **Node Journals** | `gather-extra/artifacts/nodes/<node>/journal` (gzip) | Host service logs (kernel panics, NetworkManager, CRI-O, kubelet). |
| **Audit Logs** | `gather-extra/artifacts/audit_logs/` | API server audit logs for request tracing. |
| **Install Logs** | `installer/.openshift_install.log` or `log-bundle-*/` | Installer output, bootstrap VM logs, master node ignition logs. |

---

## 3. Tool Resolution

Note: `analyze_prow_run` automatically parses GCS run metadata and returns exact resolved links for these artifact paths in `RunAnalysisResult.artifact_paths`.
