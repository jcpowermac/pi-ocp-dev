import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { apiLintTypesTool } from "./tools.js";

export default function registerApiTools(pi: ExtensionAPI) {
  pi.registerTool(apiLintTypesTool);
}
