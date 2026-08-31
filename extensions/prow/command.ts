/**
 * /prow slash command: pure arg parsing + relay prompt construction.
 * Parsing is side-effect-free so it is fully unit-testable.
 */

export type ProwCommand =
  | { kind: "usage" }
  | { kind: "status"; platforms?: string[]; version?: string }
  | { kind: "job"; name: string }
  | { kind: "log"; url: string };

const VERSION_TOKEN = /^\d+\.\d+$/;

export const PROW_USAGE = [
  "Usage:",
  "  /prow [platforms...] [version]   prow_status report (e.g. /prow vsphere 4.18)",
  "  /prow job <job-name>             prow_job detail for one job",
  "  /prow log <prow-deck-url>        prow_build_log tail + failure triage",
].join("\n");

/**
 * Parse the raw argument string after `/prow`.
 *
 *   /prow vsphere 4.18        -> status { platforms: [vsphere], version: 4.18 }
 *   /prow job <name>          -> job (rest of line, may contain spaces)
 *   /prow log <url>           -> log (next token must look like a URL)
 *   /prow                     -> usage
 */
export function parseProwCommand(args: string): ProwCommand {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "usage" };
  const tokens = trimmed.split(/\s+/);

  if (tokens[0] === "job") {
    const name = tokens.slice(1).join(" ").trim();
    return name ? { kind: "job", name } : { kind: "usage" };
  }

  if (tokens[0] === "log") {
    const url = tokens[1] ?? "";
    return /^https?:\/\//.test(url) ? { kind: "log", url } : { kind: "usage" };
  }

  const platforms: string[] = [];
  let version: string | undefined;
  for (const t of tokens) {
    if (VERSION_TOKEN.test(t)) {
      if (version !== undefined) return { kind: "usage" };
      version = t;
    } else {
      platforms.push(t);
    }
  }
  if (!platforms.length && !version) return { kind: "usage" };
  return { kind: "status", platforms: platforms.length ? platforms : undefined, version };
}

/** Build the user message relayed to the agent for a parsed command. */
export function buildProwPrompt(cmd: ProwCommand): string {
  switch (cmd.kind) {
    case "status": {
      const params: string[] = [];
      if (cmd.platforms) params.push(`platforms: [${cmd.platforms.map((p) => `"${p}"`).join(", ")}]`);
      if (cmd.version) params.push(`version: "${cmd.version}"`);
      return (
        `Use the prow_status tool with ${params.join(", ")}. ` +
        `Show the report and call out which jobs are failing.`
      );
    }
    case "job":
      return (
        `Use the prow_job tool with job: "${cmd.name}". ` +
        `Show the job details and recent runs.`
      );
    case "log":
      return (
        `Use the prow_build_log tool with url: "${cmd.url}". ` +
        `Identify the likely root cause from the log tail and summarize it.`
      );
    case "usage":
      // Unreachable: the command handler prints usage without relaying.
      return PROW_USAGE;
  }
}
