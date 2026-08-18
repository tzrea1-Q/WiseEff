/**
 * ADR-0034 / TD-117: referenced property_key rename is a source-file rewrite
 * cutover. Preview is read-only. Start persists a run from that preview.
 * Finalize rewrites the catalog triple only after live sources already show
 * the new key (or honest skip). This slice does not stage file-candidate / CR
 * drafts — prepare reclassifies items from the existing binding/occurrence
 * identities and does not write source.
 */
import { randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import { asAuditTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameter-kernel/policy";
import { writeGovernanceAudit } from "../parameter-topology/governanceAudit";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  findParameterSpecByIdentity,
  getParameterSpecRow,
  loadReferenceCountsBySpecIds,
  type ParameterSpecDetailRow,
} from "./repository";
import { requireOrgOrGlobalSpec, requireOrgOwnedSpec } from "./reviewApply";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import { assertNonStructuralPropertyKey } from "./structuralPropertyGuard";

export type PropertyKeySourceLocationStatus =
  | "would-rewrite"
  | "already-new-key"
  | "missing-from-source"
  | "no-occurrence"
  | "conflict";

export type PropertyKeyCutoverStartBlockerCode =
  | "triple-collision"
  | "open-version-cutover"
  | "open-property-key-cutover";

export type PropertyKeyCutoverStartBlocker = {
  code: PropertyKeyCutoverStartBlockerCode;
  message: string;
  details?: Record<string, unknown>;
};

export type PropertyKeyCutoverPreviewLocation = {
  projectId: string;
  bindingId: string;
  bindingRevisionId: string | null;
  configRevisionId: string | null;
  propertyOccurrenceId: string | null;
  fileVersionId: string | null;
  fileName: string | null;
  nodePath: string | null;
  rawValue: string | null;
  fromKey: string;
  toKey: string;
  status: PropertyKeySourceLocationStatus;
};

export type PropertyKeyCutoverPreviewDto = {
  parameterSpecId: string;
  fromKey: string;
  toKey: string;
  referenceCount: number;
  writesCatalog: false;
  writesSource: false;
  inlineRenameEligible: boolean;
  startBlockers: PropertyKeyCutoverStartBlocker[];
  locations: PropertyKeyCutoverPreviewLocation[];
};

export type PropertyKeyCutoverRunStatus =
  | "preparing"
  | "ready"
  | "finalized"
  | "cancelled"
  | "failed";

export type PropertyKeyCutoverItemStatus =
  | "pending"
  | "ready"
  | "incompatible"
  | "skipped"
  | "applied";

export type PropertyKeyCutoverItemDto = {
  id: string;
  bindingId: string;
  projectId: string | null;
  status: PropertyKeyCutoverItemStatus;
  locationStatus: PropertyKeySourceLocationStatus | null;
  incompatibilityCode: string | null;
  fileName: string | null;
  nodePath: string | null;
};

export type PropertyKeyCutoverRunDto = {
  id: string;
  parameterSpecId: string;
  fromKey: string;
  toKey: string;
  status: PropertyKeyCutoverRunStatus;
  referenceCount: number;
  writesCatalog: boolean;
  writesSource: false;
  startBlockers: PropertyKeyCutoverStartBlocker[];
  items: PropertyKeyCutoverItemDto[];
};

export function classifyPropertyKeySourceLocation(input: {
  hasTipRevision: boolean;
  hasFromKeyOccurrence: boolean;
  hasToKeyOccurrence: boolean;
}): PropertyKeySourceLocationStatus {
  if (!input.hasTipRevision) return "no-occurrence";
  if (input.hasFromKeyOccurrence && input.hasToKeyOccurrence) return "conflict";
  if (input.hasFromKeyOccurrence) return "would-rewrite";
  if (input.hasToKeyOccurrence) return "already-new-key";
  return "missing-from-source";
}

export function itemDispositionFromLocationStatus(status: PropertyKeySourceLocationStatus): {
  status: PropertyKeyCutoverItemStatus;
  incompatibilityCode: string | null;
} {
  if (status === "already-new-key") {
    return { status: "skipped", incompatibilityCode: null };
  }
  if (status === "would-rewrite") {
    return { status: "pending", incompatibilityCode: null };
  }
  return { status: "incompatible", incompatibilityCode: status };
}

function isPlatformSuperAdmin(auth: AuthContext) {
  return auth.roles.some((binding) => binding.roleId === "platform-admin");
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

function hashReason(reason: string) {
  let hash = 0;
  for (let i = 0; i < reason.length; i += 1) {
    hash = (hash * 31 + reason.charCodeAt(i)) >>> 0;
  }
  return `r${hash.toString(16)}`;
}

async function requireGovernableSpec(
  tx: Queryable,
  auth: AuthContext,
  specId: string,
): Promise<ParameterSpecDetailRow> {
  return isPlatformSuperAdmin(auth)
    ? requireOrgOrGlobalSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId: specId,
      })
    : requireOrgOwnedSpec(tx, {
        organizationId: auth.organization.id,
        parameterSpecId: specId,
      });
}

