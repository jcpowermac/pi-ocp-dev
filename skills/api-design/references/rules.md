# API Convention Rules (judgment calls)

The `api_lint_types` tool covers mechanical rules. This file covers the design
judgment it cannot. Sources: kubernetes/community api-conventions.md,
openshift/enhancements CONVENTIONS.md + dev-guide/api-conventions.md.
Existing OpenShift APIs predating the conventions are NOT a precedent —
non-compliant APIs are not a justification for more non-compliant APIs.

## Naming

- **Kind**: singular, PascalCase noun (`WorkThing`, not `WorkThings` or `workthing`).
  Prefer declarative names, not imperative (`Backup`, not `BackupJob` when the
  object is the artifact).
- **Resource (plural)**: lowercase (`workthings`). Use the regular English
  plural (`box` → `boxes`, `status` → `statuses`); avoid irregular forms.
- **Group**: lowercase DNS subdomain you own (`workthings.example.com`,
  `config.openshift.io`). `*.k8s.io` is reserved.
- **Version**: `v1`, `v1beta1`, `v1alpha1`. The Go package name must match.
- **JSON fields**: camelCase, no underscores/dashes, must match the Go name
  apart from initial capitalization.

## Requiredness and types (the decisions the linter can't make for you)

- **Every new field** declares `+optional` or `+required` explicitly.
  `omitempty` alone implies optional and is not an explicit declaration.
- **Pointer rule**: use a pointer (`*T`, omitempty) only when the zero value
  is a *valid user choice* and "unset" must be distinguishable from it.
  - `bool` → always `*bool` + omitempty (false is always valid).
  - `int32`/`int64` → plain type unless 0 means something the user must
    distinguish from unset.
  - structs/slices/maps → plain unless the empty value is a valid choice.
- **Required fields**: no `omitempty` (except pointer types whose zero value
  is valid). The API server rejects resources missing them.
- **int32 over int64** unless values can exceed int32. No `int`, no unsigned.
- **No floats** in spec, avoid elsewhere (not round-trippable). Model scaled
  values as int64 milliunits or strings.
- **Enums**: string alias types with PascalCase constants, never numeric.
- **Deprecated**: comment `DEPRECATED: <date/version> <guidance>` plus
  `+k8s:deprecated=<date>` marker. Do not delete or change the meaning of
  existing fields; add a new one and migrate.

## Structure

- **Resource** = `TypeMeta` + `ObjectMeta` + `Spec` (+ `Status`).
  Spec = user intent, stored as given. Status = system observation, usually
  late-initialized by a controller; status fields may be defaulted by the
  controller, spec fields only by static defaulting (optional fields only).
- **List kind** = `<Kind>List` with required `Items []<Kind> \`json:"items"\``.
- **Conditions**: `[]metav1.Condition` with `patchStrategy:"merge"
  patchMergeKey:"type"`. Document the known condition types and which
  polarity (`True`-normal or `False`-normal). Absence of a known condition
  reads as `Unknown`.
- **References**: resource-specific types (`ConfigMapNameReference`), never
  generic `ObjectReference`. Omit "Ref" from field names (`configMap`, not
  `configMapRef`).
- **Unions**: `+union` on the type, `+unionDiscriminator` (required enum) on
  the discriminator. Consider a `NoOpinion`-style escape hatch for
  configuration APIs.
- **Lists of named subobjects over maps** when subobjects carry more than a
  scalar.

## Registration markers (on the resource type)

```go
// +genclient                                   // clientset generation
// +genclient:nonNamespaced                     // cluster-scoped
// +k8s:deepcopy-gen:interfaces=...runtime.Object
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status              // if you have status
// +kubebuilder:resource:singleton=true         // cluster-scoped config singleton
// +kubebuilder:resource:shortName=wt           // only if genuinely useful
// +kubebuilder:printcolumn:name=...,type=...,JSONPath=`...`
```

- **Print columns**: every new listable resource gets them; they define
  `kubectl get` output. Age column is customary.
- **Short names**: conservative — collisions are unpredictable; only add
  when discoverability genuinely needs it.

## OpenShift specifics

- **Config API** (`config.openshift.io`): cluster-scoped singletons,
  `+kubebuilder:resource:singleton=true`, spec+status split, status carries
  `[]metav1.Condition` (e.g. `Available`, `Progressing`-style conditions).
- **Feature sets**: new/preview APIs are gated with the
  `release.openshift.io/feature-set: TechPreviewNoUpgrade` annotation (or
  equivalent FeatureGate `+openshift:enable:FeatureGate=` markers on fields).
- **Prefer Kubernetes-style naming over platform-native naming** when
  abstracting cloud/VM platform APIs (PascalCase enums etc.); map
  platform quirks in the controller, not the API.
- **Compatibility level**: new APIs start at level 4 (no guarantees) /
  level 3 (preview, no backwards-compat promises); stable APIs get
  compatibility level 1–2 treatment — once shipped, fields are forever.
- **New features are fields, not annotations.** The `something.alpha.kubernetes.io`
  annotation pattern is deprecated; do not add to it.

## Process checklist before declaring an API done

1. `api_lint_types` on the package → zero errors.
2. Warnings on *new* fields fixed; warnings on pre-existing fields may stay
   (they are legacy), but never copy them into new fields.
3. `make update-codegen` / `make verify` (deepcopy, client-gen, openapi).
4. Enhancement doc references the group/version; CRDs carry the feature-set
   annotation.
