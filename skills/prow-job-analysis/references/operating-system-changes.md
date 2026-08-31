# Operating System Changes Reference

Host-level OS diagnosis in OpenShift CI: RHCOS kernel, CRI-O runtime, NetworkManager, systemd, SELinux, and OS payload rollouts.

## 1. High-Signal Triage Indicators

- **Variant Isolation (RHCOS 9 vs 10):** If failures hit only `rhcos10` (RHEL 10 base) and zero `rhcos9` (RHEL 9 base) jobs, the root cause is an OS variant difference (kernel/SELinux/systemd), not product PR code.
- **Payload-Boundary Blast Radius:** Failures appearing simultaneously across multiple unrelated jobs on a new nightly payload with no code PR to blame point to an RHCOS component bump (`rhel-coreos` or `rhel-coreos-10`).
- **MCO Rollout vs OS Content:**
  - *MCO Rollout:* Node fails to drain, cordon, or reboot during update → See `upgrade.md`.
  - *OS Content:* Node boots into the new OS tree and subsequently crashes, fails CRI-O runtime, or throws kernel panics → This reference.

---

## 2. Failure Symptoms & Subsystem Mapping

| Symptom / Log String | Subsystem | Evidence Location | Root Cause / Note |
|---|---|---|---|
| `CreateContainerError`, `failed to create OCI runtime`, `crun/runc` error | CRI-O / OCI Runtime | Node journal, `host_service_logs/masters/crio_service.log` | Container runtime / cgroup v1/v2 incompatibility or runtime bug. |
| `NetworkManager-wait-online` fails, host loses IP/route after boot | NetworkManager | Node journal (`NetworkManager`), serial console | Host network configuration failure below Kubernetes/OVN. |
| `Kernel panic - not syncing`, `BUG:`, `Oops`, `Call Trace:`, soft lockup | Linux Kernel | `serial.log`, `libvirt-logs.tar` (metal) | Kernel crash or driver hang. Node never reaches `Ready`. |
| `failed-units.txt` non-empty, systemd unit `failed` / `start-limit-hit` | systemd | `failed-units.txt`, node journal | Host systemd service degradation during first boot. |
| `avc:  denied`, `SELinux is preventing` | SELinux Policy | Node journal (`audit.log`) | Missing or restrictive SELinux policy after OS bump. |
| `read-only file system`, `rpm-ostree` deploy failures | Storage / Filesystem | Node journal, serial console | Disk corruption or OSTree deployment failure. |

---

## 3. Evidence Inspection Rules

- **Compressed Node Journals:** `gather-extra/artifacts/nodes/<node>/journal` files are gzip-compressed without a `.gz` extension. Use `zgrep` / `zcat`.
- **Pre-Ready Nodes:** If a node never reached Kubernetes `Ready`, its output is only in serial console logs (`log-bundle-*/serial/*-serial.log` or metal `libvirt-logs.tar`).
- **OS Version Verification:** Check `.status.nodeInfo.OSImage` and `KernelVersion` in `gather-extra/artifacts/oc_cmds/nodes` to confirm OS base version.
