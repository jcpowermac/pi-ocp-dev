import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { triagePrCiFailuresTool, postCiFailureReportTool } from "./tools.js";

export default function registerCiTools(pi: ExtensionAPI) {
  pi.registerTool(triagePrCiFailuresTool);
  pi.registerTool(postCiFailureReportTool);
}
