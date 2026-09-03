// Canonical Go API type patterns for Kubernetes/OpenShift APIs.
// Copy these shapes; do not invent new ones.
// Marker placement matters: codegen reads "which marker is two comment
// blocks up", so type-level markers live in their own block, separated
// from the doc comment by a blank line.
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ── doc.go (package level, one per group/version) ────────────────────────────
//
// +k8s:deepcopy-gen=package,register
// +k8s:defaulter-gen=TypeMeta
// +k8s:openapi-gen=true
// +k8s:openapi-model-package=com.github.openshift.api.example.v1
// +openshift:featuregated-schema-gen=true
//
// +groupName=example.openshift.io
// package v1
// +kubebuilder:validation:Optional   // package-level default; fields opt in to required

// ── Resource ──────────────────────────────────────────────────────────────────
// Kinds are singular PascalCase. Resources embed TypeMeta + ObjectMeta and
// split user intent (Spec) from observed state (Status).

// +genclient
// +genclient:nonNamespaced
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object
// +openshift:compatibility-gen:level=1
// +openshift:api-approved.openshift.io=https://github.com/openshift/api/pull/xxx
// +openshift:file-pattern=cvoRunLevel=0000_50,operatorName=my-operator,operatorOrdering=01

// workThing is a user-editable desired state.
//
// Compatibility level 1: Stable within a major release for a minimum of
// 12 months or 3 minor releases (whichever is longer).
// +kubebuilder:object:root=true
// +kubebuilder:resource:path=workthings,scope=Cluster
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Platform",type=string,JSONPath=`.spec.platformType`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`
type WorkThing struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// spec is the user-editable desired state.
	// +kubebuilder:validation:Required
	// +required
	Spec WorkThingSpec `json:"spec"`
	// status is the system-managed observed state.
	// +optional
	Status WorkThingStatus `json:"status,omitempty"`
}

// WorkThingSpec is the spec for WorkThing.
type WorkThingSpec struct {
	// platformType is a required enum field. Use a PascalCase string alias,
	// never numeric enums.
	// +kubebuilder:validation:Required
	// +required
	// +kubebuilder:validation:Enum:="AWS";"None"
	PlatformType PlatformType `json:"platformType"`

	// replicas is an integer; use int32 unless values exceed int32 range.
	// Plain int32, not a pointer: 0 (replicas) is not a choice that must
	// be distinguished from unset.
	// +optional
	Replicas int32 `json:"replicas,omitempty"`

	// evictionPolicy is where a bool would have gone. Booleans are forbidden
	// in OpenShift APIs — model two-choice behavior as a string policy enum.
	// +optional
	// +kubebuilder:validation:Enum:="Always";"Never"
	EvictionPolicy EvictionPolicy `json:"evictionPolicy,omitempty"`

	// terminationTimeoutSeconds is a duration: integer seconds, unit in name.
	// +optional
	TerminationTimeoutSeconds *int32 `json:"terminationTimeoutSeconds,omitempty"`

	// configMap is a reference: use resource-specific reference types, not
	// corev1.ObjectReference, and omit the "Ref" suffix from field names.
	// +optional
	ConfigMap ConfigMapNameReference `json:"configMap,omitempty"`

	// coolNewField is a TechPreview-only field gated behind a FeatureGate;
	// the CRD schema is generated per feature set.
	// +openshift:enable:FeatureGate=Example
	// +optional
	CoolNewField string `json:"coolNewField,omitempty"`
}

// WorkThingStatus is the status for WorkThing.
type WorkThingStatus struct {
	// conditions summarize higher-level state. Use []metav1.Condition, never
	// a singular Condition, and never a `phase` field (deprecated).
	// Known condition types: "Available" (True-normal).
	// +listType=map
	// +listMapKey=type
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty" patchStrategy:"merge" patchMergeKey:"type"`

	// observedGeneration is the .metadata.generation the status was computed
	// from. Allocated values (IPs, ports, names assigned for the user) go in
	// status, not spec.
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

// ── List ──────────────────────────────────────────────────────────────────────
// List kinds end in "List"; the items field MUST serialize as "items".

// WorkThingList is a list of WorkThing.
type WorkThingList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`

	// +kubebuilder:validation:Required
	// +required
	Items []WorkThing `json:"items"`
}

// ── Discriminated union ──────────────────────────────────────────────────────
// +union marks the type; the discriminator is a required, non-pointer string
// enum; every member is a pointer and optional; each enum VALUE equals the
// camelCase json tag of a member; "" is the "no opinion" escape hatch for
// configuration APIs.

// WorkThingUnion is a discriminated union.
// +union
type WorkThingUnion struct {
	// platformType is the union discriminator.
	// +unionDiscriminator
	// +kubebuilder:validation:Required
	// +required
	// +kubebuilder:validation:Enum:="";"AWS";"None"
	PlatformType PlatformType `json:"platformType"`

	// aws is used only when platformType == "AWS".
	// +optional
	AWS *AWSSpec `json:"aws,omitempty"`

	// none is used only when platformType == "None".
	// +optional
	None *NoneSpec `json:"none,omitempty"`
}

// ── Feature-gated validation (immutability that ratchets on promotion) ────────

// (in a spec struct)
//
// immutableField may only change while Example is enabled; after promotion
// it is frozen.
// +optional
// +kubebuilder:validation:XValidation:rule="self == oldSelf || self == ''",message="immutableField is immutable once set"
// +openshift:validation:FeatureGateAwareXValidation:featureGate=Example,rule="self == oldSelf",message="immutableField is immutable while Example is enabled"
// ImmutableField string `json:"immutableField,omitempty"`

// ── String aliases ────────────────────────────────────────────────────────────

// PlatformType is a PascalCase enum value type. Constant names:
// {TypeAlias}{Value}.
type PlatformType string

const (
	AWSPlatform  PlatformType = "AWS"
	NonePlatform PlatformType = "None"
)

// EvictionPolicy is a two-choice policy — the replacement for a bool.
type EvictionPolicy string

const (
	EvictionPolicyAlways EvictionPolicy = "Always"
	EvictionPolicyNever  EvictionPolicy = "Never"
)

// AWSSpec / NoneSpec are union members; members may even be empty structs.
type AWSSpec struct{}
type NoneSpec struct{}

// ConfigMapNameReference is a resource-specific object reference.
type ConfigMapNameReference struct {
	// namespace of the referent.
	// +kubebuilder:validation:Required
	// +required
	Namespace string `json:"namespace"`
	// name of the referent.
	// +kubebuilder:validation:Required
	// +required
	Name string `json:"name"`
}

// NOTE: corev1.ObjectReference must not appear in new APIs — define
// resource-specific reference types (see ConfigMapNameReference above).
// NOTE: no functions (even accessors) in openshift/api types — helpers go
// in openshift/library-go or the consumer.
