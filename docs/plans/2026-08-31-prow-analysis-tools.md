# Plan: Prow run analysis + permafail detection (tools, skill, subagent)

Spec: approved in-chat design, session 2026-08-31 (bounded brainstorming).
Source of truth for behavior: `github.com/openshift-eng/ai-helpers` `plugins/ci`
(local clone at `/tmp/ai-helpers`), skills `prow-job-analysis` and `detect-permafail`,
script `scripts/classify-job-failures.py`.

## Context

pi-ocp-dev is a pi extension exposing `prow_status`, `prow_job`, `prow_build_log`
plus a `/prow` command (`extensions/prow/`). This plan adds two deterministic
tools distilled from the ai-helpers CI plugin, one thinned skill with lazy-loaded
references, and one `prow-analyst` subagent definition. Goal: the failure-mode
knowledge base (443 KB of markdown upstream) never loads wholesale; tools return
≤4 KB of structured signal and the agent reads only 1-2 references.

## Global Constraints

- TypeScript ESM, Node built-ins only (no new npm dependencies). Existing dev
  deps: vitest, typescript.
- Imports of local modules use `.js` extensions (repo tsconfig is NodeNext).
- All network I/O goes through an injectable fetch function
  (`(url: string) => Promise<{ status: number; body: string }>`) defaulting to
  `globalThis.fetch`, so tests run fully offline.
- Tool text output must be compact (target ≤4 KB) and deterministic for a given
  input (no timestamps in output except data fetched verbatim).
- Follow existing extension style: `defineTool` + `Type` schema in `index.ts`,
  `text(t, details)` result helper, `file`/`refresh`-style escape hatches where
  they already exist.
- TDD is mandatory for every task: failing test first, watch it fail for the
  right reason, minimal code, all tests green, commit. Test command:
  `npx vitest run test/<file>`.
- Public GCS only: `https://storage.googleapis.com/test-platform-results/...`
  and the GCS JSON listing API. No gcsweb HTML scraping.

## Interface contracts (binding for later tasks)

`RunSignature` (produced by Task 2, consumed by Task 3):
```ts
interface RunSignature {
  buildId: string;
  failureType: "test_failure" | "infra_failure" | "success";
  tests: string[];   // failed test names (test_failure only)
  errors: { message: string; hash: string }[]; // normalized infra errors (infra_failure only)
}
```
`PermafailVerdict` (Task 3 output, matches upstream verdict fields):
```ts
interface PermafailVerdict {
  permafail: boolean;
  failure_type: "test_failure" | "infra_failure" | "mixed";
  match_ratio: string;        // "7/10"
  matching_runs: number;
  comparable_runs: number;
  threshold_required: number;
  confidence: number;         // 0.99 / 0.92 / 0.85 / 0.88 / 0.70
  reason: string;             // slash-form ratios, e.g. "7/10 test_failure runs failed TestNetworkPolicy"
}
```

## Tasks

### Task 1 — `extensions/prow/failure.ts`: job types + signal scanner (pure)

No network. Three exported functions, each unit-tested:

1. `classifyJobTypes(jobName: string): string[]` — upstream name-pattern table:
   `upgrade`; `metal`|`baremetal`; `hypershift`; `fips`; `ipv6`|`dualstack`;
   `single-node`|`sno`; `aggregated-` prefix; `aws`|`gcp`|`azure`; `techpreview`;
   `rhcos9`|`rhcos10`|`rhcos9_10`|`rt`.
2. `scanFailureSignals(input: { failedTests: string[]; buildLogLines: string[]; jobName: string }): Signal[]`
   where `Signal = { name: string; evidence: string[] }` (evidence ≤3 lines,
   200 chars each). Signal names and heuristics (one row each from the upstream
   routing table): `install` (failed test/step `install should succeed` or
   build log install-stage error), `install-metal` (install + metal job type),
   `test-failure` (any failed test), `flaky` (alias routing: test failure is
   the flaky-identification entry), `test-extension` (`*-tests-ext` / OTE binary
   errors in logs), `disruption` (disruption interval/timeline markers),
   `upgrade` (CVO stuck / MCO drain/reboot / version skew markers + upgrade
   job type), `hypershift`, `aggregated`, `cloud-provider` (quota/throttle/
   provisioning API errors), `resource-exhaustion` (OOM, NotReady, disk
   pressure, unschedulable, PID), `networking` (DNS, OVN, image pull,
   registry, ingress), `os-changes` (cri-o/crun, kernel panic,
   NetworkManager, SELinux, RHCOS bump), `ci-infrastructure` (lease/quota,
   ci-operator, step-registry, Prow infra markers).
3. `candidateReferences(jobTypes: string[], signals: Signal[]): string[]` —
   ordered 1-3 reference doc paths (e.g. `references/upgrade.md`) from the
   routing table; `references/flaky-test-identification.md` first whenever a
   plain test failed; install signals select `references/install/general.md`
   (+ `install/metal.md` for metal); no signals → `["references/artifacts.md"]`.

Tests: `test/failure.test.ts`, synthetic inputs per table row + compound
cases (metal+install, upgrade+CVO-stuck).

### Task 2 — `extensions/prow/classify.ts`: artifact fetch + signature extraction

Port of `classify-job-failures.py` logic (public GCS, no gcsweb):

- `prowUrlToGcsPath(url)` — accepts `https://prow.ci.openshift.org/view/gs/
  <bucket>/<path>/<job>/<build-id>` or a raw `gs://`/bucket path; returns
  `{ bucket, path, buildId, jobName }`.