type LocationRow = {
  binding_id: string;
  project_id: string;
  binding_revision_id: string | null;
  config_revision_id: string | null;
  raw_value: string | null;
  from_occurrence_id: string | null;
  from_file_version_id: string | null;
  from_file_name: string | null;
  from_node_path: string | null;
  to_occurrence_id: string | null;
  to_file_version_id: string | null;
  to_file_name: string | null;
  to_node_path: string | null;
};

async function loadPreviewLocations(
  db: Queryable,
  input: {
    organizationId: string;
    specId: string;
    fromKey: string;
    toKey: string;
  },
): Promise<PropertyKeyCutoverPreviewLocation[]> {
  const result = await db.query<LocationRow>(
    `
    with tip as (
      select distinct on (b.id)
        b.id as binding_id,
        b.project_id,
        b.logical_node_id,
        br.id as binding_revision_id,
        br.config_revision_id,
        br.raw_value
      from project_parameter_bindings b
      left join project_parameter_binding_revisions br on br.binding_id = b.id
      where b.organization_id = $1
        and b.parameter_spec_id = $2
      order by b.id, br.created_at desc nulls last
    ),
    from_occ as (
      select distinct on (tip.binding_id)
        tip.binding_id,
        po.id as property_occurrence_id,
        po.file_version_id,
        pf.file_name,
        no.node_path
      from tip
      inner join dts_logical_node_revisions lnr
        on lnr.logical_node_id = tip.logical_node_id
       and lnr.config_revision_id = tip.config_revision_id
      inner join dts_occurrence_effects oe
        on oe.logical_node_revision_id = lnr.id
       and oe.property_name = $3
      inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
      left join dts_node_occurrences no on no.id = po.node_occurrence_id
      left join project_parameter_file_versions pfv on pfv.id = po.file_version_id
      left join project_parameter_files pf on pf.id = pfv.file_id
      order by tip.binding_id, oe.source_order
    ),
    to_occ as (
      select distinct on (tip.binding_id)
        tip.binding_id,
        po.id as property_occurrence_id,
        po.file_version_id,
        pf.file_name,
        no.node_path
      from tip
      inner join dts_logical_node_revisions lnr
        on lnr.logical_node_id = tip.logical_node_id
       and lnr.config_revision_id = tip.config_revision_id
      inner join dts_occurrence_effects oe
        on oe.logical_node_revision_id = lnr.id
       and oe.property_name = $4
      inner join dts_property_occurrences po on po.id = oe.property_occurrence_id
      left join dts_node_occurrences no on no.id = po.node_occurrence_id
      left join project_parameter_file_versions pfv on pfv.id = po.file_version_id
      left join project_parameter_files pf on pf.id = pfv.file_id
      order by tip.binding_id, oe.source_order
    )
    select
      tip.binding_id,
      tip.project_id,
      tip.binding_revision_id,
      tip.config_revision_id,
      tip.raw_value,
      from_occ.property_occurrence_id as from_occurrence_id,
      from_occ.file_version_id as from_file_version_id,
      from_occ.file_name as from_file_name,
      from_occ.node_path as from_node_path,
      to_occ.property_occurrence_id as to_occurrence_id,
      to_occ.file_version_id as to_file_version_id,
      to_occ.file_name as to_file_name,
      to_occ.node_path as to_node_path
    from tip
    left join from_occ on from_occ.binding_id = tip.binding_id
    left join to_occ on to_occ.binding_id = tip.binding_id
    order by tip.binding_id
    `,
    [input.organizationId, input.specId, input.fromKey, input.toKey],
  );

  return result.rows.map((row) => {
    const hasFrom = Boolean(row.from_occurrence_id);
    const status = classifyPropertyKeySourceLocation({
      hasTipRevision: Boolean(row.binding_revision_id),
      hasFromKeyOccurrence: hasFrom,
      hasToKeyOccurrence: Boolean(row.to_occurrence_id),
    });
    return {
      projectId: row.project_id,
      bindingId: row.binding_id,
      bindingRevisionId: row.binding_revision_id,
      configRevisionId: row.config_revision_id,
      propertyOccurrenceId: row.from_occurrence_id ?? row.to_occurrence_id,
      fileVersionId: hasFrom ? row.from_file_version_id : row.to_file_version_id,
      fileName: hasFrom ? row.from_file_name : row.to_file_name,
      nodePath: hasFrom ? row.from_node_path : row.to_node_path,
      rawValue: row.raw_value,
      fromKey: input.fromKey,
      toKey: input.toKey,
      status,
    };
  });
}

