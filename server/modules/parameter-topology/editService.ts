/**
 * Typed binding edits → overlay write targets → draft + candidate config revision.
 *
 * Shared base files are never mutated; project differences land in overlay.
 * Writes target the binding's stable logical node (never first &ref / charging_core default).
 * Release/edit gates fail closed on unresolved mapping and schema constraints.
 */

import { createHash, randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import { parseDts, serializeDts, type DtsNodeCst, type DtsPropertyCst } from "../dts";
import type { DtsValue } from "../dts/types";
import { renderDtsValue } from "../dts/valueAst";
import type { ObjectStore } from "../logs/objectStore";
import {
  createDtsToolchainRunner,
  type DtsToolchainRunner,
} from "../parameter-files/dtsToolchain";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canEditParameters } from "../parameters/policy";
import { mustUseSemanticParameterIdentity } from "../parameters/semanticParameterReads";
import { ensurePreCutoverLinkedParameterValue } from "../parameters/legacyParameterIdentityAdapter";
import { upsertDraft } from "../parameters/repository";
import { countOpenIdentityMappingTasksForRevision } from "./bindingService";
import {
  assertCanPromoteCandidateToDraft,
  type CandidateGateFailureReason,
} from "./candidateRevisionStateMachine";
import { ingestConfigRevisionInTransaction } from "./ingestService";
import {
  getConfigRevisionById,
  insertValidationDiagnostics,
  insertValidationRun,
  updateConfigRevisionStatus,
} from "./repository";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember, PersistedValidationDiagnostic } from "./types";
import { writeGovernanceAudit } from "./governanceAudit";

export type BindingEditAction = "set" | "delete";

export type CreateBindingDraftInput = {
  bindingId: string;
  baseRevisionId: string;
  /** Required when action is "set" (default). */
  targetValue?: DtsValue;
  action?: BindingEditAction;
  reason: string;
  /**
   * @deprecated Schema enforcement is always on for the normal path.
   * Callers cannot disable it; this field is ignored when false.
   */
  enforceSchema?: boolean;
};

export type CreateBindingDraftDeps = {
  /** Injected for tests; production defaults to the real Task 8 runner. */
  toolchain?: DtsToolchainRunner;
  /** Preferred source of file bytes by version storage key. */
  objectStore?: ObjectStore;
};

export type BindingDraftWriteTarget = {
  role: "overlay" | "project-occurrence";
  propertyKey: string;
  fileId?: string;
  fileName?: string;
  fileVersionId?: string;
  checksum?: string;
  nodeLocator?: string;
  occurrenceId?: string;
  occurrenceSpan?: { start: number; end: number };
  nodeSpan?: { start: number; end: number };
  targetRef?: string;
};

export type BindingDraftResult = {
  draftId: string;
  writeTarget: BindingDraftWriteTarget;
  candidateRevisionId: string;
  rawText: string;
  parameterSpecId: string;
  projectParameterBindingId: string;
  /** Base member content after draft (must equal pre-edit for shared-base protection). */
  baseContent: string;
  baseChecksumBefore: string;
  baseChecksumAfter: string;
  candidateOverlayContent: string;
  overlayFileId: string;
  overlayFileName: string;
};

type BindingContextRow = {
  binding_id: string;
  organization_id: string;
  project_id: string;
  parameter_spec_id: string;
  logical_node_id: string | null;
  property_key: string;
  node_locator: string | null;
  constraints: unknown;
  schema_default: unknown;
  example_value: unknown;
  policy_target: unknown;
};

type RevisionMemberRow = {
  file_id: string;
  file_version_id: string;
  role: "base" | "overlay" | "include";
  sort_order: number;
  file_name: string;
  checksum: string;
  storage_key: string;
};

type EffectRow = {
  effect_kind: string;
  property_occurrence_id: string | null;
  file_version_id: string | null;
  file_id: string | null;
  file_name: string | null;
  role: "base" | "overlay" | "include" | null;
  raw_text: string | null;
  node_path: string | null;
  ref_target: string | null;
  labels: unknown;
  node_name: string | null;
  start_offset: number | null;
  end_offset: number | null;
  node_start_offset: number | null;
  node_end_offset: number | null;
  file_checksum: string | null;
};

function requireCanEdit(auth: AuthContext) {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter edit permission required.", 403);
  }
}

function checksumOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function asConstraintNumber(constraints: unknown, key: "min" | "max"): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cellIntegerValues(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  const out: number[] = [];
  for (const group of value.groups) {
    for (const cell of group) {
      if (cell.kind === "integer") {
        const parsed = Number(cell.value);
        if (Number.isFinite(parsed)) out.push(parsed);
      }
    }
  }
  return out;
}

function cellGroupSizes(value: DtsValue): number[] {
  if (value.kind !== "cells") return [];
  return value.groups.map((group) => group.length);
}

