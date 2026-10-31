import { isDeepStrictEqual } from "node:util";

import type {
  CatalogReleaseDefinitionDocument, CatalogReleaseNode, CatalogReleaseSubjectDocument,
} from "../../../catalog-kernel/compiler/types";
import { parseCanonicalPropertyKey } from "../../../parameter-catalog-contract/index";
import type { SupportedDefinitionContent } from "../../builder/types";
import { contentClassOf, revisedDefinitionContent } from "../../builder/completeSuccessor";
import { diagnostic, type Definition, type ImportDiagnostic, type ImportEntry, type Subject } from "./types";
import { unwrapArraySchema } from "./schema";

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
}): Pick<ImportEntry, "outcome" | "diagnostics" | "revisionClass" | "diffs"> {
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
      if (!diagnostics.length && definition.fields.some((field) => field.name === "操作" && field.value === "修订")) {
        diagnostics.push(diagnostic(section, definition, "操作", "无变化。", definition.line));
        return { outcome: "skip", diagnostics };
      }
      return { outcome: diagnostics.length ? "error" : "skip", diagnostics };
    }
    if (definition.fields.some((field) => field.name === "操作" && field.value === "修订")
      && revision.lifecycle === "active" && content && !diagnostics.length) {
      const next = revisedDefinitionContent(revision, content);
      const fields = (value: CatalogReleaseDefinitionDocument["content"]["revision"]) => {
        const schema = value.valueSchema as Record<string, unknown>;
        const { item, arrays } = unwrapArraySchema(schema);
        const depth = arrays.length;
        return { "显示名": value.displayName, "正文": value.documentation, "简述": value.description ?? null,
          "单位": value.unit ?? null, "类型": `${"array<".repeat(depth)}${item.type ?? "mixed"}${">".repeat(depth)}`,
          "类型说明": item.description ?? null, "最小值": item.minimum ?? null, "最大值": item.maximum ?? null,
          "最少项数": schema.minItems ?? null, "最多项数": schema.maxItems ?? null, "示例": value.examples ?? null };
      };
      const oldFields = fields(revision);
      const newFields = fields(next);
      const diffs = (Object.keys(oldFields) as (keyof typeof oldFields)[])
        .filter((field) => !isDeepStrictEqual(oldFields[field], newFields[field]))
        .map((field) => ({ field, oldValue: oldFields[field], newValue: newFields[field] }));
      return { outcome: "revise", diagnostics, revisionClass: contentClassOf(revision, next), diffs };
    }
    if (content || revision.lifecycle === "retired") {
      const hasErrors = diagnostics.length > 0;
      diagnostics.push(diagnostic(
        section, definition, "属性键", revision.lifecycle === "retired"
          ? "定义已退役，请先在目录列表中恢复。" : "目录中已有不同内容的定义；如要修订，请加 `操作：修订`。", definition.line,
      ));
      return { outcome: hasErrors && revision.lifecycle !== "retired" ? "error" : "conflict", diagnostics };
    }
  }
  return { outcome: diagnostics.length ? "error" : "create", diagnostics };
}
