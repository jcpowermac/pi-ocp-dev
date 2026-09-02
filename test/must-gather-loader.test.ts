import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { resolveMustGatherPath, getCacheDir } from "../extensions/must-gather/loader.js";

describe("must-gather loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-loader-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves nested hash subdirectory automatically", async () => {
    const hashDir = path.join(tmpDir, "registry-ci-openshift-org-origin-sha256-12345");
    const clusterScoped = path.join(hashDir, "cluster-scoped-resources");
    fs.mkdirSync(clusterScoped, { recursive: true });

    const resolved = await resolveMustGatherPath(tmpDir);
    expect(resolved).toBe(hashDir);
  });

  it("returns exact path when pointing directly to inner directory", async () => {
    const clusterScoped = path.join(tmpDir, "cluster-scoped-resources");
    fs.mkdirSync(clusterScoped, { recursive: true });

    const resolved = await resolveMustGatherPath(tmpDir);
    expect(resolved).toBe(tmpDir);
  });

  it("extracts and resolves local tarball archives", async () => {
    const dataDir = path.join(tmpDir, "source-data");
    const innerDir = path.join(dataDir, "cluster-scoped-resources");
    fs.mkdirSync(innerDir, { recursive: true });
    fs.writeFileSync(path.join(innerDir, "dummy.txt"), "hello");

    const tarFile = path.join(tmpDir, "must-gather.tar");
    execSync(`tar -cf "${tarFile}" -C "${dataDir}" .`);

    const resolved = await resolveMustGatherPath(tarFile);
    expect(fs.existsSync(resolved)).toBe(true);
    expect(fs.existsSync(path.join(resolved, "cluster-scoped-resources"))).toBe(true);
  });

  it("throws for non-existent paths", async () => {
    await expect(resolveMustGatherPath("/non/existent/path/here")).rejects.toThrow(
      /Invalid must-gather path or archive/,
    );
  });

  it("handles remote URLs when not cached", async () => {
    await expect(
      resolveMustGatherPath("https://prow.ci.openshift.org/view/gs/origin-ci-test/logs/job/123"),
    ).rejects.toThrow(/Remote GCS artifact extraction/);
  });
});
