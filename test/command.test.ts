import { describe, it, expect } from "vitest";
import {
  parseProwCommand,
  buildProwPrompt,
  PROW_USAGE,
} from "../extensions/prow/command.js";

describe("parseProwCommand", () => {
  it("returns usage for empty/whitespace args", () => {
    expect(parseProwCommand("")).toEqual({ kind: "usage" });
    expect(parseProwCommand("   ")).toEqual({ kind: "usage" });
  });

  it("parses platforms only", () => {
    expect(parseProwCommand("vsphere")).toEqual({
      kind: "status",
      platforms: ["vsphere"],
    });
    expect(parseProwCommand("aws gcp azure")).toEqual({
      kind: "status",
      platforms: ["aws", "gcp", "azure"],
    });
  });

  it("parses a version token from anywhere", () => {
    expect(parseProwCommand("vsphere 4.18")).toEqual({
      kind: "status",
      platforms: ["vsphere"],
      version: "4.18",
    });
    expect(parseProwCommand("4.18 vsphere")).toEqual({
      kind: "status",
      platforms: ["vsphere"],
      version: "4.18",
    });
  });

  it("parses a bare version", () => {
    expect(parseProwCommand("4.18")).toEqual({ kind: "status", version: "4.18" });
  });

  it("rejects multiple version tokens as usage", () => {
    expect(parseProwCommand("4.18 4.19")).toEqual({ kind: "usage" });
  });

  it("parses the job subcommand", () => {
    expect(parseProwCommand("job periodic-ci-openshift-4.18-e2e-aws-ovn")).toEqual({
      kind: "job",
      name: "periodic-ci-openshift-4.18-e2e-aws-ovn",
    });
    // job name may itself contain spaces
    expect(parseProwCommand("job some weird name")).toEqual({
      kind: "job",
      name: "some weird name",
    });
  });

  it("returns usage when job has no name", () => {
    expect(parseProwCommand("job")).toEqual({ kind: "usage" });
  });

  it("parses the log subcommand", () => {
    expect(parseProwCommand("log https://prow.ci.openshift.org/view/gs/b/logs/J/1")).toEqual({
      kind: "log",
      url: "https://prow.ci.openshift.org/view/gs/b/logs/J/1",
    });
  });

  it("returns usage when log has no url", () => {
    expect(parseProwCommand("log")).toEqual({ kind: "usage" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseProwCommand("  vsphere  ")).toEqual({
      kind: "status",
      platforms: ["vsphere"],
    });
  });

  it("parses the analyze subcommand", () => {
    expect(parseProwCommand("analyze https://prow.ci.openshift.org/view/gs/b/logs/J/1")).toEqual({
      kind: "analyze",
      url: "https://prow.ci.openshift.org/view/gs/b/logs/J/1",
    });
  });

  it("returns usage when analyze has no url or the token is not a url", () => {
    expect(parseProwCommand("analyze")).toEqual({ kind: "usage" });
    expect(parseProwCommand("analyze not-a-url")).toEqual({ kind: "usage" });
  });

  it("parses the permafail subcommand with 2-10 urls", () => {
    const urls = [
      "https://prow.ci.openshift.org/view/gs/b/logs/J/3",
      "https://prow.ci.openshift.org/view/gs/b/logs/J/2",
      "https://prow.ci.openshift.org/view/gs/b/logs/J/1",
    ];
    expect(parseProwCommand(`permafail ${urls.join(" ")}`)).toEqual({
      kind: "permafail",
      urls,
    });
  });

  it("returns usage when permafail has fewer than 2 or more than 10 urls", () => {
    expect(parseProwCommand("permafail https://x/1")).toEqual({ kind: "usage" });
    const eleven = Array.from({ length: 11 }, (_, i) => `https://x/${i}`);
    expect(parseProwCommand(`permafail ${eleven.join(" ")}`)).toEqual({ kind: "usage" });
  });

  it("returns usage when permafail contains a non-url token", () => {
    expect(parseProwCommand("permafail https://x/1 https://x/2 not-a-url")).toEqual({
      kind: "usage",
    });
  });
});

describe("buildProwPrompt", () => {
  it("builds a status prompt naming the tool and parameters", () => {
    const p = buildProwPrompt({ kind: "status", platforms: ["vsphere"], version: "4.18" });
    expect(p).toContain("prow_status");
    expect(p).toContain("vsphere");
    expect(p).toContain("4.18");
  });

  it("omits absent parameters", () => {
    const p = buildProwPrompt({ kind: "status", platforms: ["aws"] });
    expect(p).toContain("prow_status");
    expect(p).not.toContain("version");
  });

  it("builds a job prompt", () => {
    const p = buildProwPrompt({ kind: "job", name: "some-job-4.18" });
    expect(p).toContain("prow_job");
    expect(p).toContain("some-job-4.18");
  });

  it("builds a log prompt", () => {
    const p = buildProwPrompt({ kind: "log", url: "https://x/view/gs/a/b" });
    expect(p).toContain("prow_build_log");
    expect(p).toContain("https://x/view/gs/a/b");
  });

  it("builds an analyze prompt naming the tool and url", () => {
    const p = buildProwPrompt({ kind: "analyze", url: "https://x/view/gs/a/b" });
    expect(p).toContain("analyze_prow_run");
    expect(p).toContain("https://x/view/gs/a/b");
  });

  it("builds a permafail prompt naming the tool and all urls", () => {
    const p = buildProwPrompt({
      kind: "permafail",
      urls: ["https://x/1", "https://x/2"],
    });
    expect(p).toContain("detect_permafail");
    expect(p).toContain("https://x/1");
    expect(p).toContain("https://x/2");
  });

  it("lists the new subcommands in the usage text", () => {
    expect(PROW_USAGE).toContain("analyze");
    expect(PROW_USAGE).toContain("permafail");
  });
});
