import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runMustGatherAnalysis } from "../extensions/must-gather/runner.js";

describe("must-gather runner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-runner-test-"));
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
    - type: Degraded
      status: "True"
      message: "OAuth deployment degraded"
    - type: Available
      status: "False"
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces compact analysis summary and detects critical issues", async () => {
    const result = await runMustGatherAnalysis(tmpDir, { component: "all", problemsOnly: true });
    expect(result.summary.operators.total).toBe(1);
    expect(result.summary.operators.degraded).toBe(1);
    expect(result.critical_issues).toHaveLength(1);
    expect(result.critical_issues[0].name).toBe("authentication");
    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/cluster-operators.md");
  });

  it("returns targeted component data when requested", async () => {
    const result = await runMustGatherAnalysis(tmpDir, { component: "operators" });
    expect(result.component_data?.operators).toBeDefined();
    expect(result.component_data?.operators).toHaveLength(1);
    expect(result.component_data?.operators?.[0].name).toBe("authentication");
  });

  it("detects pod and node issues and routes candidate references", async () => {
    const podDir = path.join(tmpDir, "namespaces/openshift-etcd/pods/etcd-master-0");
    fs.mkdirSync(podDir, { recursive: true });
    fs.writeFileSync(
      path.join(podDir, "etcd-master-0.yaml"),
      `
apiVersion: v1
kind: Pod
metadata:
  name: etcd-master-0
  namespace: openshift-etcd
spec:
  nodeName: master-0
status:
  phase: Running
  containerStatuses:
    - name: etcd
      ready: false
      restartCount: 15
      state:
        waiting:
          reason: CrashLoopBackOff
          message: "Back-off restarting failed container"
`,
    );

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
      status: "False"
`,
    );

    const etcdDir = path.join(tmpDir, "etcd_info");
    fs.mkdirSync(etcdDir, { recursive: true });
    fs.writeFileSync(
      path.join(etcdDir, "endpoint_health.json"),
      JSON.stringify([
        { endpoint: "https://10.0.0.1:2379", health: false, member_id: "abc" },
        { endpoint: "https://10.0.0.2:2379", health: false, member_id: "def" },
        { endpoint: "https://10.0.0.3:2379", health: true, member_id: "ghi" },
      ]),
    );

    const result = await runMustGatherAnalysis(tmpDir, { component: "all" });
    expect(result.summary.pods.crashloop).toBe(1);
    expect(result.summary.nodes.not_ready).toBe(1);
    expect(result.summary.etcd.quorum).toBe(false);

    const issues = result.critical_issues.map((i) => i.component);
    expect(issues).toContain("operators");
    expect(issues).toContain("pods");
    expect(issues).toContain("nodes");
    expect(issues).toContain("etcd");

    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/cluster-operators.md");
    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/pods.md");
    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/nodes.md");
    expect(result.candidate_references).toContain("skills/must-gather-analysis/references/etcd.md");
  });
});
