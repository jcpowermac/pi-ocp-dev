import { describe, it, expect } from "vitest";
import type {
  ClusterOperatorStatus,
  MustGatherAnalysisResult,
  MustGatherSummary,
} from "../extensions/must-gather/types.js";

describe("must-gather types", () => {
  it("allows constructing valid analysis results", () => {
    const summary: MustGatherSummary = {
      operators: { total: 1, healthy: 1, degraded: 0, progressing: 0 },
      nodes: { total: 3, ready: 3, not_ready: 0, pressure: [] },
      pods: { total: 10, healthy: 10, failing: 0, crashloop: 0, pending: 0 },
      etcd: { total_members: 3, healthy: 3, quorum: true },
      warning_events_count: 0,
    };
    const result: MustGatherAnalysisResult = {
      must_gather_path: "/tmp/mg",
      cluster_version: { version: "4.18.2", state: "Completed" },
      summary,
      critical_issues: [],
      candidate_references: [],
    };
    expect(result.summary.operators.total).toBe(1);
  });
});
