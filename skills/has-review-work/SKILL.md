---
name: has-review-work
description: Decide whether a GitHub PR has unanswered authorized review comments or new required CI failures worth a follow-up agent. Use when gating a review-responder loop, polling a PR for actionable feedback, or checking if address-review-pr or address-ci-failures should run.
---

## Name
has-review-work

## Synopsis
```text
/has-review-work [PR number] [owner/repo] [--ci]
```

## Description
Read-only check: does this PR have work for `address-review-pr` (unanswered authorized review comments) or `address-ci-failures` (new required CI failures)?

Uses the deterministic `pr_review_status` tool to inspect inline review comments, PR reviews, conversation comments, and Prow/GitHub CI check statuses. Automatically skips ignored accounts (CI robots, agent's own login), unauthorized authors, resolved review threads, pure acknowledgments, slash-command-only comments (`/lgtm`, `/hold`, `/test …`), already-replied threads, and optional Prow jobs.

When `--ci` is passed: print only `COMMENT_WORK=`, `CI_WORK=`, `WORK=`, and `FAILING_CHECKS=`. Make autonomous decisions. Do not ask questions.

## Implementation

### Step 1: Resolve PR and Repository

1. **PR number**: If argument `$1` is provided, set `PR_NUMBER="$1"`. Otherwise infer from current branch (`gh pr view --json number -q .number`).
2. **Repository**: If argument `$2` is provided (`owner/repo`), set `REPO="$2"`. Otherwise infer from `gh repo view --json nameWithOwner -q .nameWithOwner`.
3. **`--ci`**: Machine-readable output mode.

### Step 2: Call `pr_review_status` Tool

Invoke the deterministic `pr_review_status` tool:

```json
{
  "prNumber": 1234,
  "repo": "openshift/hypershift",
  "previousFailingChecks": [],
  "previousHeadSha": "..."
}
```

The tool deterministically:
- Fetches all comments, reviews, and GraphQL review threads.
- Filters unauthorized comment authors against `OWNERS`, `OWNERS_ALIASES`, and org membership.
- Filters slash-command-only bodies and already-replied comments.
- Fetches CI checks and filters optional Prow jobs via public GCS `prowjob.json`.
- Compares with previous poll state.

### Step 3: Handle Output

#### CI Mode (`--ci`)
Print the 4 key-value lines and nothing else:

```text
COMMENT_WORK=yes
CI_WORK=no
WORK=yes
FAILING_CHECKS=[{"name":"lint","state":"FAILURE","bucket":"fail","link":"https://prow.ci.openshift.org/..."}]
```

- `COMMENT_WORK=yes` only when there is at least one unanswered authorized review comment.
- `CI_WORK=yes` only when there are new non-optional CI failures.
- `WORK=yes` if either `COMMENT_WORK` or `CI_WORK` is yes.
- `FAILING_CHECKS` is a JSON array of current actionable failures.

#### Interactive Mode
Present a clear summary table of actionable reviewer comments (author, file, line, category, preview) and failing CI checks.

## Arguments
- `$1`: PR number (optional — inferred from current branch if omitted)
- `$2`: `owner/repo` (optional — inferred from current repo if omitted)
- `--ci`: Non-interactive CI mode

## See Also
- `address-review-pr` — address reviewer comments detected by this gate
- `address-ci-failures` — triage and fix PR CI failures
