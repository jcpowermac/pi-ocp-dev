import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { jiraGetIssueTool, createPrHelperTool } from "./tools.js";

export default function registerJiraTools(pi: ExtensionAPI) {
  pi.registerTool(jiraGetIssueTool);
  pi.registerTool(createPrHelperTool);
}
