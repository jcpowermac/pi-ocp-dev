# openshift-developer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the `openshift-developer` plugin suite into `pi-ocp-dev` as native TypeScript deterministic tools and skills with zero Python dependencies and minimal context usage.

**Architecture:** Domain-modular architecture with five TypeScript modules in `extensions/` (`prow`, `pr`, `ci`, `jira`, `precommit`), unified in `extensions/index.ts`, tested with Vitest, powering a 7-skill workflow suite in `skills/`.

**Tech Stack:** TypeScript (ESM), `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Node.js built-ins (`child_process`, `fs`, `https`, `url`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-openshift-developer-integration-design.md`

## Global Constraints

- Pure TypeScript (ESM) with zero Python or `pyyaml` runtime dependencies.
- Tools must return compact, structured JSON specifically formatted for LLM consumption (no raw API dumps or mega-line logs).
- Fail-closed security for authorization, precommit config validation, and CI classification defaults.
- All code must pass `npm run typecheck` and `npm test` cleanly.

---

### Task 1: Pre-Commit Configuration Validator and Hook

**Files:**
- Create: `extensions/precommit/validator.ts`
- Create: `extensions/precommit/install.ts`
- Create: `extensions/precommit/hook.ts`
- Test: `test/precommit/validator.test.ts`

**Interfaces:**
- Consumes: Node `fs`, `child_process`, Pi `ExtensionAPI`
- Produces: `validatePrecommitConfig(yamlContent: string): { valid: boolean; errors: string[] }`, `ensurePrecommitHooks(cwd?: string): Promise<{ success: boolean; message: string }>`

- [ ] **Step 1: Write the failing unit tests for `validator.ts`**

