# pi-ocp-dev

[pi](https://pi.dev) coding agent tools for OpenShift developers.

## Tools

| Tool | Purpose |
|------|---------|
| `prow_status` | Compact status report for OpenShift periodic CI jobs on public Prow (`prow.ci.openshift.org`): per-job latest state, 6-run sparkline (S/F/P/A/E), failure %, pass rates over 12/24/48h, last success age, and variant. Grouped by OCP version. EOL versions (< 4.12) are excluded. |
| `prow_job` | Detail for one periodic job: metrics plus the 10 most recent runs with state, start time, build id, and Prow URL. Accepts exact names or substrings; lists candidates on ambiguity. |
| `prow_build_log` | Tail of a build's `build-log.txt`, converted automatically from a Prow deck URL (`https://prow.ci.openshift.org/view/gs/...`) to the public GCS object. |

`prow_status` requires at least one of `platforms` or `version` (or an explicit
`all: true`) so the agent does not dump every periodic job by accident.

Typical agent workflow: `prow_status` (find failing jobs) → `prow_job`
(recent runs + URLs) → `prow_build_log` (root-cause triage).

## Slash command

The extension also registers `/prow`, which relays a crafted prompt to the agent
so it runs the matching tool and reasons about the result:

```
/prow vsphere 4.18                    → prow_status (platforms + version)
/prow aws gcp                         → prow_status (platforms only)
/prow job periodic-ci-openshift-...   → prow_job detail
/prow log https://prow.ci.../view/gs/ → prow_build_log + failure triage
/prow                                 → usage hint (no LLM)
```

All three tools read `prowjobs.js` with a 30-minute disk cache under
`~/.cache/pi-ocp-dev/` (override with `PI_OCP_DEV_CACHE_DIR`); pass
`refresh: true` to bypass, or `file: <path>` to analyze a local
`prowjobs.json` instead of fetching.

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
├── index.ts     # registers the three tools
├── fetch.ts     # prowjobs.js fetch + disk cache, build-log URL derivation/tail
└── analyze.ts   # filtering, aggregation, metrics, compact report rendering
test/
├── analyze.test.ts
└── fetch.test.ts
```

## License

Apache-2.0
