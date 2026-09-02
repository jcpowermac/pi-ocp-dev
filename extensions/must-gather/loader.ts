import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const CACHE_BASE = path.join(os.homedir(), ".cache", "pi-ocp-dev", "must-gather");

export function getCacheDir(): string {
  if (!fs.existsSync(CACHE_BASE)) {
    fs.mkdirSync(CACHE_BASE, { recursive: true });
  }
  return CACHE_BASE;
}

export async function resolveMustGatherPath(source: string): Promise<string> {
  const trimmed = source.trim();

  // 1. Direct directory check
  if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
    // Check if it's the root with a nested hash directory
    if (
      fs.existsSync(path.join(trimmed, "cluster-scoped-resources")) ||
      fs.existsSync(path.join(trimmed, "namespaces"))
    ) {
      return trimmed;
    }
    const entries = fs.readdirSync(trimmed, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const sub = path.join(trimmed, e.name);
        if (
          fs.existsSync(path.join(sub, "cluster-scoped-resources")) ||
          fs.existsSync(path.join(sub, "namespaces"))
        ) {
          return sub;
        }
      }
    }
    return trimmed;
  }

  // 2. Local Tarball check (.tar, .tar.gz, .tgz)
  if (
    fs.existsSync(trimmed) &&
    (trimmed.endsWith(".tar") || trimmed.endsWith(".tar.gz") || trimmed.endsWith(".tgz"))
  ) {
    const hash = Buffer.from(trimmed).toString("hex").slice(0, 16);
    const dest = path.join(getCacheDir(), hash);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
      execSync(`tar -xf "${trimmed}" -C "${dest}"`);
    }
    return resolveMustGatherPath(dest);
  }

  // 3. Remote Prow / GCS URL
  if (
    trimmed.startsWith("https://prow.ci.openshift.org/view/gs/") ||
    trimmed.startsWith("https://storage.googleapis.com/")
  ) {
    const hash = Buffer.from(trimmed).toString("hex").slice(0, 16);
    const dest = path.join(getCacheDir(), hash);
    if (fs.existsSync(dest)) {
      return resolveMustGatherPath(dest);
    }
    throw new Error(`Remote GCS artifact extraction for ${trimmed} requires downloading artifacts to ${dest}`);
  }

  throw new Error(`Invalid must-gather path or archive: ${source}`);
}
