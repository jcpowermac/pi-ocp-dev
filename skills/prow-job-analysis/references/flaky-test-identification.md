# Flaky Test Identification Reference

Triage methodology for classifying test failures into **Infrastructure**, **Product Regression**, or **Test Flake**.

## 1. The Three-Way Classification

| Failure Class | Root Cause Domain | Retry Behavior | Blast Radius | Fix Location |
|---|---|---|---|---|
| **Infrastructure** | CI platform, cloud quota, lease timeout, network blip | Often passes on retry | Multiple unrelated jobs/repos simultaneously | `openshift/release`, cloud quota, Test Platform |
| **Product Regression** | Code change broke expected product functionality | Deterministic failure on every run | Isolated to PR or payload containing the change | Product repo / PR author |
| **Test Flake** | Race condition, hardcoded timeout, or test order dependency | Passes on retry (intermittent) | Historical pass rate in 80–99% band | Test source code |

---

## 2. Fast Triage Decision Matrix

```
Did the test fail?
├── ci-operator failure reason set (acquiring_lease, pod_pending, etc.) ──► Infrastructure (100%).
├── Same error hitting 3+ unrelated jobs on search.ci ──► Infrastructure / Shared Platform.
├── Consecutive runs fail deterministically with identical assertion ──► Product Regression (see test-failure.md).
└── Passes on /retest, historical pass rate 80-99% in Sippy, or timing-dependent ──► Test Flake.
```

---

## 3. Flake Patterns in Test Code

- **Poll Without Timeout Allowance:** Test asserts immediately instead of using `wait.PollUntilContextTimeout`.
- **Resource Cleanup Race:** Test assumes a namespace or CR from a previous test is already fully deleted.
- **Node Placement Dependency:** Test assumes multi-node distribution but runs on SNO (single-node) cluster.
- **Port / Name Collision:** Test uses a static resource name that conflicts with concurrent tests.
