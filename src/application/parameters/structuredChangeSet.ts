import type {
  DtsCompareBaselineResult,
  DtsStructuralChange
} from "@/application/ports/DtsStructuredRepository";

export type ParameterSourceLookup = {
  id: string;
  sourceFileName?: string;
  sourceNodePath?: string;
};

export type ChangeSetSubmitItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

export type UnmappedStructuralChange = {
  fileId: string;
  fileName?: string;
  change: DtsStructuralChange;
};

export type FlattenedStructuralChange = {
  fileId: string;
  fileName?: string;
  change: DtsStructuralChange;
};

/**
 * One logical change unit derived from a baseline compare result.
 * Maps to existing CR submit via `{ parameterId, targetValue, reason }[]`
 * (Decision D — reuse submission_round / parameter_change_requests).
 */
export type StructuredChangeSet = {
  baselineId: string;
  items: ChangeSetSubmitItem[];
  unmapped: UnmappedStructuralChange[];
  changes: FlattenedStructuralChange[];
};

export type LocalStructuredDraft = {
  nodePath: string;
  propertyName: string;
  beforeRawText: string;
  rawText: string;
  normalizedValue: string;
};

export type AggregateLocalStructuredEditsInput = {
  fileId: string;
  fileName?: string;
  drafts: LocalStructuredDraft[];
  parameters: ParameterSourceLookup[];
};

export type AggregateLocalStructuredEditsResult = {
  edits: Array<{
    fileId: string;
    nodePath: string;
    propertyName: string;
    rawText: string;
    reason: string;
  }>;
  changeSet: StructuredChangeSet;
};

/**
 * AggregateLocalStructuredEditsInput drafts that differ from beforeRawText into Port
 * submit units. Prefer rawText for CR targetValue. When a source binding exists, map
 * to that parameterId; otherwise use a provisional `pending:` id (backend ensure creates
 * the real PPV) so the change-set stays free of unmapped rows for property edits.
 */
export function aggregateLocalStructuredEdits(
  input: AggregateLocalStructuredEditsInput
): AggregateLocalStructuredEditsResult {
  const edits: AggregateLocalStructuredEditsResult["edits"] = [];
  const items: ChangeSetSubmitItem[] = [];
  const changes: FlattenedStructuralChange[] = [];

  for (const draft of input.drafts) {
    if (draft.rawText === draft.beforeRawText) {
      continue;
    }

    const sourceNodePath = draft.nodePath.trim()
      ? `${draft.nodePath.trim()}/${draft.propertyName.trim()}`
      : draft.propertyName.trim();
    const change: DtsStructuralChange = {
      kind: "prop_changed",
      nodePath: draft.nodePath,
      prop: draft.propertyName,
      before: draft.beforeRawText,
      after: draft.rawText
    };
    changes.push({
      fileId: input.fileId,
      fileName: input.fileName,
      change
    });

    const reason = `Structured edit: ${input.fileName ?? input.fileId} ${sourceNodePath}`;
    edits.push({
      fileId: input.fileId,
      nodePath: draft.nodePath,
      propertyName: draft.propertyName,
      rawText: draft.rawText,
      reason
    });

    const parameter = findParameter(input.parameters, input.fileName, sourceNodePath);
    items.push({
      parameterId: parameter?.id ?? `pending:${input.fileId}:${sourceNodePath}`,
      targetValue: draft.rawText,
      reason
    });
  }

  return {
    edits,
    changeSet: {
      baselineId: "local-edits",
      items,
      unmapped: [],
      changes
    }
  };
}

function isPropertyChange(
  change: DtsStructuralChange
): change is Extract<DtsStructuralChange, { prop: string }> {
  return (
    change.kind === "prop_added" ||
    change.kind === "prop_removed" ||
    change.kind === "prop_changed"
  );
}

export function sourceNodePathForChange(change: DtsStructuralChange): string {
  if (!isPropertyChange(change)) {
    return change.nodePath;
  }
  return change.nodePath ? `${change.nodePath}/${change.prop}` : change.prop;
}

function targetValueForChange(change: DtsStructuralChange): string | undefined {
  if (!isPropertyChange(change)) {
    return undefined;
  }
  if (change.kind === "prop_removed") {
    return "";
  }
  return change.after ?? "";
}

function reasonForChange(fileName: string | undefined, change: DtsStructuralChange): string {
  const file = fileName ?? "(unknown file)";
  const path = sourceNodePathForChange(change);
  switch (change.kind) {
    case "prop_changed":
      return `Structured baseline drift: ${file} ${path} (${change.before ?? ""} → ${change.after ?? ""})`;
    case "prop_added":
      return `Structured baseline drift: ${file} ${path} added (${change.after ?? ""})`;
    case "prop_removed":
      return `Structured baseline drift: ${file} ${path} removed`;
    case "node_added":
      return `Structured baseline drift: ${file} node added ${path}`;
    case "node_removed":
      return `Structured baseline drift: ${file} node removed ${path}`;
  }
}

function findParameter(
  parameters: ParameterSourceLookup[],
  fileName: string | undefined,
  sourceNodePath: string
): ParameterSourceLookup | undefined {
  if (!fileName) {
    return undefined;
  }
  return parameters.find(
    (parameter) =>
      parameter.sourceFileName === fileName && parameter.sourceNodePath === sourceNodePath
  );
}

/**
 * Aggregate multi-file / multi-node structural diffs from compareBaseline into one
 * logical change-set unit. Property-level changes map to CR submit items when a
 * project parameter is bound via source_file_name + source_node_path
 * (`nodePath/prop`, matching parsed_index). Node add/remove and unbound props
 * go to `unmapped` — never invent fake CRs.
 */
export function aggregateStructuredChangeSet(
  compare: DtsCompareBaselineResult,
  parameters: ParameterSourceLookup[]
): StructuredChangeSet {
  const items: ChangeSetSubmitItem[] = [];
  const unmapped: UnmappedStructuralChange[] = [];
  const changes: FlattenedStructuralChange[] = [];

  for (const member of compare.members) {
    const structuralDiff = member.structuralDiff ?? [];
    for (const change of structuralDiff) {
      const flattened: FlattenedStructuralChange = {
        fileId: member.fileId,
        fileName: member.fileName,
        change
      };
      changes.push(flattened);

      if (!isPropertyChange(change)) {
        unmapped.push(flattened);
        continue;
      }

      const sourceNodePath = sourceNodePathForChange(change);
      const parameter = findParameter(parameters, member.fileName, sourceNodePath);
      const targetValue = targetValueForChange(change);
      if (!parameter || targetValue === undefined) {
        unmapped.push(flattened);
        continue;
      }

      items.push({
        parameterId: parameter.id,
        targetValue,
        reason: reasonForChange(member.fileName, change)
      });
    }
  }

  return {
    baselineId: compare.baselineId,
    items,
    unmapped,
    changes
  };
}
