/**
 * Prow integration for OpenShift developers (public Prow only).
 *
 * Registers three tools:
 *   - prow_status:    compact status report for periodic jobs
 *   - prow_job:       detail for a single job (metrics + recent runs)
 *   - prow_build_log: tail of a build's build-log.txt
 */

import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  aggregate,
  buildCompactSummary,
  buildJobDetail,
  extractPeriodicJobs,
  filterSummaries,
  type SortKey,
} from "./analyze.js";
import { fetchBuildLogTail, fetchProwData } from "./fetch.js";
import { buildProwPrompt, parseProwCommand } from "./command.js";

const text = (t: string, details?: unknown) => ({
  content: [{ type: "text" as const, text: t }],
  details,
});

const prowStatusTool = defineTool({
  name: "prow_status",
  label: "Prow Status",
  description:
    "Status report for OpenShift periodic CI jobs on public Prow (prow.ci.openshift.org). " +
    "Returns a compact per-job report grouped by OCP version: latest state, 6-run sparkline " +
    "(S=success F=failure P=pending A=aborted E=error), failure %, pass rates over 12/24/48h, " +
    "last success age, and variant (e2e/upgrade/serial/upi/...). " +
    "Specify at least one of platforms or version, or pass all: true to include every periodic job. " +
    "EOL versions (< 4.12) are excluded.",
  parameters: Type.Object({
    platforms: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Case-insensitive substrings matched against job names (e.g. 'vsphere', 'aws', 'gcp', 'azure', 'nutanix'). A job matches if it contains ANY.",
      }),
    ),
    version: Type.Optional(
      Type.String({ description: "Exact OCP version to filter by, e.g. '4.18'." }),
    ),
    state: Type.Optional(
      Type.String({
        description:
          "Filter jobs by latest run state: success, failure, pending, aborted, or error.",
      }),
    ),
    sort: Type.Optional(
      Type.String({
        description:
          "Sort within version groups: 'recent' (default), 'version', 'failure_rate', or 'state'.",
      }),
    ),
    all: Type.Optional(
      Type.Boolean({
        description:
          "Set true to report ALL periodic jobs when neither platforms nor version is given.",
      }),
    ),
    file: Type.Optional(
      Type.String({
        description: "Path to a local prowjobs.json to analyze instead of fetching from the API.",
      }),
    ),
    refresh: Type.Optional(
      Type.Boolean({ description: "Bypass the 30-minute disk cache and fetch fresh data." }),
    ),
  }),
  async execute(_id, params) {
    const hasFilter =
      (params.platforms && params.platforms.length > 0) || Boolean(params.version);
    if (!hasFilter && !params.all) {
      throw new Error(
        "Specify at least one of 'platforms' or 'version', or set all: true to report every periodic job.",
      );
    }
    const raw = await fetchProwData({ file: params.file, refresh: params.refresh });
    const summaries = aggregate(extractPeriodicJobs(raw, params.platforms), "openshift-ci");
    const sort = (params.sort as SortKey | undefined) ?? "recent";
    const filtered = filterSummaries(summaries, {
      version: params.version,
      state: params.state,
      sort,
    });
    if (!filtered.length) {
      return text(
        "No periodic jobs match the given filters.",
        { matched: 0 },
      );
    }
    const header = `source: openshift-ci (prow.ci.openshift.org)\n`;
    return text(header + buildCompactSummary(filtered), {
      matched: filtered.length,
    });
  },
});

const prowJobTool = defineTool({
  name: "prow_job",
  label: "Prow Job",
  description:
    "Detail for a single OpenShift periodic CI job on public Prow. Accepts an exact job name or " +
    "a substring. Returns version, variant, run counts, failure/pass rates (all + 12/24/48h windows), " +
    "last success age, and the 10 most recent runs with state, start time, build id, and Prow URL. " +
    "Use prow_build_log with a returned URL to inspect a failing build's log.",
  parameters: Type.Object({
    job: Type.String({
      description: "Exact job name or substring, e.g. 'periodic-ci-openshift-release-main-4.18-nightly-e2e-aws-ovn' or 'e2e-aws-ovn'.",
    }),
    file: Type.Optional(
      Type.String({
        description: "Path to a local prowjobs.json to analyze instead of fetching from the API.",
      }),
    ),
    refresh: Type.Optional(
      Type.Boolean({ description: "Bypass the 30-minute disk cache and fetch fresh data." }),
    ),
  }),
  async execute(_id, params) {
    const raw = await fetchProwData({ file: params.file, refresh: params.refresh });
    const summaries = aggregate(extractPeriodicJobs(raw, undefined), "openshift-ci");

    const exact = summaries.filter((s) => s.job === params.job);
    if (exact.length === 1) {
      return text(buildJobDetail(exact[0]), { job: exact[0].job });
    }

    const needle = params.job.toLowerCase();
    const matches = summaries.filter((s) => s.job.toLowerCase().includes(needle));
    if (!matches.length) {
      throw new Error(
        `No periodic job matches '${params.job}'. Check the job name (jobs look like periodic-ci-openshift-...).`,
      );
    }
    const list = matches
      .slice(0, 20)
      .map((s) => `  ${s.job}  [${s.ocpVersion}, ${s.jobVariant}, latest: ${s.latestState}]`)
      .join("\n");
    const more = matches.length > 20 ? `\n  ... and ${matches.length - 20} more (narrow your query)` : "";
    return text(
      `Multiple jobs match '${params.job}'; refine the name:\n${list}${more}`,
      { candidates: matches.map((s) => s.job) },
    );
  },
});

const prowBuildLogTool = defineTool({
  name: "prow_build_log",
  label: "Prow Build Log",
  description:
    "Fetch the tail of a Prow build log (build-log.txt) for a job run on public Prow. Pass the " +
    "Prow deck URL from prow_job (https://prow.ci.openshift.org/view/gs/...) and it is converted " +
    "to the public GCS object automatically. Returns the last N lines, which usually contain the " +
    "root cause for a failed run.",
  parameters: Type.Object({
    url: Type.String({
      description: "Prow deck URL, e.g. https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/BUILD_ID",
    }),
    maxLines: Type.Optional(
      Type.Number({
        description: "Maximum lines to return from the tail (default 2000, max 10000).",
        minimum: 1,
        maximum: 10000,
      }),
    ),
  }),
  async execute(_id, params) {
    const { logUrl, lines } = await fetchBuildLogTail(
      params.url,
      params.maxLines ?? 2000,
    );
    if (!lines.length) {
      return text(
        `No log content available at ${logUrl}. The build may be too new, expired, or the bucket may not be public.`,
        { logUrl, lines: 0 },
      );
    }
    const header = `build log tail (${lines.length} lines) from ${logUrl}:\n\n`;
    return text(header + lines.join("\n"), { logUrl, lines: lines.length });
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(prowStatusTool);
  pi.registerTool(prowJobTool);
  pi.registerTool(prowBuildLogTool);

  pi.registerCommand("prow", {
    description: "Prow CI: /prow [platforms...] [version] | /prow job <name> | /prow log <url>",
    getArgumentCompletions: (prefix: string) => {
      const items = ["job", "log"].map((v) => ({ value: v, label: v }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cmd = parseProwCommand(args);
      if (cmd.kind === "usage") {
        ctx.ui.notify(
          "/prow [platforms...] [version] | /prow job <name> | /prow log <url>",
          "info",
        );
        return;
      }
      // Relay: submit a user message that triggers a turn; the agent
      // runs the matching prow tool and reasons about the result.
      pi.sendUserMessage(buildProwPrompt(cmd));
    },
  });
}
