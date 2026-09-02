# Reference: Cluster Operators Failure Triage

## Common Degraded Operator Patterns

### 1. `authentication` Operator Degraded
- **Symptoms**: `OAuthServerDeploymentDegraded`, `OAuthServerServiceEndpointDegraded`, or `OAuthServerRouteEndpointDegraded`.
- **Causes**:
  - OAuth server pods failing or crashlooping in `openshift-authentication` namespace.
  - Ingress router unable to reach authentication endpoints or cert rotation issues.
  - Dependencies on `kube-apiserver` readiness.
- **Investigation**:
  - Run `analyze_must_gather` with `component: "pods", namespace: "openshift-authentication"`.
  - Check events in `openshift-authentication`.

### 2. `kube-apiserver` / `kube-controller-manager` / `kube-scheduler` Operator Degraded
- **Symptoms**: `NodeInstallerDegraded`, `StaticPodsDegraded`, `GuardControllerDegraded`.
- **Causes**:
  - Master node static pod installer failed (e.g. revision rollout stall).
  - etcd quorum disruption or networking latency between master nodes.
  - Node disk pressure or kubelet communication failures.
- **Investigation**:
  - Check `etcd` health and `nodes` condition.
  - Review `openshift-kube-apiserver` static pod status.

### 3. `network` / `network-operator` Degraded
- **Symptoms**: `RolloutBlocked`, `DaemonSetNotAvailable`, or `ManagementStateDegraded`.
- **Causes**:
  - OVN-Kubernetes node daemonsets failing to start or connect to Northbound/Southbound databases.
  - MTU mismatch or Geneve/VXLAN overlay encapsulation failure.
- **Investigation**:
  - Run `analyze_must_gather` with `component: "pods", namespace: "openshift-ovn-kubernetes"`.

### 4. `storage` / `ingress` / `monitoring` Degraded
- **Symptoms**: Unbound PVCs, ingress daemonset not scheduled, alertmanager crashlooping.
- **Causes**:
  - CSI driver unable to provision cloud volumes (permissions or quotas).
  - Node resource exhaustion causing Prometheus or Router eviction.
