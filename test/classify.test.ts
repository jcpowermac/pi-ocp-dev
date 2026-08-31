import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  prowUrlToGcsPath,
  fetchRunSignature,
  groupErrors,
  normalizeErrorMessage,
  type Fetcher,
} from "../extensions/prow/classify.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Prefix-matched fake fetcher: route keys are URL prefixes, so tests do not
 * depend on exact query-string formatting.
 */
function fakeFetcher(routes: [string, { status: number; body: string }][]) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url: string) => {
    calls.push(url);
    for (const [prefix, res] of routes) {
      if (url.startsWith(prefix)) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetcher, calls };
}

const LIST_URL =
  "https://storage.googleapis.com/storage/v1/b/test-platform-results/o?";
const RUN_PREFIX = "https://storage.googleapis.com/test-platform-results/";

const junitA = `<?xml version="1.0"?>
<testsuite name="e2e" tests="3" failures="1">
  <testcase classname="e2e-tests/network" name="should resolve DNS" time="1.2">
    <failure message="timed out">dns timeout</failure>
  </testcase>
  <testcase classname="e2e-tests/network" name="should list pods" time="0.5"/>
  <testcase classname="informing/extra" name="should collect metrics" lifecycle="informing">
    <failure message="boom">boom</failure>
  </testcase>
</testsuite>`;

const junitB = `<?xml version="1.0"?>
<testsuite name="e2e" tests="3" failures="2">
  <testcase classname="e2e-tests/network" name="should resolve DNS" time="0.9"/>
  <testcase classname="e2e-tests/storage" name="should mount volume" time="2.0">
    <error message="mount failed">mount failed</error>
  </testcase>
  <testcase classname="e2e-tests/storage" name="should write files" time="1.1">
    <failure message="write failed">write failed</failure>
  </testcase>
</testsuite>`;

describe("prowUrlToGcsPath", () => {
  it("parses a periodic view/gs URL", () => {
    expect(
      prowUrlToGcsPath(
        "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/123",
      ),
    ).toEqual({
      bucket: "test-platform-results",
      path: "logs",
      buildId: "123",
      jobName: "JOB",
    });
  });

  it("parses a pr-logs view/gs URL", () => {
    expect(
      prowUrlToGcsPath(
        "https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/openshift-pri/1234/JOB/456",
      ),
    ).toEqual({
      bucket: "test-platform-results",
      path: "pr-logs/pull/openshift-pri/1234",
      buildId: "456",
      jobName: "JOB",
    });
  });

  it("parses gs:// and storage.googleapis.com URLs", () => {
    const ref = prowUrlToGcsPath("gs://test-platform-results/logs/JOB/123");
    expect(ref).toEqual({
      bucket: "test-platform-results",
      path: "logs",
      buildId: "123",
      jobName: "JOB",
    });
    expect(
      prowUrlToGcsPath(
        "https://storage.googleapis.com/test-platform-results/logs/JOB/123",
      ),
    ).toEqual(ref);
  });

  it("parses a raw bucket path", () => {
    expect(
      prowUrlToGcsPath("test-platform-results/logs/JOB/123"),
    ).toMatchObject({ buildId: "123", jobName: "JOB" });
  });

  it("rejects URLs without a GCS marker or too few path parts", () => {
    expect(() =>
      prowUrlToGcsPath("https://prow.ci.openshift.org/jobs"),
    ).toThrow();
    expect(() => prowUrlToGcsPath("gs://bucket/onlyone")).toThrow();
  });
});