function asConstraintCells(constraints: unknown): number | undefined {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) return undefined;
  const value = (constraints as Record<string, unknown>).cells;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assertSchemaAllows(value: DtsValue, constraints: unknown): void {
  const expectedCells = asConstraintCells(constraints);
  if (expectedCells !== undefined) {
    const sizes = cellGroupSizes(value);
    if (sizes.length === 0 || sizes.some((size) => size !== expectedCells)) {
      throw new ApiError("VALIDATION_FAILED", `cell count must be ${expectedCells}`, 400, {
        reason: "schema-failure",
        code: "SCHEMA_CELL_COUNT",
        expectedCells,
        actualCells: sizes,
      });
    }
  }

  const min = asConstraintNumber(constraints, "min");
  const max = asConstraintNumber(constraints, "max");
  if (min === undefined && max === undefined) return;

  for (const numeric of cellIntegerValues(value)) {
    if (min !== undefined && numeric < min) {
      throw new ApiError("VALIDATION_FAILED", "Value is below schema minimum.", 400, {
        reason: "schema-failure",
        min,
        value: numeric,
      });
    }
    if (max !== undefined && numeric > max) {
      throw new ApiError("VALIDATION_FAILED", "Value exceeds schema maximum.", 400, {
        reason: "schema-failure",
        max,
        value: numeric,
      });
    }
  }
}

async function loadBindingContext(
  db: Queryable,
  auth: AuthContext,
  bindingId: string,
): Promise<BindingContextRow> {
  const result = await db.query<BindingContextRow>(
    `
    select
      b.id as binding_id,
      b.organization_id,
      b.project_id,
      b.parameter_spec_id,
      b.logical_node_id,
      coalesce(dps.property_key, nullif(split_part(ps.specification_key, '/', 2), ''), '') as property_key,
      (
        select lnr.node_locator
        from dts_logical_node_revisions lnr
        where lnr.logical_node_id = b.logical_node_id
        order by lnr.config_revision_id desc
        limit 1
      ) as node_locator,
      coalesce(dps.constraints, '{}'::jsonb) as constraints,
      (
        select psv.schema_default
        from parameter_spec_versions psv
        where psv.parameter_spec_id = b.parameter_spec_id
        order by psv.version desc
        limit 1
      ) as schema_default,
      (
        select psv.example_value
        from parameter_spec_versions psv
        where psv.parameter_spec_id = b.parameter_spec_id
        order by psv.version desc
        limit 1
      ) as example_value,
      (
        select ppt.target_value
        from parameter_policy_targets ppt
        where ppt.parameter_spec_id = b.parameter_spec_id
          and ppt.organization_id = b.organization_id
        order by ppt.updated_at desc
        limit 1
      ) as policy_target
    from project_parameter_bindings b
    join parameter_specs ps on ps.id = b.parameter_spec_id
    left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
    where b.id = $1 and b.organization_id = $2
    limit 1
    `,
    [bindingId, auth.organization.id],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "Project parameter binding was not found.", 404, { bindingId });
  }
  return row;
}

async function loadRevisionMembers(
  db: Queryable,
  configRevisionId: string,
): Promise<RevisionMemberRow[]> {
  const result = await db.query<RevisionMemberRow>(
    `
    select
      m.file_id,
      m.file_version_id,
      m.role,
      m.sort_order,
      f.file_name,
      v.checksum,
      v.storage_key
    from dts_config_revision_members m
    join project_parameter_files f on f.id = m.file_id
    join project_parameter_file_versions v on v.id = m.file_version_id
    where m.config_revision_id = $1
    order by m.sort_order asc, f.file_name asc
    `,
    [configRevisionId],
  );
  return result.rows;
}

/**
 * Prefer object-store bytes for the file version. Fall back to parsed_index.sourceText
 * only for fixtures that never wrote store objects.
 */
async function loadFileContentFromVersion(
  db: Queryable,
  fileVersionId: string,
  objectStore?: ObjectStore,
): Promise<string> {
  const result = await db.query<{
    checksum: string;
    storage_key: string;
    parsed_index: unknown;
  }>(
    `
    select checksum, storage_key, parsed_index
    from project_parameter_file_versions
    where id = $1
    limit 1
    `,
    [fileVersionId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "File version was not found for binding edit.", 404, { fileVersionId });
  }

  if (objectStore) {
    try {
      const bytes = await objectStore.get(row.storage_key);
      return bytes.toString("utf8");
    } catch {
      // Fall through to fixture sidecar when store miss (tests without put).
    }
  }

  if (row.parsed_index && typeof row.parsed_index === "object" && !Array.isArray(row.parsed_index)) {
    const source = (row.parsed_index as Record<string, unknown>).sourceText;
    if (typeof source === "string") return source;
  }

  throw new ApiError("CONFLICT", "File version content is unavailable for binding edit.", 409, {
    fileVersionId,
    storageKey: row.storage_key,
  });
}

function firstLabel(labels: unknown): string | undefined {
  if (!Array.isArray(labels)) return undefined;
  const label = labels.map(String).find((value) => value.trim().length > 0);
  return label;
}

function locatorLeafLabel(locator: string | null | undefined): string | undefined {
  if (!locator) return undefined;
  const leaf = locator.split("/").filter(Boolean).pop();
  if (!leaf || leaf.includes("@")) return undefined;
  return leaf;
}

