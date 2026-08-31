# Prow Job References & Signal Analysis Token Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce token spend across Prow job analysis references by ~85% through deterministic TypeScript tool offloading, sub-signal classification, direct artifact resolution, and dense markdown knowledge encoding.

**Architecture:** Offload deterministic error code recognition, child job discovery, and artifact path routing into TypeScript (`failure.ts`, `classify.ts`, `run-analysis.ts`), and compress all reference documents in `skills/prow-job-analysis/references/` into compact, high-density reference cards without understanding loss.

**Tech Stack:** TypeScript (ESM, Vitest, TypeBox), Markdown, Vitest test suite.

**Spec:** Research synthesis on context length reduction and deterministic tool offloading for `skills/prow-job-analysis/references/`.

## Global Constraints

- All TypeScript code must pass `npm test` (vitest) and `npm run typecheck` (`tsc --noEmit`).
- No network calls during unit tests (use mocked `Fetcher` as in existing tests).
- Every reference document must maintain full technical fidelity for root-cause diagnosis while eliminating tutorial filler, TOCs, and redundant prose.
- Total token count across all reference files should decrease from ~116,600 to <20,000 tokens.

---

### Task 1: Enhance Failure Signal Classification in TypeScript

**Files:**
- Modify: `extensions/prow/failure.ts`
- Test: `test/failure.test.ts`

**Interfaces:**
- Consumes: `FailureScanInput` (`failedTests`, `buildLogLines`, `jobName`)
- Produces: `Signal` with optional `sub_category?: string` and extended regex patterns for cloud quotas (AWS/GCP/Azure/Boskos), networking (image pulls, DNS), resource exhaustion (OOM container, node pressure), and upgrade (CVO, MCO).

- [ ] **Step 1: Write failing unit tests for fine-grained failure signals**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement fine-grained regex matching and sub-category classification in `failure.ts`**
- [ ] **Step 4: Run tests and typecheck to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 2: Implement Aggregated Job Child Resolver & Direct Artifact URLs in TypeScript

**Files:**
- Modify: `extensions/prow/classify.ts`
- Modify: `extensions/prow/run-analysis.ts`
- Test: `test/classify.test.ts`
- Test: `test/run-analysis.test.ts`

**Interfaces:**
- Consumes: GCS run ref and fetcher
- Produces: Aggregated job child run detection/resolution and direct artifact URLs (e.g. `e2e-timelines_spyglass_*.json`, `junit_install.xml`, `clusteroperators.json`) in `RunAnalysisResult`.

- [ ] **Step 1: Write failing tests for aggregated job detection and direct artifact URLs**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement child resolver and artifact link generator in `run-analysis.ts`**
- [ ] **Step 4: Run tests and typecheck to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 3: Compress Core Infrastructure & Platform References

**Files:**
- Modify: `skills/prow-job-analysis/references/cloud-provider-errors.md`
- Modify: `skills/prow-job-analysis/references/networking.md`
- Modify: `skills/prow-job-analysis/references/resource-exhaustion.md`
- Modify: `skills/prow-job-analysis/references/operating-system-changes.md`
- Modify: `skills/prow-job-analysis/references/ci-infrastructure-changes.md`

**Interfaces:**
- Produces: Compact, dense markdown reference cards (<1,000 tokens each) with clear diagnostic trees and symptom tables, zero TOCs, and no generic tutorial prose.

- [ ] **Step 1: Compress `cloud-provider-errors.md` (<800 tokens)**
- [ ] **Step 2: Compress `networking.md` (<850 tokens)**
- [ ] **Step 3: Compress `resource-exhaustion.md` (<900 tokens)**
- [ ] **Step 4: Compress `operating-system-changes.md` (<700 tokens)**
- [ ] **Step 5: Compress `ci-infrastructure-changes.md` (<1,400 tokens)**
- [ ] **Step 6: Commit changes**

---

### Task 4: Compress Install, Upgrade, Disruption, and Test References

**Files:**
- Modify: `skills/prow-job-analysis/references/install/general.md`
- Modify: `skills/prow-job-analysis/references/install/metal.md`
- Modify: `skills/prow-job-analysis/references/upgrade.md`
- Modify: `skills/prow-job-analysis/references/disruption.md`
- Modify: `skills/prow-job-analysis/references/test-extension-binaries.md`
- Modify: `skills/prow-job-analysis/references/aggregated.md`
- Modify: `skills/prow-job-analysis/references/artifacts.md`
- Modify: `skills/prow-job-analysis/references/flaky-test-identification.md`
- Modify: `skills/prow-job-analysis/references/test-failure.md`
- Modify: `skills/prow-job-analysis/references/hypershift.md`
- Modify: `skills/prow-job-analysis/references/README.md`

**Interfaces:**
- Produces: Compact reference cards (<1,500 tokens each) preserving exact OpenShift-specific failure heuristics, phase markers, and probe rules.

- [ ] **Step 1: Compress `install/general.md` and `install/metal.md`**
- [ ] **Step 2: Compress `upgrade.md` and `disruption.md`**
- [ ] **Step 3: Compress `test-extension-binaries.md`, `aggregated.md`, and `artifacts.md`**
- [ ] **Step 4: Compress `flaky-test-identification.md`, `test-failure.md`, `hypershift.md`, and `README.md`**
- [ ] **Step 5: Commit changes**

---

### Task 5: Update Skills, Agents, and Final Token Verification

**Files:**
- Modify: `skills/prow-job-analysis/SKILL.md`
- Modify: `agents/prow-analyst.md`
- Test: Full vitest suite & token reduction verification script

- [ ] **Step 1: Update `SKILL.md` and `agents/prow-analyst.md`**
- [ ] **Step 2: Run token measurement script to verify >80% total token reduction**
- [ ] **Step 3: Run `npm test` and `npm run typecheck`**
- [ ] **Step 4: Commit changes**
