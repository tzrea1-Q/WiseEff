import {
  aggregateLocalStructuredEdits,
  type AggregateLocalStructuredEditsResult,
  type ParameterSourceLookup
} from "@/application/parameters/structuredChangeSet";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";

export type SessionPropertyDraft = {
  rawText: string;
  normalizedValue: string;
  present?: boolean;
  valid?: boolean;
  error?: string;
};

export type SessionDraftIdentity = {
  fileId: string;
  nodePath: string;
  propertyName: string;
};

export function propertyIdentity(nodePath: string, propertyName: string): string {
  return `${nodePath}::${propertyName}`;
}

export function parsePropertyIdentity(identity: string): { nodePath: string; propertyName: string } | null {
  const separator = identity.indexOf("::");
  if (separator <= 0) return null;
  return {
    nodePath: identity.slice(0, separator),
    propertyName: identity.slice(separator + 2)
  };
}

export function sessionDraftKey(identity: SessionDraftIdentity): string {
  return `${identity.fileId}::${propertyIdentity(identity.nodePath, identity.propertyName)}`;
}

export type SessionDraftRow = SessionDraftIdentity & {
  identity: string;
  key: string;
  beforeRawText: string;
  rawText: string;
  normalizedValue: string;
  startLine: number | null;
  valid: boolean;
  error?: string;
};

export function listSessionDraftRows(input: {
  fileId: string;
  nodes: DtsStructuralNode[];
  drafts: Record<string, SessionPropertyDraft>;
}): SessionDraftRow[] {
  const rows: SessionDraftRow[] = [];
  for (const node of input.nodes) {
    for (const property of node.properties) {
      const identity = propertyIdentity(node.nodePath, property.name);
      const key = sessionDraftKey({
        fileId: input.fileId,
        nodePath: node.nodePath,
        propertyName: property.name
      });
      const draft = input.drafts[key] ?? input.drafts[identity];
      if (!draft) continue;
      if (draft.rawText === property.rawText && draft.present === undefined) continue;
      rows.push({
        fileId: input.fileId,
        nodePath: node.nodePath,
        propertyName: property.name,
        identity,
        key,
        beforeRawText: property.rawText,
        rawText: draft.rawText,
        normalizedValue: draft.normalizedValue,
        startLine: property.source?.startLine ?? node.source?.startLine ?? null,
        valid: draft.valid !== false,
        ...(draft.error ? { error: draft.error } : {})
      });
    }
  }
  return rows;
}

export function aggregateSessionDraftSubset(input: {
  fileId: string;
  fileName: string;
  rows: SessionDraftRow[];
  selectedKeys: ReadonlySet<string> | null;
  parameters?: ParameterSourceLookup[];
  reason: string;
}): AggregateLocalStructuredEditsResult {
  const selected =
    input.selectedKeys == null
      ? input.rows
      : input.rows.filter((row) => input.selectedKeys!.has(row.key) || input.selectedKeys!.has(row.identity));
  const aggregate = aggregateLocalStructuredEdits({
    fileId: input.fileId,
    fileName: input.fileName,
    drafts: selected.map((row) => ({
      nodePath: row.nodePath,
      propertyName: row.propertyName,
      beforeRawText: row.beforeRawText,
      rawText: row.rawText,
      normalizedValue: row.normalizedValue
    })),
    parameters: input.parameters ?? []
  });
  return {
    ...aggregate,
    edits: aggregate.edits.map((edit) => ({
      ...edit,
      reason: input.reason
    }))
  };
}

export function clearSubmittedDrafts(
  drafts: Record<string, SessionPropertyDraft>,
  submittedKeys: Iterable<string>
): Record<string, SessionPropertyDraft> {
  const next = { ...drafts };
  for (const key of submittedKeys) {
    delete next[key];
  }
  return next;
}
