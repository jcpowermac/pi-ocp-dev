# Networking Reference

Network failure diagnosis in OpenShift CI: image pull/registry, DNS, OVN-Kubernetes, ingress, service connectivity, and disconnected/proxy environments.

## Fast Triage

| Symptom / Log String | Sub-System | Primary Cause / Action |
|---|---|---|
| `ImagePullBackOff`, `ErrImagePull` | Image Pull | Check auth, registry reachability, or missing mirror. |
| `manifest unknown`, `name unknown` | Registry / Mirror | Image not mirrored (disconnected) or promotion lag (CI build farm). |
| `x509: certificate signed by unknown authority` | TLS / Trust | Missing mirror CA in `image.config.openshift.io/cluster` or `user-ca-bundle`. |
| `lookup <host> on <ip>:53: no such host`, `SERVFAIL` | CoreDNS | CoreDNS upstream failure or missing `dns-default` pod on node. |
| `CNI request failed`, `failed to create pod network sandbox` | OVN CNI | Pod networking failure; check `ovnkube-node` and `ovs-vswitchd`. |
| `Unreasonably long NNNNms poll interval` (OVSVswitchdLog) | OVS Stall | Node CPU starvation (>95% CPU) freezing dataplane packet forwarding. |
| `connection refused` to ClusterIP, `no endpoints available` | Service / Endpoints | Backing pods not Ready or EndpointSlice propagation delay. |
| `router-default` LB `EXTERNAL-IP` pending | Cloud LB Ingress | Cloud provider API quota / throttling provisioning the LoadBalancer. |
| Test times out only after applying `NetworkPolicy` | Network Policy | Policy default-deny missing allow rule for workload or DNS (`:53`). |

---

## Image Pull Error Taxonomy

- **Auth Failure (`401 Unauthorized`, `pull access denied`):** Missing/invalid credentials in `pull-secret` (`openshift-config`).
- **Image Missing (`manifest unknown`, `blob unknown`):** Tag does not exist. In disconnected jobs, image was not mirrored. In periodic jobs, postsubmit image promotion hasn't finished.
- **TLS/Trust (`x509: unknown authority`):** Mirror registry certificate not trusted by nodes. Verify `additionalTrustedCA`.
- **Network / Proxy (`dial tcp ... i/o timeout`, `no route to host`):** Missing `NO_PROXY` entry for internal mirror/cluster CIDR, or proxy pod restarted.

---

## Disconnected & Proxy Verification Chain

1. **ICSP / IDMS:** Verify `ImageContentSourcePolicy` or `ImageDigestMirrorSet` maps the source repository to the target mirror.
2. **Mirror Reachability:** Verify the node resolves mirror hostname and can connect on port `5000`/`8443`.
3. **Proxy (`config.openshift.io/proxies/cluster`):** Check `noProxy` includes `.cluster.local`, cluster CIDR, and mirror registry host.
4. **Mirroring Race:** Pods pulling before ICSP/IDMS applies or before mirror step completes will transiently fail and self-heal.

---

## OVN-Kubernetes & DNS Diagnostics

- **OVS Stalls:** If `e2e-timelines_spyglass_*.json` shows `OVSVswitchdLog: Unreasonably long ... poll interval` (>1000ms), the node's dataplane froze due to CPU starvation. Look for single-node disruption fan-out.
- **Node-Local DNS Failure:** If only pods on a single node fail DNS, verify `dns-default` DaemonSet is running and healthy on that specific node.
- **Cluster-Wide DNS Failure:** If all external lookups fail (`SERVFAIL`), the upstream node resolver (`/etc/resolv.conf`) is failing.
