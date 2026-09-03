import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintGoTypes, type LintIssue } from "../extensions/api/lint.js";
import { lintApiTypes } from "../extensions/api/tools.js";

const GOOD = `
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +genclient
// +genclient:nonNamespaced
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object
// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Field",type=string,JSONPath=\`.spec.field\`

// Infrastructure holds cluster-wide information.
type Infrastructure struct {
	metav1.TypeMeta   \`json:",inline"\`
	metav1.ObjectMeta \`json:"metadata,omitempty"\`

	// spec holds user-editable desired state.
	// +required
	Spec InfrastructureSpec \`json:"spec" protobuf:"bytes,1,opt,name=spec"\`
	// status holds observed state.
	// +optional
	Status InfrastructureStatus \`json:"status,omitempty" protobuf:"bytes,2,opt,name=status"\`
}

// InfrastructureSpec is the spec for Infrastructure.
type InfrastructureSpec struct {
	// platformType is the infrastructure platform type.
	// +kubebuilder:validation:Required
	// +required
	// +kubebuilder:validation:Enum:="AWS";"None"
	PlatformType PlatformType \`json:"platformType"\`
}

// InfrastructureStatus is the status for Infrastructure.
type InfrastructureStatus struct {
	// conditions represent the conditions of this resource.
	// +optional
	Conditions []metav1.Condition \`json:"conditions,omitempty" patchStrategy:"merge" patchMergeKey:"type"\`
}

// PlatformTypeList is a list of platforms.
type PlatformTypeList struct {
	metav1.TypeMeta \`json:",inline"\`
	metav1.ListMeta \`json:"metadata,omitempty"\`

	// +kubebuilder:validation:Required
	// +required
	Items []PlatformType \`json:"items"\`
}

// MyPlatformConfig is a discriminated union.
// +union
type MyPlatformConfig struct {
	// platformType is the union discriminator.
	// +unionDiscriminator
	// +kubebuilder:validation:Required
	// +required
	PlatformType string \`json:"platformType"\`

	// noOpinion allows the platform to choose.
	// +optional
	NoOpinion string \`json:"noOpinion,omitempty"\`
}
`;

const BAD = `
package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	corev1 "k8s.io/api/core/v1"
)

// BadThing is a resource with many convention violations.
// +kubebuilder:object:root=true
type BadThing struct {
	metav1.ObjectMeta \`json:"metadata,omitempty"\`

	// +required
	Spec BadThingSpec \`json:"spec"\`
}

type BadThingSpec struct {
	// Name has no json tag.
	// +required
	Name string

	// Bad_name uses an underscore.
	// +optional
	BadName string \`json:"bad_name,omitempty"\`

	// Mismatched json name.
	// +optional
	OtherName string \`json:"totallyWrong,omitempty"\`

	// Replicas uses bare int.
	// +optional
	Replicas int \`json:"replicas,omitempty"\`

	// MaxCount is unsigned.
	// +optional
	MaxCount uint64 \`json:"maxCount,omitempty"\`

	// Enabled is a non-pointer bool.
	// +optional
	Enabled bool \`json:"enabled,omitempty"\`

	// EnabledPtr is a pointer bool.
	// +optional
	EnabledPtr *bool \`json:"enabledPtr,omitempty"\`

	// Ratio is a float.
	// +optional
	Ratio float64 \`json:"ratio,omitempty"\`

	// Unmarked has no optional/required marker.
	Unmarked string \`json:"unmarked"\`

	// RequiredOmitempty is required but omitempty and non-pointer.
	// +required
	RequiredOmitempty string \`json:"requiredOmitempty,omitempty"\`

	// Legacy is deprecated without a marker.
	// DEPRECATED: use NewField instead.
	// +optional
	Legacy string \`json:"legacy,omitempty"\`

	// Ref uses the generic object reference.
	// +optional
	Ref corev1.ObjectReference \`json:"ref,omitempty"\`

	// Mode is an enum field missing the Enum marker.
	// +optional
	Mode Mode \`json:"mode,omitempty"\`
}

// BadList is a list with the wrong items tag.
type BadList struct {
	metav1.TypeMeta \`json:",inline"\`
	metav1.ListMeta \`json:"metadata,omitempty"\`

	// +required
	Items []BadThing \`json:"entries"\`
}

// BadUnion has the union marker but no discriminator.
// +union
type BadUnion struct {
	// +required
	Kind string \`json:"kind"\`
}

// BadCondition uses a singular condition.
type BadCondition struct {
	// +optional
	Condition metav1.Condition \`json:"condition,omitempty"\`
}

// Mode is a string alias type with const values (an enum).
type Mode string

const (
	ModeFast Mode = "fast"
	ModeSlow Mode = "slow"
)
`;

function rules(issues: LintIssue[]): Set<string> {
  return new Set(issues.map((i) => i.rule));
}

