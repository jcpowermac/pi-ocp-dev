---
name: jira-solve
description: Analyze a JIRA issue and create a pull request to solve it. Use when the user wants to implement a fix or feature described in a Jira issue, push a branch, and open a draft PR.
---

## Name
jira-solve

## Synopsis
```text
/jira-solve <jira-issue-key> [remote] [--ci]
```

## Description
Analyzes a Jira issue, implements the solution in the current repository, runs local verification, creates logical commits grouped by component, and opens a pull request.

Uses the deterministic `jira_get_issue` tool to retrieve groomed issue details (summary, acceptance criteria, reproduction steps), `verify_repo` for bounded test runs, and `create_pr_helper` for PR creation.

## Implementation

### Step 1: Issue Analysis via `jira_get_issue`

Fetch groomed Jira issue details using `jira_get_issue`:

```json
{
  "issueKey": "OCPBUGS-12345"
}
```

Extracts:
- `summary`: Issue title
- `context`: Background information
- `acceptanceCriteria`: Must-pass conditions
- `stepsToReproduce`: Bug reproduction steps

If in interactive mode and required sections are missing, clarify with the user. If `--ci` is set, proceed with available info.

### Step 2: Codebase Analysis

Search relevant files and functions matching the Jira requirements:
- Use Grep and Glob tools to locate controllers, APIs, and existing tests.
- Identify the exact code changes needed to satisfy all acceptance criteria.

### Step 3: Plan and Implement

1. Write a step-by-step implementation plan to `.work/solve/spec-<KEY>.md`.
2. Implement code changes:
   - Add/update unit tests for any new or modified functions.
   - Maintain godoc comments and follow existing code conventions.
3. Run `verify_repo` to test and lint changes.

### Step 4: Commit Creation

1. Create a feature branch: `git checkout -b fix-<KEY>`.
2. Group commits logically by component:
   - `feat(api): ...` — API/CRD changes
   - `chore(vendor): ...` — Dependency updates
   - `feat(cli): ...` — CLI command changes
   - `feat(operator): ...` / `fix(controller): ...` — Controller logic
   - `test: ...` — Test additions
   - `docs: ...` — Documentation
3. Follow conventional commits formatting.

### Step 5: Push and Open PR

1. Push feature branch to the specified remote (`$2`, default `origin`):

```bash
git push -u origin fix-<KEY>
```

2. **PR Creation**:
   - If `--ci` is set: **Do NOT open a PR** (PR creation is left to the pipeline).
   - If interactive: Call `create_pr_helper` to create a draft PR with the Jira prefix, acceptance criteria, and template body.

## Arguments
- `$1`: Jira issue key (required, e.g. `OCPBUGS-12345`)
- `$2`: Remote repository name (optional, default `origin`)
- `--ci`: Non-interactive CI automation mode (skips PR creation)

## Guidelines
- Authenticates using `JIRA_API_TOKEN` & `JIRA_USERNAME` or `JIRA_BEARER_TOKEN`.
- Always verify changes with `verify_repo` before pushing.
