# Machines (machine.openshift.io)

Source: `namespaces/openshift-machine-api/machine.openshift.io/machines/*.yaml`

## Fields
- `phase`: `Provisioning | Running | Deleting | ""` (empty = controller never reconciled)
- `instance_state`: annotation `machine.openshift.io/instance-state` (e.g. `poweredOn`)
- `conditions`: `InstanceExists` (VM exists in vSphere), `Drainable`, `Terminable`
- `provider_conditions`: provider-specific, e.g. `MachineCreation` (vSphere VM creation task result)
- `instance_id`: vSphere VM uuid
- `node`: linked Node name (`status.nodeRef.name`)
- `last_updated`: last status write by the controller

## Reading stall timelines
Join four clocks to see where a machine joined:

1. `metadata.creationTimestamp` — machine object created
2. `provider_conditions[].MachineCreation` / `InstanceExists` transition — VM created in vSphere
3. Node `creationTimestamp` — kubelet registered
4. Node `Ready` condition `lastTransitionTime` — first/last ready

Interpretation:
- gap (1→2) large: vSphere provisioning slow/failed (check `MachineCreation` reason/message)
- gap (2→3) large: VM exists but kubelet never registered — ignition/bootstrap failure,
  OS not booting, or VM off. Controller is NOT at fault; check ignition logs / vSphere console.
- gap (3→4) large or Ready transitions long after creation: node flapping, maintenance, or MHC remediation.
- `phase` stuck in `Provisioning` with `InstanceExists=False`: actuator create-instance problem.
- `MachineNodeNotLinked`/`MachineNodeMissing`: node link lost (node deleted or renamed).

Note: `Ready.lastTransitionTime` is the LAST transition, not first-ready — on long-lived nodes
it reflects recent events, not original join time.