describe("api_lint linter", () => {
  it("accepts a conventions-compliant file with zero errors", () => {
    const issues = lintGoTypes(GOOD, "types_good.go");
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("flags every seeded violation in the bad file", () => {
    const r = rules(lintGoTypes(BAD, "types_bad.go"));
    for (const expected of [
      "missing-json-tag",
      "json-bad-name",
      "json-name-mismatch",
      "bare-int",
      "unsigned-int",
      "boolean-forbidden",
      "float-avoid",
      "missing-optional-required",
      "required-omitempty",
      "deprecated-without-marker",
      "generic-object-reference",
      "list-items-json",
      "union-missing-discriminator",
      "enum-missing-validation",
      "meta-without-typemeta",
      "condition-singular",
    ]) {
      expect(r, `expected rule ${expected}`).toContain(expected);
    }
  });

  it("locates issues on the right line and names the field", () => {
    const issues = lintGoTypes(BAD, "types_bad.go");
    const missing = issues.find((i) => i.rule === "missing-json-tag");
    expect(missing?.field).toBe("Name");
    expect(missing?.type).toBe("BadThingSpec");
    expect(missing?.line).toBeGreaterThan(0);
    expect(BAD.split("\n")[missing!.line - 1]).toContain("Name");
  });

  it("reports ObjectMeta-without-TypeMeta as an error", () => {
    const r = rules(lintGoTypes(BAD, "x.go"));
    expect(r).toContain("meta-without-typemeta");
  });

  it("checks package version naming", () => {
    expect(
      lintGoTypes("package v1alpha1\n\ntype A struct{}\n", "a.go").some(
        (i) => i.rule === "bad-version-package",
      ),
    ).toBe(false);
    expect(
      lintGoTypes("package config\n\ntype A struct{}\n", "a.go").some(
        (i) => i.rule === "bad-version-package",
      ),
    ).toBe(true);
  });

  it("flags pointer bools but not int32", () => {
    const src = `package v1

type S struct {
	// +optional
	Enabled *bool \`json:"enabled,omitempty"\`
	// +optional
	Count int32 \`json:"count,omitempty"\`
	// +optional
	Items []string \`json:"items,omitempty"\`
}
`;
    const r = rules(lintGoTypes(src, "a.go"));
    expect(r).toContain("boolean-forbidden");
    expect(r).not.toContain("bare-int");
  });

  it("reports the concrete bool form in the message", () => {
    const issues = lintGoTypes(
      'package v1\n\ntype S struct {\n\t// +optional\n\tEnabled bool `json:"enabled,omitempty"`\n}\n',
      "a.go",
    );
    const flag = issues.find((i) => i.rule === "boolean-forbidden");
    expect(flag?.field).toBe("Enabled");
    expect(flag?.message).toContain("bool");
    expect(flag?.message).not.toContain("*bool");
  });

  it("handles one-line structs and const blocks after them", () => {
    const src = `package v1

type Empty struct{}

const (
\tA = "a"
)

type After struct {
\t// +required
\tX int32 \`json:"x"\`
}
`;
    const issues = lintGoTypes(src, "a.go");
    expect(issues).toEqual([]);
  });

  it("lints a directory end-to-end via lintApiTypes", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-lint-"));
    try {
      writeFileSync(
        join(dir, "types_ok.go"),
        "package v1\n\ntype Ok struct {\n\t// +required\n\tX int32 `json:\"x\"`\n}\n",
      );
      writeFileSync(
        join(dir, "zz_generated.deepcopy.go"),
        "package v1\n\n// ignored generated file\nconst x = uint(1)\n",
      );
      const r = lintApiTypes(dir);
      expect(r.files).toBe(1); // generated file skipped
      expect(r.issues.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag custom types whose names end in Condition", () => {
    const src = `package v1

type ClusterCondition struct {
\t// +optional
\tPromQL *PromQLClusterCondition \`json:"promql,omitempty"\`
}
`;
    expect(rules(lintGoTypes(src, "a.go"))).not.toContain("condition-singular");
  });

  it("does not flag enum types that carry the Enum marker", () => {
    const src = `package v1

type Mode string

const (
	ModeFast Mode = "fast"
	ModeSlow Mode = "slow"
)

type S struct {
	// +optional
	// +kubebuilder:validation:Enum="";fast;slow
	Mode Mode \`json:"mode,omitempty"\`
}
`;
    expect(lintGoTypes(src, "a.go").filter((i) => i.rule === "enum-missing-validation")).toEqual([]);
  });

  it("does not require optional/required on embedded or metav1 meta fields", () => {
    const src = `package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// T is a type.
type T struct {
	metav1.TypeMeta   \`json:",inline"\`
	metav1.ObjectMeta \`json:"metadata,omitempty"\`
}
`;
    const r = rules(lintGoTypes(src, "a.go"));
    expect(r).not.toContain("missing-optional-required");
    expect(r).not.toContain("missing-json-tag");
  });
});
