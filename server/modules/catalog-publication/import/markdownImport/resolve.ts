import type { CatalogReleaseNode, CatalogReleaseSubjectDocument } from "../../../catalog-kernel/compiler/types";
import type { CatalogChange, SupportedDefinitionContent } from "../../builder/types";
import { parseCanonicalCompatibleSelector, parseCanonicalConfigurationSchemaId, parseCanonicalNodeName } from "../../../parameter-catalog-contract/index";
import { diagnostic, type ImportDiagnostic, type Subject } from "./types";

export function resolveSubject(section: Subject, snapshot: CatalogReleaseNode): {
  subject: CatalogReleaseSubjectDocument | undefined;
  diagnostics: ImportDiagnostic[];
  section: Subject;
  nature?: "physical-device" | "logical-service";
  cardinality?: "multiple" | "singleton-per-project";
} {
  const diagnostics: ImportDiagnostic[] = [];
  const selectorKind = section.kind === "driver" ? "driver-compatible"
    : section.kind === "node-type" ? "node-type-name" : "configuration-schema-id";
  const alias = snapshot.documents.find((item) => item.kind === "alias"
    && item.content.selectorKind === selectorKind
    && item.content.normalizedSelector === section.selector
    && item.content.lifecycle === "active");
  const subject = snapshot.documents.find((item): item is CatalogReleaseSubjectDocument =>
    item.kind === "subject" && item.content.kind === section.kind
    && (item.content.selector.value === section.selector
      || (alias?.kind === "alias" && item.content.id === alias.content.subjectId)));

  if (subject?.content.lifecycle === "retired") {
    diagnostics.push(diagnostic(section, null, "主体", "主体已退役。", section.line));
  }
  if (section.kind && !subject) {
    const parsed = section.kind === "driver" ? parseCanonicalCompatibleSelector(section.selector)
      : section.kind === "node-type" ? parseCanonicalNodeName(section.selector)
        : parseCanonicalConfigurationSchemaId(section.selector);
    if (!parsed.ok) diagnostics.push(diagnostic(section, null, "主体", "主体标识格式无效。", section.line));
    if (snapshot.documents.some((item) => (item.kind === "subject" && item.content.selector.value === section.selector)
      || (item.kind === "alias" && item.content.normalizedSelector === section.selector))) {
      diagnostics.push(diagnostic(section, null, "主体", "主体类型与目录不一致或标识已被占用。", section.line));
    }
  }
  let nature: "physical-device" | "logical-service" | undefined;
  let cardinality: "multiple" | "singleton-per-project" | undefined;
  for (const metadata of section.metadataLines) {
    const match = /^nature: (physical-device|logical-service)\s*·\s*cardinality: (multiple|singleton-per-project)\s*$/u
      .exec(metadata.text);
    if (!match || section.kind !== "driver" || nature !== undefined) {
      diagnostics.push(diagnostic(section, null, "主体", "主体信息不符合模板。", metadata.line));
    } else {
      nature = match[1] as "physical-device" | "logical-service";
      cardinality = match[2] as "multiple" | "singleton-per-project";
      if (subject?.content.kind === "driver" && "nature" in subject.content.subtype && (subject.content.subtype.nature !== nature
      || subject.content.subtype.cardinality.kind !== cardinality)) {
        diagnostics.push(diagnostic(section, null, "主体", "主体性质或基数与目录不一致。", metadata.line));
      }
    }
  }
  if (section.kind === "driver" && !subject && !nature) {
    diagnostics.push(diagnostic(section, null, "主体", "新建 Driver 必须填写 nature 和 cardinality。", section.line));
  }
  return { subject, diagnostics, section, nature, cardinality };
}

/** Convert this subject's accepted definitions to existing publication operations. */
export function subjectChanges(
  resolved: ReturnType<typeof resolveSubject>,
  definitions: readonly { propertyKey: string; content: SupportedDefinitionContent }[],
): CatalogChange[] {
  if (!resolved.subject) {
    const { section, nature, cardinality } = resolved;
    if (!section.kind || !definitions.length) return [];
    const kind = section.kind;
    return [{ op: "create-subject-with-definitions", kind, canonicalKey: `${kind}:${section.selector}`,
      selector: { kind: kind === "driver" ? "driver-compatible" : kind === "node-type" ? "node-type-name" : "configuration-schema-id", value: section.selector },
      ...(kind === "driver" && nature && cardinality ? { nature, cardinality } : {}), definitions }];
  }
  const subjectId = resolved.subject.content.id;
  return definitions.map((definition) => ({ op: "create-definition", subjectId, ...definition }));
}