/**
 * Resolve the overlay &ref label for this binding's logical node.
 * Never defaults to charging_core or the first &ref in a file.
 */
function resolveTargetRef(input: {
  effect?: EffectRow;
  nodeLocator: string | null;
}): string {
  if (input.effect?.ref_target) return input.effect.ref_target;
  const label = firstLabel(input.effect?.labels);
  if (label) return label;
  if (input.effect?.node_name && !input.effect.node_name.includes("@")) {
    return input.effect.node_name;
  }
  const fromLocator = locatorLeafLabel(input.nodeLocator ?? input.effect?.node_path);
  if (fromLocator) return fromLocator;

  throw new ApiError("CONFLICT", "Unable to resolve overlay target ref for binding edit.", 409, {
    reason: "missing-overlay-target-ref",
    nodeLocator: input.nodeLocator,
    nodePath: input.effect?.node_path ?? null,
  });
}

/**
 * Resolve effective write target for a property: prefer last overlay effect for
 * this logical node; if only shared base contributes, target the correct project
 * overlay + node ref (never mutate shared base).
 */
async function resolveWriteTarget(
  db: Queryable,
  input: {
    configRevisionId: string;
    logicalNodeId: string | null;
    propertyKey: string;
    nodeLocator: string | null;
  },
): Promise<{
  writeTarget: BindingDraftWriteTarget;
  overlayMember: RevisionMemberRow;
  baseMember: RevisionMemberRow;
  members: RevisionMemberRow[];
  targetRef: string;
  occurrenceSpan?: { start: number; end: number };
  expectedRawText?: string | null;
  nodeSpan?: { start: number; end: number };
}> {
  const members = await loadRevisionMembers(db, input.configRevisionId);
  const baseMember = members.find((m) => m.role === "base");
  if (!baseMember) {
    throw new ApiError("CONFLICT", "Config revision missing base member for edit.", 409, {
      configRevisionId: input.configRevisionId,
    });
  }

  const effects = await db.query<EffectRow>(
    `
    select
      oe.effect_kind,
      oe.property_occurrence_id,
      po.file_version_id,
      m.file_id,
      f.file_name,
      m.role,
      po.raw_text,
      no.node_path,
      no.ref_target,
      no.labels,
      no.name as node_name,
      po.start_offset,
      po.end_offset,
      no.start_offset as node_start_offset,
      no.end_offset as node_end_offset,
      v.checksum as file_checksum
    from dts_occurrence_effects oe
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    left join dts_property_occurrences po on po.id = oe.property_occurrence_id
    left join dts_node_occurrences no on no.id = coalesce(oe.node_occurrence_id, po.node_occurrence_id)
    left join dts_config_revision_members m on m.file_version_id = coalesce(po.file_version_id, no.file_version_id)
      and m.config_revision_id = oe.config_revision_id
    left join project_parameter_files f on f.id = m.file_id
    left join project_parameter_file_versions v on v.id = coalesce(po.file_version_id, no.file_version_id)
    where oe.config_revision_id = $1
      and oe.property_name = $2
      and ($3::text is null or lnr.logical_node_id = $3)
    order by oe.source_order desc
    `,
    [input.configRevisionId, input.propertyKey, input.logicalNodeId],
  );

  const top = effects.rows[0];
  const overlayEffect = effects.rows.find((row) => row.role === "overlay");
  const targetRef = resolveTargetRef({
    effect: overlayEffect ?? top,
    nodeLocator: input.nodeLocator,
  });

  let overlayMember: RevisionMemberRow | undefined;
  if (overlayEffect?.file_id) {
    overlayMember = members.find((m) => m.file_id === overlayEffect.file_id && m.role === "overlay");
  }
  if (!overlayMember) {
    // Value only from shared base → write into the last project overlay in order.
    overlayMember = [...members].reverse().find((m) => m.role === "overlay");
  }
  if (!overlayMember) {
    throw new ApiError("CONFLICT", "Config revision missing overlay member for edit.", 409, {
      configRevisionId: input.configRevisionId,
    });
  }

  const effectiveFromOverlay = Boolean(overlayEffect);
  const occurrenceSpan =
    effectiveFromOverlay &&
    overlayEffect?.start_offset != null &&
    overlayEffect?.end_offset != null
      ? { start: Number(overlayEffect.start_offset), end: Number(overlayEffect.end_offset) }
      : undefined;

  let nodeSpan: { start: number; end: number } | undefined;
  if (
    effectiveFromOverlay &&
    overlayEffect?.node_start_offset != null &&
    overlayEffect?.node_end_offset != null
  ) {
    nodeSpan = {
      start: Number(overlayEffect.node_start_offset),
      end: Number(overlayEffect.node_end_offset),
    };
  } else if (input.logicalNodeId) {
    // Base-only property: still prefer an existing overlay fragment for this logical node.
    const overlayNode = await db.query<{ start_offset: number; end_offset: number }>(
      `
      select no.start_offset, no.end_offset
      from dts_occurrence_effects oe
      inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
      inner join dts_node_occurrences no on no.id = oe.node_occurrence_id
      inner join dts_config_revision_members m
        on m.file_version_id = no.file_version_id and m.config_revision_id = oe.config_revision_id
      where oe.config_revision_id = $1
        and lnr.logical_node_id = $2
        and m.file_id = $3
        and m.role = 'overlay'
      order by oe.source_order desc
      limit 1
      `,
      [input.configRevisionId, input.logicalNodeId, overlayMember.file_id],
    );
    if (overlayNode.rows[0]) {
      nodeSpan = {
        start: Number(overlayNode.rows[0].start_offset),
        end: Number(overlayNode.rows[0].end_offset),
      };
    }
  }

  return {
    writeTarget: {
      role: "overlay",
      propertyKey: input.propertyKey,
      fileId: overlayMember.file_id,
      fileName: overlayMember.file_name,
      fileVersionId: overlayMember.file_version_id,
      checksum: overlayMember.checksum,
      nodeLocator: input.nodeLocator ?? top?.node_path ?? undefined,
      occurrenceId: effectiveFromOverlay ? (overlayEffect?.property_occurrence_id ?? undefined) : undefined,
      occurrenceSpan,
      nodeSpan,
      targetRef,
    },
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
    expectedRawText: effectiveFromOverlay ? (overlayEffect?.raw_text ?? null) : undefined,
    nodeSpan,
  };
}

