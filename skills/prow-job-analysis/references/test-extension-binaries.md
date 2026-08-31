# Test Extension Binaries Reference

Triage guide for OpenShift Test Extension (OTE) binary failures (`*-tests-ext` binaries shipped inside component payload images).

## 1. Overview & Architecture

- **Traditional Tests:** Built directly into `openshift-tests` (origin repo).
- **Extension Tests:** Shipped in component images as standalone executables (`/usr/bin/<component>-tests-ext`). `openshift-tests` discovers, extracts, and executes them via the OTE protocol over stdout.

---

## 2. Failure Stages & Triage Matrix

| Stage | Command / Phase | Error Signature | Root Cause & Action |
|---|---|---|---|
| **1. Extraction** | Image extraction | `failed to extract extension binary`, `binary not found in image` | Component Dockerfile did not build/copy the `*-tests-ext` binary to `/usr/bin/`, or image pull failed. |
| **2. Discovery** | `<binary> info` / `<binary> list` | `error running extension discovery`, `invalid JSON output from info` | Binary panicked during initialization, had missing shared libraries, or returned invalid JSON schema. |
| **3. Execution** | `<binary> run-test <name>` | `test execution failed`, `panic:` in extension binary | Component-owned test assertion failed or test code crashed. Inspect test failure in component repo. |
| **4. Protocol** | JSON event streaming | `protocol error: unexpected token`, `stream EOF` | Version skew or OTE protocol mismatch between `openshift-tests` harness and component extension binary. |

---

## 3. Evidence Locations

- **Discovery & Protocol Errors:** In `artifacts/{target}/openshift-e2e-test/build-log.txt` or `openshift-tests-ext.log`.
- **Test Execution Failures:** In JUnit XML artifacts `junit_*.xml` under test step artifacts directory.
- **Component Source Repo:** Extension test names carry the component prefix (e.g. `[sig-etcd][Feature:ClusterEtcdOperator]`). Inspect the component repo's `test/e2e/` rather than `openshift/origin`.
