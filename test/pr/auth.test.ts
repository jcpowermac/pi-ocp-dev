// test/pr/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseOwnersYaml,
  parseOwnersAliasesYaml,
  isAuthorizedAuthor,
  APPROVED_BOTS,
  IGNORED_ACCOUNTS,
  clearAuthCache,
} from "../../extensions/pr/auth.js";

describe("parseOwnersYaml", () => {
  it("extracts top-level approvers and reviewers", () => {
    const content = `
# OWNERS file
approvers:
  - alice
  - bob
reviewers:
  - charlie
  - Dave
`;
    const res = parseOwnersYaml(content);
    expect(res.approvers).toEqual(["alice", "bob"]);
    expect(res.reviewers).toEqual(["charlie", "Dave"]);
    expect(Object.keys(res.filters)).toHaveLength(0);
  });

  it("extracts filters with nested approvers/reviewers", () => {
    const content = `
approvers:
  - root-approver
filters:
  ".*":
    reviewers:
      - filter-reviewer
  "pkg/api/.*":
    approvers:
      - api-approver
    reviewers:
      - api-reviewer
`;
    const res = parseOwnersYaml(content);
    expect(res.approvers).toEqual(["root-approver"]);
    expect(res.filters[".*"]?.reviewers).toEqual(["filter-reviewer"]);
    expect(res.filters["pkg/api/.*"]?.approvers).toEqual(["api-approver"]);
    expect(res.filters["pkg/api/.*"]?.reviewers).toEqual(["api-reviewer"]);
  });

  it("handles empty or comment-only content gracefully", () => {
    const res = parseOwnersYaml("# Just comments\n\n# More comments");
    expect(res.approvers).toEqual([]);
    expect(res.reviewers).toEqual([]);
    expect(res.filters).toEqual({});
  });
});

describe("parseOwnersAliasesYaml", () => {
  it("extracts alias groups", () => {
    const content = `
# OWNERS_ALIASES file
aliases:
  team-leads:
    - alice
    - bob
  devs:
    - charlie
    - dave
`;
    const res = parseOwnersAliasesYaml(content);
    expect(res["team-leads"]).toEqual(["alice", "bob"]);
    expect(res["devs"]).toEqual(["charlie", "dave"]);
  });

  it("handles empty or missing aliases gracefully", () => {
    const res = parseOwnersAliasesYaml("");
    expect(res).toEqual({});
  });
});