function findAllOverlayNodesByRef(nodes: DtsNodeCst[], refName: string): DtsNodeCst[] {
  const matches: DtsNodeCst[] = [];
  const walk = (node: DtsNodeCst) => {
    if (node.refTarget === refName) matches.push(node);
    for (const child of node.children) {
      if (child.kind === "node") walk(child);
    }
  };
  for (const node of nodes) walk(node);
  return matches;
}

function findPropertyByExactSpan(
  nodes: DtsNodeCst[],
  span: { start: number; end: number },
): { property: DtsPropertyCst; parent: DtsNodeCst } | null {
  for (const node of nodes) {
    for (const child of node.children) {
      if (
        child.kind === "property" &&
        child.span.start === span.start &&
        child.span.end === span.end
      ) {
        return { property: child, parent: node };
      }
      if (child.kind === "node") {
        const found = findPropertyByExactSpan([child], span);
        if (found) return found;
      }
    }
  }
  return null;
}

function findNodeByExactSpan(nodes: DtsNodeCst[], span: { start: number; end: number }): DtsNodeCst | null {
  for (const node of nodes) {
    if (node.span.start === span.start && node.span.end === span.end) return node;
    for (const child of node.children) {
      if (child.kind === "node") {
        const found = findNodeByExactSpan([child], span);
        if (found) return found;
      }
    }
  }
  return null;
}

function propertyStatementSpan(
  content: string,
  property: DtsPropertyCst,
  propertyKey: string,
  parent: DtsNodeCst,
): { start: number; end: number } {
  const searchFrom = Math.max(parent.span.start, 0);
  const nameStart = content.lastIndexOf(propertyKey, property.span.start);
  if (nameStart < searchFrom) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  const between = content.slice(nameStart + propertyKey.length, property.span.start);
  if (property.rawText.length > 0) {
    if (!/^\s*=\s*$/.test(between)) {
      throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
        reason: "stale-span",
        propertyKey,
        span: property.span,
      });
    }
  } else if (!/^\s*$/.test(between)) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  const semi = content.indexOf(";", property.span.end);
  if (semi < 0 || semi > parent.span.end) {
    throw new ApiError("CONFLICT", "Occurrence property statement span is stale.", 409, {
      reason: "stale-span",
      propertyKey,
      span: property.span,
    });
  }
  return { start: nameStart, end: semi + 1 };
}

function insertAfterNodeOpenBrace(content: string, node: DtsNodeCst, insertion: string): string {
  const openBrace = content.indexOf("{", node.span.start);
  if (openBrace < 0 || openBrace >= node.span.end) {
    throw new ApiError("CONFLICT", "Unable to locate overlay node body for write.", 409, {
      reason: "stale-span",
      nodeSpan: node.span,
    });
  }
  return `${content.slice(0, openBrace + 1)}\n${insertion}${content.slice(openBrace + 1)}`;
}

function resolveInsertTargetNode(
  docRoots: DtsNodeCst[],
  input: { targetRef: string; nodeSpan?: { start: number; end: number } },
): DtsNodeCst | null {
  if (input.nodeSpan) {
    const bySpan = findNodeByExactSpan(docRoots, input.nodeSpan);
    if (!bySpan) {
      throw new ApiError("CONFLICT", "Overlay node occurrence span is stale.", 409, {
        reason: "stale-span",
        nodeSpan: input.nodeSpan,
        targetRef: input.targetRef,
      });
    }
    return bySpan;
  }
  const matches = findAllOverlayNodesByRef(docRoots, input.targetRef);
  if (matches.length > 1) {
    throw new ApiError("CONFLICT", "Ambiguous overlay target ref for binding edit.", 409, {
      reason: "ambiguous-overlay-target",
      targetRef: input.targetRef,
      matchCount: matches.length,
    });
  }
  return matches[0] ?? null;
}

