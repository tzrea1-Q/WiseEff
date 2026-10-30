import type { CatalogReleaseNode, CatalogReleaseSubjectDocument } from "../../../catalog-kernel/compiler/types";
import type { CatalogChange, SupportedDefinitionContent } from "../../builder/types";
import { diagnostic, type ImportDiagnostic, type Subject } from "./types";

export function resolveSubject(section: Subject, snapshot: CatalogReleaseNode): {
  subject: CatalogReleaseSubjectDocument | undefined;
  diagnostics: ImportDiagnostic[];
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

  if (section.kind && !subject) {
    diagnostics.push(diagnostic(section, null, "主体", "未找到已有主体。", section.line));
  } else if (subject?.content.lifecycle === "retired") {
    diagnostics.push(diagnostic(section, null, "主体", "主体已退役。", section.line));
  }
  for (const metadata of section.metadataLines) {
    const match = /^nature: (physical-device|logical-service)\s*·\s*cardinality: (multiple|singleton-per-project)\s*$/u
      .exec(metadata.text);
    if (!match || subject?.content.kind !== "driver" || !("nature" in subject.content.subtype)) {
      diagnostics.push(diagnostic(section, null, "主体", "主体信息不符合模板。", metadata.line));
    } else if (subject.content.subtype.nature !== match[1]
      || subject.content.subtype.cardinality.kind !== match[2]) {
      diagnostics.push(diagnostic(section, null, "主体", "主体性质或基数与目录不一致。", metadata.line));
    }
  }
  return { subject, diagnostics };
}

/** Convert this subject's accepted definitions to existing publication operations. */
export function subjectChanges(
  resolved: ReturnType<typeof resolveSubject>,
  definitions: readonly { propertyKey: string; content: SupportedDefinitionContent }[],
): CatalogChange[] {
  if (!resolved.subject) return [];
  const subjectId = resolved.subject.content.id;
  return definitions.map((definition) => ({ op: "create-definition", subjectId, ...definition }));
}
