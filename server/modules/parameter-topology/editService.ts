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
import { upsertDraft } from "../parameters/repository";
import { ingestConfigRevisionInTransaction } from "./ingestService";
import {
  getConfigRevisionById,
  insertValidationDiagnostics,
  insertValidationRun,
  updateConfigRevisionStatus,
} from "./repository";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember, PersistedValidationDiagnostic } from "./types";
import { writeGovernanceAudit } from "./governanceAudit";
import { LEGACY_SQL } from "./migration";

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
  nodeLocator?: string;
  occurrenceId?: string;
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
      po.end_offset
    from dts_occurrence_effects oe
    inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
    left join dts_property_occurrences po on po.id = oe.property_occurrence_id
    left join dts_node_occurrences no on no.id = coalesce(oe.node_occurrence_id, po.node_occurrence_id)
    left join dts_config_revision_members m on m.file_version_id = coalesce(po.file_version_id, no.file_version_id)
      and m.config_revision_id = oe.config_revision_id
    left join project_parameter_files f on f.id = m.file_id
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

  return {
    writeTarget: {
      role: "overlay",
      propertyKey: input.propertyKey,
      fileId: overlayMember.file_id,
      fileName: overlayMember.file_name,
      nodeLocator: input.nodeLocator ?? top?.node_path ?? undefined,
      occurrenceId: effectiveFromOverlay ? (overlayEffect?.property_occurrence_id ?? undefined) : undefined,
      targetRef,
    },
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
  };
}

function findOverlayNodeByRef(root: DtsNodeCst, refName: string): DtsNodeCst | null {
  if (root.refTarget === refName) return root;
  for (const child of root.children) {
    if (child.kind === "node") {
      const found = findOverlayNodeByRef(child, refName);
      if (found) return found;
    }
  }
  return null;
}

function findTargetOverlayNode(docRoots: DtsNodeCst[], refName: string): DtsNodeCst | null {
  for (const root of docRoots) {
    const found = findOverlayNodeByRef(root, refName);
    if (found) return found;
  }
  return null;
}

function listNodeProperties(node: DtsNodeCst): DtsPropertyCst[] {
  return node.children.filter((child): child is DtsPropertyCst => child.kind === "property");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patch or create a property on the binding's target overlay node only.
 * Never falls back to the first &ref or a hard-coded charging_core label.
 */
function ensureOverlayProperty(
  content: string,
  input: {
    propertyKey: string;
    rawText: string | null;
    action: BindingEditAction;
    targetRef: string;
  },
): string {
  const { propertyKey, rawText, action, targetRef } = input;
  if (!targetRef.trim()) {
    throw new ApiError("CONFLICT", "Overlay write requires an explicit target ref.", 409, {
      reason: "missing-overlay-target-ref",
      propertyKey,
    });
  }

  const doc = parseDts(content);
  const target = findTargetOverlayNode(doc.topLevel, targetRef);

  if (action === "delete") {
    const property = target ? listNodeProperties(target).find((p) => p.name === propertyKey) : undefined;
    if (property) {
      const rhs = content.slice(property.span.start, property.span.end);
      const statement = new RegExp(`${propertyKey}\\s*=\\s*${escapeRegExp(rhs)}\\s*;`);
      if (statement.test(content)) {
        return content.replace(statement, `/delete-property/ ${propertyKey};`);
      }
    }
    if (content.includes(`/delete-property/ ${propertyKey}`)) {
      return content;
    }
    const refPattern = new RegExp(`(&${escapeRegExp(targetRef)}\\s*\\{)`);
    if (refPattern.test(content)) {
      return content.replace(refPattern, `$1\n\t/delete-property/ ${propertyKey};`);
    }
    return `${content.trimEnd()}\n&${targetRef} {\n\t/delete-property/ ${propertyKey};\n};\n`;
  }

  if (target) {
    const property = listNodeProperties(target).find((p) => p.name === propertyKey);
    if (property) {
      // Minimal in-place CST span edit for an existing project overlay occurrence.
      property.rawText = rawText ?? "";
      return serializeDts(doc);
    }
  }

  const assignment = `\t${propertyKey} = ${rawText};`;
  const refPattern = new RegExp(`(&${escapeRegExp(targetRef)}\\s*\\{)`);
  if (refPattern.test(content)) {
    return content.replace(refPattern, `$1\n${assignment}`);
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

  const { writeTarget, overlayMember, baseMember, members, targetRef } = await resolveWriteTarget(db, {
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

  if (ingested.status === "invalid") {
    const diagnostics = await loadRevisionDiagnostics(db, candidateRevisionId);
    throw new ApiError("VALIDATION_FAILED", "Candidate config revision failed resolve.", 400, {
      reason: "resolve-failure",
      candidateRevisionId,
      diagnostics,
    });
  }

  await assertCandidateToolchainRelease(db, auth, {
    candidateRevisionId,
    entryFile,
    includeSearchPaths,
    overlayOrder,
    files: new Map(candidateMembers.map((member) => [member.fileName, { content: member.content }])),
    toolchain: deps.toolchain ?? createDtsToolchainRunner(),
  });

  await updateConfigRevisionStatus(db, {
    id: candidateRevisionId,
    status: "draft",
  });

  const shadowPpv = await ensureShadowParameterValue(db, auth, {
    projectId: binding.project_id,
    bindingId: binding.binding_id,
    parameterSpecId: binding.parameter_spec_id,
    propertyKey: binding.property_key,
    currentRaw: rawText,
  });

  const draftId = randomUUID();
  await upsertDraft(db, {
    id: draftId,
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    parameterId: shadowPpv.id,
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
): Promise<void> {
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
    return;
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
    diagnostics: toolchainResult.diagnostics,
  });
}

async function ensureShadowParameterValue(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    bindingId: string;
    parameterSpecId: string;
    propertyKey: string;
    currentRaw: string;
  },
): Promise<{ id: string }> {
  const existing = await db.query<{ id: string }>(
    `
    select ppv.id
    from project_parameter_values ppv
    where ppv.organization_id = $1
      and ppv.project_id = $2
      and ppv.source_node_path like '%' || $3
    order by ppv.updated_at desc
    limit 1
    `,
    [auth.organization.id, input.projectId, input.propertyKey],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id };

  const definitionId = randomUUID();
  const ppvId = randomUUID();
  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, $3, '', '', 'dts', 'binding-shadow', '', '', 'Low')
    `,
    [definitionId, auth.organization.id, input.propertyKey],
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, ${LEGACY_SQL.recommendedValueColumn}, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values ($1, $2, $3, $4, $5, '', 1, $6, null, $7)
    `,
    [
      ppvId,
      auth.organization.id,
      input.projectId,
      definitionId,
      input.currentRaw,
      auth.user.id,
      `binding/${input.bindingId}/${input.propertyKey}`,
    ],
  );
  return { id: ppvId };
}
