# Reference: Pod & Workload Failure Triage

## Common Pod Failure Modes

### 1. `CrashLoopBackOff`
- **Definition**: Container starts, exits with a non-zero exit code (or fatal panic), and Kubernetes repeatedly delays restarting it.
- **Common Triggers**:
  - Configuration errors (missing environment variables, invalid configmaps/secrets).
  - Failed startup/liveness probe health checks.
  - OOMKilled (Exit Code 137) due to memory limits exceeded on the pod or node.
  - Dependent service unavailable (e.g. database, apiserver, OAuth).
- **Remediation**:
  - Inspect container termination reason and restart count.
  - Correlate with warning events in the same namespace.

### 2. `ImagePullBackOff` / `ErrImagePull`
- **Definition**: Kubelet cannot fetch the container image from the designated registry.
- **Common Triggers**:
  - Pull secret missing or expired in the namespace.
  - Registry rate limiting or internal CI registry outage.
  - Typo in image repository tag or sha256 digest.

### 3. `Pending` / Scheduling Failures
- **Definition**: Pod cannot be assigned to any worker/master node.
- **Common Triggers**:
  - Insufficient CPU or Memory on all available nodes (`Insufficient cpu`, `Insufficient memory`).
  - Node affinity, taint/toleration mismatch, or node selector constraints (`MatchNodeSelector`).
  - Volume binding failure (e.g. multi-attach error or unbound PVC).

### 4. `CreateContainerConfigError` / `CreateContainerError`
- **Definition**: Kubelet cannot set up the container execution environment.
- **Common Triggers**:
  - Missing ConfigMap, Secret, or volume mount target.
  - SecurityContextConstraints (SCC) or SELinux permission denial.