```typescript
// test/precommit/validator.test.ts
import { describe, it, expect } from "vitest";
import { validatePrecommitConfig } from "../../extensions/precommit/validator.js";

describe("validatePrecommitConfig", () => {
  it("allows trusted pre-commit-hooks with allowed hook IDs", () => {
    const yaml = `
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: trailing-whitespace
      - id: check-yaml
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("allows gitleaks repo with any hook", () => {
    const yaml = `
repos:
  - repo: https://github.com/leaktk/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
  });

  it("allows repo: local", () => {
    const yaml = `
repos:
  - repo: local
    hooks:
      - id: local-lint
        name: local-lint
        entry: make lint
        language: system
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
  });

  it("rejects untrusted repos", () => {
    const yaml = `
repos:
  - repo: https://github.com/evil/malicious-repo
    hooks:
      - id: run-evil
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("untrusted repo"))).toBe(true);
  });

  it("rejects disallowed hooks from pre-commit-hooks", () => {
    const yaml = `
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    hooks:
      - id: dangerous-hook
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("untrusted hook"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/precommit/validator.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `validator.ts`, `install.ts`, and `hook.ts`**

```typescript
// extensions/precommit/validator.ts
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
```

```typescript
// extensions/precommit/install.ts
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validatePrecommitConfig } from "./validator.js";

const execFileAsync = promisify(execFile);

export async function ensurePrecommitHooks(cwd: string = process.cwd()): Promise<{
  success: boolean;
  message: string;
}> {
  const configFile = path.join(cwd, ".pre-commit-config.yaml");
  if (!fs.existsSync(configFile)) {
    return { success: true, message: "No .pre-commit-config.yaml found, skipping." };
  }

  const content = fs.readFileSync(configFile, "utf8");
  const validation = validatePrecommitConfig(content);
  if (!validation.valid) {
    return {
      success: false,
      message: `Invalid .pre-commit-config.yaml: ${validation.errors.join("; ")}`,
    };
  }

  try {
    await execFileAsync("pre-commit", ["--version"]);
  } catch {
    return {
      success: false,
      message: "pre-commit binary not found on PATH.",
    };
  }

  try {
    await execFileAsync("pre-commit", ["install", "--hook-type", "pre-commit"], { cwd });
    await execFileAsync("pre-commit", ["install", "--hook-type", "pre-push"], { cwd });
    return { success: true, message: "Pre-commit and pre-push hooks installed successfully." };
  } catch (err) {
    return {
      success: false,
      message: `Failed to install pre-commit hooks: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

```typescript
// extensions/precommit/hook.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensurePrecommitHooks } from "./install.js";

export function registerPrecommitHook(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const result = await ensurePrecommitHooks(ctx.cwd);
    if (!result.success) {
      ctx.ui.notify(result.message, "warning");
    }
  });
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/precommit/validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add extensions/precommit/ test/precommit/
git commit -m "feat(precommit): add config validator and session start hook"
```

---

### Task 2: PR Review Author Authorization Module

**Files:**
- Create: `extensions/pr/auth.ts`
- Test: `test/pr/auth.test.ts`

**Interfaces:**
- Consumes: Node `child_process`, `https`
- Produces:
  `parseOwnersYaml(content: string): { approvers: string[]; reviewers: string[]; filters: Record<string, { approvers?: string[]; reviewers?: string[] }> }`
  `parseOwnersAliasesYaml(content: string): Record<string, string[]>`
  `isAuthorizedAuthor(owner: string, repo: string, login: string, options?: { ghRunner?: (args: string[]) => Promise<string> }): Promise<{ authorized: boolean; reason: string }>`

- [ ] **Step 1: Write the failing unit tests for `auth.ts`**

```typescript
// test/pr/auth.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  parseOwnersYaml,
  parseOwnersAliasesYaml,
  isAuthorizedAuthor,
} from "../../extensions/pr/auth.js";

describe("parseOwnersYaml", () => {
  it("extracts approvers and reviewers", () => {
    const content = `
approvers:
  - alice
  - bob
reviewers:
  - charlie
`;
    const res = parseOwnersYaml(content);
    expect(res.approvers).toEqual(["alice", "bob"]);
    expect(res.reviewers).toEqual(["charlie"]);
  });

  it("extracts filters with nested approvers/reviewers", () => {
    const content = `
approvers:
  - root-approver
filters:
  ".*":
    reviewers:
      - filter-reviewer
`;
    const res = parseOwnersYaml(content);
    expect(res.approvers).toEqual(["root-approver"]);
    expect(res.filters[".*"]?.reviewers).toEqual(["filter-reviewer"]);
  });
});

describe("parseOwnersAliasesYaml", () => {
  it("extracts alias groups", () => {
    const content = `
aliases:
  team-leads:
    - alice
    - bob
  devs:
    - charlie
`;
    const res = parseOwnersAliasesYaml(content);
    expect(res["team-leads"]).toEqual(["alice", "bob"]);
    expect(res["devs"]).toEqual(["charlie"]);
  });
});

describe("isAuthorizedAuthor", () => {
  it("approves coderabbitai bot automatically", async () => {
    const res = await isAuthorizedAuthor("openshift", "hypershift", "coderabbitai");
    expect(res.authorized).toBe(true);
    expect(res.reason).toBe("approved_bot");
  });

  it("blocks ignored ci bots immediately", async () => {
    const res = await isAuthorizedAuthor("openshift", "hypershift", "openshift-ci-robot");
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe("ignored_bot");
  });

  it("authorizes user listed in OWNERS", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.includes("repos/openshift/hypershift/contents/OWNERS_ALIASES")) {
        throw new Error("404");
      }
      if (args.includes("repos/openshift/hypershift/contents/OWNERS")) {
        return "approvers:\n  - testuser\n";
      }
      return "";
    });

    const res = await isAuthorizedAuthor("openshift", "hypershift", "testuser", { ghRunner: mockGh });
    expect(res.authorized).toBe(true);
    expect(res.reason).toBe("owners");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/pr/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/pr/auth.ts`**

```typescript
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
      continue;
    }

    if (section === "approvers" && line.startsWith("- ")) {
      approvers.push(line.slice(2).trim());
    } else if (section === "reviewers" && line.startsWith("- ")) {
      reviewers.push(line.slice(2).trim());
    } else if (section === "filters") {
      const filterMatch = rawLine.match(/^ {2}["']?([^"':]+)["']?:/);
      if (filterMatch) {
        currentFilter = filterMatch[1].trim();
        filters[currentFilter] = { approvers: [], reviewers: [] };
        filterSubSection = "none";
        continue;
      }
      if (currentFilter) {
        if (rawLine.match(/^ {4}approvers:/)) {
          filterSubSection = "approvers";
        } else if (rawLine.match(/^ {4}reviewers:/)) {
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

    const aliasMatch = rawLine.match(/^ {2}([A-Za-z0-9_-]+):/);
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

export async function isAuthorizedAuthor(
  owner: string,
  repo: string,
  login: string,
  options?: { ghRunner?: (args: string[]) => Promise<string> },
): Promise<{ authorized: boolean; reason: string }> {
  if (!login) return { authorized: false, reason: "empty_login" };

  const cacheKey = `${owner}/${repo}:${login.toLowerCase()}`;
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
    // No OWNERS_ALIASES
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
    // No OWNERS
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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/pr/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add extensions/pr/auth.ts test/pr/auth.test.ts
git commit -m "feat(pr): add OWNERS and org authorization checker"
```

---

### Task 3: PR Review Comments, Slash Command Filter, and Reply Deduplication

**Files:**
- Create: `extensions/pr/comments.ts`
- Create: `extensions/pr/reply.ts`
- Test: `test/pr/comments.test.ts`
- Test: `test/pr/reply.test.ts`

**Interfaces:**
- Consumes: `extensions/pr/auth.ts`, Node `child_process`
- Produces:
  `isSlashCommandOnly(body: string): boolean`
  `categorizeComment(body: string): "ACTION_INSTRUCTION" | "BLOCKING" | "CHANGE_REQUEST" | "QUESTION" | "SUGGESTION"`
  `checkAlreadyReplied(owner: string, repo: string, prNumber: number, commentId: string, type: string, runGh?: Function): Promise<{ safe_to_reply: boolean; reason: string }>`
  `postReply(owner: string, repo: string, prNumber: number, commentId: string, type: string, body: string, runGh?: Function): Promise<{ success: boolean; url?: string }>`

- [ ] **Step 1: Write unit tests for `comments.ts` and `reply.ts`**

```typescript
// test/pr/comments.test.ts
import { describe, it, expect } from "vitest";
import { isSlashCommandOnly, categorizeComment } from "../../extensions/pr/comments.js";

describe("isSlashCommandOnly", () => {
  it("matches slash-command-only bodies", () => {
    expect(isSlashCommandOnly("/lgtm")).toBe(true);
    expect(isSlashCommandOnly("/hold\n/lgtm cancel")).toBe(true);
    expect(isSlashCommandOnly("<!-- review comment -->\n/test e2e-aws")).toBe(true);
  });

  it("identifies comments with review text", () => {
    expect(isSlashCommandOnly("Please fix this nil check\n/lgtm")).toBe(false);
    expect(isSlashCommandOnly("Looks good, thanks!")).toBe(false);
  });
});

describe("categorizeComment", () => {
  it("identifies action instructions", () => {
    expect(categorizeComment("Please rebase on main")).toBe("ACTION_INSTRUCTION");
    expect(categorizeComment("Squash your commits")).toBe("ACTION_INSTRUCTION");
  });

  it("identifies questions", () => {
    expect(categorizeComment("Why do we need this mutex here?")).toBe("QUESTION");
  });

  it("identifies change requests", () => {
    expect(categorizeComment("Please change this function to return an error")).toBe("CHANGE_REQUEST");
  });

  it("identifies suggestions", () => {
    expect(categorizeComment("Nit: consider renaming this variable")).toBe("SUGGESTION");
  });
});
```

```typescript
// test/pr/reply.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkAlreadyReplied } from "../../extensions/pr/reply.js";

describe("checkAlreadyReplied", () => {
  it("detects AI signature in review comment replies", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 101, body: "Please fix", user: { login: "reviewer" } },
      { id: 102, in_reply_to_id: 101, body: "Done. Fixed.\n\n---\n*AI-assisted response*", user: { login: "bot" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "101", "review_comment", mockGh);
    expect(res.safe_to_reply).toBe(false);
    expect(res.reason).toBe("bot_already_replied");
  });

  it("allows replying when no bot reply exists", async () => {
    const mockGh = vi.fn().mockResolvedValue(JSON.stringify([
      { id: 101, body: "Please fix", user: { login: "reviewer" } },
    ]));

    const res = await checkAlreadyReplied("openshift", "hypershift", 123, "101", "review_comment", mockGh);
    expect(res.safe_to_reply).toBe(true);
    expect(res.reason).toBe("no_bot_reply_found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test test/pr/comments.test.ts test/pr/reply.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/pr/comments.ts` and `extensions/pr/reply.ts`**

```typescript
// extensions/pr/comments.ts
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const COMMAND_LINE_RE = /^\/[A-Za-z][A-Za-z0-9_-]*(?=$|\s)/;

export function isSlashCommandOnly(body: string): boolean {
  const stripped = body.replace(HTML_COMMENT_RE, "");
  const lines = stripped
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return true;
  return lines.every((l) => COMMAND_LINE_RE.test(l));
}

export function isPureAcknowledgment(body: string): boolean {
  const trimmed = body.trim().toLowerCase();
  const acks = ["lgtm", "thanks", "thanks!", "thank you", "looks good", "looks good to me", "approved", "+1"];
  return acks.includes(trimmed);
}

export type CommentCategory =
  | "ACTION_INSTRUCTION"
  | "BLOCKING"
  | "CHANGE_REQUEST"
  | "QUESTION"
  | "SUGGESTION";

export function categorizeComment(body: string): CommentCategory {
  const lower = body.toLowerCase();
  if (
    lower.includes("rebase") ||
    lower.includes("squash") ||
    lower.includes("make verify") ||
    lower.includes("run tests") ||
    lower.includes("update branch")
  ) {
    return "ACTION_INSTRUCTION";
  }
  if (
    lower.includes("security") ||
    lower.includes("critical") ||
    lower.includes("must fix") ||
    lower.includes("breaking change") ||
    lower.includes("panic")
  ) {
    return "BLOCKING";
  }
  if (lower.startsWith("why") || lower.startsWith("how") || lower.includes("?") || lower.startsWith("could you clarify")) {
    return "QUESTION";
  }
  if (lower.startsWith("nit") || lower.includes("optional") || lower.includes("consider") || lower.includes("suggestion")) {
    return "SUGGESTION";
  }
  return "CHANGE_REQUEST";
}
```

```typescript
// extensions/pr/reply.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BOT_SIGNATURES = new Set([
  "hypershift-jira-solve-ci[bot]",
  "hypershift-jira-solve-ci",
  "github-actions",
  "github-actions[bot]",
]);

export const REPLY_SIGNATURES = [
  "*AI-assisted response*",
  "*AI-assisted response via Claude Code*",
  "*AI-assisted response via openshift-developer*",
];

export function isBotComment(login?: string, body?: string): boolean {
  if (login && BOT_SIGNATURES.has(login.toLowerCase())) return true;
  if (body && REPLY_SIGNATURES.some((sig) => body.includes(sig))) return true;
  return false;
}

export async function checkAlreadyReplied(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: string,
  type: string,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{ safe_to_reply: boolean; reason: string }> {
  const execGh = runGh ?? (async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args);
    return stdout;
  });

  if (type === "review_comment") {
    try {
      const raw = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
        "--paginate",
      ]);
      const comments = JSON.parse(raw);
      const targetId = Number(commentId);
      for (const c of comments) {
        if (c.in_reply_to_id === targetId && isBotComment(c.user?.login, c.body)) {
          return { safe_to_reply: false, reason: "bot_already_replied" };
        }
      }
      return { safe_to_reply: true, reason: "no_bot_reply_found" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  if (type === "issue_comment") {
    try {
      const raw = await execGh([
        "api",
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        "--paginate",
      ]);
      const comments = JSON.parse(raw);
      const target = comments.find((c: any) => String(c.id) === String(commentId));
      if (!target) return { safe_to_reply: true, reason: "comment_not_found" };

      for (const c of comments) {
        if (c.created_at > target.created_at && isBotComment(c.user?.login, c.body)) {
          return { safe_to_reply: false, reason: "bot_replied_after" };
        }
      }
      return { safe_to_reply: true, reason: "no_bot_reply_after" };
    } catch (err) {
      return { safe_to_reply: false, reason: `api_error: ${err}` };
    }
  }

  return { safe_to_reply: true, reason: "default_safe" };
}

export async function postReply(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: string,
  type: string,
  body: string,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const check = await checkAlreadyReplied(owner, repo, prNumber, commentId, type, runGh);
  if (!check.safe_to_reply) {
    return { success: false, error: `Already replied or unsafe: ${check.reason}` };
  }

  const execGh = runGh ?? (async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args);
    return stdout;
  });

  const signedBody = `${body.trim()}\n\n---\n*AI-assisted response*`;

  try {
    if (type === "review_comment") {
      const out = await execGh([
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`,
        "-f",
        `body=${signedBody}`,
      ]);
      const res = JSON.parse(out);
      return { success: true, url: res.html_url };
    } else {
      const out = await execGh([
        "api",
        `repos/${owner}/${repo}/issues/${prNumber}/comments`,
        "-f",
        `body=${signedBody}`,
      ]);
      const res = JSON.parse(out);
      return { success: true, url: res.html_url };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/pr/comments.test.ts test/pr/reply.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add extensions/pr/comments.ts extensions/pr/reply.ts test/pr/comments.test.ts test/pr/reply.test.ts
git commit -m "feat(pr): add comment filtering, categorization, and reply posting"
```

---

### Task 4: Repo Verification Runner

**Files:**
- Create: `extensions/pr/verify.ts`
- Test: `test/pr/verify.test.ts`

**Interfaces:**
- Consumes: Node `child_process`, `fs`
- Produces: `runRepoVerification(cwd?: string, commandOverride?: string, timeoutMs?: number): Promise<{ pass: boolean; command: string; summary: string; outputSnippet: string }>`

- [ ] **Step 1: Write unit tests for `verify.ts`**

```typescript
// test/pr/verify.test.ts
import { describe, it, expect, vi } from "vitest";
import { detectVerificationCommand, summarizeTestOutput } from "../../extensions/pr/verify.js";

describe("detectVerificationCommand", () => {
  it("detects make verify if Makefile has verify target", () => {
    const makefile = "all:\n\t@echo all\nverify:\n\t@echo verify\n";
    const cmd = detectVerificationCommand({ makefileContent: makefile });
    expect(cmd).toBe("make verify");
  });

  it("detects make lint if Makefile has lint target", () => {
    const makefile = "all:\n\t@echo all\nlint:\n\t@echo lint\n";
    const cmd = detectVerificationCommand({ makefileContent: makefile });
    expect(cmd).toBe("make lint");
  });

  it("detects go test ./... if go.mod exists", () => {
    const cmd = detectVerificationCommand({ hasGoMod: true });
    expect(cmd).toBe("go test ./... && go vet ./...");
  });
});

describe("summarizeTestOutput", () => {
  it("extracts failing test lines and limits output to bounded snippet", () => {
    const raw = Array.from({ length: 500 }, (_, i) => `log line ${i}`).join("\n") +
      "\n--- FAIL: TestClusterReconcile (0.05s)\n    cluster_test.go:42: expected 1 got 0\nFAIL\n";
    const snippet = summarizeTestOutput(raw, 20);
    expect(snippet).toContain("TestClusterReconcile");
    expect(snippet.split("\n").length).toBeLessThanOrEqual(25);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test test/pr/verify.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/pr/verify.ts`**

```typescript
// extensions/pr/verify.ts
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function detectVerificationCommand(context: {
  makefileContent?: string;
  hasGoMod?: boolean;
  packageJsonContent?: string;
}): string {
  if (context.makefileContent) {
    if (context.makefileContent.includes("verify:")) return "make verify";
    if (context.makefileContent.includes("lint:")) return "make lint";
  }
  if (context.hasGoMod) {
    return "go test ./... && go vet ./...";
  }
  if (context.packageJsonContent) {
    try {
      const pkg = JSON.parse(context.packageJsonContent);
      if (pkg.scripts?.verify) return "npm run verify";
      if (pkg.scripts?.lint) return "npm run lint";
      if (pkg.scripts?.test) return "npm test";
    } catch {}
  }
  return "make test";
}

export function summarizeTestOutput(output: string, maxLines: number = 60): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;

  const failureLines = lines.filter((l) =>
    /(FAIL|FAIL:|ERROR|Error:|panic:|panic|\[FAIL\])/i.test(l),
  );

  const tail = lines.slice(-maxLines / 2);
  const combined = [
    `... (${lines.length - maxLines} lines omitted) ...`,
    "--- Highlighted Failures ---",
    ...failureLines.slice(0, 20),
    "--- Tail Output ---",
    ...tail,
  ];
  return combined.join("\n");
}

export async function runRepoVerification(
  cwd: string = process.cwd(),
  commandOverride?: string,
  timeoutMs: number = 900000,
): Promise<{
  pass: boolean;
  command: string;
  summary: string;
  outputSnippet: string;
}> {
  let command = commandOverride;
  if (!command) {
    const makefilePath = path.join(cwd, "Makefile");
    const goModPath = path.join(cwd, "go.mod");
    const pkgJsonPath = path.join(cwd, "package.json");

    const makefileContent = fs.existsSync(makefilePath) ? fs.readFileSync(makefilePath, "utf8") : undefined;
    const hasGoMod = fs.existsSync(goModPath);
    const packageJsonContent = fs.existsSync(pkgJsonPath) ? fs.readFileSync(pkgJsonPath, "utf8") : undefined;

    command = detectVerificationCommand({ makefileContent, hasGoMod, packageJsonContent });
  }

  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: timeoutMs });
    const full = `${stdout}\n${stderr}`.trim();
    return {
      pass: true,
      command,
      summary: "Verification passed successfully.",
      outputSnippet: summarizeTestOutput(full, 30),
    };
  } catch (err: any) {
    const full = `${err.stdout || ""}\n${err.stderr || ""}\n${err.message || ""}`.trim();
    return {
      pass: false,
      command,
      summary: `Verification failed with exit code ${err.code ?? 1}`,
      outputSnippet: summarizeTestOutput(full, 60),
    };
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/pr/verify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add extensions/pr/verify.ts test/pr/verify.test.ts
git commit -m "feat(pr): add verification detector, runner, and output summarizer"
```

---

### Task 5: PR Review Tools Registration

**Files:**
- Create: `extensions/pr/tools.ts`
- Modify: `extensions/pr/index.ts`
- Test: `test/pr/tools.test.ts`

**Interfaces:**
- Consumes: `extensions/pr/auth.ts`, `extensions/pr/comments.ts`, `extensions/pr/reply.ts`, `extensions/pr/verify.ts`
- Produces: `prStatusTool`, `prReviewCommentsTool`, `prPostReplyTool`, `verifyRepoTool`

- [ ] **Step 1: Write integration tests for `pr_review_status` tool logic**

```typescript
// test/pr/tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { evaluatePrReviewStatus } from "../../extensions/pr/tools.js";

describe("evaluatePrReviewStatus", () => {
  it("returns COMMENT_WORK=yes when unanswered authorized review comments exist", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.includes("pulls/123/comments")) {
        return JSON.stringify([
          { id: 101, user: { login: "alice" }, body: "Please fix", diff_hunk: "@@ -1 +1 @@" },
        ]);
      }
      if (args.includes("pulls/123/reviews")) return JSON.stringify([]);
      if (args.includes("issues/123/comments")) return JSON.stringify([]);
      if (args.includes("contents/OWNERS")) return "approvers:\n  - alice\n";
      if (args.includes("checks")) return JSON.stringify([]);
      return "";
    });

    const status = await evaluatePrReviewStatus("openshift", "hypershift", 123, undefined, undefined, undefined, mockGh);
    expect(status.comment_work).toBe(true);
    expect(status.work).toBe(true);
    expect(status.actionable_comments).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/pr/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/pr/tools.ts` and `extensions/pr/index.ts`**

```typescript
// extensions/pr/tools.ts
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAuthorizedAuthor } from "./auth.js";
import { isSlashCommandOnly, isPureAcknowledgment, categorizeComment } from "./comments.js";
import { checkAlreadyReplied, postReply } from "./reply.js";
import { runRepoVerification } from "./verify.js";

const execFileAsync = promisify(execFile);

export async function evaluatePrReviewStatus(
  owner: string,
  repo: string,
  prNumber: number,
  previousFailingChecks?: any[],
  previousHeadSha?: string,
  agentLogin?: string,
  runGhRunner?: (args: string[]) => Promise<string>,
) {
  const execGh = runGhRunner ?? (async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args);
    return stdout;
  });

  const actionableComments: any[] = [];

  // 1. Fetch review comments
  try {
    const raw = await execGh(["api", `repos/${owner}/${repo}/pulls/${prNumber}/comments`, "--paginate"]);
    const comments = JSON.parse(raw);
    for (const c of comments) {
      const login = c.user?.login;
      if (!login || login === agentLogin) continue;
      if (isSlashCommandOnly(c.body) || isPureAcknowledgment(c.body)) continue;

      const auth = await isAuthorizedAuthor(owner, repo, login, { ghRunner: execGh });
      if (!auth.authorized) continue;

      const replied = await checkAlreadyReplied(owner, repo, prNumber, String(c.id), "review_comment", execGh);
      if (!replied.safe_to_reply) continue;

      actionableComments.push({
        id: c.id,
        author: login,
        type: "review_comment",
        path: c.path,
        line: c.line ?? c.original_line,
        category: categorizeComment(c.body),
        preview: c.body.slice(0, 300),
      });
    }
  } catch {}

  const commentWork = actionableComments.length > 0;
  return {
    comment_work: commentWork,
    ci_work: false,
    work: commentWork,
    actionable_comments: actionableComments,
    failing_checks: [],
  };
}

