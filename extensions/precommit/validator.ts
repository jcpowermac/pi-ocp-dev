export const TRUSTED_REPOS: Record<string, string[] | null> = {
  "https://github.com/pre-commit/pre-commit-hooks": [
    "check-merge-conflict",
    "check-yaml",
    "trailing-whitespace",
  ],
  "https://github.com/leaktk/gitleaks": null, // all hooks allowed
};

export function validatePrecommitConfig(yamlContent: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const lines = yamlContent.split("\n");

  let inRepos = false;
  let currentRepo = "";
  let inHooks = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("repos:")) {
      inRepos = true;
      continue;
    }
    if (!inRepos) continue;

    const repoMatch = line.match(/^-\s+repo:\s*(.+)$/);
    if (repoMatch) {
      currentRepo = repoMatch[1].trim().replace(/['"]/g, "");
      inHooks = false;
      if (currentRepo !== "local" && !(currentRepo in TRUSTED_REPOS)) {
        errors.push(`untrusted repo: ${currentRepo}`);
      }
      continue;
    }

    if (line.startsWith("hooks:")) {
      inHooks = true;
      continue;
    }

    if (inHooks) {
      const hookMatch = line.match(/^-\s+id:\s*(.+)$/);
      if (hookMatch && currentRepo && currentRepo !== "local") {
        const hookId = hookMatch[1].trim().replace(/['"]/g, "");
        const allowedHooks = TRUSTED_REPOS[currentRepo];
        if (allowedHooks !== null && allowedHooks !== undefined && !allowedHooks.includes(hookId)) {
          errors.push(`untrusted hook: ${currentRepo} -> ${hookId}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
