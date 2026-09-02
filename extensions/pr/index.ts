import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  prReviewStatusTool,
  prReviewCommentsTool,
  prPostReplyTool,
  verifyRepoTool,
} from "./tools.js";

export default function registerPrTools(pi: ExtensionAPI) {
  pi.registerTool(prReviewStatusTool);
  pi.registerTool(prReviewCommentsTool);
  pi.registerTool(prPostReplyTool);
  pi.registerTool(verifyRepoTool);
}
