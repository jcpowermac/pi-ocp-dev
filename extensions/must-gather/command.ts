export type MustGatherCommand =
  | { kind: "usage" }
  | { kind: "analyze"; source: string; component: string; namespace?: string };

export function parseMustGatherCommand(args: string): MustGatherCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { kind: "usage" };
  }
  const source = parts[0];
  const component = parts[1] || "all";
  const namespace = parts[2];
  return { kind: "analyze", source, component, namespace };
}

export function buildMustGatherPrompt(cmd: MustGatherCommand): string {
  if (cmd.kind === "usage") {
    return "Usage: /must-gather <path-or-url> [component] [namespace]";
  }
  return `Analyze the must-gather diagnostic data at '${cmd.source}' for component '${cmd.component}'${cmd.namespace ? ` in namespace '${cmd.namespace}'` : ""} using analyze_must_gather tool.`;
}
