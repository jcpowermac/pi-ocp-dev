import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { StorageStatus } from "../types.js";

export async function parseStorage(mgRoot: string): Promise<StorageStatus> {
  const pvDir = path.join(mgRoot, "cluster-scoped-resources/core/persistentvolumes");
  const nsRoot = path.join(mgRoot, "namespaces");
  let pvCount = 0;
  if (fs.existsSync(pvDir)) {
    try {
      pvCount = fs.readdirSync(pvDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).length;
    } catch {}
  }

  let pvcCount = 0;
  const unbound: Array<{ namespace: string; name: string; status: string }> = [];

  if (fs.existsSync(nsRoot)) {
    let namespaces: string[] = [];
    try {
      namespaces = fs.readdirSync(nsRoot);
    } catch {
      namespaces = [];
    }

    for (const ns of namespaces) {
      const pvcFile = path.join(nsRoot, ns, "core/persistentvolumeclaims.yaml");
      if (fs.existsSync(pvcFile)) {
        try {
          const content = fs.readFileSync(pvcFile, "utf8");
          const doc = yaml.parse(content);
          const items: any[] = doc?.items || (doc?.kind === "PersistentVolumeClaim" ? [doc] : []);
          for (const it of items) {
            pvcCount++;
            const status = it.status?.phase || "Unknown";
            if (status !== "Bound") {
              unbound.push({
                namespace: it.metadata?.namespace || ns,
                name: it.metadata?.name || "unknown",
                status,
              });
            }
          }
        } catch {}
      }
    }
  }

  return {
    pv_count: pvCount,
    pvc_count: pvcCount,
    unbound_pvc_count: unbound.length,
    unbound_pvcs: unbound,
  };
}
