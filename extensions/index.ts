import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerProw from "./prow/index.js";
import registerMustGather from "./must-gather/index.js";
import registerPrTools from "./pr/index.js";
import registerCiTools from "./ci/index.js";
import registerJiraTools from "./jira/index.js";
import { registerPrecommitHook } from "./precommit/hook.js";

export default function (pi: ExtensionAPI): void {
  registerProw(pi);
  registerMustGather(pi);
  registerPrTools(pi);
  registerCiTools(pi);
  registerJiraTools(pi);
  registerPrecommitHook(pi);
}
