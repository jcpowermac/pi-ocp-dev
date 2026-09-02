# Reference: etcd Health & Quorum Triage

## Common etcd Issues

### 1. Quorum Loss
- **Definition**: Fewer than `(N/2) + 1` healthy members in the cluster (e.g. < 2 healthy out of 3, or < 3 healthy out of 5).
- **Consequences**: API server transitions to read-only or becomes completely unavailable. Cluster state mutations halt.
- **Triggers**:
  - Master node power off, reboot, or network partition.
  - Disk fsync latency exceeding leader heartbeat timeout (>100ms).
  - High memory usage / OOM on etcd member processes.

### 2. High Disk / Fsync Latency
- **Symptoms**: `etcdserver: slow fdatasync`, repeated leader elections, WAL write warnings.
- **Triggers**:
  - Slow underlying storage (e.g. HDD or low IOPS EBS/cloud volumes).
  - Heavy co-located I/O workload competing on master disk.

### 3. Member Unhealthy / Out of Sync
- **Symptoms**: One member endpoint reports `health: false` or database revision lag.
- **Investigation**:
  - Check `etcd_info/endpoint_health.json` and `member_list.json`.
  - Verify static pods in `openshift-etcd` on the corresponding master node.
