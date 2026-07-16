import type { DtsDocument, DtsNodeCst, DtsPropertyCst } from "./types";

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function collectPropertyEdits(nodes: DtsNodeCst[], source: string, out: Replacement[]): void {
  for (const node of nodes) {
    for (const child of node.children) {
      if (child.kind === "property") {
        maybeEdit(child, source, out);
      } else if (child.kind === "node") {
        collectPropertyEdits([child], source, out);
      }
      // `delete-property`/`delete-node` carry no `rawText` to splice.
    }
  }
}

function maybeEdit(prop: DtsPropertyCst, source: string, out: Replacement[]): void {
  const original = source.slice(prop.span.start, prop.span.end);
  if (original === prop.rawText) return;
  // Bool/empty properties use a name span for location; empty rawText is not an edit.
  if ((prop.valueType === "bool" || prop.valueType === "empty") && prop.rawText === "") return;
  out.push({ start: prop.span.start, end: prop.span.end, text: prop.rawText });
}

/**
 * Serialize a CST document. Unedited documents are byte-identical to `document.source`.
 * Edited properties (rawText ≠ original span text) are spliced in by span.
 */
export function serializeDts(document: DtsDocument): string {
  const edits: Replacement[] = [];
  collectPropertyEdits(document.topLevel, document.source, edits);
  if (edits.length === 0) {
    return document.source;
  }

  edits.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let out = "";
  for (const edit of edits) {
    if (edit.start < cursor) {
      throw new Error(`Overlapping CST edits at ${edit.start}`);
    }
    out += document.source.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
  }
  out += document.source.slice(cursor);
  return out;
}