async function collectStartBlockers(
  db: Queryable,
  spec: ParameterSpecDetailRow,
  toKey: string,
  options: { excludePropertyKeyRunId?: string } = {},
): Promise<PropertyKeyCutoverStartBlocker[]> {
  const blockers: PropertyKeyCutoverStartBlocker[] = [];
  const attributionSubjectId = spec.attributionSubjectId;
  if (attributionSubjectId) {
    const conflict = await findParameterSpecByIdentity(db, {
      organizationId: spec.organizationId,
      attributionSubjectId,
      propertyKey: toKey,
    });
    if (conflict && conflict.parameterSpecId !== spec.id) {
      const blocker = await getParameterSpecRow(db, {
        organizationId: spec.organizationId ?? "",
        specId: conflict.parameterSpecId,
      });
      blockers.push({
        code: "triple-collision",
        message: "A parameter definition already exists for this subject and property key.",
        details: {
          parameterSpecId: conflict.parameterSpecId,
          lifecycle: blocker?.lifecycle ?? null,
          attributionSubjectId,
          propertyKey: toKey,
        },
      });
    }
  }

  const openVersion = await db.query<{ id: string }>(
    `
    select id
    from parameter_spec_version_cutover_runs
    where parameter_spec_id = $1
      and status in ('preparing', 'ready')
    limit 1
    `,
    [spec.id],
  );
  const openRunId = openVersion.rows[0]?.id;
  if (openRunId) {
    blockers.push({
      code: "open-version-cutover",
      message: "An open version cutover already exists for this definition.",
      details: { runId: openRunId, parameterSpecId: spec.id },
    });
  }

  const openPropertyKey = await db.query<{ id: string }>(
    `
    select id
    from parameter_spec_property_key_cutover_runs
    where parameter_spec_id = $1
      and status in ('preparing', 'ready')
      and ($2::text is null or id <> $2)
    limit 1
    `,
    [spec.id, options.excludePropertyKeyRunId ?? null],
  );
  const openPropertyKeyRunId = openPropertyKey.rows[0]?.id;
  if (openPropertyKeyRunId) {
    blockers.push({
      code: "open-property-key-cutover",
      message: "An open property-key cutover already exists for this definition.",
      details: { runId: openPropertyKeyRunId, parameterSpecId: spec.id },
    });
  }

  return blockers;
}

async function resolvePreviewContext(
  db: Queryable,
  auth: AuthContext,
  input: { specId: string; propertyKey: string },
): Promise<{
  spec: ParameterSpecDetailRow;
  fromKey: string;
  toKey: string;
  referenceCount: number;
}> {
  requireCanAdmin(auth);
  const toKey = input.propertyKey.trim();
  assertNonStructuralPropertyKey(toKey);

  const spec = await requireGovernableSpec(db, auth, input.specId);
  const fromKey = spec.propertyKey?.trim() ?? "";
  if (!fromKey) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Parameter definition is missing property_key; cannot preview a rename.",
      { parameterSpecId: input.specId },
    );
  }
  if (fromKey === toKey) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Proposed property_key matches the current key.",
      { parameterSpecId: input.specId, propertyKey: toKey },
    );
  }

  const referenceCounts = await loadReferenceCountsBySpecIds(db, {
    organizationId: auth.organization.id,
    specIds: [input.specId],
  });
  return {
    spec,
    fromKey,
    toKey,
    referenceCount: referenceCounts.get(input.specId) ?? 0,
  };
}