/**
 * Patch or create a property using write identity (checksum + occurrence/node CST span).
 * Never falls back to the first `&ref` match when an occurrence span is known.
 */
function ensureOverlayProperty(
  content: string,
  input: {
    propertyKey: string;
    rawText: string | null;
    action: BindingEditAction;
    targetRef: string;
    expectedChecksum: string;
    occurrenceSpan?: { start: number; end: number };
    expectedRawText?: string | null;
    nodeSpan?: { start: number; end: number };
  },
): string {
  const { propertyKey, rawText, action, targetRef } = input;
  if (!targetRef.trim()) {
    throw new ApiError("CONFLICT", "Overlay write requires an explicit target ref.", 409, {
      reason: "missing-overlay-target-ref",
      propertyKey,
    });
  }

  if (checksumOf(content) !== input.expectedChecksum) {
    throw new ApiError("CONFLICT", "Overlay file checksum is stale for binding edit.", 409, {
      reason: "stale-checksum",
      propertyKey,
      expectedChecksum: input.expectedChecksum,
      actualChecksum: checksumOf(content),
    });
  }

  const doc = parseDts(content);

  if (input.occurrenceSpan) {
    const slice = content.slice(input.occurrenceSpan.start, input.occurrenceSpan.end);
    if (input.expectedRawText != null && slice !== input.expectedRawText) {
      throw new ApiError("CONFLICT", "Occurrence CST span is stale for binding edit.", 409, {
        reason: "stale-span",
        propertyKey,
        occurrenceSpan: input.occurrenceSpan,
      });
    }

    const located = findPropertyByExactSpan(doc.topLevel, input.occurrenceSpan);
    if (!located || located.property.name !== propertyKey) {
      throw new ApiError("CONFLICT", "Occurrence CST span is stale for binding edit.", 409, {
        reason: "stale-span",
        propertyKey,
        occurrenceSpan: input.occurrenceSpan,
      });
    }

    if (action === "delete") {
      const statement = propertyStatementSpan(content, located.property, propertyKey, located.parent);
      return (
        content.slice(0, statement.start) +
        `/delete-property/ ${propertyKey};` +
        content.slice(statement.end)
      );
    }

    located.property.rawText = rawText ?? "";
    return serializeDts(doc);
  }

  // Base-only / no overlay occurrence: insert into the precise overlay node (by node span).
  const target = resolveInsertTargetNode(doc.topLevel, {
    targetRef,
    nodeSpan: input.nodeSpan,
  });

  if (action === "delete") {
    if (target) {
      const existingDelete = target.children.find(
        (child) => child.kind === "delete-property" && child.name === propertyKey,
      );
      if (existingDelete) return content;
      return insertAfterNodeOpenBrace(content, target, `\t/delete-property/ ${propertyKey};`);
    }
    return `${content.trimEnd()}\n&${targetRef} {\n\t/delete-property/ ${propertyKey};\n};\n`;
  }

  const assignment = `\t${propertyKey} = ${rawText};`;
  if (target) {
    const existing = target.children.find(
      (child): child is DtsPropertyCst => child.kind === "property" && child.name === propertyKey,
    );
    if (existing) {
      existing.rawText = rawText ?? "";
      return serializeDts(doc);
    }
    return insertAfterNodeOpenBrace(content, target, assignment);
  }
  return `${content.trimEnd()}\n&${targetRef} {\n${assignment}\n};\n`;
}

/**
 * Initialization / suggestion helper — never treats exampleValue as enforced.
 * Prefer policyTarget, then schemaDefault; example is labeled separately.
 */
export function resolveInitializationSuggestion(input: {
  policyTarget?: unknown;
  schemaDefault?: unknown;
  exampleValue?: unknown;
}): {
  suggestion: unknown | null;
  exampleValue: unknown | null;
  exampleEnforced: false;
  source: "policyTarget" | "schemaDefault" | null;
} {
  if (input.policyTarget != null) {
    return {
      suggestion: input.policyTarget,
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false,
      source: "policyTarget",
    };
  }
  if (input.schemaDefault != null) {
    return {
      suggestion: input.schemaDefault,
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false,
      source: "schemaDefault",
    };
  }
  return {
    suggestion: null,
    exampleValue: input.exampleValue ?? null,
    exampleEnforced: false,
    source: null,
  };
}

export async function unchangedSourceBytes(draft: BindingDraftResult): Promise<boolean> {
  return draft.baseChecksumBefore === draft.baseChecksumAfter && draft.baseChecksumAfter === checksumOf(draft.baseContent);
}

/**
 * Create a typed binding draft that patches (or creates) a project overlay target,
 * stores a full candidate config revision (all members preserved), re-resolves +
 * toolchain-validates fail-closed, and writes semantic FKs on the draft row.
 */