describe("fetchRunSignature", () => {
  it("classifies a run with junit test failures, dropping flakes and informing tests", async () => {
    const { fetcher } = fakeFetcher([
      [
        LIST_URL,
        {
          status: 200,
          body: JSON.stringify({
            items: [
              { name: "logs/JOB/123/artifacts/openshift-e2e-test/artifacts/junit/e2e_1.xml" },
              { name: "logs/JOB/123/artifacts/openshift-e2e-test/artifacts/junit/e2e_2.xml" },
            ],
          }),
        },
      ],
      [`${RUN_PREFIX}logs/JOB/123/artifacts/openshift-e2e-test/artifacts/junit/e2e_1.xml`, { status: 200, body: junitA }],
      [`${RUN_PREFIX}logs/JOB/123/artifacts/openshift-e2e-test/artifacts/junit/e2e_2.xml`, { status: 200, body: junitB }],
    ]);
    const sig = await fetchRunSignature("test-platform-results/logs/JOB/123", {
      fetcher,
    });
    expect(sig.failureType).toBe("test_failure");
    expect(sig.tests).toEqual([
      "e2e-tests/storage should mount volume",
      "e2e-tests/storage should write files",
    ]);
  });

  it("classifies an ipi-install failure with no junit files as infra_failure", async () => {
    const log = [
      "step pull-ci-openshift-release: completed",
      "starting cluster install",
      "waiting for bootstrap",
      "\x1b[31merror: failed to run step ipi-install: timed out waiting for the cluster to be ready\x1b[0m",
    ].join("\n");
    const message =
      "error: failed to run step ipi-install: timed out waiting for the cluster to be ready";
    const { fetcher } = fakeFetcher([
      [LIST_URL, { status: 200, body: JSON.stringify({ items: [] }) }],
      [`${RUN_PREFIX}logs/JOB/123/build-log.txt`, { status: 200, body: log }],
    ]);
    const sig = await fetchRunSignature("test-platform-results/logs/JOB/123", {
      fetcher,
    });
    expect(sig.failureType).toBe("infra_failure");
    expect(sig.tests).toEqual([]);
    expect(sig.errors).toEqual([{ message, hash: sha256(message) }]);
  });

  it("classifies a run with no junit failures and a clean build log as success", async () => {
    const log = ["starting run", "step e2e-tests completed", "run finished ok"].join("\n");
    const { fetcher } = fakeFetcher([
      [LIST_URL, { status: 200, body: JSON.stringify({ items: [] }) }],
      [`${RUN_PREFIX}logs/JOB/123/build-log.txt`, { status: 200, body: log }],
    ]);
    const sig = await fetchRunSignature("test-platform-results/logs/JOB/123", {
      fetcher,
    });
    expect(sig).toEqual({
      buildId: "123",
      failureType: "success",
      tests: [],
      errors: [],
    });
  });

  it("truncates normalized error messages at 300 chars", async () => {
    const longLine = "error: " + "x".repeat(500);
    const { fetcher } = fakeFetcher([
      [LIST_URL, { status: 200, body: JSON.stringify({ items: [] }) }],
      [`${RUN_PREFIX}logs/JOB/123/build-log.txt`, { status: 200, body: longLine }],
    ]);
    const sig = await fetchRunSignature("test-platform-results/logs/JOB/123", {
      fetcher,
    });
    expect(sig.failureType).toBe("infra_failure");
    expect(sig.errors[0].message.length).toBe(300);
  });

  it("treats a missing build log and empty listing as success", async () => {
    const { fetcher } = fakeFetcher([
      [LIST_URL, { status: 200, body: JSON.stringify({ items: [] }) }],
      [`${RUN_PREFIX}logs/JOB/123/build-log.txt`, { status: 404, body: "not found" }],
    ]);
    const sig = await fetchRunSignature("test-platform-results/logs/JOB/123", {
      fetcher,
    });
    expect(sig.failureType).toBe("success");
  });
});

describe("normalizeErrorMessage", () => {
  it("strips ANSI escapes and collapses whitespace", () => {
    expect(normalizeErrorMessage("  \x1b[31m  Failed   to   start  \x1b[0m  ")).toBe(
      "Failed to start",
    );
  });

  it("masks timestamps, release ids, and ci-op names", () => {
    expect(normalizeErrorMessage("2025-01-02T03:04:05Z job failed")).toBe(
      "job failed",
    );
    expect(normalizeErrorMessage("job ci-op-test-123 failed")).toBe(
      "job ci-op-* failed",
    );
    expect(
      normalizeErrorMessage(
        "failed at 4.19.0-20250101.ci-2025-01-01-120000-gitabcdef0123456789",
      ),
    ).toBe("failed at release-*");
  });
});

describe("groupErrors", () => {
  it("groups exact hash matches", () => {
    const groups = groupErrors([
      { message: "a failed", hash: "h1" },
      { message: "a failed", hash: "h1" },
      { message: "b failed", hash: "h2" },
    ]);
    expect(groups).toEqual([
      { message: "a failed", hash: "h1", count: 2 },
      { message: "b failed", hash: "h2", count: 1 },
    ]);
  });

  it("groups different hashes above 70% token similarity", () => {
    const groups = groupErrors([
      {
        message: "error: connection timed out while contacting the api server from worker node one",
        hash: "h1",
      },
      {
        message: "error: connection timed out while contacting the api server from worker node two",
        hash: "h2",
      },
      { message: "dns lookup failed for the image registry", hash: "h3" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(2);
    expect(groups[1]).toEqual({
      message: "dns lookup failed for the image registry",
      hash: "h3",
      count: 1,
    });
  });

  it("returns groups in first-occurrence order", () => {
    const groups = groupErrors([
      { message: "first error happened", hash: "h1" },
      { message: "second error happened", hash: "h2" },
      { message: "first error happened", hash: "h1" },
    ]);
    expect(groups.map((g) => g.hash)).toEqual(["h1", "h2"]);
    expect(groups.map((g) => g.count)).toEqual([2, 1]);
  });
});
