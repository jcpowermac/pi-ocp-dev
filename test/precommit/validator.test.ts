import { describe, it, expect } from "vitest";
import { validatePrecommitConfig } from "../../extensions/precommit/validator.js";

describe("validatePrecommitConfig", () => {
  it("allows trusted pre-commit-hooks with allowed hook IDs", () => {
    const yaml = `
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.4.0
    hooks:
      - id: trailing-whitespace
      - id: check-yaml
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("allows gitleaks repo with any hook", () => {
    const yaml = `
repos:
  - repo: https://github.com/leaktk/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
  });

  it("allows repo: local", () => {
    const yaml = `
repos:
  - repo: local
    hooks:
      - id: local-lint
        name: local-lint
        entry: make lint
        language: system
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(true);
  });

  it("rejects untrusted repos", () => {
    const yaml = `
repos:
  - repo: https://github.com/evil/malicious-repo
    hooks:
      - id: run-evil
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("untrusted repo"))).toBe(true);
  });

  it("rejects disallowed hooks from pre-commit-hooks", () => {
    const yaml = `
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    hooks:
      - id: dangerous-hook
`;
    const result = validatePrecommitConfig(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("untrusted hook"))).toBe(true);
  });
});