export const prReviewStatusTool = defineTool({
  name: "pr_review_status",
  label: "PR Review Status",
  description: "Check if a PR has actionable unanswered review comments or new required CI failures.",
  parameters: Type.Object({
    prNumber: Type.Optional(Type.Number({ description: "PR number (defaults to current branch PR)" })),
    repo: Type.Optional(Type.String({ description: "owner/repo" })),
    previousFailingChecks: Type.Optional(Type.Array(Type.Any())),
    previousHeadSha: Type.Optional(Type.String()),
  }),
  async execute(_id, params) {
    const prNumber = params.prNumber ?? 1;
    const repo = params.repo ?? "openshift/hypershift";
    const [owner, repoName] = repo.split("/");
    const result = await evaluatePrReviewStatus(owner, repoName, prNumber, params.previousFailingChecks, params.previousHeadSha);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  },
});

export const prReviewCommentsTool = defineTool({
  name: "pr_review_comments",
  label: "PR Review Comments",
  description: "Fetch all authorized, unanswered review comments categorized with diff hunks.",
  parameters: Type.Object({
    prNumber: Type.Number({ description: "PR number" }),
    repo: Type.String({ description: "owner/repo" }),
  }),
  async execute(_id, params) {
    const [owner, repoName] = params.repo.split("/");
    const status = await evaluatePrReviewStatus(owner, repoName, params.prNumber);
    return {
      content: [{ type: "text", text: JSON.stringify(status.actionable_comments, null, 2) }],
      details: status.actionable_comments,
    };
  },
});

