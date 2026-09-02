---
name: address-ci-failures
description: Triage and fix PR CI failures caused by the PR's own changes. Use when has-review-work detects new failing checks, when a PR has CI regressions to investigate, or when deciding whether to fix vs report a CI failure.
---

## Name
address-ci-failures

## Synopsis
```text
/address-ci-failures [PR number] [owner/repo] [--failing-checks JSON] [--ci]
```

## Description
Investigates failing CI checks on a pull request, classifies each failure, and only fixes failures that are a direct consequence of the PR's changes. Pre-existing, infrastructure, flake, and fleet-wide failures are reported on the PR instead of "fixed" with out-of-scope repo-wide changes. Optional Prow jobs do not block merge — default is report, not a code change.

When `--ci` is passed: NEVER ask interactive questions or wait for user input. Make autonomous decisions. When uncertain whether a failure is PR-caused, do not fix — report instead.

## Implementation

### Step 0: Resolve PR and Failing Checks

1. Resolve PR number and repository into named variables.
2. If `--failing-checks` JSON is provided from `has-review-work`, parse it.
3. Otherwise, fetch checks using `gh pr checks <PR_NUMBER> --repo <REPO> --json name,state,bucket,link`.

### Step 1: Triage Failing Checks via `triage_pr_ci_failures`

Invoke the deterministic `triage_pr_ci_failures` tool:

```json
{
  "prNumber": 1234,
  "repo": "openshift/hypershift",
  "checks": [
    {
      "name": "e2e-aws-ovn",
      "state": "FAILURE",
      "bucket": "fail",
      "link": "https://prow.ci.openshift.org/view/gs/..."
    }
  ]
}
```

The tool:
- Diffs base..head to get changed files and packages in the PR.
- Checks if the failing jobs are optional (`prowjob.json` check).
- Analyzes Prow job runs via `analyzeProwRun` to extract failed tests and root cause signals.
- Correlates errors against modified files and classifies each failure:
  - `pr_caused`: Failing test or error touches files/packages in PR diff.
  - `infrastructure`: Cloud quota, Boskos, or ci-operator pod failures.
  - `pre_existing`: Fleet-wide failure, base branch failure, or unchanged dependency issue.
  - `flake`: Known flaky test or disruption without diff overlap.
  - `out_of_scope`: Optional job without slam-dunk diff overlap, or repo-wide CI config change needed.

### Step 2: Act on Classification

#### PR-Caused Failures (`action == "fix"`)
1. Implement the minimal fix strictly in files/tests modified by this PR.
2. Run `verify_repo` to test and lint the fix.
3. Commit locally with a conventional commit referencing the failing check.
4. In interactive mode, push. In `--ci` mode, commit locally only (the pipeline handles pushing).

#### Non-Actionable Failures (`action == "report"`)
1. Do NOT modify application code, CI configuration (`.prow.yaml`, Makefile), or generated files.
2. Call `post_ci_failure_report`:

```json
{
  "prNumber": 1234,
  "repo": "openshift/hypershift",
  "checkName": "ci/prow/lint",
  "classification": "pre_existing",
  "evidence": "Audit failure on unchanged dependencies."
}
```

3. Posts the standard non-actionable CI failure report to the PR conversation.

### Step 3: Summary

Display a triage summary table:

| Check | Optional | Classification | Action | Reason |
|-------|----------|----------------|--------|--------|
| ... | yes / no | pr_caused / infra / ... | fixed / reported | ... |

## Arguments
- `$1`: PR number (optional)
- `$2`: `owner/repo` (optional)
- `--failing-checks`: JSON array of checks from `has-review-work`
- `--ci`: Non-interactive CI automation mode

## See Also
- `has-review-work` — read-only gate that sets `CI_WORK`
- `address-review-pr` — handles review comments
- `prow-job-analysis` — deep Prow job log analysis
