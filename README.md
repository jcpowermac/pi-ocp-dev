# pi-ocp-dev

[pi](https://pi.dev) coding agent tools and skills for OpenShift developers.

`pi-ocp-dev` provides a complete suite of deterministic tools, lifecycle hooks, and skills designed to accelerate OpenShift development workflows while keeping LLM context window usage minimal.

---

## Tool Catalog

### Prow CI Inspection & Analysis (`extensions/prow/`)

| Tool | Purpose |
|------|---------|
| `prow_status` | Compact status report for OpenShift periodic CI jobs on public Prow (`prow.ci.openshift.org`): per-job latest state, 6-run sparkline (S/F/P/A/E), failure %, pass rates over 12/24/48h, last success age, and variant. Grouped by OCP version. EOL versions (< 4.12) are excluded. |
| `prow_job` | Detail for one periodic job: metrics plus the 10 most recent runs with state, start time, build id, and Prow URL. Accepts exact names or substrings; lists candidates on ambiguity. |
| `prow_build_log` | Tail of a build's `build-log.txt`, converted automatically from a Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) to the public GCS object. |
| `analyze_prow_run` | Deterministic first-pass analysis of one failed run: job types, failed e2e tests, failure signals with evidence lines, candidate reference docs, and artifact paths — compact JSON, public GCS only. |
| `detect_permafail` | Permafail verdict for 2-10 consecutive failures of the same job (newest first): fetches each run's failure signature and applies per-type match thresholds (100% / 80% / 70%), returning `permafail`, `failure_type`, `match_ratio`, and `confidence`. |

### PR Review & Gate Tools (`extensions/pr/`)

| Tool | Purpose |
|------|---------|
| `pr_review_status` | Deterministic gate check: evaluates whether a PR has actionable unanswered review comments from authorized authors or new non-optional CI failures (`comment_work`, `ci_work`, `work`). |
| `pr_review_comments` | Fetches authorized, unanswered review comments categorized by priority (`ACTION_INSTRUCTION`, `BLOCKING`, `CHANGE_REQUEST`, `QUESTION`, `SUGGESTION`) with trimmed diff hunks. |
| `pr_post_reply` | Safely posts an AI-assisted reply (`---\n*AI-assisted response*`) to a review comment or issue comment, with duplicate reply prevention. |
| `verify_repo` | Detects and executes repo verification commands (`make verify`, `make lint`, `go test ./...`, `npm test`), capturing and truncating output to preserve context. |

### PR CI Failure Triage Tools (`extensions/ci/`)

| Tool | Purpose |
|------|---------|
| `triage_pr_ci_failures` | Correlates failing PR checks with git diff context and `analyze_prow_run` to classify failures into `pr_caused`, `infrastructure`, `pre_existing`, `flake`, or `out_of_scope`. Detects optional Prow jobs via `prowjob.json`. |
| `post_ci_failure_report` | Posts a structured report to the PR conversation explaining non-actionable CI failures with evidence and next steps. |

### Jira & PR Creation Tools (`extensions/jira/`)

| Tool | Purpose |
|------|---------|
| `jira_get_issue` | Fetches Jira issue details via REST API, parsing summary, issue type, context, acceptance criteria, and reproduction steps into structured fields. |
| `create_pr_helper` | Formats PR title (`<ISSUE_KEY>: <summary>`), populates body from `.github/PULL_REQUEST_TEMPLATE.md` and commit log, and executes `gh pr create`. |

---

## Slash Commands

### `/prow`
Relays a structured prompt to the agent to inspect or analyze Prow jobs:

```
/prow vsphere 4.18                    → prow_status (platforms + version)
/prow aws gcp                         → prow_status (platforms only)
/prow job periodic-ci-openshift-...   → prow_job detail
/prow log https://prow.ci.../view/gs/ → prow_build_log + failure triage
/prow analyze <prow-deck-url>         → analyze_prow_run first-pass run analysis
/prow permafail <url> [url ...]       → detect_permafail verdict (2-10 urls, newest first)
/prow                                 → usage hint (no LLM)
```

---

## Skill Catalog

| Skill | Purpose |
|-------|---------|
| `prow-job-analysis` | Deterministic triage of Prow job failures via `analyze_prow_run` and lazy-loaded reference docs under `skills/prow-job-analysis/references/`. |
| `has-review-work` | Read-only gate check: decides if a PR has unanswered authorized comments (`COMMENT_WORK`) or new required CI failures (`CI_WORK`). Supports `--ci` machine-readable output. |
| `address-review-pr` | Fetches, prioritizes, and resolves PR review feedback, making code changes, verifying locally with `verify_repo`, replying via `pr_post_reply`, and pushing. |
| `address-ci-failures` | Triages failing CI checks using `triage_pr_ci_failures`. Fixes only PR-caused failures on required jobs; reports infra, flake, and pre-existing issues via `post_ci_failure_report`. |
| `address-review-precommit` | Applies pre-commit code review findings to the current branch, iteratively verifying with `verify_repo` before committing and pushing. |
| `create-pr` | Creates a pull request from the current branch linked to a Jira issue key (`create_pr_helper`). |
| `jira-solve` | End-to-end Jira issue solver: fetches issue details with `jira_get_issue`, plans solution in `.work/solve/`, implements changes, verifies, commits by component, pushes, and creates draft PR. |
| `generate-test-plan` | Analyzes Jira acceptance criteria and PR diffs to generate a structured manual QE testing guide (`test-<key>.md`). |

---

## Lifecycle Hooks

### Pre-Commit Session Start Hook (`extensions/precommit/`)
- Automatically triggers on Pi's `session_start` event.
- If `.pre-commit-config.yaml` is present in the workspace, it validates repository URLs against a trusted whitelist (`pre-commit-hooks`, `gitleaks`, `local` hooks).
- If valid, installs pre-commit and pre-push git hooks silently via `pre-commit install`.
- Notifies the user via UI notifications if untrusted repositories or missing prerequisites are detected.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JIRA_API_TOKEN` | Atlassian API token for Jira Cloud REST API. | None |
| `JIRA_USERNAME` | Jira username/email used alongside `JIRA_API_TOKEN` for Basic authentication. | None |
| `JIRA_BEARER_TOKEN` | Bearer token for Jira instances using personal access tokens (PAT). | None |
| `JIRA_BASE_URL` | Base URL of the Jira instance. | `https://redhat.atlassian.net` |
| `PI_OCP_DEV_CACHE_DIR` | Directory for caching Prow periodic job definitions. | `~/.cache/pi-ocp-dev/` |

---

## Installation

Install via Pi CLI:

```bash
pi install git:github.com/jcpowermac/pi-ocp-dev
```

Or install from a local checkout during development:

```bash
pi install /path/to/pi-ocp-dev
```

---

## Development & Testing

```bash
npm install        # Install dev dependencies
npm test           # Run Vitest test suites
npm run typecheck  # Run TypeScript typechecker (tsc --noEmit)
```

Directory structure:

```
extensions/
├── index.ts        # Main entrypoint registering all tools, commands, and hooks
├── prow/           # Prow periodic status, build logs, and deterministic run analysis
├── pr/             # OWNERS auth, comment parsing, reply posting, repo verify
├── ci/             # Optional job detection, PR diff context, CI failure triage
├── jira/           # Jira REST client, issue parser, PR creator helper
└── precommit/      # Pre-commit config validation and session_start hook
skills/
├── prow-job-analysis/
├── has-review-work/
├── address-review-pr/
├── address-ci-failures/
├── address-review-precommit/
├── create-pr/
├── jira-solve/
└── generate-test-plan/
agents/
└── prow-analyst.md # Specialized subagent for Prow failure analysis
test/               # Comprehensive Vitest test suites for all modules
```

---

## License

Apache-2.0
