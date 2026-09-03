// Deterministic convention linter for Kubernetes/OpenShift Go API type files.
// Encodes the mechanically-checkable subset of:
//   - kubernetes/community contributors/devel/sig-architecture/api-conventions.md
//   - openshift/enhancements dev-guide/api-conventions.md
// No Go toolchain required: line-based parser over type declarations.

export interface LintIssue {
  file: string;
  line: number;
  severity: "error" | "warn";
  rule: string;
  type?: string;
  field?: string;
  message: string;
}

interface ParsedField {
  line: number;
  name?: string; // undefined = embedded field
  type: string;
  json?: string;
  omitempty: boolean;
  doc: string[]; // raw "// ..." comment lines
}

interface ParsedType {
  name: string;
  line: number;
  doc: string[];
  fields: ParsedField[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VERSION_PKG = /^v\d+((alpha|beta)\d+)?$/;

function baseType(type: string): string {
  // strip pointers, slices, maps, packages, and spaces
  return type
    .replace(/\[\][\s\S]*$/, "")
    .replace(/^map\[[^\]]*\]\s*/, "")
    .replace(/\*\s*/, "")
    .split(/\s|\.|\//)
    .pop()
    ?.trim() ?? type;
}

function markers(doc: string[]): string[] {
  return doc
    .map((d) => d.replace(/^\/\//, "").trim())
    .filter((d) => d.startsWith("+"))
    .map((d) => d.slice(1).trim());
}

export function parseGoTypes(source: string): { pkg: string; types: ParsedType[] } {
  const lines = source.split("\n");
  let pkg = "";
  const types: ParsedType[] = [];
  let pendingDoc: string[] = [];

  const flushDoc = () => (pendingDoc.length ? pendingDoc.splice(0) : []);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const pkgMatch = raw.match(/^package\s+([A-Za-z0-9_]+)/);
    if (pkgMatch) {
      pkg = pkgMatch[1];
      pendingDoc = [];
      continue;
    }
    if (line.startsWith("//")) {
      pendingDoc.push(line);
      continue;
    }
    const typeMatch = raw.match(/^type\s+([A-Za-z0-9_]+)\s+struct\s*\{/);
    if (!typeMatch) {
      if (line !== "" && !line.startsWith("/*") && !line.endsWith("*/")) {
        pendingDoc = [];
      }
      continue;
    }
    const name = typeMatch[1];
    const doc = flushDoc();
    const fields: ParsedField[] = [];
    // one-line structs (type T struct{}) balance on the declaration line
    let depth = (raw.match(/{/g) ?? []).length - (raw.match(/}/g) ?? []).length;
    while (i + 1 < lines.length && depth > 0) {
      i++;
      const inner = lines[i];
      depth += (inner.match(/{/g) ?? []).length;
      depth -= (inner.match(/}/g) ?? []).length;
      const t = inner.trim();
      if (depth <= 0 || t === "") continue;
      if (t.startsWith("//")) {
        pendingDoc.push(t);
        continue;
      }
      const docLines = flushDoc();
      // field line: [Name] Type [`tag`]
      const tagMatch = inner.match(/`([^`]*)`/);
      const body = (tagMatch ? inner.slice(0, tagMatch.index) : inner).trim();
      const tokens = body.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      let fname: string | undefined;
      let ftype: string;
      if (tokens.length >= 2 && IDENT.test(tokens[0])) {
        fname = tokens[0];
        ftype = tokens.slice(1).join(" ");
      } else {
        ftype = tokens.join(" "); // embedded field
      }
      const jsonMatch = tagMatch?.[1].match(/json:"([^"]*)/);
      // json options (omitempty, inline) live inside the quoted value: json:"name,omitempty"
      const jsonName = jsonMatch?.[1]?.split(",")[0];
      fields.push({
        line: i + 1,
        name: fname,
        type: ftype,
        json: jsonName,
        omitempty: (tagMatch?.[1] ?? "").includes("omitempty"),
        doc: docLines,
      });
    }
    types.push({ name, line: i + 1, doc, fields });
  }
  return { pkg, types };
}

export function lintGoTypes(source: string, file: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const { pkg, types } = parseGoTypes(source);
  const add = (
    line: number,
    severity: "error" | "warn",
    rule: string,
    message: string,
    type?: string,
    field?: string,
  ) => issues.push({ file, line, severity, rule, type, field, message });

  if (pkg && !VERSION_PKG.test(pkg)) {
    add(
      1,
      "warn",
      "bad-version-package",
      `package "${pkg}" is not a Go API version (expected vN, vNbetaN, or vNalphaN)`,
    );
  }

  for (const t of types) {
    const tdoc = t.doc.join("\n");
    const embedded = t.fields.filter((f) => !f.name).map((f) => f.type);
    const hasObjectMeta = embedded.some((e) => e.endsWith("ObjectMeta"));
    const hasTypeMeta = embedded.some((e) => e.endsWith("TypeMeta"));
    const isResource = hasObjectMeta && hasTypeMeta;

    if (hasObjectMeta && !hasTypeMeta) {
      add(t.line, "error", "meta-without-typemeta",
        `type ${t.name} embeds ObjectMeta but not TypeMeta; API objects need both`, t.name);
    }
    if (isResource && !tdoc.includes("+kubebuilder:printcolumn")) {
      add(t.line, "warn", "resource-missing-printcolumn",
        `resource ${t.name} has no +kubebuilder:printcolumn markers (kubectl get columns)`, t.name);
    }

    if (t.name.endsWith("List")) {
      const items = t.fields.find((f) => f.name === "Items");
      if (items && items.json !== "items") {
        add(items.line, "error", "list-items-json",
          `list kind ${t.name} must serialize its items field as "items" (got "${items.json}")`,
          t.name, "Items");
      }
    }

    if (tdoc.includes("+union")) {
      const disc = t.fields.find((f) => markers(f.doc).some((m) => m.startsWith("unionDiscriminator")));
      if (!disc) {
        add(t.line, "error", "union-missing-discriminator",
          `union type ${t.name} (+union) has no field marked +unionDiscriminator`, t.name);
      } else if (!markers(disc.doc).some((m) => m === "required" || m.startsWith("kubebuilder:validation:Required"))) {
        add(disc.line, "warn", "union-discriminator-not-required",
          `union discriminator ${t.name}.${disc.name} should be required`, t.name, disc.name);
      }
    }

    for (const f of t.fields) {
      const m = markers(f.doc);
      const hasRequired = m.some((x) => x === "required" || x === "kubebuilder:validation:Required");
      const hasOptional = m.some((x) => x === "optional");
      const btype = baseType(f.type);
      const isPtr = /\*/.test(f.type);

      if (!f.name) continue;

      // f.json === "" means json:",inline" — skip name checks for it
      if (f.json === undefined) {
        add(f.line, "error", "missing-json-tag",
          `field ${t.name}.${f.name} has no json struct tag`, t.name, f.name);
      } else if (f.json !== "") {
        if (f.json.includes("_") || f.json.includes("-") || /^[A-Z]/.test(f.json)) {
          add(f.line, "error", "json-bad-name",
            `field ${t.name}.${f.name} json name "${f.json}" must be camelCase with no underscores or dashes`,
            t.name, f.name);
        } else if (f.json.toLowerCase() !== f.name.toLowerCase()) {
          add(f.line, "error", "json-name-mismatch",
            `field ${t.name}.${f.name} json name "${f.json}" does not match the Go field name`, t.name, f.name);
        }
      }

      if (btype === "int") {
        add(f.line, "error", "bare-int",
          `field ${t.name}.${f.name} uses bare int; use int32 or int64`, t.name, f.name);
      }
      if (/^uint\d*$/.test(btype)) {
        add(f.line, "error", "unsigned-int",
          `field ${t.name}.${f.name} uses unsigned integer ${btype}; unsigned integers are not allowed in APIs`, t.name, f.name);
      }
      if (btype === "bool") {
        add(f.line, "warn", "boolean-forbidden",
          `field ${t.name}.${f.name} is ${isPtr ? "*bool" : "bool"}; booleans are forbidden in OpenShift APIs — use a string policy/enum type (status: a condition or string state)`,
          t.name, f.name);
      }
      if (btype === "float32" || btype === "float64") {
        add(f.line, "warn", "float-avoid",
          `field ${t.name}.${f.name} is ${btype}; avoid floats (never in spec) — use int64 scaled or a string`,
          t.name, f.name);
      }
      if (!hasRequired && !hasOptional) {
        // every exported field must declare +optional or +required
        add(f.line, "warn", "missing-optional-required",
          `field ${t.name}.${f.name} has no +optional or +required marker`, t.name, f.name);
      }
      if (f.omitempty && !hasRequired && !hasOptional) {
        add(f.line, "warn", "omitempty-unmarked",
          `field ${t.name}.${f.name} uses omitempty without an explicit +optional/+required marker`,
          t.name, f.name);
      }
      if (hasRequired && f.omitempty && !isPtr) {
        add(f.line, "warn", "required-omitempty",
          `field ${t.name}.${f.name} is required but uses omitempty; required fields normally omit omitempty unless pointer-typed`,
          t.name, f.name);
      }
      if (btype === "ObjectReference") {
        add(f.line, "warn", "generic-object-reference",
          `field ${t.name}.${f.name} uses generic ObjectReference; use a resource-specific reference type`,
          t.name, f.name);
      }
      if (btype === "Condition" && !f.type.startsWith("[]")) {
        add(f.line, "error", "condition-singular",
          `field ${t.name}.${f.name} uses a singular Condition; conditions are collections ([]metav1.Condition)`,
          t.name, f.name);
      }
      if (f.doc.join(" ").toUpperCase().includes("DEPRECATED") && !m.some((x) => x.startsWith("k8s:deprecated"))) {
        add(f.line, "warn", "deprecated-without-marker",
          `field ${t.name}.${f.name} is documented DEPRECATED but has no +k8s:deprecated marker`,
          t.name, f.name);
      }
    }
  }
  return issues;
}
