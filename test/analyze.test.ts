import { describe, it, expect } from "vitest";
import {
  extractOcpVersion,
  extractVariant,
  extractPeriodicJobs,
  aggregate,
  buildCompactSummary,
  filterSummaries,
  buildJobDetail,
} from "../extensions/prow/analyze.js";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const HOUR = 3600_000;
const iso = (hoursAgo: number) =>
  new Date(Date.now() - hoursAgo * HOUR).toISOString();

/** Build a periodic Prow item matching the prowjobs.js shape. */
function periodicItem(job: string, state: string, hoursAgo: number, extra: {
  completionHoursAgo?: number | null;
  url?: string;
} = {}) {
  const completion =
    extra.completionHoursAgo === undefined || extra.completionHoursAgo === null
      ? null
      : iso(extra.completionHoursAgo);
  return {
    spec: { type: "periodic", job },
    status: {
      state,
      startTime: iso(hoursAgo),
      completionTime: completion,
      url: extra.url ?? "",
      build_id: `b-${job}-${hoursAgo}`,
    },
  };
}

const raw = (items: object[]) => ({ items });

// ---------------------------------------------------------------------------
// extractOcpVersion
// ---------------------------------------------------------------------------

describe("extractOcpVersion", () => {
  it("extracts version from typical job name", () => {
    expect(
      extractOcpVersion("periodic-ci-openshift-release-main-4.18-nightly-e2e-aws-ovn"),
    ).toBe("4.18");
  });

  it("returns last version for upgrade jobs (target version)", () => {
    expect(
      extractOcpVersion("periodic-ci-openshift-release-main-upgrade-from-stable-4.19-e2e-aws-ovn-4.20"),
    ).toBe("4.20");
  });

  it("returns 'unknown' when no version found", () => {
    expect(extractOcpVersion("periodic-ci-openshift-some-job-no-version")).toBe(
      "unknown",
    );
  });
});

// ---------------------------------------------------------------------------
// extractVariant
// ---------------------------------------------------------------------------

describe("extractVariant", () => {
  it("defaults to e2e", () => {
    expect(extractVariant("periodic-ci-openshift-release-main-4.18-nightly-e2e-aws-ovn")).toBe(
      "e2e",
    );
  });

  it("detects upgrade", () => {
    expect(extractVariant("periodic-ci-openshift-release-main-upgrade-from-stable-4.19-e2e-aws-4.20")).toBe(
      "upgrade",
    );
  });

  it("detects serial", () => {
    expect(extractVariant("periodic-ci-openshift-serial-4.18-aws-ovn")).toBe("serial");
  });

  it("detects techpreview-serial as tp-serial", () => {
    expect(extractVariant("periodic-ci-openshift-techpreview-serial-4.19-aws-ovn")).toBe(
      "tp-serial",
    );
  });

  it("detects upi", () => {
    expect(extractVariant("periodic-ci-openshift-upi-4.18-aws")).toBe("upi");
  });
});

// ---------------------------------------------------------------------------
// extractPeriodicJobs
// ---------------------------------------------------------------------------