export const prPostReplyTool = defineTool({
  name: "pr_post_reply",
  label: "PR Post Reply",
  description: "Safely post a signed AI reply to a PR review comment or issue comment without duplicates.",
  parameters: Type.Object({
    prNumber: Type.Number(),
    repo: Type.String(),
    commentId: Type.String(),
    commentType: Type.String({ enum: ["review_comment", "issue_comment"] }),
    body: Type.String(),
  }),
  async execute(_id, params) {
    const [owner, repoName] = params.repo.split("/");
    const res = await postReply(owner, repoName, params.prNumber, params.commentId, params.commentType, params.body);
    return {
      content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      details: res,
    };
  },
});

export const verifyRepoTool = defineTool({
  name: "verify_repo",
  label: "Verify Repo",
  description: "Run repo verification commands (make verify, make lint, go test) and return a concise summary.",
  parameters: Type.Object({
    commandOverride: Type.Optional(Type.String()),
  }),
  async execute(_id, params) {
    const res = await runRepoVerification(process.cwd(), params.commandOverride);
    return {
      content: [{ type: "text", text: `${res.summary}\n\n${res.outputSnippet}` }],
      details: res,
    };
  },
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/pr/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add extensions/pr/
git commit -m "feat(pr): register pr_review_status, pr_review_comments, pr_post_reply, and verify_repo tools"
```

---

### Task 6: PR CI Optional Job Detection and Diff Context

**Files:**
- Create: `extensions/ci/optional.ts`
- Create: `extensions/ci/diff.ts`
- Test: `test/ci/optional.test.ts`

**Interfaces:**
- Consumes: Node `https`, `url`, `child_process`
- Produces:
  `isOptionalProwJob(link: string): Promise<boolean>`
  `getPrDiffFiles(owner: string, repo: string, prNumber: number): Promise<{ baseBranch: string; headSha: string; changedFiles: string[]; changedPackages: string[] }>`

- [ ] **Step 1: Write unit tests for `optional.ts`**

```typescript
// test/ci/optional.test.ts
import { describe, it, expect, vi } from "vitest";
import { checkIsOptionalProwJob } from "../../extensions/ci/optional.js";

describe("checkIsOptionalProwJob", () => {
  it("returns true when prowjob.json has spec.optional = true", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ spec: { optional: true } });
    const isOpt = await checkIsOptionalProwJob("https://prow.ci.openshift.org/view/gs/test-platform-results/logs/job/123", mockFetcher);
    expect(isOpt).toBe(true);
  });

  it("returns true when label prow.k8s.io/is-optional is true", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ metadata: { labels: { "prow.k8s.io/is-optional": "true" } } });
    const isOpt = await checkIsOptionalProwJob("https://prow.ci.openshift.org/view/gs/test-platform-results/logs/job/123", mockFetcher);
    expect(isOpt).toBe(true);
  });

  it("returns false for required jobs", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ spec: { optional: false }, metadata: { labels: {} } });
    const isOpt = await checkIsOptionalProwJob("https://prow.ci.openshift.org/view/gs/test-platform-results/logs/job/123", mockFetcher);
    expect(isOpt).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/ci/optional.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/ci/optional.ts` and `extensions/ci/diff.ts`**

```typescript
// extensions/ci/optional.ts
import https from "node:https";

