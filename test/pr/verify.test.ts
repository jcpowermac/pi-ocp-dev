import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectVerificationCommand,
  summarizeTestOutput,
  runRepoVerification,
} from "../../extensions/pr/verify.js";
import fs from "node:fs";

vi.mock("node:fs");

describe("detectVerificationCommand", () => {
  it("detects make verify if Makefile has verify target", () => {
    const makefile = "all:\n\t@echo all\nverify:\n\t@echo verify\n";
    const cmd = detectVerificationCommand({ makefileContent: makefile });
    expect(cmd).toBe("make verify");
  });

  it("detects make lint if Makefile has lint target", () => {
    const makefile = "all:\n\t@echo all\nlint:\n\t@echo lint\n";
    const cmd = detectVerificationCommand({ makefileContent: makefile });
    expect(cmd).toBe("make lint");
  });

  it("detects go test ./... if go.mod exists", () => {
    const cmd = detectVerificationCommand({ hasGoMod: true });
    expect(cmd).toBe("go test ./... && go vet ./...");
  });

  it("detects npm run verify if package.json has verify script", () => {
    const pkg = JSON.stringify({ scripts: { verify: "vitest run" } });
    const cmd = detectVerificationCommand({ packageJsonContent: pkg });
    expect(cmd).toBe("npm run verify");
  });

  it("detects npm run lint if package.json has lint script", () => {
    const pkg = JSON.stringify({ scripts: { lint: "eslint ." } });
    const cmd = detectVerificationCommand({ packageJsonContent: pkg });
    expect(cmd).toBe("npm run lint");
  });

  it("detects npm test if package.json has test script", () => {
    const pkg = JSON.stringify({ scripts: { test: "vitest run" } });
    const cmd = detectVerificationCommand({ packageJsonContent: pkg });
    expect(cmd).toBe("npm test");
  });

  it("falls back to make test if no matches", () => {
    const cmd = detectVerificationCommand({});
    expect(cmd).toBe("make test");
  });
});

describe("summarizeTestOutput", () => {
  it("returns output unchanged if under maxLines", () => {
    const short = "line 1\nline 2\nline 3";
    expect(summarizeTestOutput(short, 10)).toBe(short);
  });

  it("extracts failing test lines and limits output to bounded snippet", () => {
    const raw =
      Array.from({ length: 500 }, (_, i) => `log line ${i}`).join("\n") +
      "\n--- FAIL: TestClusterReconcile (0.05s)\n    cluster_test.go:42: expected 1 got 0\nFAIL\n";
    const snippet = summarizeTestOutput(raw, 20);
    expect(snippet).toContain("TestClusterReconcile");
    expect(snippet).toContain("--- Highlighted Failures ---");
    expect(snippet).toContain("--- Tail Output ---");
    expect(snippet.split("\n").length).toBeLessThanOrEqual(35);
  });

  it("extracts panic and error lines", () => {
    const raw =
      Array.from({ length: 100 }, (_, i) => `log line ${i}`).join("\n") +
      "\npanic: runtime error: invalid memory address\nERROR: reconciler failed\n";
    const snippet = summarizeTestOutput(raw, 20);
    expect(snippet).toContain("panic: runtime error: invalid memory address");
    expect(snippet).toContain("ERROR: reconciler failed");
  });
});

describe("runRepoVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes commandOverride when provided and succeeds", async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: "ALL TESTS PASSED\n",
      stderr: "",
    });

    const res = await runRepoVerification("/mock/path", "custom-verify --all", 5000, {
      execRunner: mockExec,
    });
    expect(res.pass).toBe(true);
    expect(res.command).toBe("custom-verify --all");
    expect(res.summary).toBe("Verification passed successfully.");
    expect(res.outputSnippet).toContain("ALL TESTS PASSED");
    expect(mockExec).toHaveBeenCalledWith("custom-verify --all", {
      cwd: "/mock/path",
      timeout: 5000,
    });
  });

  it("handles failure execution with exit code and error output", async () => {
    const mockExec = vi.fn().mockRejectedValue({
      code: 2,
      stdout: "FAIL: TestSomething\n",
      stderr: "exit status 2\n",
      message: "Command failed",
    });

    const res = await runRepoVerification("/mock/path", "make test", 5000, {
      execRunner: mockExec,
    });
    expect(res.pass).toBe(false);
    expect(res.command).toBe("make test");
    expect(res.summary).toContain("Verification failed with exit code 2");
    expect(res.outputSnippet).toContain("FAIL: TestSomething");
  });

  it("detects command from files when commandOverride is not provided", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      return String(p).endsWith("go.mod");
    });
    const mockExec = vi.fn().mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
    });

    const res = await runRepoVerification("/mock/path", undefined, undefined, {
      execRunner: mockExec,
    });
    expect(res.pass).toBe(true);
    expect(res.command).toBe("go test ./... && go vet ./...");
  });
});
