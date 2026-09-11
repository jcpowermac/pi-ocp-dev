import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { MachineCondition, MachineStatus } from "../types.js";

const MACHINES_REL = "namespaces/openshift-machine-api/machine.openshift.io/machines";

function normCond(c: any): MachineCondition {
  return {
    type: String(c?.type ?? ""),
    status: String(c?.status ?? ""),
    lastTransitionTime: c?.lastTransitionTime,
    reason: c?.reason,
    message: c?.message,
  };
}

export function machineIssues(m: MachineStatus, nodeNames: Set<string>): string[] {
  const issues: string[] = [];
  const exists = m.conditions.find((c) => c.type === "InstanceExists");
  if (m.phase !== "Running") issues.push(`MachineNotRunning (phase ${m.phase || "unknown"})`);
  if (exists && exists.status === "False")
    issues.push(`InstanceExists=False (${exists.lastTransitionTime ?? "unknown time"})`);
  if (m.phase === "Running" && !m.node) issues.push("MachineNodeNotLinked");
  if (m.node && nodeNames.size > 0 && !nodeNames.has(m.node)) issues.push("MachineNodeMissing");
  return issues;
}

export async function parseMachines(mgRoot: string): Promise<MachineStatus[]> {
  const dir = path.join(mgRoot, MACHINES_REL);
  if (!fs.existsSync(dir)) return [];
  const results: MachineStatus[] = [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const f of entries) {
    try {
      const doc = yaml.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const name = doc?.metadata?.name || path.basename(f, path.extname(f));
      const status = doc?.status || {};
      const providerStatus = status.providerStatus || {};
      results.push({
        name,
        phase: status.phase,
        instance_state: doc?.metadata?.annotations?.["machine.openshift.io/instance-state"],
        node: status.nodeRef?.name,
        conditions: (status.conditions || []).map(normCond),
        provider_conditions: (providerStatus.conditions || []).map(normCond),
        instance_id: providerStatus.instanceId,
        last_updated: status.lastUpdated,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
