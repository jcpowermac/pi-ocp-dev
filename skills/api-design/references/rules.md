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
- **Time fields**: `somethingTime` (e.g. `startTime`), never `...stamp` or
  `...timestamp`. Durations: integer seconds with the unit in the name —
  `fooPeriodSeconds` (periodic), `fooTimeoutSeconds` (inactivity deadline),
  `fooDeadlineSeconds` (completion deadline). Never `metav1.Duration`.
- **Booleans as properties** (if you ever must have one): `Fooable`, not
  `IsFooable`.
- No abbreviations except near-universal ones (`id`, `args`, `stdin`).
  Acronyms only when extremely common, all-same-case (`httpGet`, `TCP`).
- `Node` = the cluster's Node resource; `Host` = the underlying
  physical/virtual system (`hostname`, `hostPath`).
- Reference naming: field naming a resource `Foo` by name = `fooName`; by
  (partial) ObjectReference = `fooRef`. (OpenShift's resource-specific
  reference types above still win: `configMap`, not `configMapRef`.)

## Requiredness and types (the decisions the linter can't make for you)

- **Every new field** declares `+optional` or `+required` explicitly.
  `omitempty` alone implies optional and is not an explicit declaration.
- **Pointer rule (CRD/custom-resource APIs — the OpenShift default)**: use a
  pointer (`*T`, omitempty) only when the zero value is a *valid user choice*
  and "unset" must be distinguishable from it. Otherwise plain type +
  omitempty: "Optional fields should not be pointers (in custom resource
  based APIs)" — the serialized form should match the default/empty state.
  Aggregated-apiserver (built-in-style) APIs allow the exception; when in
  doubt, match neighboring fields in the same type.
  - `bool` → **forbidden in OpenShift APIs.** Use a string policy enum
    instead (upstream example: `TerminationMessagePolicy`; OpenShift example:
    `AuthenticationPolicy`). `kube-api-linter` `NoBools` fails CI in
    openshift/api. If a bool is truly unavoidable: `*bool` + `omitempty`
    (false is a valid user choice, so unset must be distinguishable).
    Sources: openshift/enhancements dev-guide/api-conventions.md
    "Do not use Boolean fields"; kubernetes/community
    contributors/devel/sig-architecture/api-conventions.md "Think twice about
    `bool` fields".
  - `int32`/`int64` → plain type unless 0 means something the user must
    distinguish from unset.
  - structs/slices/maps → plain unless the empty value is a valid choice.
- **`+nullable` is discouraged** on API fields (kubernetes/community, 2025).
  JSON `null` semantics are a second optional-ish state you will regret.
- **Defaulting**: defaults are part of the API contract — once shipped you
  cannot change them without a breaking change. Configuration APIs: default
  at runtime from the user's perspective ("When omitted, ... the value is
  left to the platform to choose a good default, which is subject to change
  over time. The current default is <default>."); Workload APIs: defaulted
  at creation, documented as such.
- **Required fields**: no `omitempty` (except pointer types whose zero value
  is valid). The API server rejects resources missing them.
- **int32 over int64** unless values can exceed int32. No `int`, no unsigned.
- **No floats** in spec, avoid elsewhere (not round-trippable). Model scaled
  values as int64 milliunits or strings.
- **Enums**: string alias types with PascalCase constants, never numeric.
  Constant names follow `{TypeAlias}{Value}` (type `ProvisioningMode` →
  `ProvisioningModeThin`, not `Thin`). No MaxLength needed on enum fields —
  the allowed values already bound the length.
- **Deprecated**: comment `DEPRECATED: <date/version> <guidance>` plus
  `+k8s:deprecated=<date>` marker. Do not delete or change the meaning of
  existing fields; add a new one and migrate. You cannot remove fields from
  a GA API — "API is a contract with a user" (openshift/api PR630 review):
  deprecate first, remove only in a later major version.

## Godoc (the reviewer's checklist)

Reviewers in openshift/api (JoelSpeed, saschagrunert, everettraven) require
each field's godoc to answer:

- What validations apply — format, min/max length, allowed values, case
  sensitivity.
