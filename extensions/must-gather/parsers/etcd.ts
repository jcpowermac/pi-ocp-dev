import * as fs from "node:fs";
import * as path from "node:path";
import type { EtcdHealthInfo } from "../types.js";

export async function parseEtcd(mgRoot: string): Promise<EtcdHealthInfo | null> {
  const etcdDir = path.join(mgRoot, "etcd_info");
  if (!fs.existsSync(etcdDir)) return null;

  const healthFile = path.join(etcdDir, "endpoint_health.json");
  const memberFile = path.join(etcdDir, "member_list.json");
  const statusFile = path.join(etcdDir, "endpoint_status.json");

  try {
    let endpoints: any[] = [];
    if (fs.existsSync(healthFile)) {
      const parsed = JSON.parse(fs.readFileSync(healthFile, "utf8"));
      endpoints = Array.isArray(parsed) ? parsed : [];
    }

    let members: any[] = [];
    if (fs.existsSync(memberFile)) {
      const mDoc = JSON.parse(fs.readFileSync(memberFile, "utf8"));
      members = mDoc.members || (Array.isArray(mDoc) ? mDoc : []);
    }

    let leader: string | undefined;
    if (fs.existsSync(statusFile)) {
      try {
        const sDoc = JSON.parse(fs.readFileSync(statusFile, "utf8"));
        const sList = Array.isArray(sDoc) ? sDoc : [];
        for (const s of sList) {
          if (s.Status?.leader || s.leader) {
            leader = String(s.Status?.leader || s.leader);
            break;
          }
        }
      } catch {}
    }

    const total = endpoints.length || members.length || 0;
    if (total === 0 && !fs.existsSync(healthFile) && !fs.existsSync(memberFile)) {
      return null;
    }

    const healthy = endpoints.length > 0
      ? endpoints.filter((e) => e.health === true || e.health === "true").length
      : total;

    const quorumRequired = Math.floor(total / 2) + 1;
    const quorum = total > 0 ? healthy >= quorumRequired : true;

    return {
      total_members: total,
      healthy,
      quorum,
      leader,
      members: members.map((m) => ({
        id: String(m.ID || m.id || ""),
        name: String(m.name || m.ID || m.id || ""),
        peerURLs: Array.isArray(m.peerURLs) ? m.peerURLs : [],
        clientURLs: Array.isArray(m.clientURLs) ? m.clientURLs : [],
        healthy: true,
      })),
    };
  } catch {
    return null;
  }
}
