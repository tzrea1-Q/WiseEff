/**
 * Binding / node-enablement write locks: resolve exact writeback identity
 * (file version, checksum, occurrence/node CST span, target ref) at a config
 * revision head, and fail-closed verification of persisted locks before
 * merge/writeback. Shared write-target resolution lives here so the draft
 * (editService) and writeback (overlayWriteback) layers depend downward only.
 */

import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { BindingWriteLockFields, EnablementWriteLockFields } from "../parameter-drafts/types";
import { getConfigRevisionById } from "./repository";

export type BindingDraftWriteTarget = {
  /** `base` when the project-primary DTS is the sole config member; `overlay` for legacy base+overlay sets. */
  role: "base" | "overlay" | "project-occurrence";
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

export type BindingWriteLockContext = BindingWriteLockFields & {
  propertyKey: string;
  targetRef: string;
  /** Server-resolved logical node locator used for exact sensitive-rule lookup. */
  sourceNodePath: string;
  /** Compatible from the exact logical-node revision pinned by baseConfigRevisionId. */
  compatible: string | null;
  expectedRawText?: string | null;
  nodeSpan?: { start: number; end: number };
  overlayFileId: string;
  overlayFileName: string;
  overlayFileVersionId: string;
};

export type EnablementWriteLockContext = EnablementWriteLockFields & {
  propertyKey: "status";
  targetRef: string;
  /** Server-resolved logical node locator used for exact sensitive-rule lookup. */
  sourceNodePath: string;
  /** Compatible from the exact logical-node revision pinned by baseConfigRevisionId. */
  compatible: string | null;
  expectedRawText?: string | null;
  nodeSpan?: { start: number; end: number };
  overlayFileId: string;
  overlayFileName: string;
  overlayFileVersionId: string;
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

function canonicalizeLogicalNodeCompatible(value: string | null): string | null {
  const quotedCompatible = value?.match(/"((?:\\.|[^"\\])*)"/);
  return quotedCompatible ? quotedCompatible[1]! : (value?.trim() || null);
}

export async function loadBindingContext(
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
    throw new ApiError("NOT_FOUND", "Project parameter binding was not found.", { bindingId });
  }
  return row;
}

export async function loadRevisionMembers(
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

  throw new ApiError("CONFLICT", "Unable to resolve overlay target ref for binding edit.", {
    reason: "missing-overlay-target-ref",
    nodeLocator: input.nodeLocator,
    nodePath: input.effect?.node_path ?? null,
  });
}

/**
 * Resolve effective write target for a property.
 *
 * - Multi-member config sets: prefer overlay effects; base-only values patch the
 *   project overlay (legacy base + overlay seed shape).
 * - Project-primary config sets (sole `base` member): patch that primary DTS
 *   file directly — the product writeback target per project-primary RFC.
 */
