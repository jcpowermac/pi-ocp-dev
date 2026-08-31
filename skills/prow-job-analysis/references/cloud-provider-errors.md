# Cloud Provider Errors Reference

Cloud infrastructure failures occurring before or during cluster provisioning: CI resource leases, cloud API quotas, rate limits, credentials, capacity, and leaks.

## Fast Triage Matrix

| Location | Error Pattern | Failure Class | Action |
|---|---|---|---|
| `build-log.txt` | `acquiring_lease`, `0 free`, `all resources are in use` | Boskos Lease Exhaustion | Retry; if persistent, check for leaked account leases. |
| `build-log.txt` | `cir` not `available`, `status.size < spec.size` | OFCIR Baremetal Pool | Equinix/hardware allocation failure; not product bug. |
| `build-log.txt` | `timed out waiting for cluster claim` | Hive Pool / Claim | Upstream pool depleted; check Hive cluster deployment logs. |
| `.openshift_install*.log` | Quota/rate limits (see table below) | Cloud API Quota / Throttle | Check soft limit vs hard limit leak; retry on another account. |
| `.openshift_install*.log` | `InsufficientInstanceCapacity`, `ZONE_RESOURCE_POOL_EXHAUSTED` | Zone / Region Capacity | Provider-side shortage in target AZ; retry or switch zone. |
| `.openshift_install*.log` | `AuthFailure`, `AccessDenied`, `invalid_client`, `ExpiredToken` | Credential / Auth | Expired CI credential or STS token timeout. |
| Deprovision logs | `failed to delete`, `still exist`, leak warnings | Teardown Leak | Orphaned resources consuming quota; requires account cleanup. |

---

## Provider Error Signatures

### AWS
- **Throttling:** `RequestLimitExceeded`, `Throttling: Rate exceeded` (transient; retry).
- **vCPU Quota:** `VcpuLimitExceeded` (standard/spot limit exceeded in region).
- **Capacity:** `InsufficientInstanceCapacity`, `There is no Spot capacity available` (AZ capacity shortage).
- **Hard Limit / Leaks:** `LimitExceeded: Cannot exceed quota for UsersPerAccount: 5000` (indicates leaked IAM users).
- **Auth / STS:** `AuthFailure`, `UnauthorizedOperation`, `ExpiredToken`, `RequestExpired` (expired STS session).

### GCP
- **Quota:** `Quota 'CPUS' exceeded`, `Quota 'IN_USE_ADDRESSES' exceeded`, `Quota 'DISKS_TOTAL_GB' exceeded`, `QUOTA_EXCEEDED`.
- **Throttling:** `rateLimitExceeded`, `userRateLimitExceeded`.
- **Capacity:** `ZONE_RESOURCE_POOL_EXHAUSTED`, `does not have enough resources available`.
- **Auth:** `PERMISSION_DENIED`, `oauth2: cannot fetch token`, `invalid_grant`.

### Azure
- **Quota:** `OperationNotAllowed: Operation results in exceeding approved <Family> Cores quota`, `QuotaExceeded`.
- **Hard Limits / Leaks:** `ResourceGroupQuotaExceeded`, `PublicIPCountLimitReached` (~980 RG subscription limit).
- **Capacity:** `SkuNotAvailable`, `ZonalAllocationFailed`, `AllocationFailed`.
- **Auth:** `AuthorizationFailed`, `invalid_client`, `AADSTS700016`, `ClientSecretCredential authentication failed`.

---

## Diagnostic Classification

```
1. Did the job fail before installer started?
   ├── Yes (build-log.txt) ──► CI Lease / Boskos / OFCIR / Hive failure (CI Infrastructure).
   └── No (installer log)
       ├── Credential error on ALL calls ──► Rotated / expired CI credentials.
       ├── Missing permission on ONE call ──► Missing IAM role/policy for newly introduced resource.
       ├── Quota exceeded on soft limit (vCPU/IP) ──► Transient capacity contention.
       ├── Hard limit exceeded (IAM users/RGs) ──► Teardown leak accumulating across runs.
       └── Zone capacity exhausted ──► Cloud provider regional capacity outage.
```
