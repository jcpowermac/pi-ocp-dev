/**
 * Prow job analysis: filter periodic job runs, aggregate metrics, and
 * render compact, token-minimal summaries for LLM consumption.
 *
 * Ported from vsphere-prow-summary/vsphere_monitor/analyzer.py.
 */

// Minimum OCP version to include in results. Anything older is EOL.
const MIN_OCP_VERSION = "4.12";

export interface JobRun {
  job: string;
  state: string;
  startTime: Date;
  completionTime?: Date;
  url: string;
  buildId: string;
}

const SPARKLINE_MAP: Record<string, string> = {
  success: "S",
  failure: "F",
  pending: "P",
  aborted: "A",
  error: "E",
  triggered: "T",
};

const RECENT_STATES = 6;

export class JobSummary {
  job: string;
  ocpVersion: string;
  jobVariant: string;
  instance: string;
  runs: JobRun[];

  constructor(init: {
    job: string;
    ocpVersion: string;
    jobVariant: string;
    instance?: string;
    runs: JobRun[];
  }) {
    this.job = init.job;
    this.ocpVersion = init.ocpVersion;
    this.jobVariant = init.jobVariant;
    this.instance = init.instance ?? "";
    this.runs = init.runs;
  }

  get latestRun(): JobRun {
    return this.runs[0];
  }

  get latestState(): string {
    return this.latestRun.state;
  }

  get latestUrl(): string {
    return this.latestRun.url;
  }

  get totalRuns(): number {
    return this.runs.length;
  }

  get failureCount(): number {
    return this.runs.filter((r) => r.state === "failure").length;
  }

  get passCount(): number {
    return this.runs.filter((r) => r.state === "success").length;
  }

  get failureRate(): number {
    return this.runs.length ? this.failureCount / this.totalRuns : 0;
  }

  get passRate(): number {
    return this.runs.length ? this.passCount / this.totalRuns : 0;
  }

  runsSince(hours: number): JobRun[] {
    const cutoff = Date.now() - hours * 3600_000;
    return this.runs.filter((r) => r.startTime.getTime() >= cutoff);
  }

  /** Pass rate over the last `hours` hours; null when no runs in window. */
  passRateHours(hours: number): number | null {
    const window = this.runsSince(hours);
    if (!window.length) return null;
    return window.filter((r) => r.state === "success").length / window.length;
  }

  /** Failure rate over the last `hours` hours; null when no runs in window. */
  failureRateHours(hours: number): number | null {
    const window = this.runsSince(hours);
    if (!window.length) return null;
    return window.filter((r) => r.state === "failure").length / window.length;
  }

  lastSuccess(): Date | null {
    for (const r of this.runs) {
      if (r.state === "success") return r.startTime;
    }
    return null;
  }