- `fetchRunSignature(bucketPath: string, opts: { fetcher?: Fetcher }):
  Promise<RunSignature>` — lists `artifacts/**/junit*.xml` via the GCS JSON
  API, fetches `build-log.txt` (tail), parses JUnit XML for failed tests
  (`<testcase>` with `<failure>`/`<error>`), classifies the run:
  infra step failure if the failing step/target matches the infra prefixes
  (`ipi-install`, `gather-`, `pull-ci-`) with no test failures; otherwise
  test_failure with failed test names; `success` when nothing failed.
  ANSI escapes stripped from all extracted messages; error messages
  normalized (trim, collapse whitespace, truncate 300 chars) and hashed
  (sha256 hex).
- `groupErrors(errors: {message:string;hash:string}[]): groups` — exact hash
  match or >70% token-level similarity (port the python similarity rule).

Tests: `test/classify.test.ts` with offline fixtures (small JUnit XML strings,
build-log lines) and an injected fake fetcher; cover: test run with 2 failed
tests, infra run (ipi-install failure, no junit), success run, ANSI stripping,
URL parsing (view/gs and pr-logs variants).

### Task 3 — `extensions/prow/permafail.ts`: threshold engine (pure)

- `detectPermafail(signatures: RunSignature[]): PermafailVerdict`
  implementing the upstream logic verbatim:
  - Thresholds on N = count of comparable runs per type: N=2-3 → 100%;
    N=4-5 → ≥4; N=6-10 → ceil(N×0.7).
  - Test failures: strongest test name ratio across test_failure runs; any
    test meeting threshold → permafail.
  - Infra failures: strongest error-group ratio (hash match / >70% similarity
    via Task 2 `groupErrors`); threshold applies to N = total infra count.
  - Mixed: each group independent; either meeting threshold → permafail with
    the triggering `failure_type`; neither + both types present →
    `permafail: false`, `failure_type: "mixed"`.
  - Confidence: 0.99 all runs identical; 0.92 threshold exceeded; 0.85 exact
    threshold (test) / 0.88 with >70%-similarity infra; 0.70 clear
    non-permafail. `reason` includes slash-form ratios.
- `validatePermafailInputs(urls, jobName)` — 2-10 URLs, Prow URL pattern,
  job name non-empty (mirrors upstream Step 1 validation).

Tests: `test/permafail.test.ts` seeded from the six upstream eval cases in
`/tmp/ai-helpers/plugins/ci/evals/cases/detect-permafail/` (case-001..006
input/annotation pairs) plus threshold-boundary cases (N=3 all-match, N=5
3/5-not-4, N=6 4/6, N=7 5/7, mixed both-meet and mixed neither).

### Task 4 — tools + command wiring

- `index.ts`: register `analyze_prow_run` (param `url`) → runs
  `prowUrlToGcsPath` → `classifyJobTypes` → `fetchRunSignature`-style fetch of
  build-log tail + junit list (reuse Task 2 fetchers) → `scanFailureSignals` →
  `candidateReferences`; returns compact JSON: `job_name`, `build_id`,
  `job_types`, `failed_tests[]`, `signals[]` (name + ≤3 evidence lines),
  `candidate_references[]`, `artifact_paths[]` (build-log, junit dir,
  gather-extra, audit_logs).
- `index.ts`: register `detect_permafail` (params `urls[]`, `job_name`,
  `pr_info?`) → validate → fetch one signature per URL (sequential, bounded) →
  `detectPermafail` → verdict JSON text.
- `command.ts`: `/prow analyze <url>` and `/prow permafail <urls...>` relay
  prompts instructing the exact tool call (LLM path), usage hint for no args.
- Tests: `test/command.test.ts` additions for the two new subcommands; tool
  execute paths covered with injected fetcher where feasible.

### Task 5 — skill, subagent, docs

- `skills/prow-job-analysis/SKILL.md` — thin router (~2 KB): frontmatter
  (name, description with trigger phrases), when to use, input formats
  (Prow deck URL / gs path), workflow: call `analyze_prow_run` → read only the
  listed `references/` files relative to this skill dir → synthesize root cause
  → output format (failure_class, root_cause, evidence, confidence,
  next_steps). Explicit rule: never read more than 2 reference files unless
  the first are contradicted by evidence.
- `skills/prow-job-analysis/references/` — vendor the 15 upstream reference
  docs verbatim from `/tmp/ai-helpers/plugins/ci/skills/prow-job-analysis/
  references/` (install/general.md, install/metal.md, flaky-test-identification.md,
  test-failure.md, test-extension-binaries.md, disruption.md, upgrade.md,
  hypershift.md, aggregated.md, cloud-provider-errors.md, resource-exhaustion.md,
  networking.md, operating-system-changes.md, ci-infrastructure-changes.md,
  artifacts.md). Add attribution header line + note that paths in the docs are
  relative to this references dir.
- `agents/prow-analyst.md` — pi-subagents custom agent definition (format per
  pi-subagents management/authoring reference): takes one or more Prow URLs,
  runs `analyze_prow_run` (and `detect_permafail` for ≥2 runs) itself, reads
  only candidate references, returns the structured verdict. Recommended
  usage: dispatch async for deep analysis so the parent session stays clean.
- `README.md` — add the two tools to the tool table, the new `/prow`
  subcommands, the skill + subagent, and a one-paragraph "how it keeps context
  small" note.

## Out of scope

Sippy-backed skills, trigger-*/revert-* commands, other ai-helpers skills,
fan-out batch subagent orchestration, gcsweb access.
