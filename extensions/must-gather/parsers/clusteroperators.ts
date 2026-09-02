import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterOperatorStatus } from "../types.js";

export async function parseClusterOperators(mgRoot: string): Promise<ClusterOperatorStatus[]> {
  const dir = path.join(mgRoot, "cluster-scoped-resources/config.openshift.io/clusteroperators");
  if (!fs.existsSync(dir)) return [];
  const results: ClusterOperatorStatus[] = [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const f of entries) {
    try {
      const doc = yaml.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const name = doc?.metadata?.name || path.basename(f, path.extname(f));
      const conditions: any[] = doc?.status?.conditions || [];
      const getCond = (t: string) => conditions.find((c) => c.type === t);
      const avail = getCond("Available");
      const prog = getCond("Progressing");
      const deg = getCond("Degraded");

      const isDegraded = deg?.status === "True";
      const isProg = prog?.status === "True";
      const isAvail = avail?.status === "True";
      const msg = deg?.message || avail?.message || prog?.message;
      const since = deg?.lastTransitionTime || avail?.lastTransitionTime;

      const versions: any[] = doc?.status?.versions || [];
      const ver = versions.find((v) => v.name === "operator")?.version || versions[0]?.version;

      results.push({
        name,
        version: ver,
        available: isAvail,
        progressing: isProg,
        degraded: isDegraded,
        since,
        message: msg,
      });
    } catch {}
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
