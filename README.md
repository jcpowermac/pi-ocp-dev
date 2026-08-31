# pi-ocp-dev

[pi](https://pi.dev) coding agent tools for OpenShift developers.

## Tools

| Tool | Purpose |
|------|---------|
| `prow_status` | Compact status report for OpenShift periodic CI jobs on public Prow (`prow.ci.openshift.org`): per-job latest state, 6-run sparkline (S/F/P/A/E), failure %, pass rates over 12/24/48h, last success age, and variant. Grouped by OCP version. EOL versions (< 4.12) are excluded. |
| `prow_job` | Detail for one periodic job: metrics plus the 10 most recent runs with state, start time, build id, and Prow URL. Accepts exact names or substrings; lists candidates on ambiguity. |
| `prow_build_log` | Tail of a build's `build-log.txt`, converted automatically from a Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) to the public GCS object. |
| `analyze_prow_run` | Deterministic first-pass analysis of one failed run: job types, failed e2e tests, failure signals with evidence lines, 1-3 candidate reference docs, and artifact paths — compact JSON, public GCS only. |
| `detect_permafail` | Permafail verdict for 2-10 consecutive failures of the same job (newest first): fetches each run's failure signature and applies per-type match thresholds (100% / 80% / 70%), returning `permafail`, `failure_type`, `match_ratio`, and `confidence`. |

`prow_status` requires at least one of `platforms` or `version` (or an explicit
`all: true`) so the agent does not dump every periodic job by accident.

Typical agent workflow: `prow_status` (find failing jobs) → `prow_job`
(recent runs + URLs) → `prow_build_log` (root-cause triage).
For a failing run, `analyze_prow_run` gives a deterministic first pass and
`detect_permafail` decides whether a failure streak is systematic or flaky.

## Slash command

The extension also registers `/prow`, which relays a crafted prompt to the agent
so it runs the matching tool and reasons about the result:

```
/prow vsphere 4.18                    → prow_status (platforms + version)
/prow aws gcp                         → prow_status (platforms only)
/prow job periodic-ci-openshift-...   → prow_job detail
/prow log https://prow.ci.../view/gs/ → prow_build_log + failure triage
/prow analyze <prow-deck-url>         → analyze_prow_run first-pass run analysis
/prow permafail <url> [url ...]       → detect_permafail verdict (2-10 urls, newest first)
/prow                                 → usage hint (no LLM)
```

`prow_status` and `prow_job` read `prowjobs.js` with a 30-minute disk cache
under `~/.cache/pi-ocp-dev/` (override with `PI_OCP_DEV_CACHE_DIR`); pass
`refresh: true` to bypass, or `file: <path>` to analyze a local
`prowjobs.json` instead of fetching. `prow_build_log`, `analyze_prow_run`, and
`detect_permafail` fetch straight from public GCS.

## Run analysis: skill and subagent

The package also ships a thin `prow-job-analysis` skill and a `prow-analyst`
subagent (`agents/prow-analyst.md`). The skill routes analysis through the two
deterministic tools and then reads at most 2 of the vendored reference docs
under `skills/prow-job-analysis/references/`; dispatch `prow-analyst` (prefer
async) for deep dives so the parent session stays clean.

How it keeps context small: the upstream failure-mode knowledge base is ~443 KB
of markdown. Here it stays on disk and loads lazily — per run, the session sees
≤4 KB of structured tool output plus at most 2 reference docs, instead of the
whole runbook.

## Install

```bash
pi install git:github.com/jcpowermac/pi-ocp-dev
```

(Installs the default branch; run `pi update --extensions` after pushing
changes. Pin a ref with `@<commit-or-tag>` if you ever want a stable version.)

or a local path while developing:

```bash
pi install /path/to/pi-ocp-dev
```

Verify the tools are active:

```bash
pi -p "call prow_status with platforms ['vsphere'] and show the report"
```

## Development

```bash
npm install        # dev deps include vitest + pi packages for typechecking
npm test           # vitest
npx tsc --noEmit   # typecheck
```

Layout:

```
extensions/prow/
├── index.ts        # registers the Prow tools
├── fetch.ts        # prowjobs.js fetch + disk cache, build-log URL derivation/tail
├── analyze.ts      # filtering, aggregation, metrics, compact report rendering
├── command.ts      # /prow slash command parsing + prompt building
├── failure.ts      # job-type classification + failure-signal scanning
├── classify.ts     # GCS artifact fetch, JUnit parsing, failure signatures
├── permafail.ts    # permafail threshold engine (per-type match thresholds)
└── run-analysis.ts # analyze_prow_run / detect_permafail pipelines
skills/prow-job-analysis/
├── SKILL.md     # thin router (analyze_prow_run → ≤2 references → verdict)
└── references/  # 15 vendored failure-mode docs, lazy-loaded
agents/prow-analyst.md  # deep-dive subagent
```

`test/` covers the tools and their pure logic (`failure`, `classify`,
`permafail`, `run-analysis`, `command`).

## License

Apache-2.0
