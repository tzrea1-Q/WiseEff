import type { CatalogReleaseNode, CatalogReleaseSubjectDocument } from "../../../catalog-kernel/compiler/types";
import { parseCanonicalPropertyKey } from "../../../parameter-catalog-contract/index";
import type { SupportedDefinitionContent } from "../../builder/types";
import { diagnostic, type Definition, type ImportDiagnostic, type ImportEntry, type Subject } from "./types";

/** Classification owns existing and duplicate keys, so later outcome policy has one seam. */
export function classifyEntry(input: {
  entry: {
    section: Subject;
    definition: Definition;
    subject: CatalogReleaseSubjectDocument | undefined;
    content: SupportedDefinitionContent | null;
    duplicate: boolean;
    diagnostics: ImportDiagnostic[];
  };
  snapshot: CatalogReleaseNode;
}): { outcome: ImportEntry["outcome"]; diagnostics: ImportDiagnostic[] } {
  const { section, definition, subject, duplicate } = input.entry;
  const diagnostics = [...input.entry.diagnostics];
  if (!parseCanonicalPropertyKey(definition.propertyKey).ok) {
    diagnostics.push(diagnostic(section, definition, "属性键", "属性键格式无效。", definition.line));
  }
  if (duplicate) {
    diagnostics.push(diagnostic(section, definition, "属性键", "文档中存在重复属性键。", definition.line));
  }
  if (subject && input.snapshot.documents.some((item) => item.kind === "definition"
    && item.content.subjectId === subject.content.id
    && item.content.propertyKey === definition.propertyKey)) {
    diagnostics.push(diagnostic(
      section, definition, "属性键", "目录中已存在该定义，请使用现有定义管理入口。", definition.line,
    ));
  }
  return { outcome: diagnostics.length ? "error" : "create", diagnostics };
}
