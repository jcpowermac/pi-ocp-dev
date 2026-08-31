# Test Failure Root-Cause Analysis

Step-by-step method for root-cause analysis of deterministic e2e test failures (conformance, integration, or functional tests).

## 1. Five-Step Investigation Method

```
1. Read JUnit Failure: Extract expected vs actual, target namespace, and failure message.
   ↓
2. Locate Test Source: Search openshift/origin or component repo for test assertion code.
   ↓
3. Scope Namespace & Component: Inspect cluster operators and pods in the affected namespace.
   ↓
4. Pin Failure Window: Correlate test execution timestamps with timeline events in e2e-timelines_*.json.
   ↓
5. Trace Originating Error: Read previous container logs (previous.log) for the earliest panic/fatal error.
```

---

## 2. Common E2E Failure Categories & Root Causes

| Failure Pattern in JUnit | Common Root Cause | Where to Look |
|---|---|---|
| `timed out waiting for condition` | Backing pods never became Ready, or operator failed to reconcile CR within timeout. | Target namespace pod status & events in `gather-extra/artifacts/oc_cmds/`. |
| `Expected <x> to equal <y>` | Behavioral regression in API response, default configuration value, or status field. | Component source repo PR diff or API handler logs. |
| `User "system:serviceaccount:..." cannot get resource` | Missing RBAC RoleBinding or ClusterRole permission for component service account. | RBAC manifests and API server audit logs in `audit_logs/`. |
| `connection refused` or `502 Bad Gateway` | Target service pod crashed or endpoint was removed from service. | Pod restart logs in `gather-extra/artifacts/pods/<namespace>/`. |
| `panic:` / nil pointer dereference | Unhandled nil pointer or edge case in controller/operator binary. | Operator pod `previous.log` or stderr output. |