export async function resolveWriteTarget(
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
    throw new ApiError("CONFLICT", "Config revision missing base member for edit.", {
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
  const hasOverlayMember = members.some((member) => member.role === "overlay");
  const overlayEffect = effects.rows.find((row) => row.role === "overlay");
  const baseEffect = effects.rows.find((row) => row.role === "base");
  const writeEffect = hasOverlayMember ? (overlayEffect ?? top) : (baseEffect ?? top);
  const targetRef = resolveTargetRef({
    effect: writeEffect,
    nodeLocator: input.nodeLocator,
  });

  let overlayMember: RevisionMemberRow | undefined;
  if (hasOverlayMember) {
    if (overlayEffect?.file_id) {
      overlayMember = members.find((m) => m.file_id === overlayEffect.file_id && m.role === "overlay");
    }
    if (!overlayMember) {
      // Value only from shared base → write into the last project overlay in order.
      overlayMember = [...members].reverse().find((m) => m.role === "overlay");
    }
  } else {
    overlayMember = baseMember;
  }
  if (!overlayMember) {
    throw new ApiError("CONFLICT", "Config revision missing writable DTS member for edit.", {
      configRevisionId: input.configRevisionId,
    });
  }

  const effectiveFromOverlay = hasOverlayMember ? Boolean(overlayEffect) : Boolean(baseEffect ?? top);
  const occurrenceSpan =
    effectiveFromOverlay &&
    writeEffect?.start_offset != null &&
    writeEffect?.end_offset != null
      ? { start: Number(writeEffect.start_offset), end: Number(writeEffect.end_offset) }
      : undefined;

  let nodeSpan: { start: number; end: number } | undefined;
  if (
    effectiveFromOverlay &&
    writeEffect?.node_start_offset != null &&
    writeEffect?.node_end_offset != null
  ) {
    nodeSpan = {
      start: Number(writeEffect.node_start_offset),
      end: Number(writeEffect.node_end_offset),
    };
  } else if (input.logicalNodeId) {
    const writeMemberRole = hasOverlayMember ? "overlay" : "base";
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
        and m.role = $4
      order by oe.source_order desc
      limit 1
      `,
      [input.configRevisionId, input.logicalNodeId, overlayMember.file_id, writeMemberRole],
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
      role: hasOverlayMember ? "overlay" : "base",
      propertyKey: input.propertyKey,
      fileId: overlayMember.file_id,
      fileName: overlayMember.file_name,
      fileVersionId: overlayMember.file_version_id,
      checksum: overlayMember.checksum,
      nodeLocator: input.nodeLocator ?? top?.node_path ?? undefined,
      occurrenceId: effectiveFromOverlay ? (writeEffect?.property_occurrence_id ?? undefined) : undefined,
      occurrenceSpan,
      nodeSpan,
      targetRef,
    },
    overlayMember,
    baseMember,
    members,
    targetRef,
    occurrenceSpan,
    expectedRawText: effectiveFromOverlay ? (writeEffect?.raw_text ?? null) : undefined,
    nodeSpan,
  };
}

export async function loadLogicalNodeEnablementContext(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    logicalNodeId: string;
  },
): Promise<{
  nodeLocator: string;
  compatible: string | null;
  currentRaw: string | null;
}> {
  const node = await db.query<{
    node_locator: string;
    compatible: string | null;
    logical_node_revision_id: string;
  }>(
    `
    select lnr.id as logical_node_revision_id, lnr.node_locator, lnr.compatible
    from dts_logical_node_revisions lnr
    inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
    inner join dts_config_set cs on cs.id = cr.config_set_id
    where lnr.config_revision_id = $1
      and lnr.logical_node_id = $2
      and cs.organization_id = $3
      and cs.project_id = $4
    limit 1
    `,
    [input.configRevisionId, input.logicalNodeId, input.organizationId, input.projectId],
  );
  const row = node.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "Logical node was not found in this config revision.", {
      logicalNodeId: input.logicalNodeId,
      configRevisionId: input.configRevisionId,
    });
  }

  const statusEffects = await db.query<{
    effect_kind: string;
    raw_text: string | null;
  }>(
    `
    select oe.effect_kind, po.raw_text
    from dts_occurrence_effects oe
    left join dts_property_occurrences po on po.id = oe.property_occurrence_id
    where oe.config_revision_id = $1
      and oe.logical_node_revision_id = $2
      and oe.property_name = 'status'
    order by oe.source_order asc
    `,
    [input.configRevisionId, row.logical_node_revision_id],
  );

  let currentRaw: string | null = null;
  for (const effect of statusEffects.rows) {
    if (effect.effect_kind === "delete") {
      currentRaw = null;
    } else {
      currentRaw = effect.raw_text;
    }
  }

  return {
    nodeLocator: row.node_locator,
    compatible: canonicalizeLogicalNodeCompatible(row.compatible),
    currentRaw,
  };
}

/**
 * Resolve sensitive-rule match inputs from one exact logical-node revision.
 * Callers must supply the server-owned config revision carried by the binding
 * head or persisted draft; this deliberately has no "latest" fallback.
 */
export async function loadLogicalNodeSubmissionContext(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    configRevisionId: string;
    logicalNodeId: string;
  },
): Promise<{ nodeLocator: string; compatible: string | null }> {
  const result = await db.query<{ node_locator: string; compatible: string | null }>(
    `
    select lnr.node_locator, lnr.compatible
    from dts_logical_node_revisions lnr
    inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
    inner join dts_config_set cs on cs.id = cr.config_set_id
    where lnr.config_revision_id = $1
      and lnr.logical_node_id = $2
      and cs.organization_id = $3
      and cs.project_id = $4
    limit 1
    `,
    [input.configRevisionId, input.logicalNodeId, input.organizationId, input.projectId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "Logical node was not found in this config revision.", {
      logicalNodeId: input.logicalNodeId,
      configRevisionId: input.configRevisionId,
    });
  }
  return {
    nodeLocator: row.node_locator,
    compatible: canonicalizeLogicalNodeCompatible(row.compatible),
  };
}

/**
 * Newest non-`resolving` config revision that carries a binding revision for this
 * binding — the base a fresh typed draft should target when the caller has no
 * explicit revision (workbench-less callers such as the Xiaoze action tool).
 */
export async function resolveBindingHeadRevisionId(
  db: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string },
): Promise<string | undefined> {
  const head = await db.query<{ config_revision_id: string }>(
    `
    select bpr.config_revision_id
    from project_parameter_binding_revisions bpr
    inner join project_parameter_bindings b on b.id = bpr.binding_id
    inner join dts_config_revisions cr on cr.id = bpr.config_revision_id
    inner join dts_logical_node_revisions lnr
      on lnr.config_revision_id = bpr.config_revision_id
     and lnr.logical_node_id = b.logical_node_id
    where bpr.binding_id = $1
      and cr.organization_id = $2
      and cr.project_id = $3
      and cr.status <> 'resolving'
    order by cr.revision_number desc
    limit 1
    `,
    [input.bindingId, input.organizationId, input.projectId],
  );
  return head.rows[0]?.config_revision_id;
}

/** Resolve exact writeback lock metadata for a binding at a config revision head. */
export async function resolveBindingWriteLock(
  db: Queryable,
  auth: AuthContext,
  input: { bindingId: string; baseRevisionId?: string },
): Promise<BindingWriteLockContext> {
  const binding = await loadBindingContext(db, auth, input.bindingId);

  const baseRevisionId =
    input.baseRevisionId ??
    (await resolveBindingHeadRevisionId(db, {
      organizationId: auth.organization.id,
      projectId: binding.project_id,
      bindingId: input.bindingId,
    }));
  if (!baseRevisionId) {
    throw new ApiError("CONFLICT", "No config revision is available for binding write lock.", {
      reason: "stale-revision",
      bindingId: input.bindingId,
    });
  }

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    revisionId: baseRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale or missing.", {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId,
    });
  }

  if (!binding.logical_node_id) {
    throw new ApiError("CONFLICT", "Binding has no logical node identity for write lock.", {
      reason: "missing-logical-node",
      bindingId: input.bindingId,
      baseRevisionId,
    });
  }
  const logicalNode = await loadLogicalNodeSubmissionContext(db, {
    organizationId: auth.organization.id,
    projectId: binding.project_id,
    configRevisionId: baseRevisionId,
    logicalNodeId: binding.logical_node_id,
  });

  const bindingRevision = await db.query<{ id: string }>(
    `
    select id from project_parameter_binding_revisions
    where binding_id = $1 and config_revision_id = $2
    limit 1
    `,
    [input.bindingId, baseRevisionId],
  );
  if (!bindingRevision.rows[0]) {
    throw new ApiError("CONFLICT", "Base config revision is stale for this binding.", {
      reason: "stale-revision",
      bindingId: input.bindingId,
      baseRevisionId,
    });
  }

  const {
    writeTarget,
    overlayMember,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
    targetRef,
  } = await resolveWriteTarget(db, {
    configRevisionId: baseRevisionId,
    logicalNodeId: binding.logical_node_id,
    propertyKey: binding.property_key,
    nodeLocator: logicalNode.nodeLocator,
  });

  if (!writeTarget.fileVersionId || !writeTarget.checksum) {
    throw new ApiError("CONFLICT", "Write target file version is incomplete for binding lock.", {
      reason: "missing-write-target",
      bindingId: input.bindingId,
    });
  }

  return {
    baseConfigRevisionId: baseRevisionId,
    bindingRevisionId: bindingRevision.rows[0].id,
    propertyOccurrenceId: writeTarget.occurrenceId ?? null,
    sourceFileVersionId: writeTarget.fileVersionId,
    expectedChecksum: writeTarget.checksum,
    occurrenceSpan: occurrenceSpan ?? writeTarget.occurrenceSpan ?? null,
    propertyKey: binding.property_key,
    targetRef,
    sourceNodePath: logicalNode.nodeLocator,
    compatible: logicalNode.compatible,
    expectedRawText,
    nodeSpan,
    overlayFileId: overlayMember.file_id,
    overlayFileName: overlayMember.file_name,
    overlayFileVersionId: overlayMember.file_version_id,
  };
}

/** Fail-closed verification of persisted write lock before merge/writeback. */
export async function verifyBindingWriteLock(
  db: Queryable,
  lock: BindingWriteLockFields,
): Promise<void> {
  const bindingRevision = await db.query<{ id: string; config_revision_id: string }>(
    `
    select id, config_revision_id
    from project_parameter_binding_revisions
    where id = $1
    limit 1
    `,
    [lock.bindingRevisionId],
  );
  const revisionRow = bindingRevision.rows[0];
  if (!revisionRow || revisionRow.config_revision_id !== lock.baseConfigRevisionId) {
    throw new ApiError("CONFLICT", "Binding revision lock is stale.", {
      reason: "stale-binding-revision",
      bindingRevisionId: lock.bindingRevisionId,
    });
  }

  const fileVersion = await db.query<{ id: string; checksum: string }>(
    `
    select id, checksum
    from project_parameter_file_versions
    where id = $1
    limit 1
    `,
    [lock.sourceFileVersionId],
  );
  const fileRow = fileVersion.rows[0];
  if (!fileRow || fileRow.checksum !== lock.expectedChecksum) {
    throw new ApiError("CONFLICT", "Source file checksum lock is stale.", {
      reason: "stale-checksum",
      sourceFileVersionId: lock.sourceFileVersionId,
      expectedChecksum: lock.expectedChecksum,
      actualChecksum: fileRow?.checksum,
    });
  }

  if (lock.propertyOccurrenceId) {
    const occurrence = await db.query<{
      id: string;
      start_offset: number;
      end_offset: number;
      file_version_id: string;
    }>(
      `
      select id, start_offset, end_offset, file_version_id
      from dts_property_occurrences
      where id = $1
      limit 1
      `,
      [lock.propertyOccurrenceId],
    );
    const occ = occurrence.rows[0];
    if (!occ || occ.file_version_id !== lock.sourceFileVersionId) {
      throw new ApiError("CONFLICT", "Property occurrence lock is stale.", {
        reason: "stale-occurrence",
        propertyOccurrenceId: lock.propertyOccurrenceId,
      });
    }
    if (lock.occurrenceSpan) {
      if (
        Number(occ.start_offset) !== lock.occurrenceSpan.start ||
        Number(occ.end_offset) !== lock.occurrenceSpan.end
      ) {
        throw new ApiError("CONFLICT", "Occurrence CST span lock is stale.", {
          reason: "stale-span",
          propertyOccurrenceId: lock.propertyOccurrenceId,
          occurrenceSpan: lock.occurrenceSpan,
        });
      }
    }
  }
}

/** Fail-closed verification of persisted enablement write lock before merge/writeback. */
export async function verifyEnablementWriteLock(
  db: Queryable,
  lock: {
    baseConfigRevisionId: string;
    propertyOccurrenceId?: string | null;
    sourceFileVersionId: string;
    expectedChecksum: string;
    occurrenceSpan?: { start: number; end: number } | null;
  },
): Promise<void> {
  const fileVersion = await db.query<{ id: string; checksum: string }>(
    `
    select id, checksum
    from project_parameter_file_versions
    where id = $1
    limit 1
    `,
    [lock.sourceFileVersionId],
  );
  const fileRow = fileVersion.rows[0];
  if (!fileRow || fileRow.checksum !== lock.expectedChecksum) {
    throw new ApiError("CONFLICT", "Source file checksum lock is stale.", {
      reason: "stale-checksum",
      sourceFileVersionId: lock.sourceFileVersionId,
      expectedChecksum: lock.expectedChecksum,
      actualChecksum: fileRow?.checksum,
    });
  }

  if (lock.propertyOccurrenceId) {
    const occurrence = await db.query<{
      id: string;
      start_offset: number;
      end_offset: number;
      file_version_id: string;
    }>(
      `
      select id, start_offset, end_offset, file_version_id
      from dts_property_occurrences
      where id = $1
      limit 1
      `,
      [lock.propertyOccurrenceId],
    );
    const occ = occurrence.rows[0];
    if (!occ || occ.file_version_id !== lock.sourceFileVersionId) {
      throw new ApiError("CONFLICT", "Property occurrence lock is stale.", {
        reason: "stale-occurrence",
        propertyOccurrenceId: lock.propertyOccurrenceId,
      });
    }
    if (lock.occurrenceSpan) {
      if (
        Number(occ.start_offset) !== lock.occurrenceSpan.start ||
        Number(occ.end_offset) !== lock.occurrenceSpan.end
      ) {
        throw new ApiError("CONFLICT", "Occurrence CST span lock is stale.", {
          reason: "stale-span",
          propertyOccurrenceId: lock.propertyOccurrenceId,
          occurrenceSpan: lock.occurrenceSpan,
        });
      }
    }
  }
}

/** Resolve exact writeback lock metadata for node enablement at a config revision head. */
export async function resolveEnablementWriteLock(
  db: Queryable,
  auth: AuthContext,
  input: { logicalNodeId: string; baseRevisionId?: string },
): Promise<EnablementWriteLockContext> {
  const node = await db.query<{ project_id: string }>(
    `
    select project_id
    from dts_logical_nodes
    where id = $1 and organization_id = $2
    limit 1
    `,
    [input.logicalNodeId, auth.organization.id],
  );
  const projectId = node.rows[0]?.project_id;
  if (!projectId) {
    throw new ApiError("NOT_FOUND", "Logical node was not found for enablement write lock.", {
      logicalNodeId: input.logicalNodeId,
    });
  }

  let baseRevisionId = input.baseRevisionId;
  if (!baseRevisionId) {
    const head = await db.query<{ config_revision_id: string }>(
      `
      select lnr.config_revision_id
      from dts_logical_node_revisions lnr
      inner join dts_config_revisions cr on cr.id = lnr.config_revision_id
      where lnr.logical_node_id = $1
        and cr.organization_id = $2
        and cr.project_id = $3
        and cr.status <> 'resolving'
      order by cr.revision_number desc
      limit 1
      `,
      [input.logicalNodeId, auth.organization.id, projectId],
    );
    baseRevisionId = head.rows[0]?.config_revision_id;
  }
  if (!baseRevisionId) {
    throw new ApiError("CONFLICT", "No config revision is available for enablement write lock.", {
      reason: "stale-revision",
      logicalNodeId: input.logicalNodeId,
    });
  }

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId,
    revisionId: baseRevisionId,
  });
  if (!revision) {
    throw new ApiError("CONFLICT", "Base config revision is stale or missing.", {
      reason: "stale-revision",
      logicalNodeId: input.logicalNodeId,
      baseRevisionId,
    });
  }

  const nodeContext = await loadLogicalNodeEnablementContext(db, {
    organizationId: auth.organization.id,
    projectId,
    configRevisionId: baseRevisionId,
    logicalNodeId: input.logicalNodeId,
  });

  const {
    writeTarget,
    overlayMember,
    occurrenceSpan,
    expectedRawText,
    nodeSpan,
    targetRef,
  } = await resolveWriteTarget(db, {
    configRevisionId: baseRevisionId,
    logicalNodeId: input.logicalNodeId,
    propertyKey: "status",
    nodeLocator: nodeContext.nodeLocator,
  });

  if (!writeTarget.fileVersionId || !writeTarget.checksum) {
    throw new ApiError("CONFLICT", "Write target file version is incomplete for enablement lock.", {
      reason: "missing-write-target",
      logicalNodeId: input.logicalNodeId,
    });
  }

  return {
    baseConfigRevisionId: baseRevisionId,
    propertyOccurrenceId: writeTarget.occurrenceId ?? null,
    sourceFileVersionId: writeTarget.fileVersionId,
    expectedChecksum: writeTarget.checksum,
    occurrenceSpan: occurrenceSpan ?? writeTarget.occurrenceSpan ?? null,
    propertyKey: "status",
    targetRef,
    sourceNodePath: nodeContext.nodeLocator,
    compatible: nodeContext.compatible,
    expectedRawText,
    nodeSpan,
    overlayFileId: overlayMember.file_id,
    overlayFileName: overlayMember.file_name,
    overlayFileVersionId: overlayMember.file_version_id,
  };
}