- What happens when the field is omitted ("When omitted, ...").
- Interaction with nearby fields — required/forbidden combinations, and
  which field takes precedence when two could apply. If CEL encodes a rule,
  the godoc must describe it in prose too; doc/validation mismatches are a
  review blocker.
- A short usage example where one clarifies intent.
- **Use the JSON field name (lowercase first letter)** in the comment —
  "platformType is ..." not "PlatformType is ..." — reviewers have made
  this an explicit convention (dev-guide commit 12e08c2, 2025-12).
- Every `+kubebuilder:validation:*` marker on the field should be
  explained in its comment, and every documented constraint must actually
  be enforced by a validation rule — doc/impl divergence is a blocker.

Stale docs get flagged: when a feature gate is promoted out of TechPreview,
"in TechPreview" wording in godoc must be updated in the same change.

## Structure

- **Resource** = `TypeMeta` + `ObjectMeta` + `Spec` (+ `Status`).
  Spec = user intent, stored as given. Status = system observation, usually
  late-initialized by a controller; status fields may be defaulted by the
  controller, spec fields only by static defaulting (optional fields only).
- **List kind** = `<Kind>List` with required `Items []<Kind> \`json:"items"\``.
- **Conditions**: `[]metav1.Condition` with `+listType=map +listMapKey=type`
  (plus `patchStrategy:"merge" patchMergeKey:"type"` in generated manifests).
  Document the known condition types and which polarity (`True`-normal or
  `False`-normal). Absence of a known condition reads as `Unknown`.
  - **`phase` is deprecated — use conditions** for high-level state.
  - Condition names: short, PascalCase, adjectives or past-tense verbs
    (`Ready`, `Succeeded`), with documented semantics and a `Reason`.
- **Allocated values** (IPs, ports, bucket names assigned on the user's
  behalf) belong in `status`, not `spec`, for new APIs — `spec` is unsafe
  because users can write unconfirmed values (the `Service.externalIPs`
  counter-example).
- **Every list field needs a `+listType` tag** (`map`, `set`, or `atomic`) —
  set/map semantics get automatic uniqueness validation and correct SSA.
- **References**: resource-specific types (`ConfigMapNameReference`), never
  generic `ObjectReference`. Omit "Ref" from field names (`configMap`, not
  `configMapRef`).
- **Unions** (openshift/enhancements dev-guide "Discriminated Unions" — these
  are MUSTs):
  - `+union` on the type; the discriminator is a `string`/string-alias field,
    `+unionDiscriminator`, **required**, and **never pointer**.
  - Every union member MUST be a pointer and `+optional`.
  - Each enum constant's value MUST equal the camelCase json tag of a union
    member, e.g. `"none"` for `None *NoneSpec \`json:"none,omitempty"\``
    (PascalCase constant name, lowercase value, field names aligned).
  - Union members may be empty structs (discriminator-only unions are OK).
  - Configuration APIs: prefer an escape hatch over a forced choice — allow
    the empty discriminator value `""` (or a `NoOpinion` value) meaning "no
    opinion, platform picks", instead of forcing a value that is often wrong
    and hard to discover (platform defaults).
  - Use `+default=...` on the discriminator sparingly: the empty-string
    escape hatch is usually the more honest default.
  - Put each marker on its own line (`// +unionMember` then
    `// +optional`, not one line) and remember `+unionMember` on an optional
    field means the member's value is optional context, not that the field
    itself is optional.
- **Lists of named subobjects over maps** when subobjects carry more than a
  scalar.

## Registration markers (on the resource type)

Full block as used in openshift/api (order and blank-line placement matter —
codegen reads "which marker is two comment blocks up", so type-level markers
and the doc comment are separate blocks):

