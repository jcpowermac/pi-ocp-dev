import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validatePrecommitConfig } from "./validator.js";

const execFileAsync = promisify(execFile);

export async function ensurePrecommitHooks(cwd: string = process.cwd()): Promise<{
  success: boolean;
  message: string;
}> {
  const configFile = path.join(cwd, ".pre-commit-config.yaml");
  if (!fs.existsSync(configFile)) {
    return { success: true, message: "No .pre-commit-config.yaml found, skipping." };
  }

  const content = fs.readFileSync(configFile, "utf8");
  const validation = validatePrecommitConfig(content);
  if (!validation.valid) {
    return {
      success: false,
      message: `Invalid .pre-commit-config.yaml: ${validation.errors.join("; ")}`,
    };
  }

  try {
    await execFileAsync("pre-commit", ["--version"]);
  } catch {
    return {
      success: false,
      message: "pre-commit binary not found on PATH.",
    };
  }

  try {
    await execFileAsync("pre-commit", ["install", "--hook-type", "pre-commit"], { cwd });
    await execFileAsync("pre-commit", ["install", "--hook-type", "pre-push"], { cwd });
    return { success: true, message: "Pre-commit and pre-push hooks installed successfully." };
  } catch (err) {
    return {
      success: false,
      message: `Failed to install pre-commit hooks: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
