export interface ClusterVersionInfo {
  version: string;
  state: string;
  desired_version?: string;
  cluster_id?: string;
  capabilities?: string[];
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export interface OperatorCondition {
  type: "Available" | "Progressing" | "Degraded" | "Upgradeable";
  status: "True" | "False" | "Unknown";
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface ClusterOperatorStatus {
  name: string;
  version?: string;
  available: boolean;
  progressing: boolean;
  degraded: boolean;
  since?: string;
  message?: string;
}

export interface NodeStatus {
  name: string;
  ready: boolean;
  roles: string[];
  version?: string;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  pressures: string[];
}

export interface PodIssue {
  namespace: string;
  name: string;
  status: string;
  restarts: number;
  ready_containers: string;
  node?: string;
  reason?: string;
  message?: string;
}

export interface PodStatusSummary {
  total: number;
  healthy: number;
  failing: number;
  crashloop: number;
  pending: number;
  issues: PodIssue[];
}

export interface ClusterEvent {
  namespace: string;
  lastTimestamp: string;
  type: "Normal" | "Warning" | "Error";
  reason: string;
  object: string;
  message: string;
  count: number;
}

export interface EtcdMember {
  id: string;
  name: string;
  peerURLs: string[];
  clientURLs: string[];
  healthy: boolean;
}

export interface EtcdHealthInfo {
  total_members: number;
  healthy: number;
  quorum: boolean;
  leader?: string;
  members: EtcdMember[];
}

export interface StorageStatus {
  pv_count: number;
  pvc_count: number;
  unbound_pvc_count: number;
  unbound_pvcs: Array<{ namespace: string; name: string; status: string }>;
}

export interface NetworkStatus {
  type: string;
  healthy: boolean;
  issues: string[];
}

export interface MustGatherSummary {
  operators: { total: number; healthy: number; degraded: number; progressing: number };
  nodes: { total: number; ready: number; not_ready: number; pressure: string[] };
  pods: { total: number; healthy: number; failing: number; crashloop: number; pending: number };
  etcd: { total_members: number; healthy: number; quorum: boolean };
  warning_events_count: number;
}

export interface CriticalIssue {
  component: "operators" | "nodes" | "pods" | "events" | "etcd" | "network" | "storage";
  name: string;
  namespace?: string;
  reason?: string;
  message: string;
  since?: string;
  severity: "critical" | "warning";
}

export interface MustGatherAnalysisResult {
  must_gather_path: string;
  cluster_version?: ClusterVersionInfo;
  summary: MustGatherSummary;
  critical_issues: CriticalIssue[];
  candidate_references: string[];
  component_data?: {
    operators?: ClusterOperatorStatus[];
    nodes?: NodeStatus[];
    pods?: PodIssue[];
    events?: ClusterEvent[];
    etcd?: EtcdHealthInfo;
    storage?: StorageStatus;
    network?: NetworkStatus;
  };
}
