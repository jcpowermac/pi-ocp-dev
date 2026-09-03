// Canonical Go API type patterns for Kubernetes/OpenShift APIs.
// Copy these shapes; do not invent new ones.
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ── Resource ──────────────────────────────────────────────────────────────────
// Kinds are singular PascalCase. Resources embed TypeMeta + ObjectMeta and
// split user intent (Spec) from observed state (Status).

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:shortName=wt
// +kubebuilder:printcolumn:name="Field",type=string,JSONPath=`.spec.field`
// +kubebuilder:printcolumn:name="Age",type=date,JSONPath=`.metadata.creationTimestamp`

// WorkThing holds user-editable desired state.
type WorkThing struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	// spec is the user-editable desired state.
	// +required
	Spec WorkThingSpec `json:"spec"`
	// status is the system-managed observed state.
	// +optional
	Status WorkThingStatus `json:"status,omitempty"`
}

// WorkThingSpec is the spec for WorkThing.
type WorkThingSpec struct {
	// field is a required enum field. Use a PascalCase string alias, never numeric enums.
	// +kubebuilder:validation:Required
	// +required
	// +kubebuilder:validation:Enum:="AWS";"None"
	PlatformType PlatformType `json:"platformType"`

	// replicas is an integer; use int32 unless values exceed int32 range.
	// +optional
	Replicas int32 `json:"replicas,omitempty"`

	// enabled is a bool: false is a valid value, so it must be a pointer
	// with omitempty to distinguish "unset" from "false".
	// +optional
	Enabled *bool `json:"enabled,omitempty"`

	// configMap is a reference: use resource-specific reference types, not
	// corev1.ObjectReference, and omit the "Ref" suffix from field names.
	// +optional
	ConfigMap ConfigMapNameReference `json:"configMap,omitempty"`
}

// WorkThingStatus is the status for WorkThing.
type WorkThingStatus struct {
	// conditions summarize higher-level state. Use []metav1.Condition, never
	// a singular Condition. List the known condition types in this comment.
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty" patchStrategy:"merge" patchMergeKey:"type"`

	// observedGeneration is the .metadata.generation the status was computed from.
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
// +union marks the type; the discriminator field is +unionDiscriminator,
// required, and an enum whose values name the sibling fields.

// WorkThingUnion is a discriminated union.
// +union
type WorkThingUnion struct {
	// platformType is the union discriminator.
	// +unionDiscriminator
	// +kubebuilder:validation:Required
	// +required
	// +kubebuilder:validation:Enum:="AWS";"None"
	PlatformType PlatformType `json:"platformType"`

	// aws is used only when platformType == "AWS".
	// +optional
	AWS *AWSSpec `json:"aws,omitempty"`

	// noOpinion allows the platform to choose a default.
	// +optional
	NoOpinion bool `json:"noOpinion,omitempty"`
}

// ── String aliases ────────────────────────────────────────────────────────────

// PlatformType is a PascalCase enum value type.
type PlatformType string

const (
	AWSPlatform PlatformType = "AWS"
	NonePlatform PlatformType = "None"
)

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
