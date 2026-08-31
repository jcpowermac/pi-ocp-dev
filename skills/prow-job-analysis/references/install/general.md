# Install Failure Analysis — General

Diagnostic reference for OpenShift cluster installation failures (`install should succeed` failed test, or upgrade jobs failing pre-upgrade install).

## 1. Fast Triage Matrix: Install Stages

The installation lifecycle progresses through 4 distinct stages. Determine the failed stage from `junit_install.xml` or `.openshift_install*.log`:

| Stage | Failure Signal in Log / JUnit | Primary Failure Causes | Where to Look |
|---|---|---|---|
| **1. Infrastructure Provisioning** | `InfrastructureFailed`, cloud quota error, CAPI machine timeout | Cloud quota exceeded, throttling, invalid IAM permissions, or VPC subnet limits. | Non-deprovision `.openshift_install*.log` |
| **2. Bootstrap Initialization** | `BootstrapFailed`, `bootstrap did not become ready`, `timed out waiting for bootstrap-complete` | Bootstrap VM failed Ignition/first-boot, etcd cluster on bootstrap failed, or ignition image pull failed. | `log-bundle-*/` (bootstrap logs), `serial.log` |
| **3. Cluster Creation (Master Nodes)** | `ClusterCreation`, `control plane did not become ready`, `API server not reachable` | Master nodes failed to join etcd, CNI/OVN failed to initialize, or kubelet failed to start static pods. | `log-bundle-*/` (master nodes), `host_service_logs` |
| **4. Cluster Operator Stability** | `ClusterOperatorDegraded`, `operators did not become stable within timeout` | Core cluster operators (e.g. `network`, `dns`, `authentication`, `ingress`) stuck in `Degraded=True`. | `clusteroperators.json`, `gather-extra/artifacts/oc_cmds/co` |

---

## 2. Reading Installer Logs & Log Bundles

- **Exclude Deprovision Logs:** Look only at `.openshift_install.log` (provisioning); ignore `.openshift_install-deprovision.log`.
- **Work Backwards:** In `.openshift_install.log`, start from the final fatal error at the bottom and scan upwards to find the *first* underlying component timeout or failure.
- **Log Bundle Structure (`log-bundle-*`):**
  - `log-bundle-*/bootstrap/` — Journal, bootkube, and ignition logs from the bootstrap VM.
  - `log-bundle-*/masters/` — Logs from master nodes (`kubelet.service`, `crio.service`).
  - `log-bundle-*/serial/` — Serial console logs for nodes that failed to boot or reach network readiness.

---

## 3. Common Install Failure Patterns

- **Ignition Fetch Failure:** Node unable to fetch Ignition config (`dial tcp ... timeout` on port 22623) → Check machine-config-server on bootstrap VM and load balancer routing.
- **Bootstrap etcd Quorum:** Bootstrap VM brings up temporary single-node etcd, then transfers quorum to master nodes. If masters fail to connect to bootstrap etcd on port 2379/2380, quorum fails.
- **Static Pod CrashLoop:** If `kube-apiserver`, `kube-controller-manager`, or `etcd` static pods fail on master nodes, check `log-bundle-*/masters/<node>/host_service_logs/crio_service.log`.
- **Operator Timeout:** If installation fails at 99% during operator stabilization, inspect `gather-extra/artifacts/oc_cmds/co` for operators reporting `Degraded=True` or `Available=False`.
