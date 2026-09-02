import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { runMustGatherAnalysis } from "./runner.js";
import { buildMustGatherPrompt, parseMustGatherCommand } from "./command.js";

const text = (t: string, details?: unknown) => ({
  content: [{ type: "text" as const, text: t }],
  details,
});

export const analyzeMustGatherTool = defineTool({
  name: "analyze_must_gather",
  label: "Analyze Must-Gather",
  description:
    "Deterministic analysis of OpenShift must-gather diagnostic data from a local directory, tarball, or remote Prow GCS artifact URL.",
  parameters: Type.Object({
    source: Type.String({
      description:
        "Local path to must-gather directory/tarball, or remote Prow deck URL (https://prow.ci.openshift.org/view/gs/...)",
    }),
    component: Type.Optional(
      Type.Union(
        [
          Type.Literal("all"),
          Type.Literal("operators"),
          Type.Literal("pods"),
          Type.Literal("nodes"),
          Type.Literal("events"),
          Type.Literal("etcd"),
          Type.Literal("storage"),
          Type.Literal("network"),
          Type.Literal("version"),
        ],
        { description: "Component to analyze. Defaults to 'all'." },
      ),
    ),
    problemsOnly: Type.Optional(
      Type.Boolean({
        description:
          "When true, filters to unhealthy/failing resources only. Default: true for 'all'.",
      }),
    ),
    namespace: Type.Optional(
      Type.String({
        description: "Optional namespace filter for pods, events, and storage.",
      }),
    ),
    count: Type.Optional(
      Type.Number({
        description: "Maximum number of items to return (e.g. events, pods).",
      }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    try {
      const result = await runMustGatherAnalysis(params.source, {
        component: params.component,
        problemsOnly: params.problemsOnly,
        namespace: params.namespace,
        count: params.count,
      });
      return text(JSON.stringify(result, null, 2), result);
    } catch (err: any) {
      return text(`Error analyzing must-gather: ${err?.message || String(err)}`);
    }
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(analyzeMustGatherTool);

  pi.registerCommand("must-gather", {
    description:
      "Must-gather diagnostics: /must-gather <path-or-url> [component] [namespace]",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        "operators",
        "pods",
        "nodes",
        "events",
        "etcd",
        "storage",
        "network",
      ].map((v) => ({
        value: v,
        label: v,
      }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cmd = parseMustGatherCommand(args);
      if (cmd.kind === "usage") {
        ctx.ui.notify(
          "/must-gather <path-or-url> [operators|pods|nodes|events|etcd|storage|network] [namespace]",
          "info",
        );
        return;
      }
      pi.sendUserMessage(buildMustGatherPrompt(cmd));
    },
  });
}
