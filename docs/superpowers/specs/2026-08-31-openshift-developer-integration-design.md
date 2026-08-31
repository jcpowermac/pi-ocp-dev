# Design Document: Integrating openshift-developer into pi-ocp-dev

## 1. Overview and Goals

This design defines the architecture and implementation for integrating the functionality of `/home/jcallen/Development/ai-helpers/plugins/openshift-developer` into `pi-ocp-dev`.

### Core Goals
1. **Deterministic Execution**: Shift heavy data fetching, parsing, filtering, and authorization logic from LLM prompt steps to in-process TypeScript extension tools.
2. **Context Window Minimization**: Eliminate multi-thousand-line raw JSON dumps and build log flooding. Tools return bounded, pre-filtered structured summaries (saving 80–95% of LLM context).
3. **Zero Python Runtime Dependencies**: Replace standalone Python scripts with pure TypeScript implementations tested via Vitest.
4. **Full Workflow Coverage**: Support the complete OpenShift developer authoring and review lifecycle:
   - Pre-commit hook validation and automatic installation (`ensure_precommit`, `session_start` hook)
   - Jira issue analysis and grooming (`jira_get_issue`)
   - Pre-PR verification and pre-commit review resolution (`address-review-precommit`, `verify_repo`)
   - PR creation with Jira linkage (`create-pr`, `create_pr_helper`)
   - PR review gate check (`has-review-work`, `pr_review_status`)
   - Addressing PR reviewer feedback with authorization and deduplication (`address-review-pr`, `pr_review_comments`, `pr_post_reply`)
   - PR CI failure triage against git diffs with Prow log analysis (`address-ci-failures`, `triage_pr_ci_failures`, `post_ci_failure_report`)
   - Manual QE test plan generation (`generate-test-plan`)

---

## 2. Directory and Package Architecture

The `pi-ocp-dev` package will be organized into domain-specific modules under `extensions/`, alongside the skill suite in `skills/` and comprehensive unit tests in `test/`.

```
pi-ocp-dev/
├── package.json
├── tsconfig.json
├── extensions/
│   ├── index.ts                  # Main extension entrypoint: registers all tools, commands, hooks
│   ├── prow/                     # Periodic monitoring & Prow log analysis (existing)
│   │   ├── index.ts
│   │   ├── analyze.ts
│   │   ├── fetch.ts
│   │   ├── classify.ts
│   │   ├── command.ts
│   │   ├── failure.ts
│   │   ├── permafail.ts
│   │   └── run-analysis.ts
│   ├── pr/                       # PR review gate, comment fetching, deduplication & replies
│   │   ├── auth.ts               # OWNERS, OWNERS_ALIASES & Org membership authorization
│   │   ├── comments.ts           # Comment/thread fetcher, slash command filter, category parser
│   │   ├── reply.ts              # Bot-reply detection & deduplication, response poster
│   │   ├── verify.ts             # Repo verification command runner & bounded output summarizer
│   │   └── tools.ts              # Tool definitions: pr_review_status, pr_review_comments, pr_post_reply, verify_repo
│   ├── ci/                       # PR CI failure triage & classification
│   │   ├── optional.ts           # ProwJob optional check detector (prowjob.json / GCS label check)
│   │   ├── diff.ts               # Git base..head diff analysis & changed file/package extractor
│   │   ├── triage.ts             # Failure classifier (pr_caused, infra, pre_existing, flake, out_of_scope)
│   │   └── tools.ts              # Tool definitions: triage_pr_ci_failures, post_ci_failure_report
│   ├── jira/                     # Jira issue fetching, parsing, and grooming
│   │   ├── client.ts             # Jira REST API client (Basic auth & Bearer token support)
│   │   ├── parser.ts             # ADF / Markdown parser extracting summary, AC, repro steps
│   │   └── tools.ts              # Tool definitions: jira_get_issue, create_pr_helper
│   └── precommit/                # Pre-commit hook validation & installation
│       ├── validator.ts          # Whitelist validator for .pre-commit-config.yaml
│       ├── install.ts            # Pre-commit installer execution
│       └── hook.ts               # session_start event listener
├── skills/
│   ├── prow-job-analysis/        # Existing Prow run analysis skill
│   ├── has-review-work/          # PR gate: checks COMMENT_WORK & CI_WORK
│   ├── address-review-pr/        # Systematic review feedback resolver
│   ├── address-ci-failures/      # Triage and fix PR-caused CI failures
│   ├── address-review-precommit/ # Fix pre-commit findings before pushing
│   ├── create-pr/                # Create PR linked to Jira issue
│   ├── jira-solve/               # End-to-end Jira issue solver pipeline
│   └── generate-test-plan/       # Generate QE manual test plan
└── test/
    ├── prow/                     # Existing Prow tests
    ├── pr/                       # Auth, comments, replied, verify tests
    ├── ci/                       # Optional check detector, diff matcher, triage classifier tests
    ├── jira/                     # Jira REST client & AC extraction tests
    └── precommit/                # Precommit config validation tests
```