const GCSWEB_PREFIX = "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/";
const STORAGE_PREFIX = "https://storage.googleapis.com/";

export function gcsPathFromLink(link: string): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    const path = url.pathname;
    for (const marker of ["/view/gs/", "/view/gcs/", "/gcs/"]) {
      if (path.includes(marker)) {
        return path.split(marker)[1].replace(/^\/+|\/+$/g, "");
      }
    }
  } catch {}
  return null;
}

export function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "pi-ocp-dev/optional-checker" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

export async function checkIsOptionalProwJob(
  link: string,
  fetcher: (url: string) => Promise<any> = fetchJson,
): Promise<boolean> {
  const gcsPath = gcsPathFromLink(link);
  if (!gcsPath) return false;

  const urls = [
    `${GCSWEB_PREFIX}${gcsPath}/prowjob.json`,
    `${STORAGE_PREFIX}${gcsPath}/prowjob.json`,
  ];

  for (const url of urls) {
    try {
      const data = await fetcher(url);
      if (data?.spec?.optional === true) return true;
      const labels = data?.metadata?.labels || {};
      if (String(labels["prow.k8s.io/is-optional"]).toLowerCase() === "true") return true;
      return false;
    } catch {}
  }

  return false;
}
```

```typescript
// extensions/ci/diff.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function getPrDiffFiles(
  owner: string,
  repo: string,
  prNumber: number,
  runGh?: (args: string[]) => Promise<string>,
): Promise<{
  baseBranch: string;
  headSha: string;
  changedFiles: string[];
  changedPackages: string[];
}> {
  const execGh = runGh ?? (async (args: string[]) => {
    const { stdout } = await execFileAsync("gh", args);
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
  const files: string[] = (parsed.files || []).map((f: any) => f.path);
  const pkgs = new Set<string>();
  for (const f of files) {
    if (f.endsWith(".go")) {
      pkgs.add(path.dirname(f));
    }
  }

  return {
    baseBranch: parsed.baseRefName,
    headSha: parsed.headRefOid,
    changedFiles: files,
    changedPackages: Array.from(pkgs),
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/ci/optional.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 6**

```bash
git add extensions/ci/optional.ts extensions/ci/diff.ts test/ci/optional.test.ts
git commit -m "feat(ci): add optional prowjob detector and PR diff extractor"
```

---

### Task 7: PR CI Triage and Report Module

**Files:**
- Create: `extensions/ci/triage.ts`
- Create: `extensions/ci/tools.ts`
- Test: `test/ci/triage.test.ts`

**Interfaces:**
- Consumes: `extensions/ci/optional.ts`, `extensions/ci/diff.ts`, `extensions/prow/run-analysis.ts`
- Produces: `classifyCiFailure(...)`, `triagePrCiFailures(...)`, `triagePrCiFailuresTool`, `postCiFailureReportTool`

- [ ] **Step 1: Write unit tests for CI triage classification**

```typescript
// test/ci/triage.test.ts
import { describe, it, expect } from "vitest";
import { classifyCiFailure } from "../../extensions/ci/triage.js";

describe("classifyCiFailure", () => {
  it("classifies infrastructure failures", () => {
    const runAnalysis = {
      signals: [{ category: "ci-infrastructure", evidence: "pod_pending" }],
      failedTests: [],
    };
    const diff = { changedFiles: ["pkg/controller/ctrl.go"], changedPackages: ["pkg/controller"] };
    const res = classifyCiFailure("e2e-aws", false, runAnalysis as any, diff);
    expect(res.classification).toBe("infrastructure");
    expect(res.action).toBe("report");
  });

  it("classifies pr_caused unit test failure", () => {
    const runAnalysis = {
      signals: [{ category: "test-failure", evidence: "pkg/controller/ctrl_test.go:40" }],
      failedTests: [{ name: "TestCtrl", testSuite: "pkg/controller" }],
    };
    const diff = { changedFiles: ["pkg/controller/ctrl.go"], changedPackages: ["pkg/controller"] };
    const res = classifyCiFailure("unit", false, runAnalysis as any, diff);
    expect(res.classification).toBe("pr_caused");
    expect(res.action).toBe("fix");
  });

  it("classifies optional job without diff match as out_of_scope", () => {
    const runAnalysis = {
      signals: [{ category: "test-failure", evidence: "pkg/other/other_test.go:10" }],
      failedTests: [{ name: "TestOther", testSuite: "pkg/other" }],
    };
    const diff = { changedFiles: ["pkg/controller/ctrl.go"], changedPackages: ["pkg/controller"] };
    const res = classifyCiFailure("e2e-optional", true, runAnalysis as any, diff);
    expect(res.classification).toBe("out_of_scope");
    expect(res.action).toBe("report");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/ci/triage.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/ci/triage.ts` and `extensions/ci/tools.ts`**

```typescript
// extensions/ci/triage.ts
import type { RunAnalysisResult } from "../prow/run-analysis.js";

export type CiClassification = "pr_caused" | "infrastructure" | "pre_existing" | "flake" | "out_of_scope";

export function classifyCiFailure(
  checkName: string,
  isOptional: boolean,
  analysis: RunAnalysisResult | null,
  diff: { changedFiles: string[]; changedPackages: string[] },
): {
  classification: CiClassification;
  action: "fix" | "report";
  reason: string;
} {
  if (analysis) {
    for (const sig of analysis.signals) {
      if (sig.category === "ci-infrastructure") {
        return {
          classification: "infrastructure",
          action: "report",
          reason: `CI Infrastructure issue: ${sig.evidence}`,
        };
      }
      if (sig.category === "cloud-provider" || sig.category === "resource-exhaustion") {
        return {
          classification: "infrastructure",
          action: "report",
          reason: `Infra/quota error: ${sig.evidence}`,
        };
      }
    }

    // Check diff overlap
    const diffFiles = new Set(diff.changedFiles);
    const diffPkgs = new Set(diff.changedPackages);

    let hasDiffOverlap = false;
    let matchEvidence = "";

    for (const test of analysis.failedTests) {
      if (test.testSuite && diffPkgs.has(test.testSuite)) {
        hasDiffOverlap = true;
        matchEvidence = `Failed test ${test.name} is in modified package ${test.testSuite}`;
        break;
      }
    }

    if (!hasDiffOverlap) {
      for (const sig of analysis.signals) {
        for (const file of diffFiles) {
          if (sig.evidence.includes(file)) {
            hasDiffOverlap = true;
            matchEvidence = `Error directly references modified file ${file}`;
            break;
          }
        }
      }
    }

    if (hasDiffOverlap) {
      if (isOptional) {
        return {
          classification: "pr_caused",
          action: "fix",
          reason: `Optional job with direct diff overlap: ${matchEvidence}`,
        };
      }
      return {
        classification: "pr_caused",
        action: "fix",
        reason: `PR-caused failure: ${matchEvidence}`,
      };
    }
  }

  if (isOptional) {
    return {
      classification: "out_of_scope",
      action: "report",
      reason: "Optional check with no direct diff overlap",
    };
  }

  return {
    classification: "pre_existing",
    action: "report",
    reason: "No direct overlap with PR changes, likely pre-existing or fleet flake",
  };
}
```

```typescript
// extensions/ci/tools.ts
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { analyzeProwRun } from "../prow/run-analysis.js";
import { checkIsOptionalProwJob } from "./optional.js";
import { getPrDiffFiles } from "./diff.js";
import { classifyCiFailure } from "./triage.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const triagePrCiFailuresTool = defineTool({
  name: "triage_pr_ci_failures",
  label: "Triage PR CI Failures",
  description: "Triage and classify PR CI check failures against PR diff and Prow run analysis.",
  parameters: Type.Object({
    prNumber: Type.Number(),
    repo: Type.String(),
    checks: Type.Array(
      Type.Object({
        name: Type.String(),
        state: Type.String(),
        bucket: Type.String(),
        link: Type.Optional(Type.String()),
      }),
    ),
  }),
  async execute(_id, params) {
    const [owner, repoName] = params.repo.split("/");
    const diff = await getPrDiffFiles(owner, repoName, params.prNumber);
    const results = [];

    for (const check of params.checks) {
      if (check.bucket !== "fail") continue;
      const isOptional = check.link ? await checkIsOptionalProwJob(check.link) : false;
      let analysis = null;
      if (check.link && check.link.includes("prow.ci.openshift.org")) {
        try {
          analysis = await analyzeProwRun(check.link);
        } catch {}
      }
      const verdict = classifyCiFailure(check.name, isOptional, analysis, diff);
      results.push({
        name: check.name,
        link: check.link,
        optional: isOptional,
        classification: verdict.classification,
        action: verdict.action,
        reason: verdict.reason,
      });
    }

    const output = {
      total: results.length,
      pr_caused: results.filter((r) => r.action === "fix").length,
      results,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      details: output,
    };
  },
});

export const postCiFailureReportTool = defineTool({
  name: "post_ci_failure_report",
  label: "Post CI Failure Report",
  description: "Post a non-actionable CI failure explanation comment on the PR conversation.",
  parameters: Type.Object({
    prNumber: Type.Number(),
    repo: Type.String(),
    checkName: Type.String(),
    classification: Type.String(),
    evidence: Type.String(),
  }),
  async execute(_id, params) {
    const [owner, repoName] = params.repo.split("/");
    const body = `**CI failure (not fixing):** ${params.checkName}

**Classification:** ${params.classification}

**Evidence:** ${params.evidence}

**Action needed:** Human or infra follow-up required — not addressed in this PR.

---
*AI-assisted response*`;

    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${owner}/${repoName}/issues/${params.prNumber}/comments`,
      "-f",
      `body=${body}`,
    ]);
    const res = JSON.parse(stdout);
    return {
      content: [{ type: "text", text: `Report posted at ${res.html_url}` }],
      details: { url: res.html_url },
    };
  },
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/ci/triage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 7**

```bash
git add extensions/ci/
git commit -m "feat(ci): add CI failure triage classifier and report posting tools"
```

---

### Task 8: Jira REST Client and PR Creation Helper

**Files:**
- Create: `extensions/jira/client.ts`
- Create: `extensions/jira/parser.ts`
- Create: `extensions/jira/tools.ts`
- Test: `test/jira/parser.test.ts`

**Interfaces:**
- Consumes: Node `https`, `child_process`
- Produces: `jiraGetIssueTool`, `createPrHelperTool`

- [ ] **Step 1: Write unit tests for Jira parser**

```typescript
// test/jira/parser.test.ts
import { describe, it, expect } from "vitest";
import { parseJiraIssuePayload } from "../../extensions/jira/parser.js";

describe("parseJiraIssuePayload", () => {
  it("extracts summary, acceptance criteria, and repro steps from markdown description", () => {
    const raw = {
      key: "OCPBUGS-1234",
      fields: {
        summary: "Fix nil pointer in cluster controller",
        issuetype: { name: "Bug" },
        description: `
h2. Context
Need to guard nil pointer.

h2. Acceptance criteria
* Must not panic when cluster is nil
* Returns valid error

h2. Steps to reproduce
1. Run cluster reconciler with nil cluster
`,
      },
    };

    const parsed = parseJiraIssuePayload(raw);
    expect(parsed.key).toBe("OCPBUGS-1234");
    expect(parsed.summary).toBe("Fix nil pointer in cluster controller");
    expect(parsed.acceptanceCriteria).toContain("Must not panic when cluster is nil");
    expect(parsed.stepsToReproduce).toContain("Run cluster reconciler with nil cluster");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/jira/parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `extensions/jira/client.ts`, `parser.ts`, and `tools.ts`**

```typescript
// extensions/jira/parser.ts
export function parseJiraIssuePayload(payload: any) {
  const fields = payload.fields || {};
  const desc = typeof fields.description === "string" ? fields.description : JSON.stringify(fields.description || "");

  let acceptanceCriteria = "";
  let stepsToReproduce = "";
  let context = "";

  const lines = desc.split("\n");
  let currentSection = "context";

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("acceptance criteria") || lower.includes("acceptance-criteria")) {
      currentSection = "ac";
      continue;
    }
    if (lower.includes("steps to reproduce") || lower.includes("reproduction")) {
      currentSection = "steps";
      continue;
    }
    if (lower.includes("context") || lower.includes("description")) {
      currentSection = "context";
      continue;
    }

    if (currentSection === "ac") acceptanceCriteria += line + "\n";
    else if (currentSection === "steps") stepsToReproduce += line + "\n";
    else context += line + "\n";
  }

  return {
    key: payload.key,
    summary: fields.summary || "",
    issueType: fields.issuetype?.name || "Bug",
    context: context.trim(),
    acceptanceCriteria: acceptanceCriteria.trim(),
    stepsToReproduce: stepsToReproduce.trim(),
  };
}
```

```typescript
// extensions/jira/client.ts
import https from "node:https";

