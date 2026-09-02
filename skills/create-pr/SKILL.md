---
name: create-pr
description: Create a pull request from the current branch for a Jira issue. Use when changes are committed and pushed and the user wants to open a PR linking back to a Jira issue.
---

## Name
create-pr

## Synopsis
```text
/create-pr <ISSUE_KEY> [--upstream <owner/repo>] [--head <fork-owner>:<branch>] [--draft]
```

## Description
Creates a pull request from the current feature branch, linking it to a Jira issue. Uses the `create_pr_helper` tool to automatically read the repository PR template, inspect commit logs, format the PR title as `<ISSUE_KEY>: <summary>`, and add the Jira issue link and disclaimer footer.

## Implementation

### Step 1: Parse Arguments

- `$1`: Jira issue key (required, e.g. `OCPBUGS-12345`)
- `--upstream`: Target repository in `owner/repo` format (optional)
- `--head`: PR head ref in `fork:branch` format (optional)
- `--draft`: Create PR as draft (optional)

### Step 2: Extract Summary from Commits

Inspect local branch commits relative to base branch:

```bash
git log -1 --format="%s"
```

Extract a clean summary sentence.

### Step 3: Invoke `create_pr_helper`

Call the deterministic `create_pr_helper` tool:

```json
{
  "issueKey": "OCPBUGS-12345",
  "summary": "Fix nil pointer in cluster controller",
  "upstream": "openshift/hypershift",
  "head": "myfork:fix-OCPBUGS-12345",
  "draft": true
}
```

The tool:
- Reads `.github/PULL_REQUEST_TEMPLATE.md` if present.
- Formats title `<ISSUE_KEY>: <summary>`.
- Appends Jira link `https://redhat.atlassian.net/browse/<ISSUE_KEY>` and the AI-assisted response footer.
- Executes `gh pr create` and returns the PR URL.

### Step 4: Report PR URL

Print the created PR URL.

## Arguments
- `$1`: Jira issue key (required)
- `--upstream`: Target repository in `owner/repo` format (optional)
- `--head`: Head branch ref (optional)
- `--draft`: Open as draft pull request (optional)
