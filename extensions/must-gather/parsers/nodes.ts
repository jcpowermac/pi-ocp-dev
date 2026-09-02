import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { NodeStatus } from "../types.js";

export async function parseNodes(mgRoot: string): Promise<NodeStatus[]> {
  const dir = path.join(mgRoot, "cluster-scoped-resources/core/nodes");
  if (!fs.existsSync(dir)) return [];
  const results: NodeStatus[] = [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const f of entries) {
    try {
      const doc = yaml.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const name = doc?.metadata?.name || path.basename(f, path.extname(f));
      const labels = doc?.metadata?.labels || {};
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith("node-role.kubernetes.io/"))
        .map((k) => k.replace("node-role.kubernetes.io/", ""));

      const conditions: any[] = doc?.status?.conditions || [];
      const readyCond = conditions.find((c) => c.type === "Ready");
      const isReady = readyCond?.status === "True";

      const pressures: string[] = [];
      for (const c of conditions) {
        if (
          ["MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable"].includes(c.type) &&
          c.status === "True"
        ) {
          pressures.push(c.type);
        }
      }

      results.push({
        name,
        ready: isReady,
        roles: roles.length > 0 ? roles : ["worker"],
        version: doc?.status?.nodeInfo?.kubeletVersion,
        conditions,
        pressures,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
