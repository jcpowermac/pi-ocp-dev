import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function detectVerificationCommand(context: {
  makefileContent?: string;
  hasGoMod?: boolean;
  packageJsonContent?: string;
}): string {
  if (context.makefileContent) {
    if (context.makefileContent.includes("verify:")) return "make verify";
    if (context.makefileContent.includes("lint:")) return "make lint";
  }
  if (context.hasGoMod) {
    return "go test ./... && go vet ./...";
  }
  if (context.packageJsonContent) {
    try {
      const pkg = JSON.parse(context.packageJsonContent);
      if (pkg.scripts?.verify) return "npm run verify";
      if (pkg.scripts?.lint) return "npm run lint";
      if (pkg.scripts?.test) return "npm test";
    } catch {}
  }
  return "make test";
}

export function summarizeTestOutput(output: string, maxLines: number = 60): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;

  const failureLines = lines.filter((l) =>
    /(FAIL|FAIL:|ERROR|Error:|panic:|panic|\[FAIL\])/i.test(l),
  );

  const half = Math.floor(maxLines / 2);
  const tail = lines.slice(-half);
  const combined = [
    `... (${lines.length - maxLines} lines omitted) ...`,
    "--- Highlighted Failures ---",
    ...failureLines.slice(0, 20),
    "--- Tail Output ---",
    ...tail,
  ];
  return combined.join("\n");
}

export interface VerificationOptions {
  execRunner?: (
    command: string,
    options: { cwd: string; timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export async function runRepoVerification(
  cwd: string = process.cwd(),
  commandOverride?: string,
  timeoutMs: number = 900000,
  options?: VerificationOptions,
): Promise<{
  pass: boolean;
  command: string;
  summary: string;
  outputSnippet: string;
}> {
  let command = commandOverride;
  if (!command) {
    const makefilePath = path.join(cwd, "Makefile");
    const goModPath = path.join(cwd, "go.mod");
    const pkgJsonPath = path.join(cwd, "package.json");

    const makefileContent = fs.existsSync(makefilePath)
      ? fs.readFileSync(makefilePath, "utf8")
      : undefined;
    const hasGoMod = fs.existsSync(goModPath);
    const packageJsonContent = fs.existsSync(pkgJsonPath)
      ? fs.readFileSync(pkgJsonPath, "utf8")
      : undefined;

    command = detectVerificationCommand({
      makefileContent,
      hasGoMod,
      packageJsonContent,
    });
  }

  const runExec = options?.execRunner ?? execAsync;

  try {
    const { stdout, stderr } = await runExec(command, { cwd, timeout: timeoutMs });
    const full = `${stdout || ""}\n${stderr || ""}`.trim();
    return {
      pass: true,
      command,
      summary: "Verification passed successfully.",
      outputSnippet: summarizeTestOutput(full, 30),
    };
  } catch (err: any) {
    const full = `${err.stdout || ""}\n${err.stderr || ""}\n${err.message || ""}`.trim();
    return {
      pass: false,
      command,
      summary: `Verification failed with exit code ${err.code ?? 1}`,
      outputSnippet: summarizeTestOutput(full, 60),
    };
  }
}
