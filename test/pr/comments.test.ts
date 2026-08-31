import { describe, it, expect } from "vitest";
import {
  isSlashCommandOnly,
  isPureAcknowledgment,
  categorizeComment,
} from "../../extensions/pr/comments.js";

describe("isSlashCommandOnly", () => {
  it("matches single slash command", () => {
    expect(isSlashCommandOnly("/lgtm")).toBe(true);
    expect(isSlashCommandOnly("/hold")).toBe(true);
    expect(isSlashCommandOnly("/test e2e-aws")).toBe(true);
  });

  it("matches multiline slash commands", () => {
    expect(isSlashCommandOnly("/hold\n/lgtm cancel")).toBe(true);
    expect(isSlashCommandOnly("/lgtm\n\n/approve")).toBe(true);
  });

  it("handles HTML comments properly", () => {
    expect(isSlashCommandOnly("<!-- review comment -->\n/test e2e-aws")).toBe(true);
    expect(isSlashCommandOnly("<!-- just a comment -->")).toBe(true);
    expect(isSlashCommandOnly("<!-- comment -->\nPlease fix this")).toBe(false);
  });

  it("identifies comments with review prose", () => {
    expect(isSlashCommandOnly("Please fix this nil check\n/lgtm")).toBe(false);
    expect(isSlashCommandOnly("Looks good, thanks!")).toBe(false);
    expect(isSlashCommandOnly("Why did you add this?")).toBe(false);
  });

  it("treats empty or whitespace-only bodies as slash command only (no review work)", () => {
    expect(isSlashCommandOnly("")).toBe(true);
    expect(isSlashCommandOnly("   \n\n  ")).toBe(true);
  });
});

describe("isPureAcknowledgment", () => {
  it("detects acknowledgments", () => {
    expect(isPureAcknowledgment("lgtm")).toBe(true);
    expect(isPureAcknowledgment("LGTM")).toBe(true);
    expect(isPureAcknowledgment("Thanks!")).toBe(true);
    expect(isPureAcknowledgment("thank you")).toBe(true);
    expect(isPureAcknowledgment("looks good to me")).toBe(true);
    expect(isPureAcknowledgment("+1")).toBe(true);
  });

  it("returns false for actionable comments", () => {
    expect(isPureAcknowledgment("Thanks! But could you fix line 10?")).toBe(false);
    expect(isPureAcknowledgment("Please rebase")).toBe(false);
  });
});

describe("categorizeComment", () => {
  it("identifies action instructions", () => {
    expect(categorizeComment("Please rebase on main")).toBe("ACTION_INSTRUCTION");
    expect(categorizeComment("Squash your commits")).toBe("ACTION_INSTRUCTION");
    expect(categorizeComment("Run make verify to make sure it passes")).toBe("ACTION_INSTRUCTION");
    expect(categorizeComment("Please update branch")).toBe("ACTION_INSTRUCTION");
  });

  it("identifies blocking issues", () => {
    expect(categorizeComment("This is a critical security vulnerability")).toBe("BLOCKING");
    expect(categorizeComment("This causes a nil pointer panic in production")).toBe("BLOCKING");
    expect(categorizeComment("This is a breaking change")).toBe("BLOCKING");
    expect(categorizeComment("Must fix before merging")).toBe("BLOCKING");
  });

  it("identifies questions", () => {
    expect(categorizeComment("Why do we need this mutex here?")).toBe("QUESTION");
    expect(categorizeComment("How does this handle timeout?")).toBe("QUESTION");
    expect(categorizeComment("Could you clarify this logic?")).toBe("QUESTION");
  });

  it("identifies suggestions", () => {
    expect(categorizeComment("Nit: consider renaming this variable")).toBe("SUGGESTION");
    expect(categorizeComment("Optional: we could extract a helper")).toBe("SUGGESTION");
    expect(categorizeComment("Suggestion: use strings.Builder")).toBe("SUGGESTION");
  });

  it("defaults to change request for standard code changes", () => {
    expect(categorizeComment("Please change this function to return an error")).toBe("CHANGE_REQUEST");
    expect(categorizeComment("Remove this unused field")).toBe("CHANGE_REQUEST");
  });
});
