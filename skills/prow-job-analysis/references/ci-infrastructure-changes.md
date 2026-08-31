# CI Infrastructure Changes Reference

Triage guide for distinguishing product bugs from CI infrastructure, `openshift/release` config changes, ci-operator failures, lease exhaustion, and step-registry issues.

## 1. Fast Triage: CI Infrastructure vs Product Bug

```
Where did the error occur?
├── Top-level build-log.txt (before test phase) ──► CI Infrastructure (100%)
│   ├── acquiring_lease / Boskos / OFCIR ──► Cloud quota / baremetal lease exhaustion.
│   ├── creating_release_images ──► CI registry outage or unpromoted image tag.
│   ├── pod_pending / pod scheduling ──► Build-farm cluster node capacity / pressure.
│   └── could not resolve ... ──► Broken step-registry reference in openshift/release.
│
└── Step build-log (artifacts/{target}/{step}/build-log.txt)
    ├── PRE phase (ipi-conf-*, ipi-install-*) ──► Step script syntax error, cloud API quota, or installer bug.
    ├── TEST phase (openshift-e2e-test) ──► Product code bug, test assertion failure, or flaky test.
    └── POST phase (gather-*, deprovision) ──► Teardown / artifact capture failure (informational).
```

---

## 2. ci-operator Error Taxonomy

| Error String | Category | Meaning & Action |
|---|---|---|
| `creating_release_images` / `failed to import release` | Release Assembly | CI image registry issue, payload import timeout, or missing base tag. |
| `pod_pending` / `did not start running within 30m` | Build Scheduling | Build-farm cluster at capacity, resource requests unsatisfiable, or node pressure. |
| `failed to acquire lease: context deadline exceeded` | Lease / Quota | Boskos cloud account or OFCIR baremetal pool depleted. Retry. |
| `could not resolve '<step>': no such ref` | Step Registry | Broken reference in `ci-operator/step-registry/` after an `openshift/release` PR. |
| `manifest unknown: manifest unknown` | Image Promotion | Postsubmit promotion hasn't finished promoting image tag before periodic ran (transient timing race). |
| `error: the interrupt handler was triggered` | Timeout / Kill | Job exceeded maximum runtime or was preempted by CI system. |

---

## 3. Step Registry Execution Model

```
Workflow (*-workflow.yaml)
  ├── PRE Phase:  Chains/Refs setup cluster (ipi-conf -> ipi-install) [Fail = Abort TEST]
  ├── TEST Phase: Executes e2e suites (openshift-e2e-test)            [Fail = Record Fail]
  └── POST Phase: Gathers logs & deprovisions (gather-extra, ipi-deprovision) [Always runs]
```

- **Step Failures in PRE:** If `ipi-install-install` fails, the TEST phase is skipped entirely, and POST gather/deprovision runs.
- **Step Script Errors:** If a step fails with a shell syntax error or missing variable, check recent git commits to `ci-operator/step-registry/<step-path>/*-commands.sh` in `openshift/release`.
- **Parameter Overrides:** Multi-stage parameters can be passed via `MULTISTAGE_PARAM_OVERRIDE_<PARAM>` or job env config.

---

## 4. Cross-Job Correlation Checklist

1. **Fleet-Wide Blast Radius:** If unrelated repositories (e.g. `installer`, `origin`, `cvo`) start failing with the same error simultaneously, the cause is CI infrastructure or shared image promotion, not a product PR.
2. **Recent `openshift/release` PRs:** When a job suddenly breaks with no product code changes, check merged PRs under `ci-operator/config/` and `ci-operator/step-registry/`.
3. **Transient Promotion Race:** If `manifest unknown` occurs on a periodic job immediately following a merge to master, wait for the postsubmit promotion job to finish and retry.