describe("extractPeriodicJobs", () => {
  it("keeps only periodic jobs", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 1),
      {
        spec: { type: "postsubmit", job: "post-ci-openshift-4.18" },
        status: { state: "success", startTime: iso(1), completionTime: iso(0.5), url: "", build_id: "x" },
      },
    ];
    const runs = extractPeriodicJobs(raw(items), undefined);
    expect(runs).toHaveLength(1);
    expect(runs[0].job).toBe("periodic-ci-openshift-4.18-e2e-aws");
  });

  it("filters by platform (case-insensitive substring, any match)", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 1),
      periodicItem("periodic-ci-openshift-4.18-e2e-vsphere", "failure", 2),
      periodicItem("periodic-ci-openshift-4.18-e2e-gcp", "success", 3),
    ];
    const runs = extractPeriodicJobs(raw(items), ["VSPHERE"]);
    expect(runs).toHaveLength(1);
    expect(runs[0].job).toContain("vsphere");
  });

  it("skips EOL versions (< 4.12)", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.11-e2e-aws", "success", 1),
      periodicItem("periodic-ci-openshift-4.12-e2e-aws", "success", 1),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 1),
    ];
    const runs = extractPeriodicJobs(raw(items), undefined);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => !r.job.includes("4.11"))).toBe(true);
  });

  it("keeps jobs with unknown versions", () => {
    const items = [periodicItem("periodic-ci-openshift-mystery-job", "success", 1)];
    expect(extractPeriodicJobs(raw(items), undefined)).toHaveLength(1);
  });

  it("skips items without a parseable startTime", () => {
    const items = [{ spec: { type: "periodic", job: "p-4.18" }, status: { state: "pending" } }];
    expect(extractPeriodicJobs(raw(items), undefined)).toHaveLength(0);
  });

  it("parses completionTime null as undefined", () => {
    const items = [periodicItem("periodic-ci-openshift-4.18-e2e", "pending", 0.5, { completionHoursAgo: null })];
    const [run] = extractPeriodicJobs(raw(items), undefined);
    expect(run.completionTime).toBeUndefined();
    expect(run.state).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// aggregate + JobSummary metrics
// ---------------------------------------------------------------------------

describe("aggregate", () => {
  it("groups runs by job, most recent first", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 5),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 1),
    ];
    const [summary] = aggregate(extractPeriodicJobs(raw(items), undefined), "openshift-ci");
    expect(summary.job).toBe("periodic-ci-openshift-4.18-e2e-aws");
    expect(summary.runs.map((r) => r.state)).toEqual(["failure", "success"]);
    expect(summary.instance).toBe("openshift-ci");
  });

  it("computes failure/pass counts and rates", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 8),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 6),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 4),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 2),
    ];
    const [s] = aggregate(extractPeriodicJobs(raw(items), undefined));
    expect(s.totalRuns).toBe(4);
    expect(s.failureCount).toBe(1);
    expect(s.passCount).toBe(3);
    expect(s.failureRate).toBeCloseTo(0.25);
    expect(s.passRate).toBeCloseTo(0.75);
  });

  it("computes pass rate over time window (null when no runs in window)", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 2),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 30),
    ];
    const [s] = aggregate(extractPeriodicJobs(raw(items), undefined));
    expect(s.passRateHours(12)).toBeCloseTo(1);
    expect(s.passRateHours(72)).toBeCloseTo(0.5);
    expect(s.passRateHours(0.0001)).toBeNull();
  });

  it("reports last success age", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 1),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 3),
    ];
    const [s] = aggregate(extractPeriodicJobs(raw(items), undefined));
    expect(s.lastSuccessAge()).toMatch(/^3h ago$/);
    const failingOnly = aggregate(
      extractPeriodicJobs(
        raw([periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 1)]),
        undefined,
      ),
    )[0];
    expect(failingOnly.lastSuccessAge()).toBe("never");
  });

  it("renders sparkline from last 6 states, most recent first", () => {
    // hoursAgo decreases with index, so the list is newest -> oldest;
    // sparkline shows newest first, unknown states render as '?'
    const states = ["mystery", "failure", "success", "pending", "aborted", "error"];
    const items = states.map((st, i) =>
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", st, (i + 1) * 2),
    );
    const [s] = aggregate(extractPeriodicJobs(raw(items), undefined));
    expect(s.stateSparkline()).toBe("?FSPAE");
  });

  it("renders duration for completed runs and dashes for running", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-done", "success", 3, { completionHoursAgo: 2 }),
      periodicItem("periodic-ci-openshift-4.18-running", "pending", 0.5, { completionHoursAgo: null }),
    ];
    const summaries = aggregate(extractPeriodicJobs(raw(items), undefined));
    const done = summaries.find((s) => s.job.includes("done"))!;
    const running = summaries.find((s) => s.job.includes("running"))!;
    expect(done.latestDuration()).toBe("01:00:00");
    expect(running.latestDuration()).toBe("--:--:--");
  });
});

