/**
 * PR diff context extractor.
 *
 * Fetches base branch, head commit, and changed files/packages for a pull request.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface PrDiffContext {
  baseBranch: string;
  headSha: string;
  changedFiles: string[];
  changedPackages: string[];
}

export async function getPrDiffFiles(
  owner: string,
  repo: string,
  prNumber: number,
  runGh?: (args: string[]) => Promise<string>,
): Promise<PrDiffContext> {
  const execGh =
    runGh ??
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args, { timeout: 30_000 });
      return stdout;
    });

  const raw = await execGh([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${owner}/${repo}`,
    "--json",
    "baseRefName,headRefOid,files",
  ]);

  const parsed = JSON.parse(raw);
  const files: string[] = (parsed.files || []).map((f: { path: string }) => f.path);
  const pkgs = new Set<string>();

  for (const f of files) {
    if (f.endsWith(".go")) {
      const dir = path.dirname(f);
      pkgs.add(dir === "." ? "." : dir);
    }
  }

  return {
    baseBranch: parsed.baseRefName || "main",
    headSha: parsed.headRefOid || "",
    changedFiles: files,
    changedPackages: Array.from(pkgs),
  };
}
