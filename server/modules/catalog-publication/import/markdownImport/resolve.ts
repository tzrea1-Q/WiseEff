import type { CatalogReleaseNode, CatalogReleaseSubjectDocument } from "../../../catalog-kernel/compiler/types";
import type { CatalogChange, SupportedDefinitionContent } from "../../builder/types";
import { parseCanonicalCompatibleSelector, parseCanonicalConfigurationSchemaId, parseCanonicalNodeName } from "../../../parameter-catalog-contract/index";
import { diagnostic, type ImportDiagnostic, type Subject, type SubjectKind } from "./types";

const SELECTOR_KIND = {
  driver: "driver-compatible", "node-type": "node-type-name", "configuration-schema": "configuration-schema-id",
} as const satisfies Record<SubjectKind, string>;

/** Resolve the subject and validate any declared facts against the snapshot. */
export function resolveSubject(section: Subject, snapshot: CatalogReleaseNode): {
  subject: CatalogReleaseSubjectDocument | undefined;
  diagnostics: ImportDiagnostic[];
  section: Subject;
  nature?: "physical-device" | "logical-service";
  cardinality?: "multiple" | "singleton-per-project";
  ownerSubjectId?: string;
  categoryPath?: string;
  displayAlias?: string;
  warnings: string[];
  hintLine?: number;
} {
  const diagnostics: ImportDiagnostic[] = [];
  const parents = section.metadataLines.flatMap((line) => line.text.split(/\s*·\s*/u)
    .filter((part) => part.startsWith("parent:" )).map((part) => ({ value: part.slice("parent:".length).trim(), line: line.line })));
  let ownerSubjectId: string | undefined;
  if (parents.length) {
    const parent = parents[0]!;
    const parentAlias = snapshot.documents.find((item) => item.kind === "alias" && item.content.selectorKind === "driver-compatible"
      && item.content.normalizedSelector === parent.value && item.content.lifecycle === "active");
    const driver = snapshot.documents.find((item): item is CatalogReleaseSubjectDocument => item.kind === "subject"
      && item.content.kind === "driver" && item.content.lifecycle === "active"
      && (item.content.selector.value === parent.value || (parentAlias?.kind === "alias" && parentAlias.content.subjectId === item.content.id)));
    if (parents.length !== 1 || section.kind !== "node-type" || !parseCanonicalCompatibleSelector(parent.value).ok || !driver) {
      diagnostics.push(diagnostic(section, null, "主体", "parent 必须指定一个当前目录中有效的 Driver compatible。", parent.line));
    } else ownerSubjectId = driver.content.id;
  }
  const selectorKind = section.kind ? SELECTOR_KIND[section.kind] : undefined;
  const alias = snapshot.documents.find((item) => item.kind === "alias"
    && item.content.selectorKind === selectorKind
    && item.content.normalizedSelector === section.selector
    && item.content.lifecycle === "active"
    && snapshot.documents.some((subject) => subject.kind === "subject" && subject.content.id === item.content.subjectId
      && subject.content.ownerSubjectId === ownerSubjectId));
  const subject = snapshot.documents.find((item): item is CatalogReleaseSubjectDocument =>
    item.kind === "subject" && item.content.kind === section.kind
    && item.content.ownerSubjectId === ownerSubjectId
    && ((item.content.selector.kind === selectorKind && item.content.selector.value === section.selector)
      || (alias?.kind === "alias" && item.content.id === alias.content.subjectId)));

  if (subject?.content.lifecycle === "retired") {
    diagnostics.push(diagnostic(section, null, "主体", "主体已退役。", section.line));
  }
  if (section.kind && !subject) {
    const parsed = section.kind === "driver" ? parseCanonicalCompatibleSelector(section.selector)
      : section.kind === "node-type" ? parseCanonicalNodeName(section.selector)
        : parseCanonicalConfigurationSchemaId(section.selector);
    if (!parsed.ok) diagnostics.push(diagnostic(section, null, "主体", "主体标识格式无效。", section.line));
    if (snapshot.documents.some((item) => (item.kind === "subject" && item.content.ownerSubjectId === ownerSubjectId && item.content.selector.value === section.selector)
      || (item.kind === "alias" && item.content.normalizedSelector === section.selector && snapshot.documents.some((subject) => subject.kind === "subject"
        && subject.content.id === item.content.subjectId && subject.content.ownerSubjectId === ownerSubjectId)))) {
      diagnostics.push(diagnostic(section, null, "主体", "主体类型与目录不一致或标识已被占用。", section.line));
    }
  }
  let nature: "physical-device" | "logical-service" | undefined;
  let cardinality: "multiple" | "singleton-per-project" | undefined;
  let categoryPath: string | undefined;
  let displayAlias: string | undefined;
  let aliasSeen = false;
  const warnings: string[] = [];
  let hintLine: number | undefined;
  for (const metadata of section.metadataLines) {
    const parts = metadata.text.split(/\s*·\s*/u);
    const hintPattern = /^(业务分类|模块名称|展示别名)：|^(categoryPath|moduleName|displayAlias):/u;
    const facts = parts.filter((part) => !hintPattern.test(part) && !part.startsWith("parent:"));
    const match = facts.length ? /^nature: (physical-device|logical-service)\s*·\s*cardinality: (multiple|singleton-per-project)$/u.exec(facts.join(" · ")) : null;
    let invalid = facts.length > 0 && (!match || section.kind !== "driver" || nature !== undefined);
    for (const part of parts.filter((item) => hintPattern.test(item))) {
      const separator = part.search(/[：:]/u);
      const key = part.slice(0, separator);
      const value = part.slice(separator + 1).trim();
      if (key === "业务分类" || key === "categoryPath") {
        if (categoryPath !== undefined || !value || value.split(" / ").some((segment) => !segment.trim() || segment.includes("/"))) invalid = true;
        else categoryPath = value;
      } else {
        if (key === "模块名称" || key === "moduleName") warnings.push("模块名称（moduleName）已弃用，请改用展示别名（displayAlias）。");
        if (aliasSeen || !value) invalid = true;
        else if (parents.length || subject?.content.ownerSubjectId) warnings.push("子主体继承所属驱动的展示位置，已忽略展示别名。");
        else displayAlias = value;
        aliasSeen = true;
      }
      hintLine = metadata.line;
    }
    if (!metadata.text.trim() || (!facts.length && hintLine === undefined && !parts.some((part) => part.startsWith("parent:")))) invalid = true;
    if (invalid) {
      diagnostics.push(diagnostic(section, null, "主体", "主体信息不符合模板。", metadata.line));
    } else if (match) {
      nature = match[1] as "physical-device" | "logical-service";
      cardinality = match[2] as "multiple" | "singleton-per-project";
      if (subject?.content.kind === "driver" && (!("nature" in subject.content.subtype)
        || subject.content.subtype.nature !== nature || subject.content.subtype.cardinality.kind !== cardinality)) {
        diagnostics.push(diagnostic(section, null, "主体", "主体性质或基数与目录不一致。", metadata.line));
      }
    }
  }
  if (section.kind === "driver" && !subject && !nature) {
    diagnostics.push(diagnostic(section, null, "主体", "新建 Driver 必须填写 nature 和 cardinality。", section.line));
  }
  return { subject, diagnostics, section, nature, cardinality, ownerSubjectId, categoryPath, displayAlias, warnings, hintLine };
}

/** Convert this subject's accepted definitions to existing publication operations. */
export function subjectChanges(
  resolved: ReturnType<typeof resolveSubject>,
  definitions: readonly { propertyKey: string; content: SupportedDefinitionContent }[],
): CatalogChange[] {
  if (!resolved.subject) {
    const { section, nature, cardinality, ownerSubjectId } = resolved;
    if (!section.kind || !definitions.length) return [];
    const kind = section.kind;
    return [{ op: "create-subject-with-definitions", kind, canonicalKey: `${kind}:${section.selector}`,
      selector: { kind: SELECTOR_KIND[kind], value: section.selector },
      ...(ownerSubjectId ? { ownerSubjectId } : {}),
      ...(kind === "driver" && nature && cardinality ? { nature, cardinality } : {}), definitions }];
  }
  const subjectId = resolved.subject.content.id;
  return definitions.map((definition) => ({ op: "create-definition", subjectId, ...definition }));
}
