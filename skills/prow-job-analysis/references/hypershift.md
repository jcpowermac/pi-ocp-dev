# HyperShift Reference

Triage guide for HyperShift (Hosted Control Planes / HCP) CI jobs spanning management and guest clusters.

## 1. Architecture: Two Clusters, One Job

| Entity | Cluster / Namespace | Purpose |
|---|---|---|
| **Management Cluster** | Physical/virtual OCP cluster | Runs hosted control plane pods and the HyperShift operator. |
| **Hosted Cluster (Guest)** | Worker nodes only | Tenant workload cluster; has no dedicated control plane VMs. |
| **HostedCluster (HC)** | Management `clusters` ns | Top-level CR for cluster lifecycle and overall status. |
| **HostedControlPlane (HCP)** | Management `clusters-<name>` ns | Rendered control plane state; owns kube-apiserver/etcd pods. |
| **NodePool (NP)** | Management `clusters` ns | Manages worker node scaling and machine configs for the guest. |

---

## 2. Fast Triage Workflow

```
1. Check HostedCluster Status in Management Cluster:
   Inspect .status.conditions on HostedCluster CR:
   ├── Degraded=True ──► Control plane component failing in namespace clusters-<name>.
   └── Available=False ──► Hosted API server pod not ready or unreachable.

2. Inspect Control Plane Pods in clusters-<name>:
   Check kube-apiserver, etcd, and kube-controller-manager pods for crashloops or OOMs.

3. Inspect NodePool Status:
   Check NodePool conditions for worker node provisioning errors or cloud instance capacity shortages.
```

---

## 3. Artifact Locations

- **Management Cluster Dump:** `artifacts/{target}/dump-management-cluster/` or must-gather in namespace `clusters-<name>`.
- **Hosted Guest Cluster Dump:** `artifacts/{target}/dump-hosted-cluster/` or standard e2e must-gather.
