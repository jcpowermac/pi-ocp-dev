# Aggregated Jobs Reference

Triage guide for aggregated Prow CI jobs (`aggregated-*` prefix), which run multiple parallel child jobs (typically 10) to perform statistical regression analysis.

## 1. Core Architecture & Rule

- **Parent Job is an Orchestrator:** The parent job does NOT install a cluster or run tests directly. It launches N child jobs, aggregates JUnit results, and compares pass rates against historical baselines.
- **NEVER triage parent `build-log.txt` for test errors:** Parent `build-log.txt` contains only orchestrator setup and statistical summary output.

---

## 2. Key Artifact: `junit-aggregated.xml`

Located under:
`artifacts/release-analysis-aggregator/.../{underlying-job-name}/{payload-tag}/junit-aggregated.xml`

This file contains:
- List of all child job runs and their Prow URLs.
- Per-test statistical pass rates vs baseline.
- Identification of statistically significant regression failures.

---

## 3. Triage Workflow

```
1. Identify underlying child runs:
   Inspect junit-aggregated.xml for child Prow URLs:
   https://prow.ci.openshift.org/view/gs/test-platform-results/logs/<child-job>/<build-id>

2. Classify child failure pattern:
   ├── All child runs failed Install ──► Baseline payload install failure (see install/general.md).
   ├── Infra / Cloud Quota in children ──► Cloud quota / CI capacity exhaustion (see cloud-provider-errors.md).
   └── Specific e2e test failure ──► Run analyze_prow_run on representative failing child runs.
```
