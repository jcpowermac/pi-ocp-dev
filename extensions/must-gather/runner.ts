import { resolveMustGatherPath } from "./loader.js";
import { parseClusterVersion } from "./parsers/clusterversion.js";
import { parseClusterOperators } from "./parsers/clusteroperators.js";
import { parseNodes } from "./parsers/nodes.js";
import { parsePods } from "./parsers/pods.js";
import { parseEvents } from "./parsers/events.js";
import { parseEtcd } from "./parsers/etcd.js";
import { parseStorage } from "./parsers/storage.js";
import { parseNetwork } from "./parsers/network.js";
import type { CriticalIssue, MustGatherAnalysisResult, MustGatherSummary } from "./types.js";

export async function runMustGatherAnalysis(
  source: string,
  opts: {
    component?: string;
    problemsOnly?: boolean;
    namespace?: string;
    count?: number;
  } = {},
): Promise<MustGatherAnalysisResult> {
  const mgRoot = await resolveMustGatherPath(source);
  const component = opts.component || "all";
  const problemsOnly = opts.problemsOnly ?? (component === "all");

  const [version, operators, nodes, podSummary, events, etcd, storage, network] = await Promise.all([
    parseClusterVersion(mgRoot),
    parseClusterOperators(mgRoot),
    parseNodes(mgRoot),
    parsePods(mgRoot, { namespace: opts.namespace, problemsOnly }),
    parseEvents(mgRoot, { namespace: opts.namespace, count: opts.count, warningsOnly: true }),
    parseEtcd(mgRoot),
    parseStorage(mgRoot),
    parseNetwork(mgRoot),
  ]);

  const degradedOps = operators.filter((o) => o.degraded || !o.available);
  const progOps = operators.filter((o) => o.progressing);
  const notReadyNodes = nodes.filter((n) => !n.ready);
  const pressureNodes = nodes
    .filter((n) => n.pressures.length > 0)
    .map((n) => `${n.name} (${n.pressures.join(", ")})`);

  const summary: MustGatherSummary = {
    operators: {
      total: operators.length,
      healthy: operators.length - degradedOps.length,
      degraded: degradedOps.length,
      progressing: progOps.length,
    },
    nodes: {
      total: nodes.length,
      ready: nodes.length - notReadyNodes.length,
      not_ready: notReadyNodes.length,
      pressure: pressureNodes,
    },
    pods: {
      total: podSummary.total,
      healthy: podSummary.healthy,
      failing: podSummary.failing,
      crashloop: podSummary.crashloop,
      pending: podSummary.pending,
    },
    etcd: {
      total_members: etcd?.total_members || 0,
      healthy: etcd?.healthy || 0,
      quorum: etcd?.quorum ?? true,
    },
    warning_events_count: events.length,
  };

  const critical_issues: CriticalIssue[] = [];
  const candidate_references: Set<string> = new Set();

  for (const op of degradedOps) {
    critical_issues.push({
      component: "operators",
      name: op.name,
      reason: op.degraded ? "OperatorDegraded" : "OperatorUnavailable",
      message: op.message || "Operator in degraded or unavailable state",
      since: op.since,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/cluster-operators.md");
  }

  for (const p of podSummary.issues.filter((i) => i.status.includes("CrashLoop") || i.status === "Failed")) {
    critical_issues.push({
      component: "pods",
      name: p.name,
      namespace: p.namespace,
      reason: p.status,
      message: `Pod in ${p.status} with ${p.restarts} restarts on node ${p.node || "unknown"}`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/pods.md");
  }

  for (const n of notReadyNodes) {
    critical_issues.push({
      component: "nodes",
      name: n.name,
      reason: "NodeNotReady",
      message: `Node is not in Ready condition (${n.roles.join(",")})`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/nodes.md");
  }

  if (etcd && !etcd.quorum) {
    critical_issues.push({
      component: "etcd",
      name: "etcd-cluster",
      reason: "QuorumLost",
      message: `Only ${etcd.healthy}/${etcd.total_members} etcd members healthy`,
      severity: "critical",
    });
    candidate_references.add("skills/must-gather-analysis/references/etcd.md");
  }

  return {
    must_gather_path: mgRoot,
    cluster_version: version || undefined,
    summary,
    critical_issues,
    candidate_references: Array.from(candidate_references),
    component_data:
      component === "all"
        ? undefined
        : {
            operators: component === "operators" ? operators : undefined,
            nodes: component === "nodes" ? nodes : undefined,
            pods: component === "pods" ? podSummary.issues : undefined,
            events: component === "events" ? events : undefined,
            etcd: component === "etcd" ? etcd || undefined : undefined,
            storage: component === "storage" ? storage : undefined,
            network: component === "network" ? network : undefined,
          },
  };
}
