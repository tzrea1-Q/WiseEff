import type { CatalogReleaseNode } from "../../../catalog-kernel/compiler/types";
import { IMPORT_FIELDS as F } from "./content";
import { formatValueType, unwrapArraySchema } from "./schema";
import { parseMarkdown } from "./parse";
import { planMarkdownImport } from "./plan";

/** Serialize existing definition heads in the vocabulary understood by the importer. */
function serialize(snapshot: CatalogReleaseNode, definitionIds: readonly string[], documentationOnly = false): string {
  const selected = new Set(definitionIds);
  const blocks: string[] = [];
  for (const subject of snapshot.documents) {
    if (subject.kind !== "subject") continue;
    const definitions = snapshot.documents.filter((item) => item.kind === "definition"
      && item.content.subjectId === subject.content.id && selected.has(item.content.id));
    if (!definitions.length) continue;
    const name = { driver: "Driver", "node-type": "NodeType", "configuration-schema": "ConfigurationSchema" }[subject.content.kind];
    blocks.push(`# ${name} \`${subject.content.selector.value}\``);
    if (subject.content.kind === "driver" && "nature" in subject.content.subtype) {
      blocks.push(`nature: ${subject.content.subtype.nature} · cardinality: ${subject.content.subtype.cardinality.kind}`);
    }
    for (const definition of definitions) {
      if (definition.kind !== "definition") continue;
      const { revision, propertyKey } = definition.content;
      const schema = revision.valueSchema as Record<string, unknown>;
      const { item } = unwrapArraySchema(schema);
      const type = formatValueType(schema);
      const rows: [string, string][] = [[F.operation, "修订"], [F.type, documentationOnly ? "string" : type]];
      if (!documentationOnly) {
        if (item.description !== undefined) rows.push([F.typeDescription, String(item.description)]);
        for (const [label, value] of [[F.unit, revision.unit], [F.minimum, item.minimum], [F.maximum, item.maximum],
          [F.minItems, schema.minItems], [F.maxItems, schema.maxItems]] as const) {
          if (value !== undefined) rows.push([label, String(value)]);
        }
        for (const example of revision.examples ?? []) rows.push([F.example, type === "string" ? String(example) : JSON.stringify(example)]);
        if (revision.description !== undefined) rows.push([F.description, revision.description]);
      }
      if (revision.documentation === "-") rows.push([F.documentation, revision.documentation]);
      const escape = (value: string) => value === "-" ? "\\-" : value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
      blocks.push(`## \`${propertyKey}\` ${revision.displayName}\n| 字段 | 值 |\n| --- | --- |\n${rows.map(([key, value]) => `| ${key} | ${escape(value)} |`).join("\n")}\n\n${revision.documentation === "-" ? "" : revision.documentation}`);
    }
  }
  return `${blocks.join("\n\n")}\n`;
}

export function serializeMarkdownRevision(snapshot: CatalogReleaseNode, definitionIds: readonly string[]) {
  const allowed: string[] = [];
  const skipped: { definitionId: string; reason: "documentation-not-expressible" | "not-round-trippable" }[] = [];
  for (const definitionId of definitionIds) {
    const definition = snapshot.documents.find((item) => item.kind === "definition" && item.content.id === definitionId);
    const block = serialize(snapshot, [definitionId]);
    const syntax = parseMarkdown(serialize(snapshot, [definitionId], true));
    const parsed = syntax.subjects[0]?.definitions[0];
    if (definition?.kind === "definition" && definition.content.revision.documentation !== "-"
      && (syntax.subjects.length !== 1 || syntax.subjects[0]?.definitions.length !== 1
        || parsed?.documentation !== definition.content.revision.documentation)) {
      skipped.push({ definitionId, reason: "documentation-not-expressible" });
      continue;
    }
    const plan = planMarkdownImport(block, "export.md", snapshot);
    if (!plan.noChange || plan.entries.length !== 1 || plan.entries[0]?.outcome !== "skip") {
      skipped.push({ definitionId, reason: "not-round-trippable" });
      continue;
    }
    allowed.push(definitionId);
  }
  return { document: serialize(snapshot, allowed), skipped };
}
