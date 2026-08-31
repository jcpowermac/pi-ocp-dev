import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROW_URL,
  prowUrlToGcsPrefix,
  prowUrlToBuildLogUrl,
} from "../extensions/prow/fetch.js";

describe("prowUrlToGcsPrefix", () => {
  it("extracts the GCS prefix from a deck URL", () => {
    expect(
      prowUrlToGcsPrefix(
        "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/123",
      ),
    ).toBe("test-platform-results/logs/JOB/123");
  });

  it("returns null for non-gs deck URLs", () => {
    expect(
      prowUrlToGcsPrefix("https://prow.ci.openshift.org/view/gcs/other/x"),
    ).toBeNull();
    expect(prowUrlToGcsPrefix("https://example.com/nothing")).toBeNull();
  });
});

describe("prowUrlToBuildLogUrl", () => {
  it("converts a deck URL to the public GCS build-log URL", () => {
    expect(
      prowUrlToBuildLogUrl(
        "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/JOB/123",
      ),
    ).toBe(
      "https://storage.googleapis.com/test-platform-results/logs/JOB/123/build-log.txt",
    );
  });

  it("returns null when the prefix cannot be extracted", () => {
    expect(prowUrlToBuildLogUrl("https://example.com/nothing")).toBeNull();
  });
});

describe("DEFAULT_PROW_URL", () => {
  it("points at public prow with heavy fields omitted", () => {
    expect(DEFAULT_PROW_URL).toContain("prow.ci.openshift.org/prowjobs.js");
    expect(DEFAULT_PROW_URL).toContain("omit=");
  });
});
