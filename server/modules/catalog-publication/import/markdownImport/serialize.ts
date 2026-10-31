import type { CatalogReleaseNode } from "../../../catalog-kernel/compiler/types";
import { IMPORT_FIELDS as F } from "./content";
import { unwrapArraySchema } from "./schema";

/** Serialize existing definition heads in the vocabulary understood by the importer. */
export function serializeMarkdownRevision(snapshot: CatalogReleaseNode, definitionIds: readonly string[]): string {
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
      const { arrays, item } = unwrapArraySchema(schema);
      const type = `${"array<".repeat(arrays.length)}${item.type ?? "mixed"}${">".repeat(arrays.length)}`;
      const rows: [string, string][] = [[F.operation, "修订"], [F.type, type]];
      if (item.description !== undefined) rows.push([F.typeDescription, String(item.description)]);
      for (const [label, value] of [[F.unit, revision.unit], [F.minimum, item.minimum], [F.maximum, item.maximum],
        [F.minItems, schema.minItems], [F.maxItems, schema.maxItems]] as const) {
        if (value !== undefined) rows.push([label, String(value)]);
      }
      for (const example of revision.examples ?? []) rows.push([F.example, type === "string" ? String(example) : JSON.stringify(example)]);
      if (revision.description !== undefined) rows.push([F.description, revision.description]);
      if (revision.documentation === "-") rows.push([F.documentation, revision.documentation]);
      const escape = (value: string) => value === "-" ? "\\-" : value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
      blocks.push(`## \`${propertyKey}\` ${revision.displayName}\n| 字段 | 值 |\n| --- | --- |\n${rows.map(([key, value]) => `| ${key} | ${escape(value)} |`).join("\n")}\n\n${revision.documentation === "-" ? "" : revision.documentation}`);
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
