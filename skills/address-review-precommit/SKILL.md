---
name: address-review-precommit
description: Fix code review findings before committing. Use when the user wants to address pre-commit review feedback, fix review findings in the current branch, or apply code review fixes and push.
---

## Name
address-review-precommit

## Synopsis
```text
/address-review-precommit [REVIEW_FINDINGS]
```

## Description
Applies code review findings to the current branch by editing code, running verification iteratively via `verify_repo`, and pushing the fixes. Designed to run after a pre-commit code review pass.

## Implementation

### Step 1: Understand Review Findings

Parse the review findings provided in the prompt and identify all required changes, improvements, and refactoring items.

### Step 2: Apply Fixes

Address all findings by editing the code:
1. Locate target files and line ranges.
2. Implement fixes following existing codebase patterns and conventions.
3. Keep changes scoped strictly to the review findings.

### Step 3: Verify via `verify_repo`

Run the deterministic `verify_repo` tool:

```json
{}
```

- If verification fails, inspect the extracted error snippet, apply corrections, and re-run.
- Up to 3 retry attempts.

### Step 4: Commit and Push

1. Amend existing commits or create new conventional commits as appropriate.
2. Push the branch:

```bash
git push
```

## Arguments
- `REVIEW_FINDINGS`: The review findings to address (passed inline from prior review output).

## Guidelines
- Address all critical and important findings.
- Always verify before pushing.
