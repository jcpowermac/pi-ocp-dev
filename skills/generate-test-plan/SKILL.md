---
name: generate-test-plan
description: Generate a comprehensive manual testing guide from a Jira issue, GitHub PR URLs, or both. Use when the user wants test steps, a QE test plan, or a testing guide for code changes.
---

## Name
generate-test-plan

## Synopsis
```text
/generate-test-plan <JIRA_KEY | PR_URL> [additional PR URLs...]
```

## Description
Generates a comprehensive manual testing guide by analyzing a Jira issue, one or more GitHub PRs, or both. Consolidates context from Jira acceptance criteria, PR diffs, commit messages, and changed files into actionable QE test scenarios.

## Implementation

### Step 1: Gather Sources

1. Parse arguments:
   - If `$1` matches a Jira key pattern (e.g. `OCPBUGS-12345`): call `jira_get_issue` to retrieve summary, description, and acceptance criteria.
   - If `$1` is a GitHub PR URL: extract owner, repo, and PR number.
   - Additional arguments: additional PR URLs.

2. Fetch PR details using `gh pr view`:
   ```bash
   gh pr view <PR_NUMBER> --repo <REPO> --json title,body,commits,files,labels
   ```

### Step 2: Analyze Implementation and Edge Cases

1. Identify component changes (API, CLI, controller, webhooks).
2. Map Jira acceptance criteria to test scenarios.
3. For bugs, derive test cases from reproduction steps.
4. Determine edge cases, regression risk areas, and platform variations (AWS, Azure, Baremetal).

### Step 3: Generate the Test Guide

**Filename**:
- Jira-based: `test-{jira-key-lowercase}.md` (e.g. `test-ocpbugs-12345.md`)
- PR-only: `test-pr-{number}.md`

**Document Structure**:
- **Summary**: Jira issue summary, PR links, overall objective.
- **Prerequisites**: Required tools, cluster configuration, permissions.
- **Test Scenarios**: Concrete, numbered test cases with:
  - Step-by-step CLI commands and manifests.
  - Expected outputs and verification checks.
  - Mapping to Jira acceptance criteria.
- **Regression Testing**: Related components and areas to verify.
- **Success Criteria**: Checklist matching acceptance criteria.
- **Troubleshooting**: Common failure modes and logs to collect.

### Step 4: Report

Display the path where the test guide was saved and summarize key test scenarios.

## Arguments
- `$1`: Jira issue key or GitHub PR URL (required)
- `$2 ... $N`: Additional GitHub PR URLs (optional)