function locationDetails(location: PropertyKeyCutoverPreviewLocation): Record<string, unknown> {
  return {
    bindingRevisionId: location.bindingRevisionId,
    configRevisionId: location.configRevisionId,
    propertyOccurrenceId: location.propertyOccurrenceId,
    fileVersionId: location.fileVersionId,
    fileName: location.fileName,
    nodePath: location.nodePath,
    rawValue: location.rawValue,
    fromKey: location.fromKey,
    toKey: location.toKey,
  };
}

async function syncItemsFromLocations(
  tx: Queryable,
  runId: string,
  locations: PropertyKeyCutoverPreviewLocation[],
): Promise<{ pending: number; incompatible: number; skipped: number; ready: number }> {
  const existing = await tx.query<{ id: string; binding_id: string }>(
    `select id, binding_id from parameter_spec_property_key_cutover_items where run_id = $1`,
    [runId],
  );
  const existingByBinding = new Map(existing.rows.map((row) => [row.binding_id, row.id]));
  const seen = new Set<string>();

  for (const location of locations) {
    seen.add(location.bindingId);
    const disposition = itemDispositionFromLocationStatus(location.status);
    const itemId = existingByBinding.get(location.bindingId) ?? randomUUID();
    await tx.query(
      `
      insert into parameter_spec_property_key_cutover_items (
        id, run_id, binding_id, project_id, status, location_status, incompatibility_code, details
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (run_id, binding_id) do update
        set project_id = excluded.project_id,
            status = excluded.status,
            location_status = excluded.location_status,
            incompatibility_code = excluded.incompatibility_code,
            details = excluded.details
      `,
      [
        itemId,
        runId,
        location.bindingId,
        location.projectId,
        disposition.status,
        location.status,
        disposition.incompatibilityCode,
        JSON.stringify(locationDetails(location)),
      ],
    );
  }

  for (const row of existing.rows) {
    if (seen.has(row.binding_id)) continue;
    await tx.query(
      `
      update parameter_spec_property_key_cutover_items
      set status = 'skipped',
          location_status = null,
          incompatibility_code = 'binding-gone',
          details = details || '{"skipReason":"binding-gone"}'::jsonb
      where id = $1
      `,
      [row.id],
    );
  }

  const counts = await tx.query<{ status: PropertyKeyCutoverItemStatus; count: string }>(
    `
    select status, count(*)::text as count
    from parameter_spec_property_key_cutover_items
    where run_id = $1
    group by status
    `,
    [runId],
  );
  const tally = { pending: 0, incompatible: 0, skipped: 0, ready: 0 };
  for (const row of counts.rows) {
    if (row.status === "pending") tally.pending = Number(row.count);
    if (row.status === "incompatible") tally.incompatible = Number(row.count);
    if (row.status === "skipped") tally.skipped = Number(row.count);
    if (row.status === "ready") tally.ready = Number(row.count);
  }
  return tally;
}

function runStatusFromCounts(counts: { pending: number; incompatible: number }): PropertyKeyCutoverRunStatus {
  return counts.pending > 0 || counts.incompatible > 0 ? "preparing" : "ready";
}

type RunRow = {
  id: string;
  parameter_spec_id: string;
  from_key: string;
  to_key: string;
  status: PropertyKeyCutoverRunStatus;
};

type ItemRow = {
  id: string;
  binding_id: string;
  project_id: string | null;
  status: PropertyKeyCutoverItemStatus;
  location_status: PropertyKeySourceLocationStatus | null;
  incompatibility_code: string | null;
  details: Record<string, unknown> | string | null;
};

