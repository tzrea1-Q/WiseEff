import { isDeepStrictEqual } from "node:util";

import type {
  CatalogReleaseDefinitionDocument, CatalogReleaseNode, CatalogReleaseSubjectDocument,
} from "../../../catalog-kernel/compiler/types";
import { parseCanonicalPropertyKey } from "../../../parameter-catalog-contract/index";
import type { SupportedDefinitionContent } from "../../builder/types";
import { diagnostic, type Definition, type ImportDiagnostic, type ImportEntry, type Subject } from "./types";

const comparableContent = (
  content: SupportedDefinitionContent | CatalogReleaseDefinitionDocument["content"]["revision"],
) => ({
  displayName: content.displayName, documentation: content.documentation,
  description: content.description ?? null, unit: content.unit ?? null,
  valueSchema: content.valueSchema, examples: content.examples ?? null,
});

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
  const existing = subject && input.snapshot.documents.find((item) => item.kind === "definition"
    && item.content.subjectId === subject.content.id
    && item.content.propertyKey === definition.propertyKey);
  if (existing?.kind === "definition") {
    const revision = existing.content.revision;
    const content = input.entry.content;
    if (revision.lifecycle === "active" && content
      && isDeepStrictEqual(comparableContent(revision), comparableContent(content))) {
      return { outcome: diagnostics.length ? "error" : "skip", diagnostics };
    }
    if (content || revision.lifecycle === "retired") {
      const hasErrors = diagnostics.length > 0;
      diagnostics.push(diagnostic(
        section, definition, "属性键", revision.lifecycle === "retired"
          ? "定义已退役，请使用现有恢复流程。" : "目录中已有不同内容或非活跃的定义，请使用现有定义管理入口。", definition.line,
      ));
      return { outcome: hasErrors && revision.lifecycle !== "retired" ? "error" : "conflict", diagnostics };
    }
  }
  return { outcome: diagnostics.length ? "error" : "create", diagnostics };
}