```go
// +genclient                                   // clientset generation
// +genclient:nonNamespaced                     // cluster-scoped
// +k8s:deepcopy-gen:interfaces=...runtime.Object
// +openshift:compatibility-gen:level=1         // see Compatibility level
// +openshift:api-approved.openshift.io=https://github.com/openshift/api/pull/xxx
// +openshift:file-pattern=cvoRunLevel=0000_50,operatorName=my-operator,operatorOrdering=01

// WorkThing holds user-editable desired state.
// +kubebuilder:object:root=true
// +kubebuilder:resource:path=workthings,scope=Cluster  // or singleton=true
// +kubebuilder:subresource:status              // if you have status
// +kubebuilder:printcolumn:name=...,type=...,JSONPath=`...`
type WorkThing struct {
```

`doc.go` in each group/version package carries: `+groupName=example.openshift.io`,
`+k8s:deepcopy-gen=package,register`, `+k8s:openapi-gen=true`,
`+k8s:openapi-model-package=...`, `+openshift:featuregated-schema-gen=true`
(the last one only if you use feature-gated schema generation), and a
package-level `// +kubebuilder:validation:Optional` default.

- **Print columns**: every new listable resource gets them; they define
  `kubectl get` output. Age column is customary.
- **Short names**: conservative — collisions are unpredictable; only add
  when discoverability genuinely needs it.
