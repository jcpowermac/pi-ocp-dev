---
name: must-gather-analysis
description: Analyze OpenShift must-gather diagnostic data from local directories, tarballs, or remote Prow GCS build artifacts. Use when given a must-gather path/URL, asked to evaluate cluster health, triage degraded operators, investigate pod crashloops, analyze node conditions, or check etcd quorum.
---

# Must-Gather Diagnostic Analysis

## When to use

You need to diagnose cluster health issues, degraded operators, failing pods,
node pressures, etcd quorum loss, or investigate an OpenShift must-gather dump
(from a local directory, `.tar`/`.tar.gz` archive, or a remote Prow GCS build URL).

## Inputs

- Local must-gather folder path (e.g. `./must-gather.local.1234/` or root directory).
- Local archive path (`must-gather.tar`, `must-gather.tar.gz`).
- Remote Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) or GCS path.
- Optional component filter: `operators`, `pods`, `nodes`, `events`, `etcd`, `storage`, `network`, `version`.
- Optional namespace filter or item count.

## Workflow

1. Call `analyze_must_gather` with the `source` (and optional `component` or `namespace`).
   The tool deterministically extracts cluster version, health ratios, and
   flags critical issues in structured JSON.
2. If `critical_issues` and `candidate_references` are returned: read ONLY the
   listed `references/` files (relative to this skill directory, e.g.
   `references/cluster-operators.md`, `references/pods.md`).
   **Never read more than 2 reference files unless contradicted by the tool's evidence.**
3. Correlate issues across components:
   - Degraded ClusterOperator → check its namespace pods
   - Failing/CrashLooping pods → check hosting node conditions and events
   - NotReady nodes → check node pressure and kubelet conditions
   - etcd quorum loss → check etcd member connectivity and disk latency
4. Synthesize findings into a concise, actionable report.

## Output format

- `cluster_summary`: High-level cluster health (version, operator/node/pod/etcd ratios)
- `critical_issues[]`: Specific component failures with reasons and messages
- `root_cause`: One-paragraph synthesis identifying the underlying trigger
- `evidence[]`: ≤3 verbatim lines/messages from the tool output
- `confidence`: high / medium / low
- `next_steps[]`: Concrete remediation or follow-up actions (e.g. log inspection, node reboot, quota expansion)