---

## 3. Detailed Component Specifications

### 3.1 Pre-Commit Module (`extensions/precommit/`)
- **`validator.ts`**: Parses `.pre-commit-config.yaml` using a simple YAML parser. Validates repos and hook IDs against `TRUSTED_REPOS`:
  - `https://github.com/pre-commit/pre-commit-hooks`: `['check-merge-conflict', 'check-yaml', 'trailing-whitespace']`
  - `https://github.com/leaktk/gitleaks`: all hooks
  - `repo: local`: always allowed
  - Untrusted repos/hooks are rejected with detailed error messages.
- **`install.ts`**: Checks if `pre-commit` binary is available, validates config via `validator.ts`, and runs `pre-commit install --hook-type pre-commit` and `pre-commit install --hook-type pre-push`.
- **`hook.ts`**: Subscribes to Pi's `session_start` event. Runs `install.ts` silently if `.pre-commit-config.yaml` exists, notifying user via `ctx.ui.notify` only on warning/error.

### 3.2 PR Review & Gate Module (`extensions/pr/`)
- **`auth.ts`**:
  - `isAuthorizedAuthor(owner, repo, login)`:
    1. Returns true for approved bots (`coderabbitai`, `coderabbitai[bot]`).
    2. Returns false for ignored automation accounts (`openshift-ci-robot`, `openshift-ci`, `openshift-merge-robot`, `openshift-bot`, and general unapproved bots).
    3. Fetches `OWNERS` and `OWNERS_ALIASES` via GitHub raw contents API. Parses approvers, reviewers, and filter mappings. Expands alias definitions.
    4. Fallback: Checks GitHub Organization membership via `gh api orgs/{owner}/members/{login}`.
    5. Caches results per repository/login. Fails closed (unauthorized) on network or API errors.
- **`comments.ts`**:
  - `isSlashCommandOnly(body)`: Regex-based check stripping HTML comments (`<!-- ... -->`) and testing if all non-empty lines match `^/[A-Za-z][A-Za-z0-9_-]*(?=$|\s)` (e.g. `/lgtm`, `/hold`, `/test e2e-aws`).
  - `fetchActionableComments(owner, repo, prNumber)`:
    - Fetches issue comments, reviews, and review comments with pagination.
    - Filters out unauthorized authors, slash-command-only comments, pure acknowledgments, and comments > 5000 chars.
    - Categorizes remaining comments into: `ACTION_INSTRUCTION`, `BLOCKING`, `CHANGE_REQUEST`, `QUESTION`, `SUGGESTION`.
- **`reply.ts`**:
  - `checkAlreadyReplied(owner, repo, prNumber, commentId, type)`:
    - Queries GraphQL `reviewThreads` or REST comments.
    - Checks for bot accounts or text signatures (`*AI-assisted response*`).
    - Returns `safe_to_reply: boolean`.
  - `postReply(owner, repo, prNumber, commentId, type, replyText)`:
    - Verifies `checkAlreadyReplied`.
    - Appends footer `---\n*AI-assisted response*`.
    - Posts via REST `pulls/{prNumber}/comments/{commentId}/replies` or `issues/{prNumber}/comments`.
- **`verify.ts`**:
  - `detectAndRunVerification(cwd)`:
    - Checks for `Makefile` with `verify` or `lint` target, `go.mod` (`go build ./...` && `go vet ./...`), or `package.json` (`npm run lint`).
    - Runs the command with a timeout.
    - Captures stdout/stderr, extracts failure lines/stack traces, caps output at 100 lines to preserve context window.
- **Tools**:
  - `pr_review_status`: Read-only gate returning `comment_work`, `ci_work`, `work`, and current actionable failures.
  - `pr_review_comments`: Fetches structured actionable comments with diff hunks.
  - `pr_post_reply`: Posts signed reply to a comment.
  - `verify_repo`: Runs repo verification commands and summarizes output.

### 3.3 PR CI Failure Triage Module (`extensions/ci/`)
- **`optional.ts`**:
  - `isOptionalCheck(link)`:
    - Extracts GCS path from Prow link (`https://prow.ci.openshift.org/view/gs/...` or `gcsweb`).
    - Fetches `prowjob.json` from GCS/gcsweb.
    - Checks `spec.optional === true` or label `prow.k8s.io/is-optional=true`.
    - Returns boolean.
