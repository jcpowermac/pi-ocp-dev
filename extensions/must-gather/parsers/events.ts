import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { ClusterEvent } from "../types.js";

export async function parseEvents(
  mgRoot: string,
  opts: { namespace?: string; count?: number; warningsOnly?: boolean } = {},
): Promise<ClusterEvent[]> {
  const nsRoot = path.join(mgRoot, "namespaces");
  if (!fs.existsSync(nsRoot)) return [];
  const events: ClusterEvent[] = [];

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
    return [];
  }

  for (const ns of namespaces) {
    const eventFile = path.join(nsRoot, ns, "core/events.yaml");
    if (!fs.existsSync(eventFile)) continue;
    try {
      const content = fs.readFileSync(eventFile, "utf8");
      const doc = yaml.parse(content);
      const items: any[] = doc?.items || (doc?.kind === "Event" ? [doc] : []);
      for (const it of items) {
        const type = (it.type || "Normal") as "Normal" | "Warning" | "Error";
        if (opts.warningsOnly && type === "Normal") continue;
        events.push({
          namespace: it.metadata?.namespace || ns,
          lastTimestamp: it.lastTimestamp || it.eventTime || it.metadata?.creationTimestamp || "",
          type,
          reason: it.reason || "Unknown",
          object: `${it.involvedObject?.kind || "Object"}/${it.involvedObject?.name || "unknown"}`,
          message: it.message || "",
          count: it.count || 1,
        });
      }
    } catch {}
  }

  events.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
  const max = opts.count !== undefined ? opts.count : 100;
  return events.slice(0, max);
}
