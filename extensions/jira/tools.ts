import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fetchJiraIssue } from "./client.js";
import { parseJiraIssuePayload, type ParsedJiraIssue } from "./parser.js";

const execFileAsync = promisify(execFile);

export interface JiraGetIssueParams {
  issueKey: string;
  baseUrl?: string;
}

export interface JiraGetIssueOptions {
  fetchJira?: (issueKey: string, baseUrl?: string) => Promise<any>;
}

export async function executeJiraGetIssue(
  params: JiraGetIssueParams,
  options?: JiraGetIssueOptions,
): Promise<ParsedJiraIssue> {
  const fetcher = options?.fetchJira || fetchJiraIssue;
  const payload = await fetcher(params.issueKey, params.baseUrl);
  return parseJiraIssuePayload(payload);
}

export interface CreatePrHelperParams {
  issueKey: string;
  summary: string;
  body?: string;
  upstream?: string;
  head?: string;
  draft?: boolean;
}

export interface CreatePrHelperOptions {
  ghRunner?: (args: string[]) => Promise<string>;
  readFile?: (filePath: string) => string;
  cwd?: string;
}

export async function executeCreatePrHelper(
  params: CreatePrHelperParams,
  options?: CreatePrHelperOptions,
): Promise<{ url: string; title: string }> {
  const runner =
    options?.ghRunner ||
    (async (args: string[]) => {
      const { stdout } = await execFileAsync("gh", args, { cwd: options?.cwd });
      return stdout;
    });

  const reader =
    options?.readFile ||
    ((filePath: string) => {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch {
        return "";
      }
    });

  const cwd = options?.cwd || process.cwd();
  const templatePath = path.join(cwd, ".github", "PULL_REQUEST_TEMPLATE.md");
  const templateContent = reader(templatePath);

  const title = `${params.issueKey}: ${params.summary.replace(/^[\s:]+/, "")}`;

  let bodyContent = params.body || templateContent;
  const jiraLink = `https://redhat.atlassian.net/browse/${params.issueKey}`;
  const footer = `Always review AI generated responses prior to use.\nAI-assisted response via pi-ocp-dev`;

  if (!bodyContent.includes(params.issueKey)) {
    bodyContent = `${bodyContent ? `${bodyContent}\n\n` : ""}Fixes: ${jiraLink}`;
  }

  const fullBody = `${bodyContent.trim()}\n\n---\n${footer}`;

  const ghArgs = ["pr", "create", "--title", title, "--body", fullBody];
  if (params.upstream) {
    ghArgs.push("--repo", params.upstream);
  }
  if (params.head) {
    ghArgs.push("--head", params.head);
  }
  if (params.draft) {
    ghArgs.push("--draft");
  }

  const stdout = await runner(ghArgs);
  const url = stdout.trim();

  return { url, title };
}

export const jiraGetIssueTool = defineTool({
  name: "jira_get_issue",
  label: "Jira Get Issue",
  description:
    "Fetch and groom Jira issue details (summary, context, acceptance criteria, repro steps, linked PRs) from Jira REST API. Requires JIRA_API_TOKEN + JIRA_USERNAME or JIRA_BEARER_TOKEN.",
  parameters: Type.Object({
    issueKey: Type.String({
      description: "Jira issue key, e.g. OCPBUGS-1234 or CNTRLPLANE-205",
    }),
    baseUrl: Type.Optional(
      Type.String({
        description: "Optional Jira base URL (defaults to https://redhat.atlassian.net)",
      }),
    ),
  }),
  async execute(_id, params) {
    const parsed = await executeJiraGetIssue(params);
    return {
      content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }],
      details: parsed,
    };
  },
});

export const createPrHelperTool = defineTool({
  name: "create_pr_helper",
  label: "Create PR Helper",
  description:
    "Create a GitHub pull request with Jira issue prefix, formatted description from template, Jira link, and AI disclaimer footer.",
  parameters: Type.Object({
    issueKey: Type.String({
      description: "Jira issue key for PR title prefix, e.g. OCPBUGS-1234",
    }),
    summary: Type.String({
      description: "Concise PR summary describing the change",
    }),
    body: Type.Optional(
      Type.String({
        description: "Custom PR description (if omitted, uses .github/PULL_REQUEST_TEMPLATE.md)",
      }),
    ),
    upstream: Type.Optional(
      Type.String({
        description: "Target repository owner/repo (e.g. openshift/hypershift)",
      }),
    ),
    head: Type.Optional(
      Type.String({
        description: "Head branch ref in fork-owner:branch or branch format",
      }),
    ),
    draft: Type.Optional(
      Type.Boolean({
        description: "Create as draft pull request",
      }),
    ),
  }),
  async execute(_id, params) {
    const result = await executeCreatePrHelper(params);
    return {
      content: [{ type: "text", text: `Pull request created: ${result.url}` }],
      details: result,
    };
  },
});
