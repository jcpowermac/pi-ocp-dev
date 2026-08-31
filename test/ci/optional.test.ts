import { describe, it, expect, vi } from "vitest";
import {
  gcsPathFromLink,
  checkIsOptionalProwJob,
  prowjobJsonUrls,
  isOptionalProwJobData,
} from "../../extensions/ci/optional.js";

describe("gcsPathFromLink", () => {
  it("extracts gcs path from prow deck view/gs URL", () => {
    const link =
      "https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/openshift_hypershift/123/pull-ci-job/456";
    const path = gcsPathFromLink(link);
    expect(path).toBe("test-platform-results/pr-logs/pull/openshift_hypershift/123/pull-ci-job/456");
  });

  it("extracts gcs path from prow deck view/gcs URL", () => {
    const link =
      "https://prow.ci.openshift.org/view/gcs/origin-ci-test/logs/periodic-job/789";
    const path = gcsPathFromLink(link);
    expect(path).toBe("origin-ci-test/logs/periodic-job/789");
  });

  it("extracts gcs path from gcsweb URL", () => {
    const link =
      "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/job/101";
    const path = gcsPathFromLink(link);
    expect(path).toBe("test-platform-results/logs/job/101");
  });

  it("returns null for non-prow / untrusted host URLs", () => {
    expect(gcsPathFromLink("https://github.com/openshift/hypershift/actions/runs/123")).toBeNull();
    expect(gcsPathFromLink("https://evil.com/view/gs/bucket/path")).toBeNull();
    expect(gcsPathFromLink("")).toBeNull();
  });

  it("returns null for path traversal attempts", () => {
    expect(
      gcsPathFromLink("https://prow.ci.openshift.org/view/gs/bucket/../secret"),
    ).toBeNull();
  });
});

describe("prowjobJsonUrls", () => {
  it("constructs gcsweb and storage URLs", () => {
    const link =
      "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/job/123";
    const urls = prowjobJsonUrls(link);
    expect(urls).toEqual([
      "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/job/123/prowjob.json",
      "https://storage.googleapis.com/test-platform-results/logs/job/123/prowjob.json",
    ]);
  });

  it("returns empty array for invalid links", () => {
    expect(prowjobJsonUrls("https://example.com")).toEqual([]);
  });
});

describe("isOptionalProwJobData", () => {
  it("returns true when spec.optional is true", () => {
    expect(isOptionalProwJobData({ spec: { optional: true } })).toBe(true);
  });

  it("returns true when label prow.k8s.io/is-optional is 'true'", () => {
    expect(
      isOptionalProwJobData({
        spec: { optional: false },
        metadata: { labels: { "prow.k8s.io/is-optional": "true" } },
      }),
    ).toBe(true);
  });

  it("returns false when neither indicates optional", () => {
    expect(
      isOptionalProwJobData({
        spec: { optional: false },
        metadata: { labels: { "prow.k8s.io/is-optional": "false" } },
      }),
    ).toBe(false);
    expect(isOptionalProwJobData({})).toBe(false);
  });
});

describe("checkIsOptionalProwJob", () => {
  it("returns true when fetcher returns optional job via spec", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ spec: { optional: true } });
    const isOpt = await checkIsOptionalProwJob(
      "https://prow.ci.openshift.org/view/gs/bucket/job/123",
      mockFetcher,
    );
    expect(isOpt).toBe(true);
    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });

  it("returns true when fetcher returns optional job via label on fallback URL", async () => {
    const mockFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce({
        metadata: { labels: { "prow.k8s.io/is-optional": "true" } },
      });

    const isOpt = await checkIsOptionalProwJob(
      "https://prow.ci.openshift.org/view/gs/bucket/job/123",
      mockFetcher,
    );
    expect(isOpt).toBe(true);
    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });

  it("returns false for required jobs", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      spec: { optional: false },
      metadata: { labels: {} },
    });
    const isOpt = await checkIsOptionalProwJob(
      "https://prow.ci.openshift.org/view/gs/bucket/job/123",
      mockFetcher,
    );
    expect(isOpt).toBe(false);
  });

  it("returns false (fail-closed) on network errors across all URLs", async () => {
    const mockFetcher = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const isOpt = await checkIsOptionalProwJob(
      "https://prow.ci.openshift.org/view/gs/bucket/job/123",
      mockFetcher,
    );
    expect(isOpt).toBe(false);
  });

  it("returns false for non-prow URLs", async () => {
    const mockFetcher = vi.fn();
    const isOpt = await checkIsOptionalProwJob(
      "https://github.com/openshift/hypershift/actions",
      mockFetcher,
    );
    expect(isOpt).toBe(false);
    expect(mockFetcher).not.toHaveBeenCalled();
  });
});
