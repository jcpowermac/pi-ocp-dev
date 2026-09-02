# Reference: Node Conditions & Capacity Triage

## Common Node Issues

### 1. `NotReady` Condition
- **Definition**: Node is reporting `Ready: False` or `Ready: Unknown`.
- **Common Triggers**:
  - `kubelet` stopped, crashed, or unresponsive on the host.
  - CRI-O / Container runtime failure (e.g. storage driver exhausted or lock contention).
  - Network disconnection between node and API server (heartbeat timeout).
  - Cloud provider instance termination or health probe failure.
- **Triage**:
  - Check node roles (`master` vs `worker`).
  - Check other conditions (`DiskPressure`, `MemoryPressure`, `NetworkUnavailable`).

### 2. Node Pressures
- **`MemoryPressure`**: Node available memory is below eviction thresholds. Kubelet starts evicting BestEffort / Burstable pods.
- **`DiskPressure`**: Root filesystem or image filesystem usage exceeds 85–90%. Kubelet stops pulling images and evicts pods.
- **`PIDPressure`**: Process ID limit reached on the host, preventing new container/process spawning.
- **`NetworkUnavailable`**: CNI plugin has not configured node routing or pod CIDR allocation failed.

### 3. Taints and Scheduling Impact
- Nodes under pressure automatically receive taints (e.g. `node.kubernetes.io/memory-pressure:NoSchedule`), preventing new workload placement and resulting in `Pending` pods.
