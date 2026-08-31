export interface ParsedJiraIssue {
  key: string;
  summary: string;
  issueType: string;
  context: string;
  acceptanceCriteria: string;
  stepsToReproduce: string;
  linkedPrs: string[];
}

const GITHUB_PR_URL_RE = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;

export function extractLinkedPrs(payload: any): string[] {
  const prSet = new Set<string>();

  const scanText = (text?: string) => {
    if (!text || typeof text !== "string") return;
    const matches = text.match(GITHUB_PR_URL_RE);
    if (matches) {
      for (const m of matches) prSet.add(m);
    }
  };

  // 1. Scan description
  if (typeof payload?.fields?.description === "string") {
    scanText(payload.fields.description);
  } else if (payload?.fields?.description) {
    scanText(JSON.stringify(payload.fields.description));
  }

  // 2. Scan remote links
  const remotelinks = payload?.remotelinks || payload?.fields?.remotelinks || [];
  if (Array.isArray(remotelinks)) {
    for (const link of remotelinks) {
      const url = link?.object?.url || link?.url;
      scanText(url);
    }
  }

  // 3. Scan comments
  const comments = payload?.fields?.comment?.comments || [];
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (typeof c?.body === "string") {
        scanText(c.body);
      } else if (c?.body) {
        scanText(JSON.stringify(c.body));
      }
    }
  }

  return Array.from(prSet);
}

export function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);

  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }

  const content = Array.isArray(node.content)
    ? node.content.map(adfToText).join("")
    : "";

  switch (node.type) {
    case "heading": {
      const level = node.attrs?.level || 2;
      const prefix = "#".repeat(level);
      return `\n${prefix} ${content.trim()}\n`;
    }
    case "paragraph":
      return `${content}\n`;
    case "listItem":
      return `- ${content.trim()}\n`;
    case "bulletList":
    case "orderedList":
      return `\n${content}\n`;
    case "codeBlock": {
      const lang = node.attrs?.language || "";
      return `\n\`\`\`${lang}\n${content.trim()}\n\`\`\`\n`;
    }
    default:
      return content;
  }
}

export function parseJiraIssuePayload(payload: any): ParsedJiraIssue {
  const fields = payload?.fields || {};
  const key = payload?.key || "";
  const summary = fields.summary || "";
  const issueType = fields.issuetype?.name || "Bug";

  let rawDesc = fields.description;
  let descText = "";

  if (typeof rawDesc === "string") {
    descText = rawDesc;
  } else if (rawDesc && typeof rawDesc === "object") {
    descText = adfToText(rawDesc);
  }

  let context = "";
  let acceptanceCriteria = "";
  let stepsToReproduce = "";

  const lines = descText.split("\n");
  let currentSection: "context" | "ac" | "steps" = "context";
  let hasExplicitSections = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    const isHeading =
      /^h[1-6]\./i.test(line) ||
      /^#{1,6}\s+/i.test(line) ||
      /^[A-Za-z\s]+:$/i.test(line);

    if (
      isHeading &&
      (lower.includes("acceptance criteria") ||
        lower.includes("acceptance-criteria") ||
        lower.includes("acceptance") ||
        lower.includes("success criteria"))
    ) {
      currentSection = "ac";
      hasExplicitSections = true;
      continue;
    }

    if (
      isHeading &&
      (lower.includes("steps to reproduce") ||
        lower.includes("reproduction steps") ||
        lower.includes("repro steps") ||
        lower.includes("how to reproduce"))
    ) {
      currentSection = "steps";
      hasExplicitSections = true;
      continue;
    }

    if (
      isHeading &&
      (lower.includes("context") ||
        lower.includes("description") ||
        lower.includes("overview") ||
        lower.includes("background"))
    ) {
      currentSection = "context";
      hasExplicitSections = true;
      continue;
    }

    if (currentSection === "ac") {
      acceptanceCriteria += (acceptanceCriteria ? "\n" : "") + line;
    } else if (currentSection === "steps") {
      stepsToReproduce += (stepsToReproduce ? "\n" : "") + line;
    } else {
      context += (context ? "\n" : "") + line;
    }
  }

  // If there were no explicit headers, the entire description is context
  if (!hasExplicitSections && descText.trim()) {
    context = descText.trim();
  }

  const linkedPrs = extractLinkedPrs(payload);

  return {
    key,
    summary,
    issueType,
    context: context.trim(),
    acceptanceCriteria: acceptanceCriteria.trim(),
    stepsToReproduce: stepsToReproduce.trim(),
    linkedPrs,
  };
}
