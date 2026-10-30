import { createHash } from "node:crypto";

import type { CatalogReleaseNode } from "../../../catalog-kernel/compiler/types";
import type { CatalogChange, SupportedDefinitionContent } from "../../builder/types";
import { classifyEntry } from "./classify";
import { buildContent } from "./content";
import { parseMarkdown } from "./parse";
import { resolveSubject, subjectChanges } from "./resolve";
import { diagnostic, type ImportDiagnostic, type ImportEntry, type SyntaxDiagnostic } from "./types";

const publicDiagnostic = ({ subjectHeading, definitionHeading, field, message, line }: SyntaxDiagnostic)
  : ImportDiagnostic => ({ subjectHeading, definitionHeading, field, message, line });

/** Plan one document against an immutable Catalog snapshot without side effects. */
export function planMarkdownImport(document: string, fileName: string, snapshot: CatalogReleaseNode) {
  const source = {
    fileName,
    sha256: `sha256:${createHash("sha256").update(document, "utf8").digest("hex")}`,
    parserVersion: "markdown-import/v1",
  };
  const syntax = parseMarkdown(document);
  const entries: ImportEntry[] = [];
  const changes: CatalogChange[] = [];
  const seen = new Set<string>();
  let definitionCount = 0;
  for (const issue of syntax.diagnostics.filter((item) => item.subjectLine === undefined)) {
    entries.push({
      subjectHeading: "", definitionHeading: "", selector: "", propertyKey: "", displayName: "",
      outcome: "error", diagnostics: [publicDiagnostic(issue)],
    });
  }
  for (const section of syntax.subjects) {
    const resolved = resolveSubject(section, snapshot);
    const creations: { propertyKey: string; content: SupportedDefinitionContent }[] = [];
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
      definitionCount += 1;
      const content = buildContent(section, definition);
      const diagnostics = [
        ...sectionDiagnostics.map((item) => ({ ...item, definitionHeading: definition.heading })),
        ...syntax.diagnostics.filter((item) => item.definitionLine === definition.line).map(publicDiagnostic),
        ...content.diagnostics,
      ];
      if (definitionCount === 129) {
        diagnostics.push(diagnostic(
          section, definition, "文档", "最多导入 128 条定义，请按主体拆分文档。", definition.line,
        ));
      }
      const naturalKey = `${resolved.subject?.content.id ?? section.heading}\0${definition.propertyKey}`;
      const duplicate = seen.has(naturalKey);
      seen.add(naturalKey);
      const classified = classifyEntry({
        entry: { section, definition, subject: resolved.subject, content: content.content, duplicate, diagnostics },
        snapshot,
      });
      entries.push({ subjectHeading: section.heading, definitionHeading: definition.heading,
        selector: section.selector, propertyKey: definition.propertyKey, displayName: definition.displayName,
        ...classified });
      if (classified.outcome === "create" && content.content) {
        creations.push({ propertyKey: definition.propertyKey, content: content.content });
      }
    }
    changes.push(...subjectChanges(resolved, creations));
  }
  if (!entries.length) {
    entries.push({
      subjectHeading: "", definitionHeading: "", selector: "", propertyKey: "", displayName: "", outcome: "error",
      diagnostics: [{ subjectHeading: "", definitionHeading: "", field: "文档",
        message: "文档中没有有效的定义标题。", line: 1 }],
    });
  }
  for (const entry of entries) entry.diagnostics.sort((a, b) => a.line - b.line);
  const ready = entries.every((entry) => entry.outcome === "create" || entry.outcome === "skip");
  return { entries, changeSet: ready && changes.length > 0 ? changes : null, source };
}
