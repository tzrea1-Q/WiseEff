import { createHash } from "node:crypto";

import type { CatalogReleaseNode } from "../../../catalog-kernel/compiler/types";
import type { CatalogChange, SupportedDefinitionContent } from "../../builder/types";
import { tighterConstraint } from "../../builder/completeSuccessor";
import { classifyEntry } from "./classify";
import { buildContent, isRevisionEntry } from "./content";
import { parseMarkdown } from "./parse";
import { resolveSubject, subjectChanges } from "./resolve";
import { diagnostic, type ImportDiagnostic, type ImportEntry, type SyntaxDiagnostic } from "./types";

const publicDiagnostic = ({ subjectHeading, definitionHeading, field, message, line }: SyntaxDiagnostic)
  : ImportDiagnostic => ({ subjectHeading, definitionHeading, field, message, line });
const MAX_IMPORT_DEFINITIONS = 128;
const documentError = (issue: ImportDiagnostic): ImportEntry => ({
  subjectHeading: "", definitionHeading: "", selector: "", propertyKey: "", displayName: "",
  outcome: "error", diagnostics: [issue],
});

/** Plan one document against an immutable Catalog snapshot without side effects. */
export function planMarkdownImport(document: string, fileName: string, snapshot: CatalogReleaseNode) {
  const source = {
    fileName,
    sha256: `sha256:${createHash("sha256").update(document, "utf8").digest("hex")}`,
    parserVersion: "markdown-import/v2",
  };
  const syntax = parseMarkdown(document);
  const definitionCount = syntax.subjects.reduce((count, subject) => count + subject.definitions.length, 0);
  if (definitionCount > MAX_IMPORT_DEFINITIONS) {
    return { entries: [documentError({ subjectHeading: "", definitionHeading: "", field: "文档", line: 1,
      message: `最多导入 ${MAX_IMPORT_DEFINITIONS} 条定义（本文档 ${definitionCount} 条），请按主体拆分文档。` })],
    changeSet: null, noChange: false, source, placementHints: [] };
  }
  const entries: ImportEntry[] = [];
  const changes: CatalogChange[] = [];
  const placementHints: { kind: string; selector: string; subjectId?: string; categoryPath?: string; moduleName?: string; line: number }[] = [];
  const seen = new Set<string>();
  const newSubjects = new Map<string, ReturnType<typeof resolveSubject>>();
  for (const issue of syntax.diagnostics.filter((item) => item.subjectLine === undefined)) {
    entries.push(documentError(publicDiagnostic(issue)));
  }
  for (const section of syntax.subjects) {
    const resolved = resolveSubject(section, snapshot);
    if (section.kind && resolved.hintLine !== undefined) placementHints.push({ kind: section.kind, selector: section.selector,
      ...(resolved.subject ? { subjectId: resolved.subject.content.id } : {}),
      ...(resolved.categoryPath ? { categoryPath: resolved.categoryPath } : {}),
      ...(resolved.moduleName ? { moduleName: resolved.moduleName } : {}), line: resolved.hintLine });
    if (!resolved.subject && section.kind) {
      const previous = newSubjects.get(section.selector);
      if (previous && (previous.section.kind !== section.kind || previous.nature !== resolved.nature
        || previous.cardinality !== resolved.cardinality)) {
        resolved.diagnostics.push(diagnostic(section, null, "主体", "文档中主体的类型、性质或基数不一致。", section.line));
      } else if (!previous) newSubjects.set(section.selector, resolved);
    }
    const creations: { propertyKey: string; content: SupportedDefinitionContent }[] = [];
    const createdEntries: ImportEntry[] = [];
    const sectionDiagnostics = [
      ...syntax.diagnostics.filter((item) => item.subjectLine === section.line && item.definitionLine === undefined)
        .map(publicDiagnostic),
      ...resolved.diagnostics,
    ];
    if (section.definitions.length === 0) {
      const diagnostics = sectionDiagnostics.length ? sectionDiagnostics : [
        diagnostic(section, null, "主体", "主体下没有定义。", section.line),
      ];
      entries.push({ subjectHeading: section.heading, definitionHeading: "", selector: section.selector,
        propertyKey: "", displayName: "", outcome: "error", diagnostics });
      continue;
    }
    for (const definition of section.definitions) {
      const revise = isRevisionEntry(definition);
      const existing = resolved.subject ? snapshot.documents.find((item) => item.kind === "definition"
        && item.content.subjectId === resolved.subject!.content.id && item.content.propertyKey === definition.propertyKey) : undefined;
      const naturalKey = `${resolved.subject?.content.id ?? `${section.kind}:${section.selector}`}\0${definition.propertyKey}`;
      const duplicate = seen.has(naturalKey);
      seen.add(naturalKey);
      const diagnostics = [
        ...sectionDiagnostics.map((item) => ({ ...item, definitionHeading: definition.heading })),
        ...syntax.diagnostics.filter((item) => item.definitionLine === definition.line).map(publicDiagnostic),
      ];
      if (revise && !existing) {
        entries.push({ subjectHeading: section.heading, definitionHeading: definition.heading,
          selector: section.selector, propertyKey: definition.propertyKey, displayName: definition.displayName,
          outcome: "error", diagnostics: [...diagnostics, diagnostic(section, definition, "操作", "修订的定义不存在。", definition.line)] });
        continue;
      }
      const content = buildContent(section, definition, revise && existing?.kind === "definition" ? existing.content.revision : undefined);
      diagnostics.push(...content.diagnostics);
      const classified = classifyEntry({
        entry: { section, definition, subject: resolved.subject, content: content.content, duplicate, diagnostics },
        snapshot,
      });
      const entry: ImportEntry = { subjectHeading: section.heading, definitionHeading: definition.heading,
        selector: section.selector, propertyKey: definition.propertyKey, displayName: definition.displayName,
        ...(existing?.kind === "definition" ? { definitionId: existing.content.id } : {}), ...classified };
      entries.push(entry);
      if (classified.outcome === "create" && content.content) {
        creations.push({ propertyKey: definition.propertyKey, content: content.content });
        createdEntries.push(entry);
      }
      if (classified.outcome === "revise" && content.content && existing?.kind === "definition" && classified.revisionClass) {
        entry.operationIndex = changes.length;
        entry.tightensExistingContract = tighterConstraint(existing.content.revision.valueSchema, content.content.valueSchema);
        changes.push({ op: "revise-definition", definitionId: existing.content.id, class: classified.revisionClass, content: content.content });
      }
    }
    for (const change of subjectChanges(resolved, creations)) {
      const previous = change.op === "create-subject-with-definitions"
        ? changes.find((item) => item.op === "create-subject-with-definitions" && item.canonicalKey === change.canonicalKey)
        : undefined;
      const operationIndex = previous ? changes.indexOf(previous) : changes.length;
      if (previous?.op === "create-subject-with-definitions" && change.op === "create-subject-with-definitions") {
        changes[operationIndex] = { ...previous, definitions: [...previous.definitions, ...change.definitions] };
      } else changes.push(change);
      for (const entry of createdEntries) {
        if (change.op === "create-subject-with-definitions" || (change.op === "create-definition" && change.propertyKey === entry.propertyKey)) {
          entry.operationIndex = operationIndex;
        }
      }
    }
  }
  if (!entries.length) {
    entries.push(documentError({ subjectHeading: "", definitionHeading: "", field: "文档",
      message: "文档中没有有效的定义标题。", line: 1 }));
  }
  for (const entry of entries) entry.diagnostics.sort((a, b) => a.line - b.line);
  const ready = entries.every((entry) => entry.outcome === "create" || entry.outcome === "revise" || entry.outcome === "skip");
  return { entries, changeSet: ready && changes.length > 0 ? changes : null,
    noChange: entries.length > 0 && entries.every((entry) => entry.outcome === "skip"), source, placementHints };
}
