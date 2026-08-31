// extensions/pr/auth.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const APPROVED_BOTS = new Set(["coderabbitai", "coderabbitai[bot]"]);
export const IGNORED_ACCOUNTS = new Set([
  "openshift-ci-robot",
  "openshift-ci",
  "openshift-merge-robot",
  "openshift-bot",
]);

export function parseOwnersYaml(content: string): {
  approvers: string[];
  reviewers: string[];
  filters: Record<string, { approvers?: string[]; reviewers?: string[] }>;
} {
  const approvers: string[] = [];
  const reviewers: string[] = [];
  const filters: Record<string, { approvers?: string[]; reviewers?: string[] }> = {};

  const lines = content.split("\n");
  let section: "none" | "approvers" | "reviewers" | "filters" = "none";
  let currentFilter = "";
  let filterSubSection: "none" | "approvers" | "reviewers" = "none";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (rawLine.match(/^[a-z_]+:/)) {
      if (line.startsWith("approvers:")) {
        section = "approvers";
      } else if (line.startsWith("reviewers:")) {
        section = "reviewers";
      } else if (line.startsWith("filters:")) {
        section = "filters";
      } else {
        section = "none";
      }
      currentFilter = "";
      filterSubSection = "none";
      continue;
    }

    if (section === "approvers" && line.startsWith("- ")) {
      approvers.push(line.slice(2).trim());
    } else if (section === "reviewers" && line.startsWith("- ")) {
      reviewers.push(line.slice(2).trim());
    } else if (section === "filters") {
      const filterMatch = rawLine.match(/^ {2,4}["']?([^"':]+)["']?:/);
      if (filterMatch && !line.startsWith("approvers:") && !line.startsWith("reviewers:")) {
        currentFilter = filterMatch[1].trim();
        filters[currentFilter] = { approvers: [], reviewers: [] };
        filterSubSection = "none";
        continue;
      }
      if (currentFilter) {
        if (line.startsWith("approvers:")) {
          filterSubSection = "approvers";
        } else if (line.startsWith("reviewers:")) {
          filterSubSection = "reviewers";
        } else if (line.startsWith("- ")) {
          const entry = line.slice(2).trim();
          if (filterSubSection === "approvers") {
            filters[currentFilter]?.approvers?.push(entry);
          } else if (filterSubSection === "reviewers") {
            filters[currentFilter]?.reviewers?.push(entry);
          }
        }
      }
    }
  }

  return { approvers, reviewers, filters };
}

export function parseOwnersAliasesYaml(content: string): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  const lines = content.split("\n");
  let inAliases = false;
  let currentAlias = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("aliases:")) {
      inAliases = true;
      continue;
    }
    if (!inAliases) continue;

    const aliasMatch = rawLine.match(/^ {2,4}([A-Za-z0-9_-]+):/);
    if (aliasMatch) {
      currentAlias = aliasMatch[1];
      aliases[currentAlias] = [];
      continue;
    }

    if (currentAlias && line.startsWith("- ")) {
      aliases[currentAlias].push(line.slice(2).trim());
    }
  }

  return aliases;
}

const authCache = new Map<string, { authorized: boolean; reason: string }>();

export function clearAuthCache(): void {
  authCache.clear();
}

export async function isAuthorizedAuthor(
  owner: string,
  repo: string,
  login: string,
  options?: { ghRunner?: (args: string[]) => Promise<string> },
): Promise<{ authorized: boolean; reason: string }> {
  if (!login) return { authorized: false, reason: "empty_login" };

  const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}:${login.toLowerCase()}`;
  if (authCache.has(cacheKey)) {
    return authCache.get(cacheKey)!;
  }

  const lowerLogin = login.toLowerCase();
  if (APPROVED_BOTS.has(lowerLogin)) {
    const res = { authorized: true, reason: "approved_bot" };
    authCache.set(cacheKey, res);
    return res;
  }

  if (IGNORED_ACCOUNTS.has(lowerLogin) || (lowerLogin.endsWith("[bot]") && !APPROVED_BOTS.has(lowerLogin))) {
    const res = { authorized: false, reason: "ignored_bot" };
    authCache.set(cacheKey, res);
    return res;
  }

  const runGh = options?.ghRunner ?? (async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args, { timeout: 30000 });
    return stdout;
  });

  const authorizedUsers = new Set<string>();
  const aliases: Record<string, string[]> = {};

  try {
    const aliasContent = await runGh([
      "api",
      "-H",
      "Accept: application/vnd.github.raw",
      `repos/${owner}/${repo}/contents/OWNERS_ALIASES`,
    ]);
    const parsedAliases = parseOwnersAliasesYaml(aliasContent);
    Object.assign(aliases, parsedAliases);
    for (const members of Object.values(parsedAliases)) {
      for (const m of members) authorizedUsers.add(m.toLowerCase());
    }
  } catch {
    // No OWNERS_ALIASES or 404
  }

  try {
    const ownersContent = await runGh([
      "api",
      "-H",
      "Accept: application/vnd.github.raw",
      `repos/${owner}/${repo}/contents/OWNERS`,
    ]);
    const parsedOwners = parseOwnersYaml(ownersContent);
    const addList = (list?: string[]) => {
      for (const entry of list || []) {
        if (aliases[entry]) {
          for (const m of aliases[entry]) authorizedUsers.add(m.toLowerCase());
        } else {
          authorizedUsers.add(entry.toLowerCase());
        }
      }
    };
    addList(parsedOwners.approvers);
    addList(parsedOwners.reviewers);
    for (const f of Object.values(parsedOwners.filters)) {
      addList(f.approvers);
      addList(f.reviewers);
    }
  } catch {
    // No OWNERS or 404
  }

  if (authorizedUsers.has(lowerLogin)) {
    const res = { authorized: true, reason: "owners" };
    authCache.set(cacheKey, res);
    return res;
  }

  try {
    await runGh(["api", `orgs/${owner}/members/${login}`]);
    const res = { authorized: true, reason: "org_member" };
    authCache.set(cacheKey, res);
    return res;
  } catch {
    const res = { authorized: false, reason: "not_authorized" };
    authCache.set(cacheKey, res);
    return res;
  }
}
