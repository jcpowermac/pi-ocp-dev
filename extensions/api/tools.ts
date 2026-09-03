import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lintGoTypes, type LintIssue } from "./lint.js";

const MAX_ISSUES = 300;

function collectGoFiles(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return [path];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "vendor" || entry === "zz_generated.deepcopy.go") continue;
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (entry.endsWith(".go")) out.push(full);
    }
  };
  walk(path);
  return out;
}

export function lintApiTypes(path: string): {
  files: number;
  errors: number;
  warnings: number;
  issues: LintIssue[];
} {
  const files = collectGoFiles(path);
  const issues: LintIssue[] = [];
  for (const f of files) {
    issues.push(...lintGoTypes(readFileSync(f, "utf8"), f));
  }
  issues.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return { files: files.length, errors, warnings, issues: issues.slice(0, MAX_ISSUES) };
}

export const apiLintTypesTool = defineTool({
  name: "api_lint_types",
  label: "Lint API Type Files",
  description:
    "Deterministically lint Go API type files against Kubernetes/OpenShift API conventions (openshift/enhancements CONVENTIONS + k8s api-conventions): json tag naming, +optional/+required markers, omitempty consistency, bare/unsigned ints, float in APIs, forbidden booleans, List items, TypeMeta/ObjectMeta pairing, +union discriminators, printcolumns, package version naming, deprecated markers. Pass a types_*.go file or a package directory. No Go toolchain required.",
  parameters: Type.Object({
    path: Type.String({
      description: "A Go type file or a directory of Go files (e.g. a config/v1 package dir).",
    }),
  }),
  execute: async (_id, params) => {
    const { path } = params as { path: string };
    let result;
    try {
      result = lintApiTypes(path);
    } catch (err) {
      throw new Error(`api_lint_types: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = JSON.stringify(result, null, 2);
    return {
      content: [
        {
          type: "text" as const,
          text: `${result.files} files, ${result.errors} errors, ${result.warnings} warnings${result.issues.length >= MAX_ISSUES ? " (truncated)" : ""}\n${text}`,
        },
      ],
      details: result,
    };
  },
});