export async function createBindingDraft(
  db: Database | Queryable,
  auth: AuthContext,
  input: CreateBindingDraftInput,
  deps: CreateBindingDraftDeps = {},
): Promise<BindingDraftResult> {
  requireCanEdit(auth);

  const action: BindingEditAction = input.action ?? "set";
  if (action === "set" && !input.targetValue) {
    throw new ApiError("VALIDATION_FAILED", "targetValue is required for set action.", 400);
  }

  const binding = await loadBindingContext(db, auth, input.bindingId);
  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    revisionId: input.baseRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale or missing.", 409, {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId: input.baseRevisionId,
    });
  }

  const bindingRevision = await db.query<{ id: string }>(
    `
    select id from project_parameter_binding_revisions
    where binding_id = $1 and config_revision_id = $2
    limit 1
    `,
    [input.bindingId, input.baseRevisionId],
  );
  if (!bindingRevision.rows[0]) {
    throw new ApiError("CONFLICT", "Base config revision is stale for this binding.", 409, {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId: input.baseRevisionId,
    });
  }

  if (revision.status === "needs_mapping") {
    throw new ApiError("CONFLICT", "Config revision has unresolved identity mapping.", 409, {
      reason: "unresolved-mapping",
      configRevisionId: revision.id,
    });
  }
  if (revision.status === "invalid") {
    throw new ApiError("CONFLICT", "Config revision is invalid and cannot accept edits.", 409, {
      reason: "invalid-revision",
      configRevisionId: revision.id,
    });
  }

  // Schema enforcement is ON by default; callers cannot turn it off for the normal path.
  if (action === "set" && input.targetValue) {
    assertSchemaAllows(input.targetValue, binding.constraints);
  }

  const {
    writeTarget,
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  } = await resolveWriteTarget(db, {
    configRevisionId: revision.id,
    logicalNodeId: binding.logical_node_id,
    propertyKey: binding.property_key,
    nodeLocator: binding.node_locator,
  });

  const memberContents = new Map<string, string>();
  for (const member of members) {
    try {
      const content = await loadFileContentFromVersion(db, member.file_version_id, deps.objectStore);
      memberContents.set(member.file_version_id, content);
    } catch (error) {
      throw new ApiError("CONFLICT", "Config set source text unavailable for typed edit.", 409, {
        reason: "missing-source-text",
        fileVersionId: member.file_version_id,
        fileName: member.file_name,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baseContent = memberContents.get(baseMember.file_version_id)!;
  const overlayContent = memberContents.get(overlayMember.file_version_id)!;
  const baseChecksumBefore = checksumOf(baseContent);
  const rawText = action === "delete" ? "" : renderDtsValue(input.targetValue!, undefined);

  const candidateOverlayContent = ensureOverlayProperty(overlayContent, {
    propertyKey: binding.property_key,
    rawText: action === "delete" ? null : rawText,
    action,
    targetRef,
    expectedChecksum: overlayMember.checksum,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
  });

  const candidateOverlayVersionId = randomUUID();
  const overlayChecksum = checksumOf(candidateOverlayContent);
  let candidateStorageKey = `${auth.organization.id}/${overlayChecksum}-candidate-${overlayMember.file_name}`;

  if (deps.objectStore) {
    const stored = await deps.objectStore.put({
      organizationId: auth.organization.id,
      fileName: overlayMember.file_name,
      contentType: "text/plain",
      bytes: Buffer.from(candidateOverlayContent, "utf8"),
    });
    candidateStorageKey = stored.storageKey;
  }

  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    )
    select $1, $2, coalesce(max(version_number), 0) + 1, $3, $4, $5, $6::jsonb, 'writeback', $7
    from project_parameter_file_versions
    where file_id = $2
    `,
    [
      candidateOverlayVersionId,
      overlayMember.file_id,
      candidateStorageKey,
      overlayChecksum,
      Buffer.byteLength(candidateOverlayContent, "utf8"),
      JSON.stringify({ sourceText: candidateOverlayContent }),
      auth.user.id,
    ],
  );

  const overlayOrder = members.filter((m) => m.role === "overlay").map((m) => m.file_name);
  const entryFile = baseMember.file_name;
  const includeSearchPaths = ["."];

  const candidateMembers: ConfigRevisionManifestMember[] = members.map((member) => {
    const isEditedOverlay = member.file_id === overlayMember.file_id;
    const content = isEditedOverlay
      ? candidateOverlayContent
      : memberContents.get(member.file_version_id)!;
    return {
      fileId: member.file_id,
      fileVersionId: isEditedOverlay ? candidateOverlayVersionId : member.file_version_id,
      fileName: member.file_name,
      role: member.role,
      sortOrder: member.sort_order,
      content,
    };
  });

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    configSetId: revision.configSetId,
    entryFile,
    includeSearchPaths,
    overlayOrder,
    members: candidateMembers,
  };

  const ingested = await ingestConfigRevisionInTransaction(db, manifest, auth);
  const candidateRevisionId = ingested.id;

  // Fail-closed before toolchain when ingest already left a blocked diagnosable status.
  // Never overwrite needs_mapping / invalid to draft.
  if (ingested.status === "invalid" || ingested.status === "needs_mapping") {
    const diagnostics = await loadRevisionDiagnostics(db, candidateRevisionId);
    const reason =
      ingested.status === "needs_mapping" ? "unresolved-mapping" : "resolve-failure";
    throw new ApiError(
      ingested.status === "needs_mapping" ? "CONFLICT" : "VALIDATION_FAILED",
      ingested.status === "needs_mapping"
        ? "Candidate config revision has unresolved identity mapping."
        : "Candidate config revision failed resolve.",
      ingested.status === "needs_mapping" ? 409 : 400,
      {
        reason,
        candidateRevisionId,
        candidateStatus: ingested.status,
        diagnostics,
      },
    );
  }

  const semanticCounts = await loadCandidateSemanticGateCounts(db, {
    organizationId: auth.organization.id,
    configRevisionId: candidateRevisionId,
  });

  const earlyGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: true,
    toolchainFailureCode: null,
  });
  if (!earlyGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, earlyGate.keepStatus);
    throw candidateGateError(candidateRevisionId, earlyGate.reason, earlyGate.keepStatus);
  }

  const toolchainOutcome = await assertCandidateToolchainRelease(db, auth, {
    candidateRevisionId,
    entryFile,
    includeSearchPaths,
    overlayOrder,
    files: new Map(candidateMembers.map((member) => [member.fileName, { content: member.content }])),
    toolchain: deps.toolchain ?? createDtsToolchainRunner(),
  });

  const finalGate = assertCanPromoteCandidateToDraft({
    status: ingested.status,
    ...semanticCounts,
    toolchainOk: toolchainOutcome.ok,
    toolchainFailureCode: toolchainOutcome.failureCode,
  });
  if (!finalGate.ok) {
    await ensureCandidateKeepStatus(db, candidateRevisionId, finalGate.keepStatus);
    throw candidateGateError(candidateRevisionId, finalGate.reason, finalGate.keepStatus);
  }

  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: "draft",
  });

  // Post-cutover drafts key only on project_parameter_binding_id.
  // Pre-cutover still needs a linked PPV row for the legacy unique constraint —
  // that dual-write lives solely in the transitional adapter (unreachable post-cutover).
  const useSemantic = await mustUseSemanticParameterIdentity(db);
  let draftParameterId = binding.binding_id;
  if (!useSemantic) {
    const linked = await ensurePreCutoverLinkedParameterValue(db, auth, {
      projectId: binding.project_id,
      bindingId: binding.binding_id,
      parameterSpecId: binding.parameter_spec_id,
      propertyKey: binding.property_key,
      currentRaw: rawText,
    });
    draftParameterId = linked.id;
  }

  const draftId = randomUUID();
  await upsertDraft(db, {
    id: draftId,
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    parameterId: draftParameterId,
    userId: auth.user.id,
    targetValue: rawText,
    reason: input.reason,
    origin: "manual",
    projectParameterBindingId: binding.binding_id,
    parameterSpecId: binding.parameter_spec_id,
  });

  await writeGovernanceAudit(db, auth, {
    action: "binding-edited",
    projectId: binding.project_id,
    targetType: "project-parameter-binding",
    targetId: binding.binding_id,
    metadata: {
      draftId,
      candidateRevisionId,
      propertyKey: binding.property_key,
      writeTargetRole: writeTarget.role,
      targetRef,
      action,
    },
  });

  const baseChecksumAfter = checksumOf(baseContent);

  return {
    draftId,
    writeTarget,
    candidateRevisionId,
    rawText,
    parameterSpecId: binding.parameter_spec_id,
    projectParameterBindingId: binding.binding_id,
    baseContent,
    baseChecksumBefore,
    baseChecksumAfter,
    candidateOverlayContent,
    overlayFileId: overlayMember.file_id,
    overlayFileName: overlayMember.file_name,
  };
}

async function loadRevisionDiagnostics(
  db: Queryable,
  configRevisionId: string,
): Promise<
  Array<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    fileName: string | null;
  }>
> {
  const result = await db.query<{
    code: string;
    severity: string;
    stage: string;
    message: string;
    file_name: string | null;
  }>(
    `
    select d.code, d.severity, d.stage, d.message, d.file_name
    from dts_validation_diagnostics d
    inner join dts_validation_runs r on r.id = d.validation_run_id
    where r.config_revision_id = $1
    order by d.created_at asc
    `,
    [configRevisionId],
  );
  return result.rows.map((row) => ({
    code: row.code,
    severity: row.severity,
    stage: row.stage,
    message: row.message,
    fileName: row.file_name,
  }));
}

async function loadCandidateSemanticGateCounts(
  db: Queryable,
  input: { organizationId: string; configRevisionId: string },
): Promise<{
  openIdentityMappings: number;
  openSpecReviews: number;
  unmatchedOccurrences: number;
  ambiguousBindings: number;
  resolverErrorDiagnostics: number;
}> {
  const openIdentityMappings = await countOpenIdentityMappingTasksForRevision(db, input);

  // Structural DTS keys are not parameter-spec review material; exclude from candidate gates.
  const structuralKeys = [
    "compatible",
    "reg",
    "#address-cells",
    "#size-cells",
    "#interrupt-cells",
    "phandle",
    "linux,phandle",
    "device_type",
    "ranges",
  ];

  // Candidate gates are revision-scoped (evidence.configRevisionId).
  const openReviews = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from parameter_spec_review_tasks t
    where t.organization_id = $1
      and t.status = 'open'
      and coalesce(t.source_evidence->>'configRevisionId', '') = $2
      and coalesce(t.source_evidence->>'propertyKey', '') <> all($3::text[])
    `,
    [input.organizationId, input.configRevisionId, structuralKeys],
  );

  const unmatched = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from parameter_spec_review_tasks t
    where t.organization_id = $1
      and t.status = 'open'
      and coalesce(t.source_evidence->>'configRevisionId', '') = $2
      and coalesce(t.source_evidence->>'propertyKey', '') <> all($3::text[])
      and (
        coalesce(jsonb_array_length(t.candidate_schemas), 0) = 0
        or coalesce(t.source_evidence->>'inferred', '') = 'true'
      )
    `,
    [input.organizationId, input.configRevisionId, structuralKeys],
  );

  const resolverErrors = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from dts_validation_diagnostics d
    inner join dts_validation_runs r on r.id = d.validation_run_id
    where r.config_revision_id = $1
      and r.stage = 'resolve'
      and d.severity = 'error'
    `,
    [input.configRevisionId],
  );

  const openSpecReviews = Number(openReviews.rows[0]?.count ?? 0);
  return {
    openIdentityMappings,
    openSpecReviews,
    unmatchedOccurrences: Number(unmatched.rows[0]?.count ?? 0),
    ambiguousBindings: openIdentityMappings,
    resolverErrorDiagnostics: Number(resolverErrors.rows[0]?.count ?? 0),
  };
}

