import { describe, it, expect } from "vitest";
import {
  parseJiraIssuePayload,
  adfToText,
  extractLinkedPrs,
} from "../../extensions/jira/parser.js";

describe("adfToText", () => {
  it("converts plain text and headings", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Context" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "This is the context description." }],
        },
      ],
    };
    const text = adfToText(doc);
    expect(text).toContain("## Context");
    expect(text).toContain("This is the context description.");
  });

  it("converts bullet and ordered lists", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Acceptance criteria" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Must not panic on nil" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Returns proper error" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const text = adfToText(doc);
    expect(text).toContain("## Acceptance criteria");
    expect(text).toContain("- Must not panic on nil");
    expect(text).toContain("- Returns proper error");
  });

  it("handles empty or primitive inputs gracefully", () => {
    expect(adfToText(null)).toBe("");
    expect(adfToText(undefined)).toBe("");
    expect(adfToText("plain string")).toBe("plain string");
  });
});

describe("extractLinkedPrs", () => {
  it("extracts github PR URLs from text and remote links", () => {
    const payload = {
      fields: {
        description:
          "Related PR: https://github.com/openshift/hypershift/pull/1234 and duplicate https://github.com/openshift/hypershift/pull/1234",
      },
      remotelinks: [
        {
          object: {
            url: "https://github.com/openshift/installer/pull/5678",
            title: "PR 5678",
          },
        },
      ],
    };

    const prs = extractLinkedPrs(payload);
    expect(prs).toEqual([
      "https://github.com/openshift/hypershift/pull/1234",
      "https://github.com/openshift/installer/pull/5678",
    ]);
  });
});

describe("parseJiraIssuePayload", () => {
  it("extracts fields from markdown / Jira markup description", () => {
    const payload = {
      key: "OCPBUGS-1234",
      fields: {
        summary: "Fix nil pointer in cluster controller",
        issuetype: { name: "Bug" },
        description: `
h2. Context
Need to guard nil pointer when cluster spec is missing.

h2. Acceptance criteria
* Must not panic when cluster is nil
* Returns valid error message

h2. Steps to reproduce
1. Run cluster reconciler with nil cluster
2. Observe panic stack trace
`,
      },
    };

    const parsed = parseJiraIssuePayload(payload);
    expect(parsed.key).toBe("OCPBUGS-1234");
    expect(parsed.summary).toBe("Fix nil pointer in cluster controller");
    expect(parsed.issueType).toBe("Bug");
    expect(parsed.context).toContain("Need to guard nil pointer");
    expect(parsed.acceptanceCriteria).toContain("Must not panic when cluster is nil");
    expect(parsed.stepsToReproduce).toContain("Run cluster reconciler with nil cluster");
    expect(parsed.linkedPrs).toEqual([]);
  });

  it("extracts fields from ADF (Atlassian Document Format) description", () => {
    const payload = {
      key: "CNTRLPLANE-205",
      fields: {
        summary: "Support new ingress configuration",
        issuetype: { name: "Story" },
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Context" }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Ingress controller needs new custom domain support. See https://github.com/openshift/origin/pull/9999",
                },
              ],
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Acceptance Criteria" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Custom domain validates correctly" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    const parsed = parseJiraIssuePayload(payload);
    expect(parsed.key).toBe("CNTRLPLANE-205");
    expect(parsed.summary).toBe("Support new ingress configuration");
    expect(parsed.issueType).toBe("Story");
    expect(parsed.context).toContain("Ingress controller needs new custom domain support");
    expect(parsed.acceptanceCriteria).toContain("Custom domain validates correctly");
    expect(parsed.linkedPrs).toContain("https://github.com/openshift/origin/pull/9999");
  });

  it("handles missing sections gracefully", () => {
    const payload = {
      key: "OCPBUGS-999",
      fields: {
        summary: "Simple task",
        description: "Just a short one-liner description.",
      },
    };

    const parsed = parseJiraIssuePayload(payload);
    expect(parsed.key).toBe("OCPBUGS-999");
    expect(parsed.summary).toBe("Simple task");
    expect(parsed.context).toBe("Just a short one-liner description.");
    expect(parsed.acceptanceCriteria).toBe("");
    expect(parsed.stepsToReproduce).toBe("");
    expect(parsed.linkedPrs).toEqual([]);
  });
});
