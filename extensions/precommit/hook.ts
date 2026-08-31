import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensurePrecommitHooks } from "./install.js";

export function registerPrecommitHook(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const result = await ensurePrecommitHooks(ctx.cwd);
    if (!result.success) {
      ctx.ui.notify(result.message, "warning");
    }
  });
}
