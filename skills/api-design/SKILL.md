---
name: api-design
description: Use when designing or reviewing Kubernetes/OpenShift API types — new CRDs, openshift/api config types, types_*.go files, adding or deprecating spec/status fields, unions, conditions, or API review. Catches json tag, requiredness, pointer, enum, naming, and printer-column convention violations.
---

# API Design

Design or review Kubernetes/OpenShift API types (types_*.go, CRDs,
config APIs) in compliance with the k8s API conventions and OpenShift
enhancements conventions, with minimal context cost.

## Workflow

1. **Writing new types?** Read `references/templates.go` (relative to this
   skill directory) ONCE and copy its shapes. Do not invent new patterns.
2. **Always** run the `api_lint_types` tool on the types file or package
   directory. Fix every `error`. Warnings on *new* fields must be fixed;
   warnings on pre-existing (legacy) fields may stay — never copy them into
   new fields.
3. Only if a question remains that the linter does not answer (naming,
   requiredness semantics, unions, defaults, deprecation, feature sets,
   versioning/promotion workflow, feature-gate mechanics), read
   `references/rules.md`.

## Golden example

`openshift/api` `config/v1/types_infrastructure.go` is the reference shape
for a config singleton: TypeMeta+ObjectMeta, required spec, optional status
with `[]metav1.Condition`, platform-specific unions, printcolumn markers.

## Non-negotiables

- Kinds singular PascalCase; resources lowercase plural; JSON camelCase
  matching the Go name.
- Every new field has `+optional` or `+required`. Booleans are forbidden in
  OpenShift APIs — use a string policy enum instead.
- Godoc per field: validation, "When omitted, ...", and field interactions.
- No bare `int`, no unsigned ints, no floats in spec, no numeric enums.
- String-enum fields need `+kubebuilder:validation:Enum` (include "" if the
  zero value is meaningful) — without it the CRD accepts any string.
- Conditions are `[]metav1.Condition` (map-listType), never singular, and
  no `phase` fields.
- Resource-specific reference types; never generic `ObjectReference`.
- New CRDs start as `v1alpha1` behind a FeatureGate; stable `v1` is
  `compatibility-gen:level=1`, alpha is `level=4`; v1 fields are frozen —
  deprecate, never delete.