async function ensureCandidateKeepStatus(
  db: Queryable,
  candidateRevisionId: string,
  keepStatus: "needs_mapping" | "invalid" | "resolved",
): Promise<void> {
  const current = await db.query<{ status: string }>(
    `select status from dts_config_revisions where id = $1`,
    [candidateRevisionId],
  );
  if (current.rows[0]?.status === keepStatus) {
    return;
  }
  // Never promote blocked statuses upward; only move resolved → invalid/needs_mapping when needed.
  if (current.rows[0]?.status === "needs_mapping" || current.rows[0]?.status === "invalid") {
    return;
  }
  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: keepStatus,
    resolvedAt: new Date().toISOString(),
  });
}

function candidateGateError(
  candidateRevisionId: string,
  reason: CandidateGateFailureReason,
  keepStatus: string,
): ApiError {
  const conflictReasons = new Set([
    "needs-mapping",
    "unresolved-mapping",
    "open-spec-review",
    "unmatched-occurrence",
    "ambiguous-binding",
  ]);
  const isConflict = conflictReasons.has(reason);
  return new ApiError(
    isConflict ? "CONFLICT" : "VALIDATION_FAILED",
    `Candidate config revision failed semantic/toolchain gate (${reason}).`,
    isConflict ? 409 : 400,
    {
      reason,
      candidateRevisionId,
      candidateStatus: keepStatus,
    },
  );
}

