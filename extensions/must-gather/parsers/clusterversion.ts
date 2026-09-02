import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterVersionInfo } from "../types.js";

export async function parseClusterVersion(mgRoot: string): Promise<ClusterVersionInfo | null> {
  const file = path.join(mgRoot, "cluster-scoped-resources/config.openshift.io/clusterversions/version.yaml");
  if (!fs.existsSync(file)) return null;
  try {
    const doc = yaml.parse(fs.readFileSync(file, "utf8"));
    const status = doc?.status || {};
    const history = Array.isArray(status.history) ? status.history : [];
    const latest = history[0] || {};
    return {
      version: latest.version || status.desired?.version || "Unknown",
      state: latest.state || "Unknown",
      desired_version: status.desired?.version,
      cluster_id: doc?.spec?.clusterID,
      capabilities: status.capabilities?.enabledCapabilities || [],
      conditions: status.conditions || [],
    };
  } catch {
    return null;
  }
}
