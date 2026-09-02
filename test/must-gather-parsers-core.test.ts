import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseClusterVersion } from "../extensions/must-gather/parsers/clusterversion.js";
import { parseClusterOperators } from "../extensions/must-gather/parsers/clusteroperators.js";
import { parseNodes } from "../extensions/must-gather/parsers/nodes.js";

describe("core manifest parsers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-core-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses clusterversion.yaml correctly", async () => {
    const cvDir = path.join(tmpDir, "cluster-scoped-resources/config.openshift.io/clusterversions");
    fs.mkdirSync(cvDir, { recursive: true });
    fs.writeFileSync(
      path.join(cvDir, "version.yaml"),
      `
apiVersion: config.openshift.io/v1
kind: ClusterVersion
metadata:
  name: version
status:
  desired:
    version: 4.18.2
  history:
    - state: Completed
      version: 4.18.2
  conditions:
    - type: Available
      status: "True"
`,
    );
    const res = await parseClusterVersion(tmpDir);
    expect(res).not.toBeNull();
    expect(res?.version).toBe("4.18.2");
    expect(res?.state).toBe("Completed");
  });

  it("handles missing clusterversion gracefully", async () => {
    const res = await parseClusterVersion(tmpDir);
    expect(res).toBeNull();
  });

  it("parses clusteroperators correctly", async () => {
    const coDir = path.join(tmpDir, "cluster-scoped-resources/config.openshift.io/clusteroperators");
    fs.mkdirSync(coDir, { recursive: true });
    fs.writeFileSync(
      path.join(coDir, "authentication.yaml"),
      `
apiVersion: config.openshift.io/v1
kind: ClusterOperator
metadata:
  name: authentication
status:
  conditions:
    - type: Available
      status: "False"
      message: "Deployment not ready"
    - type: Degraded
      status: "True"
      message: "OAuth degraded"
    - type: Progressing
      status: "False"
`,
    );
    const res = await parseClusterOperators(tmpDir);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("authentication");
    expect(res[0].degraded).toBe(true);
    expect(res[0].available).toBe(false);
    expect(res[0].progressing).toBe(false);
  });

  it("handles missing clusteroperators directory gracefully", async () => {
    const res = await parseClusterOperators(tmpDir);
    expect(res).toEqual([]);
  });

  it("parses nodes correctly", async () => {
    const nodeDir = path.join(tmpDir, "cluster-scoped-resources/core/nodes");
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(nodeDir, "worker-1.yaml"),
      `
apiVersion: v1
kind: Node
metadata:
  name: worker-1
  labels:
    node-role.kubernetes.io/worker: ""
status:
  conditions:
    - type: Ready
      status: "True"
    - type: MemoryPressure
      status: "True"
`,
    );
    const res = await parseNodes(tmpDir);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("worker-1");
    expect(res[0].ready).toBe(true);
    expect(res[0].pressures).toContain("MemoryPressure");
  });

  it("handles missing nodes directory gracefully", async () => {
    const res = await parseNodes(tmpDir);
    expect(res).toEqual([]);
  });
});