describe("isAuthorizedAuthor", () => {
  beforeEach(() => {
    clearAuthCache();
  });

  it("returns not authorized for empty login", async () => {
    const res = await isAuthorizedAuthor("openshift", "hypershift", "");
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe("empty_login");
  });

  it("approves coderabbitai bot automatically without gh calls", async () => {
    const mockGh = vi.fn();
    const res1 = await isAuthorizedAuthor("openshift", "hypershift", "coderabbitai", { ghRunner: mockGh });
    expect(res1.authorized).toBe(true);
    expect(res1.reason).toBe("approved_bot");

    const res2 = await isAuthorizedAuthor("openshift", "hypershift", "coderabbitai[bot]", { ghRunner: mockGh });
    expect(res2.authorized).toBe(true);
    expect(res2.reason).toBe("approved_bot");

    expect(mockGh).not.toHaveBeenCalled();
  });

  it("blocks ignored ci bots immediately without gh calls", async () => {
    const mockGh = vi.fn();
    for (const bot of ["openshift-ci-robot", "openshift-ci", "openshift-merge-robot", "openshift-bot"]) {
      const res = await isAuthorizedAuthor("openshift", "hypershift", bot, { ghRunner: mockGh });
      expect(res.authorized).toBe(false);
      expect(res.reason).toBe("ignored_bot");
    }
    expect(mockGh).not.toHaveBeenCalled();
  });

  it("blocks unapproved [bot] accounts without gh calls", async () => {
    const mockGh = vi.fn();
    const res = await isAuthorizedAuthor("openshift", "hypershift", "random-bot[bot]", { ghRunner: mockGh });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe("ignored_bot");
    expect(mockGh).not.toHaveBeenCalled();
  });

  it("authorizes user listed in OWNERS approvers or reviewers", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) {
        throw new Error("404");
      }
      if (endpoint.includes("OWNERS")) {
        return `
approvers:
  - LeadUser
reviewers:
  - ReviewUser
`;
      }
      return "";
    });

    const res1 = await isAuthorizedAuthor("openshift", "hypershift", "leaduser", { ghRunner: mockGh });
    expect(res1.authorized).toBe(true);
    expect(res1.reason).toBe("owners");

    const res2 = await isAuthorizedAuthor("openshift", "hypershift", "ReviewUser", { ghRunner: mockGh });
    expect(res2.authorized).toBe(true);
    expect(res2.reason).toBe("owners");
  });

  it("authorizes user listed in OWNERS filter approvers/reviewers", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) throw new Error("404");
      if (endpoint.includes("OWNERS")) {
        return `
filters:
  ".*":
    approvers:
      - FilterApprover
`;
      }
      return "";
    });

    const res = await isAuthorizedAuthor("openshift", "hypershift", "filterapprover", { ghRunner: mockGh });
    expect(res.authorized).toBe(true);
    expect(res.reason).toBe("owners");
  });

  it("authorizes user expanded from OWNERS_ALIASES in OWNERS", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) {
        return `
aliases:
  team-leads:
    - AliceLead
    - BobLead
`;
      }
      if (endpoint.includes("OWNERS")) {
        return `
approvers:
  - team-leads
`;
      }
      return "";
    });

    const res1 = await isAuthorizedAuthor("openshift", "hypershift", "alicelead", { ghRunner: mockGh });
    expect(res1.authorized).toBe(true);
    expect(res1.reason).toBe("owners");

    const res2 = await isAuthorizedAuthor("openshift", "hypershift", "BobLead", { ghRunner: mockGh });
    expect(res2.authorized).toBe(true);
    expect(res2.reason).toBe("owners");
  });

  it("authorizes user via org membership fallback when not in OWNERS", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) throw new Error("404");
      if (endpoint.includes("OWNERS")) {
        return "approvers:\n  - rootuser\n";
      }
      if (endpoint.includes("orgs/openshift/members/orguser")) {
        return JSON.stringify({ state: "active" });
      }
      throw new Error("404 Not Found");
    });

    const res = await isAuthorizedAuthor("openshift", "hypershift", "orguser", { ghRunner: mockGh });
    expect(res.authorized).toBe(true);
    expect(res.reason).toBe("org_member");
  });

  it("rejects unauthorized user not in OWNERS and not in org", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) throw new Error("404");
      if (endpoint.includes("OWNERS")) {
        return "approvers:\n  - rootuser\n";
      }
      if (endpoint.includes("orgs/openshift/members/stranger")) {
        throw new Error("404 Not Found");
      }
      return "";
    });

    const res = await isAuthorizedAuthor("openshift", "hypershift", "stranger", { ghRunner: mockGh });
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe("not_authorized");
  });

  it("caches results per repo and login so subsequent lookups do not invoke gh", async () => {
    const mockGh = vi.fn().mockImplementation(async (args: string[]) => {
      const endpoint = args.join(" ");
      if (endpoint.includes("OWNERS_ALIASES")) throw new Error("404");
      if (endpoint.includes("OWNERS")) {
        return "approvers:\n  - CachedUser\n";
      }
      return "";
    });

    const first = await isAuthorizedAuthor("openshift", "hypershift", "cacheduser", { ghRunner: mockGh });
    expect(first.authorized).toBe(true);
    const callCount = mockGh.mock.calls.length;

    const second = await isAuthorizedAuthor("openshift", "hypershift", "cacheduser", { ghRunner: mockGh });
    expect(second.authorized).toBe(true);
    expect(mockGh.mock.calls.length).toBe(callCount);
  });
});
