---
name: address-review-pr
description: Fetch and address all PR review comments — categorize by priority, make code changes, post replies, and push. Use when addressing, responding to, or working through PR review feedback.
---

## Name
address-review-pr

## Synopsis
```text
/address-review-pr [PR number] [--preview] [--ci]
```

## Description
Systematically addresses PR review comments by fetching pre-filtered, authorized comments, categorizing them by priority (action instructions, blocking issues, change requests, questions, suggestions), making required code edits, verifying changes locally, posting signed responses, and pushing updates.

Does not handle CI failures — use `address-ci-failures` for CI triage.

When `--ci` is passed: Never ask interactive questions or wait for user input. Make autonomous decisions. Proceed with the safest action.

## Implementation

### Step 0: Ensure Working Tree Clean

1. Resolve the PR number: `$1` if provided, otherwise infer from current branch.
2. Checkout PR branch if needed and verify working tree is clean (`git status`).

### Step 1: Fetch Review Comments via `pr_review_comments`

Invoke the deterministic `pr_review_comments` tool:

```json
{
  "prNumber": 1234,
  "repo": "openshift/hypershift"
}
```

The tool returns an array of pre-filtered, authorized, unanswered comments with:
- `id`: Comment ID
- `author`: GitHub login
- `type`: `review_comment` or `issue_comment`
- `path`: File path
- `line`: Line number
- `category`: `ACTION_INSTRUCTION`, `BLOCKING`, `CHANGE_REQUEST`, `QUESTION`, `SUGGESTION`
- `preview`: Comment body

### Step 2: Categorize and Prioritize

Process comments in priority order:
1. **ACTION_INSTRUCTION**: Operations like git rebase, squash, or branch updates.
2. **BLOCKING**: Critical security, panics, or breaking bugs.
3. **CHANGE_REQUEST**: Code improvements or refactoring.
4. **QUESTION**: Inquiries needing technical explanations.
5. **SUGGESTION**: Optional improvements or nits.

### Step 3: Address Feedback

For each comment:
- **Code Changes (`BLOCKING`, `CHANGE_REQUEST`, `SUGGESTION`)**:
  - Implement minimal changes in the affected files.
  - Amend existing commits or create clean conventional commits.
- **Clarifications (`QUESTION`)**:
  - Formulate a clear, concise technical explanation (2–4 sentences with file:line references).

### Step 4: Verification via `verify_repo`

Run the deterministic `verify_repo` tool:

```json
{}
```

- Verifies that `make verify`, `make lint`, or `go test` passes.
- Up to 3 retry attempts if verification fails — fix errors and re-run.
- Do NOT push code that fails verification.

### Step 5: Post Replies via `pr_post_reply`

For each addressed comment, call `pr_post_reply`:

```json
{
  "prNumber": 1234,
  "repo": "openshift/hypershift",
  "commentId": "101",
  "commentType": "review_comment",
  "body": "Done. Fixed nil pointer check."
}
```

- All replies automatically receive the footer `---\n*AI-assisted response*`.
- Duplicate checks prevent re-replying if already answered.

### Step 6: Push

Push changes to the remote branch:

```bash
git push
```

## Arguments
- `$1`: PR number (optional — uses current branch if omitted)
- `--preview`: Preview proposed actions and replies before applying
- `--ci`: Non-interactive CI automation mode

## See Also
- `has-review-work` — read-only gate detecting review work
- `address-ci-failures` — triage and fix PR-caused CI failures