// ---------------------------------------------------------------------------
// buildCompactSummary
// ---------------------------------------------------------------------------

describe("buildCompactSummary", () => {
  it("produces the compact report grouped by version", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 2),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 4),
      periodicItem("periodic-ci-openshift-4.17-e2e-azure", "failure", 1),
    ];
    const summaries = aggregate(extractPeriodicJobs(raw(items), undefined), "openshift-ci");
    const out = buildCompactSummary(summaries);

    expect(out).toContain("PERIODIC JOB STATUS REPORT");
    expect(out).toContain("Jobs: 2 | Failing: 1 | Passing: 1 | Pending: 0");
    expect(out).toContain("## OCP 4.17: 1 jobs, 1 failing");
    // 4.18 job's latest run succeeded, so 0 failing in that group
    expect(out).toContain("## OCP 4.18: 1 jobs, 0 failing");
    // 4.17 sorts before 4.18
    expect(out.indexOf("## OCP 4.17")).toBeLessThan(out.indexOf("## OCP 4.18"));
    // per-job line contains state, sparkline, fail pct, job name
    expect(out).toMatch(/fail=50%.*e2e.*periodic-ci-openshift-4\.18-e2e-aws/);
  });

  it("places 'unknown' versions last", () => {
    const items = [
      periodicItem("periodic-ci-openshift-mystery", "success", 1),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 1),
    ];
    const out = buildCompactSummary(
      aggregate(extractPeriodicJobs(raw(items), undefined)),
    );
    expect(out.indexOf("## OCP 4.18")).toBeLessThan(out.indexOf("## OCP unknown"));
  });
});

// ---------------------------------------------------------------------------
// filterSummaries (option (a) enforcement lives in index.ts; filter here)
// ---------------------------------------------------------------------------

describe("filterSummaries", () => {
  const make = () =>
    aggregate(
      extractPeriodicJobs(
        raw([
          periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 1),
          periodicItem("periodic-ci-openshift-4.18-e2e-azure", "success", 1),
          periodicItem("periodic-ci-openshift-4.17-e2e-aws", "pending", 1),
        ]),
        undefined,
      ),
    );

  it("filters by version", () => {
    expect(filterSummaries(make(), { version: "4.17" }).map((s) => s.ocpVersion)).toEqual(["4.17"]);
  });

  it("filters by latest state", () => {
    expect(filterSummaries(make(), { state: "failure" }).map((s) => s.latestState)).toEqual(["failure"]);
  });

  it("sorts by failure rate descending", () => {
    const s = filterSummaries(make(), { sort: "failure_rate" });
    // aws 4.18 failing (100%) first
    expect(s[0].job).toContain("4.18-e2e-aws");
  });

  it("sorts by state ascending", () => {
    const s = filterSummaries(make(), { sort: "state" });
    expect(s.map((x) => x.latestState)).toEqual(["failure", "pending", "success"]);
  });
});

// ---------------------------------------------------------------------------
// buildJobDetail
// ---------------------------------------------------------------------------

describe("buildJobDetail", () => {
  it("renders a detail block for a known job", () => {
    const items = [
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "failure", 1, { url: "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/j/1" }),
      periodicItem("periodic-ci-openshift-4.18-e2e-aws", "success", 25, { completionHoursAgo: 24, url: "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/j/0" }),
    ];
    const [s] = aggregate(extractPeriodicJobs(raw(items), undefined), "openshift-ci");
    const out = buildJobDetail(s);
    expect(out).toContain(s.job);
    expect(out).toContain("4.18");
    expect(out).toContain("failure");
    expect(out).toContain("https://prow.ci.openshift.org/view/gs/");
    expect(out).toMatch(/runs/);
  });
});