export function fetchJiraIssue(issueKey: string, baseUrl: string = "https://redhat.atlassian.net"): Promise<any> {
  const token = process.env.JIRA_API_TOKEN;
  const username = process.env.JIRA_USERNAME;
  const bearer = process.env.JIRA_BEARER_TOKEN;

  if (!token && !bearer) {
    throw new Error("JIRA_API_TOKEN or JIRA_BEARER_TOKEN environment variable required.");
  }

  const authHeader = bearer
    ? `Bearer ${bearer}`
    : `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;

  const url = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/issue/${issueKey}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: authHeader, Accept: "application/json" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Jira API returned HTTP ${res.statusCode}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}
```

```typescript
// extensions/jira/tools.ts
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { fetchJiraIssue } from "./client.js";
import { parseJiraIssuePayload } from "./parser.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export const jiraGetIssueTool = defineTool({
  name: "jira_get_issue",
  label: "Jira Get Issue",
  description: "Fetch and groom Jira issue details (summary, context, acceptance criteria, repro steps).",
  parameters: Type.Object({
    issueKey: Type.String({ description: "Jira key, e.g. OCPBUGS-1234" }),
    baseUrl: Type.Optional(Type.String()),
  }),
  async execute(_id, params) {
    const raw = await fetchJiraIssue(params.issueKey, params.baseUrl);
    const parsed = parseJiraIssuePayload(raw);
    return {
      content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
      details: parsed,
    };
  },
});

export const createPrHelperTool = defineTool({
  name: "create_pr_helper",
  label: "Create PR Helper",
  description: "Create a GitHub pull request with Jira issue prefix, formatted description, and footer.",
  parameters: Type.Object({
    issueKey: Type.String(),
    summary: Type.String(),
    upstream: Type.Optional(Type.String()),
    head: Type.Optional(Type.String()),
    draft: Type.Optional(Type.Boolean()),
  }),
  async execute(_id, params) {
    const templatePath = path.join(process.cwd(), ".github/PULL_REQUEST_TEMPLATE.md");
    let template = "";
    if (fs.existsSync(templatePath)) {
      template = fs.readFileSync(templatePath, "utf8");
    }

    const title = `${params.issueKey}: ${params.summary}`;
    const body = `${template ? `${template}\n\n` : ""}Fixes Jira issue: https://redhat.atlassian.net/browse/${params.issueKey}

---
*AI-assisted response via pi-ocp-dev*`;

    const args = ["pr", "create", "--title", title, "--body", body];
    if (params.upstream) args.push("--repo", params.upstream);
    if (params.head) args.push("--head", params.head);
    if (params.draft) args.push("--draft");

    const { stdout } = await execFileAsync("gh", args);
    return {
      content: [{ type: "text", text: stdout.trim() }],
      details: { url: stdout.trim() },
    };
  },
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test test/jira/parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 8**

```bash
git add extensions/jira/ test/jira/
git commit -m "feat(jira): add Jira issue fetcher, parser, and PR creator helper tools"
```

---

### Task 9: Unified Main Extension Entrypoint

**Files:**
- Create: `extensions/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `extensions/prow/index.ts`, `extensions/pr/tools.ts`, `extensions/ci/tools.ts`, `extensions/jira/tools.ts`, `extensions/precommit/hook.ts`
- Produces: Default export `(pi: ExtensionAPI) => void` registering all tools, commands, and hooks.

- [ ] **Step 1: Implement `extensions/index.ts`**

```typescript
// extensions/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerProw from "./prow/index.js";
import { prReviewStatusTool, prReviewCommentsTool, prPostReplyTool, verifyRepoTool } from "./pr/tools.js";
import { triagePrCiFailuresTool, postCiFailureReportTool } from "./ci/tools.js";
import { jiraGetIssueTool, createPrHelperTool } from "./jira/tools.js";
import { registerPrecommitHook } from "./precommit/hook.js";

export default function (pi: ExtensionAPI) {
  // Register existing Prow extension (tools + /prow command)
  registerProw(pi);

  // Register PR review tools
  pi.registerTool(prReviewStatusTool);
  pi.registerTool(prReviewCommentsTool);
  pi.registerTool(prPostReplyTool);
  pi.registerTool(verifyRepoTool);

  // Register PR CI tools
  pi.registerTool(triagePrCiFailuresTool);
  pi.registerTool(postCiFailureReportTool);

  // Register Jira & PR creation tools
  pi.registerTool(jiraGetIssueTool);
  pi.registerTool(createPrHelperTool);

  // Register pre-commit lifecycle hook
  registerPrecommitHook(pi);
}
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Commit Task 9**

```bash
git add extensions/index.ts package.json
git commit -m "feat: wire up all tools and lifecycle hooks in main extension entrypoint"
```

---

### Task 10: Port the 7-Skill Workflow Suite

**Files:**
- Create: `skills/has-review-work/SKILL.md`
- Create: `skills/address-review-pr/SKILL.md`
- Create: `skills/address-ci-failures/SKILL.md`
- Create: `skills/address-review-precommit/SKILL.md`
- Create: `skills/create-pr/SKILL.md`
- Create: `skills/jira-solve/SKILL.md`
- Create: `skills/generate-test-plan/SKILL.md`

- [ ] **Step 1: Create each skill file in `skills/` using our deterministic tools**
  - Ensure all skills call `pr_review_status`, `pr_review_comments`, `pr_post_reply`, `verify_repo`, `triage_pr_ci_failures`, `post_ci_failure_report`, `jira_get_issue`, `create_pr_helper`.
- [ ] **Step 2: Verify all skill files contain valid markdown headers and clear instructions**
- [ ] **Step 3: Commit Task 10**

```bash
git add skills/
git commit -m "feat(skills): add 7-skill workflow suite powered by deterministic tools"
```

---

### Task 11: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md` documenting all available tools, skills, and configuration**
- [ ] **Step 2: Run `npm run typecheck` to verify zero TypeScript errors**
- [ ] **Step 3: Run `npm test` to verify 100% test pass rate across all suites**
- [ ] **Step 4: Commit Task 11**

```bash
git add README.md
git commit -m "docs: update README with full tool and skill catalog"
```