- **`diff.ts`**:
  - `getPrDiffContext(repo, prNumber)`:
    - Fetches base branch and head SHA via `gh pr view`.
    - Diffs base..head to get changed file paths, directories, and Go packages.
- **`triage.ts`**:
  - `triagePrCiFailures(repo, prNumber, checks)`:
    - Runs `getPrDiffContext` and `optional.ts`.
    - For each failing check with a Prow URL, calls `analyzeProwRun(url)`.
    - Correlates failed test names, step failures, and compiler/linter error paths against the PR's changed files.
    - Classifies into `pr_caused`, `infrastructure`, `pre_existing`, `flake`, or `out_of_scope`.
    - Enforces TRT-2831 guardrails: optional jobs require slam-dunk diff overlap and no infra/flake signal to be marked `pr_caused`.
- **Tools**:
  - `triage_pr_ci_failures`: Returns structured triage verdict for all failing checks.
  - `post_ci_failure_report`: Posts the formatted non-actionable CI failure report to PR conversation.

### 3.4 Jira & PR Module (`extensions/jira/`)
- **`client.ts`**:
  - Authenticates via `JIRA_API_TOKEN` + `JIRA_USERNAME` (Basic Auth) or `JIRA_BEARER_TOKEN`.
  - Fetches Jira issue payload from `https://redhat.atlassian.net/rest/api/3/issue/{key}` or custom `JIRA_BASE_URL`.
- **`parser.ts`**:
  - Parses description (Atlassian Document Format or raw text/markdown).
  - Extracts structured fields: `summary`, `issueType`, `context`, `acceptanceCriteria`, `stepsToReproduce`, `linkedPrs`.
- **Tools**:
  - `jira_get_issue`: Returns groomed Jira issue data.
  - `create_pr_helper`: Generates PR title, body from `.github/PULL_REQUEST_TEMPLATE.md` and commit log, and executes `gh pr create`.

---

## 4. Skill Integrations

The 7 skills will be updated to orchestrate these deterministic tools:
1. `skills/has-review-work/SKILL.md`: Calls `pr_review_status` tool; emits 4-line summary for `--ci` mode.
2. `skills/address-review-pr/SKILL.md`: Calls `pr_review_comments`, applies edits, runs `verify_repo`, calls `pr_post_reply`, pushes branch.
3. `skills/address-ci-failures/SKILL.md`: Calls `triage_pr_ci_failures`; for `pr_caused` fixes code and runs `verify_repo`; for others calls `post_ci_failure_report`.
4. `skills/address-review-precommit/SKILL.md`: Applies pre-commit review feedback and iterates with `verify_repo`.
5. `skills/create-pr/SKILL.md`: Calls `create_pr_helper` with Jira issue key and branch info.
6. `skills/jira-solve/SKILL.md`: Calls `jira_get_issue`, plans solution in `.work/solve/`, makes changes, runs `verify_repo`, commits by component, pushes, and opens draft PR.
7. `skills/generate-test-plan/SKILL.md`: Fetches Jira issue via `jira_get_issue` and PR diffs, generating `test-<jira-key>.md`.

---

## 5. Error Handling and Security
- **Fail-Closed Authorization**: If `OWNERS` or org membership cannot be retrieved, the author is treated as unauthorized.
- **Untrusted Content Sanitization**: PR comments, issue descriptions, and build logs are treated as untrusted data. Tools extract structured strings and never execute embedded shell commands.
- **Safe Reply Posting**: Duplicate reply checks ensure the bot never replies multiple times to the same comment.
- **Pre-Commit Whitelist**: Only trusted repositories and local hooks are allowed in `.pre-commit-config.yaml`.

---

## 6. Testing Strategy
- **Unit Tests (`test/`)**:
  - `test/pr/auth.test.ts`: OWNERS parsing, alias expansion, org membership fallback, bot allowlist/blocklist.
  - `test/pr/comments.test.ts`: Slash-command regexes, comment categorization, size limits.
  - `test/pr/reply.test.ts`: Bot signature detection in comments and GraphQL threads.
  - `test/pr/verify.test.ts`: Build command detection and error log truncation.
  - `test/ci/optional.test.ts`: ProwJob optional check parsing and URL resolution.
  - `test/ci/triage.test.ts`: Classification rules across all TRT-2831 scenarios (CVEs, unit test failures, infra pod_pending, optional jobs).
  - `test/jira/parser.test.ts`: ADF and markdown Jira description parsing.
  - `test/precommit/validator.test.ts`: Whitelist checking for pre-commit configs.
- **Verification**:
  - `npm run typecheck` (tsc clean)
  - `npm test` (Vitest suites 100% passing)