- **Compatibility level** (`+openshift:compatibility-gen:level=N`) with its
  standard godoc comment: new stable `v1` APIs use **level 1** ("Stable
  within a major release for a minimum of 12 months or 3 minor releases");
  `v1alpha1`/TechPreview-only APIs use **level 4** ("No compatibility is
  provided, the API can change at any point"). The comment text is
  conventionally part of the doc block.
- **`+openshift:file-pattern`** controls the generated CRD manifest
  filename (CVO run level, operator name, ordering) — copy it from an
  existing CRD in the same group.

## OpenShift specifics

- **Config API** (`config.openshift.io`): cluster-scoped singletons,
  `+kubebuilder:resource:singleton=true`, spec+status split, status carries
  `[]metav1.Condition` (e.g. `Available`, `Progressing`-style conditions).
- **Feature sets**: new/preview APIs are gated with the
  `release.openshift.io/feature-set: TechPreviewNoUpgrade` annotation (or
  equivalent FeatureGate `+openshift:enable:FeatureGate=` markers on fields).
  Use `+openshift:validation:FeatureGateAwareXValidation` only when a
  constraint genuinely changes per gate state; if the parent field is already
  gated, children need plain XValidation (gating the children too breaks the
  ungated behavior). Gate promotion requires a ratcheting test and enough
  `verify-feature-promotion` runs; the gate must be removed from all
  consuming components before the removal PR merges (OCPBUGS-105407 PR2975).
- **Prefer Kubernetes-style naming over platform-native naming** when
  abstracting cloud/VM platform APIs (PascalCase enums etc.); map
  platform quirks in the controller, not the API.
- **New features are fields, not annotations.** The `something.alpha.kubernetes.io`
  annotation pattern is deprecated; do not add to it.
- **No functions in openshift/api types** (not even simple accessors):
  `openshift/api` must stay dependency-free — helpers belong in
  `openshift/library-go` or the consuming component.

## Versioning workflow (v1alpha1 first)

1. New CRDs **must start as `v1alpha1`** (or later alpha) with a
   `+kubebuilder:validation:XValidation`-gated or
   `+openshift:enable:FeatureGate=` TechPreview path. Do not ship a
   new resource straight to `v1`.
2. When the API graduates, you promote it to `v1` **without changing the
   API** — the same types, same fields, new package + manifests. Breaking
   changes before graduation go in `v1alpha2`, `v1alpha3`, ...
3. After reaching `v1`, fields are frozen: deprecate, never delete or
   change meaning (see Deprecated above).

## OpenShift FeatureGate workflow (repo mechanics, from README/AGENTS)

- Gates live in `<group>/<version>/features.go` and are registered in a
  `MustRegister`-style init: `newFeatureGate("MyGate")` with
  `.reportProblemsToJiraComponent(...)`, `.contactPerson(...)`,
  `.productScope(ocpSpecific)`, `.enableIn(TechPreviewNoUpgrade)` (or
  `enableForClusterProfile(...)`), `.mustRegister()`.
- Gate-aware schema: `+openshift:validation:FeatureGateAwareXValidation:featureGate=MyGate,rule=...`
  for constraints that only apply while gated (e.g. immutability that
  ratchets), `+openshift:validation:FeatureGateAwareEnum:featureGate=MyGate,enum=...`
  for enum values added behind the gate. Gate promotion requires a
  ratcheting test and enough `verify-feature-promotion` runs; the gate must
  be removed from all consuming components before the removal PR merges.
- Immutability patterns in use: `self == oldSelf`; ratchet
  `oldSelf == '' || self == oldSelf` (once set, may only be cleared or
  kept); optional-pair
  `has(oldSelf.x) ? has(self.x) : true`.
- Tests: `<group>/<version>/tests/<crdname>/FeatureGate.yaml` +
  `AAA_ungated.yaml`, `onCreate`/`onUpdate` blocks, `initialCRDPatches`
  to simulate the ungated→gated ratchet. Generate skeletons with
  `hack/gen-minimal-test.sh`.
- Promotion thresholds: TechPreview requires an open (not-implementation)
  enhancement + QE sign-off; promoting to Default requires ~99% test pass
  rate or explicit QE approval. E2E promotion: ≥5 tests tagged
  `[OCPFeatureGate:<Name>]`, ≥14 consecutive runs, ≥95% pass.
- CRD manifest split for feature-gated APIs: `make update` emits
  `<name>-Default.crd.yaml` and `<name>-TechPreviewNoUpgrade.crd.yaml`;
  hand edits go through `hack/manual-override-crd-manifests/` (the old
  `yamlpatch` mechanism is deprecated).

## Validation guidelines and error messages (kubernetes/community)

- Strings: check format AND max length (and min if meaningful). Never do
  case-insensitive comparisons in validation — it forces every consumer to
  match.
- Numbers: bounds-check both ends. Lists/maps: `+kubebuilder:validation:MaxItems`.
- Error messages: "must" / "must not" (formatting) / "may not" (behavior),
  single-quotes for literals, back-quotes for field names, words not
  symbols ("less than 256", not `< 256`), inclusive ranges, tell users what
  they CAN do. Prefer declarative `+kubebuilder:validation:*` over hand-
  written validation for everything it can express.
- **One phrasing per idea** (OCP, PEP 20): one canonical way to express
  "empty"/"no opinion". `nil`, `""`, and an empty struct all meaning the
  same thing is a design smell; pick one (usually the escape hatch).

## Process checklist before declaring an API done

1. `api_lint_types` on the package → zero errors.
2. Warnings on *new* fields fixed; warnings on pre-existing fields may stay
   (they are legacy), but never copy them into new fields.
3. `make update-codegen API_GROUP_VERSIONS=<group>/<version>` while
   iterating; full `make update` before committing (deepcopy, client-gen,
   openapi, CRDs, test skeletons). `make verify` must be green.
4. Enhancement doc references the group/version; CRDs carry the
   feature-set markers; PR carries `bugzilla/valid-bug` or `qe/docs` label
   (docs-only changes skip the BZ).

## Reviewer culture (what the API owners actually flag)

From ~47 openshift/api PR reviews (jcpowermac, vr4manta, rvanderp3 eras +
api-review approvers): the top recurring blockers, in rough frequency order:

1. Godoc that doesn't state validations / omitted-behavior / field
   interaction — "please add a comment explaining ...".
2. Missing or wrong `+optional`/`+required`/`omitempty` triplets.
3. `omitempty` on a required field (or required fields that look optional
   because their zero value is valid).
4. Pointers where a plain type suffices (and the reverse for genuinely
   meaningful zero values).
5. Bool fields (rejected outright in OpenShift; propose the enum).
6. Enum constants not matching the `{Type}{Value}` naming, or enum values
   not matching union member field names.
7. New field without a TechPreview FeatureGate / feature-set path.
8. Feature promoted but godoc still says "in TechPreview".
9. Cross-references using generic ObjectReference or missing the
   resource-specific type.
10. API changes smuggled into a `v1` package instead of a new alpha version.
