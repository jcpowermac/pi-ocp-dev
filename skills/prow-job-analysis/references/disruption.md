# Disruption Analysis Reference

Diagnostic guide for interpreting API disruption intervals and timeline events (`e2e-timelines_spyglass_*.json`) in OpenShift CI.

## 1. Core Principles: Disruption as a Symptom

- **Disruption is an observational signal, never the root cause.** API backends stop responding because an underlying system failed (etcd election, node drain, OVS stall, CPU starvation, or network partition).
- **Temporal Correlation:** Correlate disruption timestamps with failed e2e tests. If disruption occurs inside a test execution window, the test is likely a victim of API unavailability.

---

## 2. Key Timeline Sources in `e2e-timelines_spyglass_*.json`

| Timeline Source | What It Measures | Failure Signature / Significance |
|---|---|---|
| `Disruption` | API backend probe failures | Measures downtime window (`from` → `to`) for specific API target (e.g. `kube-api`, `oauth`, `ingress`). |
| `OVSVswitchdLog` | Open vSwitch polling latency | `Unreasonably long NNNNms poll interval` (>1000ms = dataplane frozen on that node). |
| `CPUMonitor` | Node CPU utilization | >95% sustained CPU load causing process starvation and probe timeouts. |
| `CloudMetrics` | Cloud disk / IOPS saturation | Disk throttle/burst exhaustion (common on Azure managed disks / AWS EBS). |
| `NodeMonitor` | Node lifecycle & conditions | Node transitions between `Ready` and `NotReady`, or entering `MemoryPressure`. |
| `Alert` | Prometheus alerting rules | Firing alerts such as `KubeAPILatencyHigh`, `etcdBackendQuotaLowSpace`, `SystemOOM`. |
| `EtcdDiskWalFsyncDuration` | etcd fsync latency | High fsync duration (>100ms) causing etcd leader re-elections and API freeze. |

---

## 3. Backend Classification & Root Cause Routing

```
Which backend experienced disruption?
├── Ingress-Routed Backends (oauth-api, console, ingress-to-oauth)
│   └── Cause: router-default pods restarting, Cloud LoadBalancer health-check failure, or ingress cert reload.
│
├── Core Kubernetes API (kube-api, openshift-api)
│   ├── All nodes affected simultaneously ──► etcd leader election, disk fsync stall, or apiserver crashloop.
│   └── Only one source node affected ──► Node-local OVS stall, kubelet failure, or source node CPU starvation.
│
└── Service-to-Service / In-Cluster
    └── Cause: OVN CNI port binding lag, EndpointSlice propagation delay, or NetworkPolicy drop.
```

---

## 4. Single-Node vs Cluster-Wide Disruption

- **Single Source-Node Pattern:** Probes originating from *only one* worker node fail, while probes from other nodes succeed.
  - *Diagnosis:* The problem is local to the source node (OVS stall, host CPU contention, local CoreDNS drop), NOT an API server outage.
- **Cluster-Wide Multi-Node Pattern:** Probes from *all* nodes fail at the same exact timestamp.
  - *Diagnosis:* Control plane outage (etcd leader lost, apiserver rollout, or cloud LB outage).

---

## 5. Disruption During Upgrades

- During rolling upgrades, minor disruption (few seconds) is permitted as apiserver pods restart and nodes drain/reboot.
- If a disruption test fails (`exceeded allowance of N seconds`), check if node drain stalled on a PDB or if etcd quorum degraded during master node reboot.
