import { describe, it, expect } from "vitest";
import {
  parseMustGatherCommand,
  buildMustGatherPrompt,
} from "../extensions/must-gather/command.js";
import { analyzeMustGatherTool } from "../extensions/must-gather/index.js";

describe("must-gather command parser", () => {
  it("parses empty arguments as usage", () => {
    const cmd = parseMustGatherCommand("");
    expect(cmd.kind).toBe("usage");
  });

  it("parses single path argument", () => {
    const cmd = parseMustGatherCommand("./must-gather.local.123");
    expect(cmd.kind).toBe("analyze");
    if (cmd.kind === "analyze") {
      expect(cmd.source).toBe("./must-gather.local.123");
      expect(cmd.component).toBe("all");
    }
  });

  it("parses path with component filter", () => {
    const cmd = parseMustGatherCommand("./must-gather.local.123 operators");
    expect(cmd.kind).toBe("analyze");
    if (cmd.kind === "analyze") {
      expect(cmd.source).toBe("./must-gather.local.123");
      expect(cmd.component).toBe("operators");
    }
  });

  it("parses path with component and namespace filter", () => {
    const cmd = parseMustGatherCommand("./must-gather.local.123 pods openshift-etcd");
    expect(cmd.kind).toBe("analyze");
    if (cmd.kind === "analyze") {
      expect(cmd.source).toBe("./must-gather.local.123");
      expect(cmd.component).toBe("pods");
      expect(cmd.namespace).toBe("openshift-etcd");
    }
  });

  it("builds prompt for usage and analyze commands", () => {
    expect(buildMustGatherPrompt({ kind: "usage" })).toContain("Usage:");
    expect(
      buildMustGatherPrompt({
        kind: "analyze",
        source: "./mg",
        component: "pods",
        namespace: "openshift-etcd",
      }),
    ).toContain("Analyze the must-gather diagnostic data at './mg'");
  });

  it("exports analyzeMustGatherTool definition", () => {
    expect(analyzeMustGatherTool.name).toBe("analyze_must_gather");
    expect(analyzeMustGatherTool.description).toContain("must-gather");
  });
});
