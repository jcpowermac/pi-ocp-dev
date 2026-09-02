import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { PodIssue, PodStatusSummary } from "../types.js";

export async function parsePods(
  mgRoot: string,
  opts: { namespace?: string; problemsOnly?: boolean } = {},
): Promise<PodStatusSummary> {
  const nsRoot = path.join(mgRoot, "namespaces");
  const summary: PodStatusSummary = { total: 0, healthy: 0, failing: 0, crashloop: 0, pending: 0, issues: [] };
  if (!fs.existsSync(nsRoot)) return summary;

  let namespaces: string[] = [];
  try {
    namespaces = fs.readdirSync(nsRoot).filter((ns) => {
      if (opts.namespace && ns !== opts.namespace) return false;
      const full = path.join(nsRoot, ns);
      try {
        return fs.statSync(full).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return summary;
  }

  for (const ns of namespaces) {
    const podsDir = path.join(nsRoot, ns, "pods");
    if (!fs.existsSync(podsDir)) continue;
    let podFolders: string[] = [];
    try {
      podFolders = fs.readdirSync(podsDir);
    } catch {
      continue;
    }

    for (const pf of podFolders) {
      const fullDir = path.join(podsDir, pf);
      try {
        if (!fs.statSync(fullDir).isDirectory()) continue;
      } catch {
        continue;
      }

      let yamlFiles: string[] = [];
      try {
        yamlFiles = fs.readdirSync(fullDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      } catch {
        continue;
      }

      for (const yf of yamlFiles) {
        try {
          const content = fs.readFileSync(path.join(fullDir, yf), "utf8");
          const doc = yaml.parse(content);
          if (doc?.kind !== "Pod") continue;

          summary.total++;
          const name = doc.metadata?.name || pf;
          const phase = doc.status?.phase || "Unknown";
          const nodeName = doc.spec?.nodeName;
          const containerStatuses: any[] = doc.status?.containerStatuses || [];
          const totalContainers = containerStatuses.length || (doc.spec?.containers?.length || 1);
          const readyContainers = containerStatuses.filter((c) => c.ready).length;
          const totalRestarts = containerStatuses.reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0);

          let status = phase;
          let reason: string | undefined;
          let message: string | undefined;

          for (const c of containerStatuses) {
            if (c.state?.waiting) {
              status = c.state.waiting.reason || "Waiting";
              reason = c.state.waiting.reason;
              message = c.state.waiting.message;
            } else if (c.state?.terminated && c.state.terminated.exitCode !== 0) {
              status = c.state.terminated.reason || `ExitCode:${c.state.terminated.exitCode}`;
              reason = c.state.terminated.reason;
              message = c.state.terminated.message;
            }
          }

          const isCrashLoop = status.includes("CrashLoop") || reason === "CrashLoopBackOff";
          const isPending = phase === "Pending";
          const isFailing =
            phase === "Failed" ||
            isCrashLoop ||
            (!readyContainers && totalContainers > 0 && phase !== "Succeeded") ||
            (status !== "Running" && phase !== "Succeeded");

          if (isCrashLoop) summary.crashloop++;
          if (isPending) summary.pending++;
          if (isFailing) summary.failing++;
          if (!isFailing && !isPending && !isCrashLoop) summary.healthy++;

          if (isFailing || isCrashLoop || isPending || !opts.problemsOnly) {
            summary.issues.push({
              namespace: ns,
              name,
              status,
              restarts: totalRestarts,
              ready_containers: `${readyContainers}/${totalContainers}`,
              node: nodeName,
              reason,
              message,
            });
          }
        } catch {}
      }
    }
  }

  summary.issues.sort((a, b) => {
    const nsCmp = a.namespace.localeCompare(b.namespace);
    return nsCmp !== 0 ? nsCmp : a.name.localeCompare(b.name);
  });

  return summary;
}
