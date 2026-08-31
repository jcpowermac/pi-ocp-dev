---
name: prow-job-analysis
description: Analyze why an OpenShift CI Prow job run failed. Use when given a Prow deck URL (prow.ci.openshift.org/view/gs/...), a test-platform-results gcs path, asked to triage a failing run, or asked "which reference" applies. For 2-10 consecutive failing runs of the same job, also yields a permafail verdict.
---

# Prow Job Analysis

## When to use

You need the root cause of a failed OpenShift CI Prow run, or a permafail
verdict for a streak of consecutive failures of the same job.

## Inputs

- One Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) or a
  `test-platform-results` GCS path — single-run analysis.
- 2-10 Prow deck URLs of consecutive failures of the **same job**, newest
  first, plus the job name — permafail analysis.

## Workflow

1. Call `analyze_prow_run` with the URL. It returns job types, failed tests,
   failure signals with evidence lines, 1-3 candidate reference docs, and
   artifact paths.
2. Read ONLY the listed `references/` files (relative to this skill
   directory, e.g. `references/upgrade.md`). **Never read more than 2
   reference files unless their content is contradicted by the tool's
   evidence.**
3. For ≥2 consecutive failing runs of the same job, call `detect_permafail`
   with all URLs (newest first) and the job name.
4. Synthesize the root cause from the evidence lines plus the reference(s).

## Output format

- `failure_class` — the matched failure signal / reference area
- `root_cause` — one-paragraph synthesis
- `evidence` — ≤3 verbatim lines from the run
- `confidence` — high / medium / low
- `next_steps[]` — concrete follow-ups (e.g. artifacts to fetch, Jira triage)
