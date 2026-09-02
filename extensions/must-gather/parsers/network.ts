import * as fs from "node:fs";
import * as path from "node:path";
import type { NetworkStatus } from "../types.js";

export async function parseNetwork(mgRoot: string): Promise<NetworkStatus> {
  const netDir = path.join(mgRoot, "network_logs");
  const hasOvn =
    fs.existsSync(path.join(netDir, "ovnk_database_store.tar.gz")) ||
    fs.existsSync(path.join(mgRoot, "namespaces/openshift-ovn-kubernetes"));
  const hasSdn = fs.existsSync(path.join(mgRoot, "namespaces/openshift-sdn"));

  let netType = "Unknown";
  if (hasOvn) {
    netType = "OVN-Kubernetes";
  } else if (hasSdn) {
    netType = "OpenShift-SDN";
  }

  return {
    type: netType,
    healthy: true,
    issues: [],
  };
}
