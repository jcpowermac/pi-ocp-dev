import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parsePods } from "../extensions/must-gather/parsers/pods.js";
import { parseEvents } from "../extensions/must-gather/parsers/events.js";
import { parseEtcd } from "../extensions/must-gather/parsers/etcd.js";
import { parseStorage } from "../extensions/must-gather/parsers/storage.js";
import { parseNetwork } from "../extensions/must-gather/parsers/network.js";

describe("workload parsers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-workload-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses pods with crashloop and container restarts", async () => {
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
          message: "Back-off 5m0s restarting failed container"
`,
    );
    const summary = await parsePods(tmpDir);
    expect(summary.total).toBe(1);
    expect(summary.failing).toBe(1);
    expect(summary.crashloop).toBe(1);
    expect(summary.issues[0].name).toBe("etcd-master-0");
    expect(summary.issues[0].status).toBe("CrashLoopBackOff");
  });

  it("handles missing pods gracefully", async () => {
    const summary = await parsePods(tmpDir);
    expect(summary.total).toBe(0);
    expect(summary.issues).toEqual([]);
  });

  it("parses warning events", async () => {
    const nsDir = path.join(tmpDir, "namespaces/openshift-etcd/core");
    fs.mkdirSync(nsDir, { recursive: true });
    fs.writeFileSync(
      path.join(nsDir, "events.yaml"),
      `
apiVersion: v1
kind: EventList
items:
  - metadata:
      namespace: openshift-etcd
    lastTimestamp: "2026-09-02T10:00:00Z"
    type: Warning
    reason: Unhealthy
    involvedObject:
      kind: Pod
      name: etcd-master-0
    message: "Readiness probe failed"
    count: 10
`,
    );
    const events = await parseEvents(tmpDir);
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("Unhealthy");
    expect(events[0].type).toBe("Warning");
  });

  it("handles missing events gracefully", async () => {
    const events = await parseEvents(tmpDir);
    expect(events).toEqual([]);
  });

  it("parses etcd health files", async () => {
    const etcdDir = path.join(tmpDir, "etcd_info");
    fs.mkdirSync(etcdDir, { recursive: true });
    fs.writeFileSync(
      path.join(etcdDir, "endpoint_health.json"),
      JSON.stringify([
        { endpoint: "https://10.0.0.1:2379", health: true, member_id: "abc" },
        { endpoint: "https://10.0.0.2:2379", health: true, member_id: "def" },
        { endpoint: "https://10.0.0.3:2379", health: true, member_id: "ghi" },
      ]),
    );
    const etcd = await parseEtcd(tmpDir);
    expect(etcd).not.toBeNull();
    expect(etcd?.total_members).toBe(3);
    expect(etcd?.healthy).toBe(3);
    expect(etcd?.quorum).toBe(true);
  });

  it("returns null for missing etcd info", async () => {
    const etcd = await parseEtcd(tmpDir);
    expect(etcd).toBeNull();
  });

  it("parses storage persistent volumes and claims", async () => {
    const pvDir = path.join(tmpDir, "cluster-scoped-resources/core/persistentvolumes");
    fs.mkdirSync(pvDir, { recursive: true });
    fs.writeFileSync(path.join(pvDir, "pv-1.yaml"), "apiVersion: v1\nkind: PersistentVolume\nmetadata:\n  name: pv-1");

    const pvcDir = path.join(tmpDir, "namespaces/openshift-monitoring/core");
    fs.mkdirSync(pvcDir, { recursive: true });
    fs.writeFileSync(
      path.join(pvcDir, "persistentvolumeclaims.yaml"),
      `
apiVersion: v1
kind: PersistentVolumeClaimList
items:
  - metadata:
      name: prometheus-pvc
    status:
      phase: Pending
`,
    );

    const storage = await parseStorage(tmpDir);
    expect(storage.pv_count).toBe(1);
    expect(storage.pvc_count).toBe(1);
    expect(storage.unbound_pvc_count).toBe(1);
    expect(storage.unbound_pvcs[0].name).toBe("prometheus-pvc");
    expect(storage.unbound_pvcs[0].status).toBe("Pending");
  });

  it("parses network type for ovn vs sdn", async () => {
    const ovnDir = path.join(tmpDir, "namespaces/openshift-ovn-kubernetes");
    fs.mkdirSync(ovnDir, { recursive: true });
    const net = await parseNetwork(tmpDir);
    expect(net.type).toBe("OVN-Kubernetes");
    expect(net.healthy).toBe(true);
  });
});
