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
  const acks = [
    "lgtm",
    "thanks",
    "thanks!",
    "thank you",
    "looks good",
    "looks good to me",
    "approved",
    "+1",
  ];
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
  if (
    lower.startsWith("why") ||
    lower.startsWith("how") ||
    lower.includes("?") ||
    lower.startsWith("could you clarify")
  ) {
    return "QUESTION";
  }
  if (
    lower.startsWith("nit") ||
    lower.includes("optional") ||
    lower.includes("consider") ||
    lower.includes("suggestion")
  ) {
    return "SUGGESTION";
  }
  return "CHANGE_REQUEST";
}