function parseDetails(raw: ItemRow["details"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

async function loadRunDto(
  tx: Queryable,
  auth: AuthContext,
  run: RunRow,
  startBlockers: PropertyKeyCutoverStartBlocker[] = [],
): Promise<PropertyKeyCutoverRunDto> {
  const items = await tx.query<ItemRow>(
    `
    select id, binding_id, project_id, status, location_status, incompatibility_code, details
    from parameter_spec_property_key_cutover_items
    where run_id = $1
    order by binding_id
    `,
    [run.id],
  );
  const referenceCounts = await loadReferenceCountsBySpecIds(tx, {
    organizationId: auth.organization.id,
    specIds: [run.parameter_spec_id],
  });
  return {
    id: run.id,
    parameterSpecId: run.parameter_spec_id,
    fromKey: run.from_key,
    toKey: run.to_key,
    status: run.status,
    referenceCount: referenceCounts.get(run.parameter_spec_id) ?? 0,
    writesCatalog: run.status === "finalized",
    writesSource: false,
    startBlockers,
    items: items.rows.map((row) => {
      const details = parseDetails(row.details);
      return {
        id: row.id,
        bindingId: row.binding_id,
        projectId: row.project_id,
        status: row.status,
        locationStatus: row.location_status,
        incompatibilityCode: row.incompatibility_code,
        fileName: typeof details.fileName === "string" ? details.fileName : null,
        nodePath: typeof details.nodePath === "string" ? details.nodePath : null,
      };
    }),
  };
}

async function loadOpenRun(
  tx: Queryable,
  specId: string,
  organizationId: string,
): Promise<RunRow | null> {
  const result = await tx.query<RunRow>(
    `
    select id, parameter_spec_id, from_key, to_key, status
    from parameter_spec_property_key_cutover_runs
    where parameter_spec_id = $1
      and organization_id = $2
      and status in ('preparing', 'ready')
    limit 1
    `,
    [specId, organizationId],
  );
  return result.rows[0] ?? null;
}

function throwIfStartBlockers(
  specId: string,
  blockers: PropertyKeyCutoverStartBlocker[],
  phase: "start" | "finalize",
) {
  if (blockers.length === 0) return;
  throw new ApiError(
    "CONFLICT",
    phase === "start"
      ? "Property-key cutover cannot start while blockers remain."
      : "Property-key cutover cannot finalize while blockers remain.",
    { parameterSpecId: specId, startBlockers: blockers },
  );
}

/**
 * Read-only precheck: list source locations that a later prepare step would
 * rewrite (old key → new key, same raw value). Never writes catalog or source.
 */
export async function previewPropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  input: { specId: string; propertyKey: string },
): Promise<{ item: PropertyKeyCutoverPreviewDto }> {
  const { spec, fromKey, toKey, referenceCount } = await resolvePreviewContext(db, auth, input);
  const [locations, startBlockers] = await Promise.all([
    loadPreviewLocations(db, {
      organizationId: auth.organization.id,
      specId: input.specId,
      fromKey,
      toKey,
    }),
    collectStartBlockers(db, spec, toKey),
  ]);

  return {
    item: {
      parameterSpecId: input.specId,
      fromKey,
      toKey,
      referenceCount,
      writesCatalog: false,
      writesSource: false,
      inlineRenameEligible: referenceCount === 0,
      startBlockers,
      locations,
    },
  };
}

export async function startPropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  input: { specId: string; propertyKey: string; reason: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  return db.transaction(async (tx) => {
    const { spec, fromKey, toKey, referenceCount } = await resolvePreviewContext(tx, auth, input);
    if (referenceCount === 0) {
      throw new ApiError(
        "CONFLICT",
        "Use rename-property-key while referenceCount is 0.",
        { parameterSpecId: input.specId, referenceCount: 0 },
      );
    }

    const startBlockers = await collectStartBlockers(tx, spec, toKey);
    throwIfStartBlockers(input.specId, startBlockers, "start");

    const locations = await loadPreviewLocations(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
      fromKey,
      toKey,
    });

    const runId = randomUUID();
    await tx.query(
      `
      insert into parameter_spec_property_key_cutover_runs (
        id, organization_id, parameter_spec_id, from_key, to_key,
        status, created_by_user_id, metadata
      ) values ($1, $2, $3, $4, $5, 'preparing', $6, $7::jsonb)
      `,
      [
        runId,
        auth.organization.id,
        input.specId,
        fromKey,
        toKey,
        auth.user.id,
        JSON.stringify({ reasonHash: hashReason(input.reason) }),
      ],
    );

    const counts = await syncItemsFromLocations(tx, runId, locations);
    const nextStatus = runStatusFromCounts(counts);
    await tx.query(`update parameter_spec_property_key_cutover_runs set status = $2 where id = $1`, [
      runId,
      nextStatus,
    ]);

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-property-key-cutover-started",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          runId,
          fromKey,
          toKey,
          nextStatus,
          reasonHash: hashReason(input.reason),
          itemCounts: counts,
        },
      },
      context,
    );

    return {
      item: await loadRunDto(
        tx,
        auth,
        {
          id: runId,
          parameter_spec_id: input.specId,
          from_key: fromKey,
          to_key: toKey,
          status: nextStatus,
        },
        [],
      ),
    };
  });
}