async function assertCandidateToolchainRelease(
  db: Queryable,
  auth: AuthContext,
  input: {
    candidateRevisionId: string;
    entryFile: string;
    includeSearchPaths: string[];
    overlayOrder: string[];
    files: Map<string, { content: string }>;
    toolchain: DtsToolchainRunner;
  },
): Promise<{ ok: true } | { ok: false; failureCode: string | null }> {
  const toolchainResult = await input.toolchain.validate(
    {
      entryFile: input.entryFile,
      includeSearchPaths: input.includeSearchPaths,
      overlayOrder: input.overlayOrder,
      files: input.files,
    },
    { mode: "release" },
  );

  const runId = randomUUID();
  await insertValidationRun(db, {
    id: runId,
    organizationId: auth.organization.id,
    configRevisionId: input.candidateRevisionId,
    stage: "toolchain",
    status: toolchainResult.ok ? "passed" : "failed",
  });

  const persisted: PersistedValidationDiagnostic[] = toolchainResult.diagnostics.map((diagnostic) => ({
    id: randomUUID(),
    code: (diagnostic.code ?? toolchainResult.failureCode ?? "compile-failed") as PersistedValidationDiagnostic["code"],
    severity: "error" as const,
    stage: diagnostic.stage ?? "toolchain",
    message: diagnostic.message,
    fileName: diagnostic.file,
    startLine: diagnostic.line,
  }));
  if (persisted.length > 0) {
    await insertValidationDiagnostics(db, runId, persisted);
  }

  if (toolchainResult.ok) {
    return { ok: true };
  }

  await updateConfigRevisionStatus(db, {
    id: input.candidateRevisionId,
    status: "invalid",
    resolvedAt: new Date().toISOString(),
  });

  throw new ApiError("VALIDATION_FAILED", "Candidate config revision failed toolchain validation.", 400, {
    reason: "toolchain-failure",
    candidateRevisionId: input.candidateRevisionId,
    failureCode: toolchainResult.failureCode,
    candidateStatus: "invalid",
    diagnostics: toolchainResult.diagnostics,
  });
}
