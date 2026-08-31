# Install Failure Analysis — Metal (Bare Metal)

Bare metal install failure diagnosis: dev-scripts orchestration, OFCIR host allocation, Ironic / Metal3 node provisioning, and virtualmedia/PXE boot.

## 1. Fast Triage Matrix: Metal Stack Layers

| Layer | Component | Failure Symptoms | Primary Evidence Path |
|---|---|---|---|
| **Layer 0** | **OFCIR Acquisition** | Host allocation timeout, pool empty, `cir` in error/maintenance state. | `artifacts/{target}/ofcir-acquire/build-log.txt`, `junit_metal_setup.xml` |
| **Layer 1** | **dev-scripts Setup** | Hypervisor networking failure, dnsmasq error, mirror registry setup failure. | `artifacts/{target}/baremetalds-devscripts-setup/` (`01_*.log` through `05_*.log`) |
| **Layer 2** | **Ironic / Metal3** | `BareMetalHost` stuck in `inspecting`, `preparing`, or `provisioning`; BMC IPMI/Redfish auth failure; virtualmedia boot hang. | `ironic.log`, `ironic-conductor.log`, `baremetal-operator.log` |
| **Layer 3** | **OpenShift Install** | Standard bootstrap or master node installation failures. | See `install/general.md` |

---

## 2. dev-scripts Numbered Phase Logs

When dev-scripts fails during setup (Layer 1), check the step log corresponding to the failing script:
- `01_install_requirements.log` — Package installation, dependencies, and hypervisor tool setup.
- `02_configure_host.log` — Hypervisor network interfaces (`baremetal`, `provisioning` bridges), sysctl, and firewall.
- `03_ocp_repo.log` — Installer binary fetching/building and release image extraction.
- `04_setup_ironic.log` — Ironic container startup, dnsmasq, and virtualmedia/tftp endpoints.
- `05_install_requirements.log` / `06_create_cluster.log` — Cluster creation execution.

---

## 3. Ironic & Metal3 Failure Signatures

- **BMC Authentication / Connectivity:** `IPMI error: invalid username or password` or `Redfish connection timeout` → Ironic unable to control host power/boot.
- **Inspection Timeout:** BMH stuck in `inspecting` → Introspection kernel failed to boot or network interface did not DHCP on the provisioning network.
- **VirtualMedia Boot Hang:** Node boots into blank screen or fails to fetch ISO image over HTTP → Check webserver hosting the ISO on hypervisor port 6180.
- **Provisioning Network DHCP / DNS:** dnsmasq on `provisioning` bridge failed to assign IP or deliver PXE configuration.

---

## 4. Libvirt & Serial Console Logs

For baremetal VM/node boot failures:
- Libvirt console outputs live in `libvirt-logs.tar` or `serial.log`.
- Look for kernel panics, firmware/UEFI boot failures, or Ignition network timeouts during the node's first boot.