  /** Human-readable age of the last successful run, or "never". */
  lastSuccessAge(): string {
    const ls = this.lastSuccess();
    if (!ls) return "never";
    const seconds = (Date.now() - ls.getTime()) / 1000;
    const hours = seconds / 3600;
    if (hours < 1) return `${Math.floor(seconds / 60)}m ago`;
    if (hours < 48) return `${Math.floor(hours)}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  /** Human-readable start time of the latest run, e.g. "Feb 25 14:30". */
  latestStartDisplay(): string {
    const d = this.latestRun.startTime;
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  /** Duration of the latest run as HH:MM:SS, or "--:--:--" if still running. */
  latestDuration(): string {
    const run = this.latestRun;
    if (!run.completionTime) return "--:--:--";
    let total = Math.floor((run.completionTime.getTime() - run.startTime.getTime()) / 1000);
    if (total < 0) total = 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  /** Last N run states, most recent first. */
  recentStates(): string[] {
    return this.runs.slice(0, RECENT_STATES).map((r) => r.state);
  }

  /** Compact visual of recent states: S=success, F=failure, P=pending, ... */
  stateSparkline(): string {
    return this.recentStates()
      .map((s) => SPARKLINE_MAP[s] ?? "?")
      .join("");
  }
}

// ---------------------------------------------------------------------------
// Job-name parsing
// ---------------------------------------------------------------------------

const VERSION_RE = /(?:^|-)(\d+\.\d+)(?:-|$)/g;

/** Extract the OCP version (e.g. "4.18") from a job name.
 * For upgrade jobs the target version is typically the last one. */
export function extractOcpVersion(jobName: string): string {
  const matches = [...jobName.matchAll(VERSION_RE)].map((m) => m[1]);
  if (!matches.length) return "unknown";
  return matches[matches.length - 1];
}

/** Extract a short variant description from a job name. */
export function extractVariant(jobName: string): string {
  let name = jobName;
  for (const prefix of [
    "periodic-ci-openshift-release-main-",
    "periodic-ci-openshift-",
    "openshift-",
    "release-",
  ]) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  if (name.includes("upgrade")) return "upgrade";
  if (name.includes("serial") && name.includes("techpreview")) return "tp-serial";
  if (name.includes("techpreview")) return "techpreview";
  if (name.includes("serial")) return "serial";
  if (name.includes("upi")) return "upi";
  if (name.includes("static")) return "static";
  if (name.includes("csi")) return "csi";
  if (name.includes("zones")) return "zones";
  if (name.includes("assisted")) return "assisted";
  if (name.includes("operator")) return "operator";
  if (name.includes("prfinder")) return "prfinder";
  return "e2e";
}

// ---------------------------------------------------------------------------
// Filtering and aggregation
// ---------------------------------------------------------------------------

function parseTime(ts: string | null | undefined): Date | undefined {
  if (!ts) return undefined;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Filter raw prow data to periodic job runs matching the given platforms.
 * Each platform string is matched case-insensitively against the job name;
 * a job matches if its name contains ANY of the platform strings.
 * When `platforms` is null/undefined/empty, all periodic jobs are returned.
 */
export function extractPeriodicJobs(
  raw: { items: unknown[] },
  platforms?: string[] | null,
): JobRun[] {
  const runs: JobRun[] = [];
  const matchPlatforms = (platforms ?? []).map((p) => p.toLowerCase());

  for (const item of raw.items) {
    const entry = item as { spec?: Record<string, unknown>; status?: Record<string, unknown> };
    const spec = entry.spec ?? {};
    if (spec.type !== "periodic") continue;
    const jobName = (spec.job as string) ?? "";

    if (matchPlatforms.length) {
      const lower = jobName.toLowerCase();
      if (!matchPlatforms.some((p) => lower.includes(p))) continue;
    }

    const version = extractOcpVersion(jobName);
    if (version !== "unknown" && version < MIN_OCP_VERSION) continue;

    const status = entry.status ?? {};
    const start = parseTime(status.startTime as string | undefined);
    if (!start) continue;

    runs.push({
      job: jobName,
      state: (status.state as string) ?? "unknown",
      startTime: start,
      completionTime: parseTime(status.completionTime as string | undefined),
      url: (status.url as string) ?? "",
      buildId: (status.build_id as string) ?? "",
    });
  }

  return runs;
}

/** Group runs by job name and compute per-job summaries (runs most-recent-first). */
export function aggregate(runs: JobRun[], instance = ""): JobSummary[] {
  const byJob = new Map<string, JobRun[]>();
  for (const run of runs) {
    const list = byJob.get(run.job);
    if (list) list.push(run);
    else byJob.set(run.job, [run]);
  }

  const summaries: JobSummary[] = [];
  for (const [jobName, jobRuns] of [...byJob.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    jobRuns.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    summaries.push(
      new JobSummary({
        job: jobName,
        ocpVersion: extractOcpVersion(jobName),
        jobVariant: extractVariant(jobName),
        instance,
        runs: jobRuns,
      }),
    );
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Build a token-minimal text summary for LLM consumption.
 * Grouped by OCP version; one row per job.
 */
export function buildCompactSummary(summaries: JobSummary[]): string {
  const lines: string[] = [];
  const failing = summaries.filter((s) => s.latestState === "failure").length;
  const passing = summaries.filter((s) => s.latestState === "success").length;
  const pending = summaries.filter((s) => s.latestState === "pending").length;

  lines.push("PERIODIC JOB STATUS REPORT");
  lines.push(`Jobs: ${summaries.length} | Failing: ${failing} | Passing: ${passing} | Pending: ${pending}`);
  lines.push("");

  const byVersion = new Map<string, JobSummary[]>();
  for (const s of summaries) {
    const list = byVersion.get(s.ocpVersion);
    if (list) list.push(s);
    else byVersion.set(s.ocpVersion, [s]);
  }

  const versions = [...byVersion.keys()].sort((a, b) =>
    a === "unknown" ? 1 : b === "unknown" ? -1 : a.localeCompare(b),
  );

  for (const version of versions) {
    const jobs = byVersion.get(version)!;
    const failingCount = jobs.filter((j) => j.latestState === "failure").length;
    lines.push(`## OCP ${version}: ${jobs.length} jobs, ${failingCount} failing`);

    for (const j of jobs) {
      const p12 = j.passRateHours(12);
      const p24 = j.passRateHours(24);
      const p48 = j.passRateHours(48);
      lines.push(
        `  ${j.latestState[0].toUpperCase()} ${j.stateSparkline().padEnd(6)} ` +
          `fail=${pct(j.failureRate).padEnd(4)} ` +
          `pass12=${(p12 === null ? "--" : pct(p12)).padEnd(4)} ` +
          `pass24=${(p24 === null ? "--" : pct(p24)).padEnd(4)} ` +
          `pass48=${(p48 === null ? "--" : pct(p48)).padEnd(4)} ` +
          `last_ok=${j.lastSuccessAge().padEnd(8)} ` +
          `${j.jobVariant.padEnd(12)} ${j.job}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export type SortKey = "recent" | "version" | "failure_rate" | "state";

export interface StatusFilters {
  version?: string;
  state?: string;
  sort?: SortKey;
}

/** Filter and sort summaries for the prow_status report. */
export function filterSummaries(
  summaries: JobSummary[],
  filters: StatusFilters = {},
): JobSummary[] {
  let out = summaries;
  if (filters.version) {
    out = out.filter((s) => s.ocpVersion === filters.version);
  }
  if (filters.state) {
    const state = filters.state.toLowerCase();
    out = out.filter((s) => s.latestState === state);
  }

  const sorted = [...out];
  switch (filters.sort) {
    case "failure_rate":
      sorted.sort((a, b) => b.failureRate - a.failureRate || a.job.localeCompare(b.job));
      break;
    case "state":
      sorted.sort((a, b) => a.latestState.localeCompare(b.latestState) || a.job.localeCompare(b.job));
      break;
    case "version":
      sorted.sort((a, b) => a.ocpVersion.localeCompare(b.ocpVersion) || a.job.localeCompare(b.job));
      break;
    case "recent":
    default:
      sorted.sort(
        (a, b) => b.latestRun.startTime.getTime() - a.latestRun.startTime.getTime(),
      );
      break;
  }
  return sorted;
}

/** Render a per-job detail block: metrics plus the most recent runs. */
export function buildJobDetail(summary: JobSummary, recentRuns = 10): string {
  const s = summary;
  const lines: string[] = [];
  lines.push(`JOB: ${s.job}`);
  if (s.instance) lines.push(`instance: ${s.instance}`);
  lines.push(`version: ${s.ocpVersion} | variant: ${s.jobVariant}`);
  lines.push(
    `runs: ${s.totalRuns} | success: ${s.passCount} | failure: ${s.failureCount}`,
  );
  const pr12 = s.passRateHours(12);
  const pr24 = s.passRateHours(24);
  const pr48 = s.passRateHours(48);
  lines.push(
    `fail rate: ${pct(s.failureRate)} | pass12=${pr12 === null ? "--" : pct(pr12)} ` +
      `pass24=${pr24 === null ? "--" : pct(pr24)} pass48=${pr48 === null ? "--" : pct(pr48)}`,
  );
  lines.push(`last success: ${s.lastSuccessAge()}`);
  lines.push(`latest: ${s.latestState} started ${s.latestStartDisplay()} UTC, duration ${s.latestDuration()}`);
  lines.push("");
  lines.push("RECENT RUNS:");
  for (const [i, r] of s.runs.slice(0, recentRuns).entries()) {
    lines.push(`  [${i + 1}] ${r.state}  start=${r.startTime.toISOString()}  build=${r.buildId}`);
    if (r.url) lines.push(`      ${r.url}`);
  }
  return lines.join("\n");
}
