import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseMachines, machineIssues } from "../extensions/must-gather/parsers/machines.js";

describe("machine manifest parser", () => {
  let tmpDir: string;
  const machinesDir = (d: string) => path.join(d, "namespaces/openshift-machine-api/machine.openshift.io/machines");

  const writeMachine = (name: string, body: string) => {
    const dir = machinesDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.yaml`), body);
  };

  const runningMachine = `
apiVersion: machine.openshift.io/v1beta1
kind: Machine
metadata:
  name: good-worker
  creationTimestamp: "2026-04-24T15:55:09Z"
  annotations:
    machine.openshift.io/instance-state: poweredOn
status:
  conditions:
  - lastTransitionTime: "2026-04-24T16:17:18Z"
    status: "True"
    type: Drainable
  - lastTransitionTime: "2026-04-24T18:41:16Z"
    status: "True"
    type: InstanceExists
  lastUpdated: "2026-04-30T21:05:46Z"
  nodeRef:
    kind: Node
    name: good-worker
  phase: Running
  providerStatus:
    conditions:
    - lastTransitionTime: "2026-04-24T16:10:00Z"
      message: Machine successfully created
      reason: MachineCreationSucceeded
      status: "True"
      type: MachineCreation
    instanceId: 42066e29-0010-9d89-7396-fac9caa71c0b
`;

  const stuckMachine = `
apiVersion: machine.openshift.io/v1beta1
kind: Machine
metadata:
  name: stuck-worker
  creationTimestamp: "2026-04-02T15:02:59Z"
status:
  conditions:
  - lastTransitionTime: "2026-04-02T15:33:46Z"
    status: "False"
    type: InstanceExists
  phase: ""
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-machines-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when machines dir is missing", async () => {
    expect(await parseMachines(tmpDir)).toEqual([]);
  });

  it("parses phase, conditions, providerStatus, and nodeRef", async () => {
    writeMachine("good-worker", runningMachine);
    const [m] = await parseMachines(tmpDir);
    expect(m.name).toBe("good-worker");
    expect(m.phase).toBe("Running");
    expect(m.instance_state).toBe("poweredOn");
    expect(m.node).toBe("good-worker");
    expect(m.instance_id).toBe("42066e29-0010-9d89-7396-fac9caa71c0b");
    expect(m.last_updated).toBe("2026-04-30T21:05:46Z");
    const exists = m.conditions.find((c) => c.type === "InstanceExists");
    expect(exists).toMatchObject({ status: "True", lastTransitionTime: "2026-04-24T18:41:16Z" });
    const created = m.provider_conditions.find((c) => c.type === "MachineCreation");
    expect(created).toMatchObject({ reason: "MachineCreationSucceeded", message: "Machine successfully created" });
  });

  it("flags machines that are not Running and lack an instance", async () => {
    writeMachine("good-worker", runningMachine);
    writeMachine("stuck-worker", stuckMachine);
    const machines = await parseMachines(tmpDir);
    expect(machines).toHaveLength(2);
    const good = machineIssues(machines[0], new Set(["good-worker"]));
    expect(good).toEqual([]);
    const stuck = machineIssues(machines[1], new Set(["good-worker"]));
    expect(stuck).toContain("MachineNotRunning (phase unknown)");
    expect(stuck.some((s) => s.startsWith("InstanceExists=False"))).toBe(true);
  });

  it("flags running machines whose node is missing", async () => {
    writeMachine("good-worker", runningMachine);
    const [m] = await parseMachines(tmpDir);
    expect(machineIssues(m, new Set(["other-node"]))).toContain("MachineNodeMissing");
  });
});