export async function preparePropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  input: { specId: string; reason?: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const spec = await requireGovernableSpec(tx, auth, input.specId);
    const run = await loadOpenRun(tx, input.specId, auth.organization.id);
    if (!run) {
      throw new ApiError("NOT_FOUND", "No open property-key cutover run for this spec.", {
        specId: input.specId,
      });
    }

    const locations = await loadPreviewLocations(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
      fromKey: run.from_key,
      toKey: run.to_key,
    });
    const counts = await syncItemsFromLocations(tx, run.id, locations);
    const nextStatus = runStatusFromCounts(counts);
    await tx.query(`update parameter_spec_property_key_cutover_runs set status = $2 where id = $1`, [
      run.id,
      nextStatus,
    ]);

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-property-key-cutover-prepared",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          runId: run.id,
          nextStatus,
          reasonHash: input.reason ? hashReason(input.reason) : null,
          itemCounts: counts,
          writesSource: false,
        },
      },
      context,
    );

    return {
      item: await loadRunDto(
        tx,
        auth,
        { ...run, status: nextStatus },
        await collectStartBlockers(tx, spec, run.to_key, { excludePropertyKeyRunId: run.id }),
      ),
    };
  });
}

export async function finalizePropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  input: { specId: string; reason: string },
  context: AuditCorrelationContext = {},
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const spec = await requireGovernableSpec(tx, auth, input.specId);
    const locked = await tx.query<RunRow>(
      `
      select id, parameter_spec_id, from_key, to_key, status
      from parameter_spec_property_key_cutover_runs
      where parameter_spec_id = $1
        and organization_id = $2
        and status in ('preparing', 'ready')
      limit 1
      for update
      `,
      [input.specId, auth.organization.id],
    );
    const run = locked.rows[0];
    if (!run) {
      throw new ApiError("NOT_FOUND", "No open property-key cutover run for this spec.", {
        specId: input.specId,
      });
    }

    const startBlockers = await collectStartBlockers(tx, spec, run.to_key, {
      excludePropertyKeyRunId: run.id,
    });
    throwIfStartBlockers(input.specId, startBlockers, "finalize");

    const locations = await loadPreviewLocations(tx, {
      organizationId: auth.organization.id,
      specId: input.specId,
      fromKey: run.from_key,
      toKey: run.to_key,
    });
    const counts = await syncItemsFromLocations(tx, run.id, locations);
    const nextStatus = runStatusFromCounts(counts);
    await tx.query(`update parameter_spec_property_key_cutover_runs set status = $2 where id = $1`, [
      run.id,
      nextStatus,
    ]);

    const blockingItems = counts.pending + counts.incompatible;
    if (blockingItems > 0) {
      throw new ApiError(
        "CONFLICT",
        "Property-key cutover cannot finalize while binding items remain pending or incompatible.",
        {
          parameterSpecId: input.specId,
          runId: run.id,
          blockingItems,
        },
      );
    }

    const attributionSubjectId = spec.attributionSubjectId;
    if (!attributionSubjectId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Parameter definition is missing attribution_subject_id; cannot finalize.",
        { parameterSpecId: input.specId },
      );
    }

    const derived = buildSubjectScopedManualSpecIds({
      organizationId: spec.organizationId,
      attributionSubjectId,
      propertyKey: run.to_key,
    });

    await tx.query(
      `
      update parameter_specs
      set property_key = $2,
          specification_key = $3
      where id = $1
      `,
      [input.specId, run.to_key, derived.specificationKey],
    );
    await tx.query(
      `
      update dts_property_specs
      set property_key = $2,
          schema_namespace = $3
      where parameter_spec_id = $1
      `,
      [input.specId, run.to_key, derived.schemaNamespace],
    );

    await tx.query(
      `
      update parameter_spec_property_key_cutover_items
      set status = 'applied'
      where run_id = $1
        and status = 'ready'
      `,
      [run.id],
    );
    await tx.query(
      `
      update parameter_spec_property_key_cutover_runs
      set status = 'finalized', finalized_at = now()
      where id = $1
      `,
      [run.id],
    );

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "spec-property-key-cutover-finalized",
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          runId: run.id,
          fromKey: run.from_key,
          toKey: run.to_key,
          previousPropertyKey: spec.propertyKey,
          nextPropertyKey: run.to_key,
          previousSpecificationKey: spec.specificationKey,
          nextSpecificationKey: derived.specificationKey,
          reasonHash: hashReason(input.reason),
          itemCounts: counts,
        },
      },
      context,
    );

    return {
      item: await loadRunDto(
        tx,
        auth,
        { ...run, status: "finalized" },
        [],
      ),
    };
  });
}
