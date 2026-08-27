/**
 * ADR-0034 / TD-117: referenced property_key rename is a source-file rewrite
 * cutover. Preview is read-only. Start persists a run from that preview.
 * Prepare stages a file-candidate rewrite through the existing parameter-files
 * seam (no live activate). Finalize rewrites the catalog triple only after
 * live sources already show the new key (or honest skip).
 */
import { randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import { asAuditTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { createCandidate } from "../parameter-files/candidateService";
import { getParameterFileCandidateById } from "../parameter-files/candidateRepository";
import { getFileVersionById } from "../parameter-files/repository";
import {
  assertTrustedSensitiveNodeWriteAllowed,
  assertTrustedSensitiveNodeWriteContext,
  type TrustedSensitiveNodeWriteContext
} from "../parameter-kernel/sensitiveNode";
import { canAdminParameters } from "../parameter-kernel/policy";
import { writeGovernanceAudit, writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { rewritePropertyKeyInDtsSource } from "./propertyKeySourceRewrite";
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

export type StagedPropertyKeyRewrite = {
  kind: "file-candidate";
  id: string;
  status: string;
};

export type PropertyKeyCutoverPreviewLocation = {
  projectId: string;
  bindingId: string;
  bindingRevisionId: string | null;
  configRevisionId: string | null;
  propertyOccurrenceId: string | null;
  fileId: string | null;
  fileVersionId: string | null;
  fileName: string | null;
  configSetId: string | null;
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
  fileId: string | null;
  configSetId: string | null;
  nodePath: string | null;
  stagedRewrite: StagedPropertyKeyRewrite | null;
};

export function resolveLiveStagedRewrite(
  staged: StagedPropertyKeyRewrite,
  live: { status: string } | null,
): StagedPropertyKeyRewrite {
  return { ...staged, status: live?.status ?? "missing" };
}

export type PropertyKeyCutoverRunDto = {
  id: string;
  parameterSpecId: string;
  fromKey: string;
  toKey: string;
  status: PropertyKeyCutoverRunStatus;
  referenceCount: number;
  writesCatalog: boolean;
  writesSource: false;
  stagedSource: boolean;
  startBlockers: PropertyKeyCutoverStartBlocker[];
  items: PropertyKeyCutoverItemDto[];
};

export type PropertyKeyCutoverPrepareDeps = {
  objectStore: ObjectStore;
  createCandidate?: typeof createCandidate;
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
  from_file_id: string | null;
  from_file_version_id: string | null;
  from_file_name: string | null;
  from_config_set_id: string | null;
  from_node_path: string | null;
  to_occurrence_id: string | null;
  to_file_id: string | null;
  to_file_version_id: string | null;
  to_file_name: string | null;
  to_config_set_id: string | null;
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
        pf.id as file_id,
        pf.file_name,
        pf.config_set_id,
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
        pf.id as file_id,
        pf.file_name,
        pf.config_set_id,
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
      from_occ.file_id as from_file_id,
      from_occ.file_version_id as from_file_version_id,
      from_occ.file_name as from_file_name,
      from_occ.config_set_id as from_config_set_id,
      from_occ.node_path as from_node_path,
      to_occ.property_occurrence_id as to_occurrence_id,
      to_occ.file_id as to_file_id,
      to_occ.file_version_id as to_file_version_id,
      to_occ.file_name as to_file_name,
      to_occ.config_set_id as to_config_set_id,
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
      fileId: hasFrom ? row.from_file_id : row.to_file_id,
      fileVersionId: hasFrom ? row.from_file_version_id : row.to_file_version_id,
      fileName: hasFrom ? row.from_file_name : row.to_file_name,
      configSetId: hasFrom ? row.from_config_set_id : row.to_config_set_id,
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
    fileId: location.fileId,
    fileVersionId: location.fileVersionId,
    fileName: location.fileName,
    configSetId: location.configSetId,
    nodePath: location.nodePath,
    rawValue: location.rawValue,
    fromKey: location.fromKey,
    toKey: location.toKey,
  };
}

function parseStagedRewrite(details: Record<string, unknown>): StagedPropertyKeyRewrite | null {
  const raw = details.stagedRewrite;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const staged = raw as Record<string, unknown>;
  if (staged.kind !== "file-candidate") return null;
  if (typeof staged.id !== "string" || typeof staged.status !== "string") return null;
  return { kind: "file-candidate", id: staged.id, status: staged.status };
}

async function syncItemsFromLocations(
  tx: Queryable,
  runId: string,
  locations: PropertyKeyCutoverPreviewLocation[],
  options: {
    stagedByBinding?: Map<string, StagedPropertyKeyRewrite | { errorCode: string }>;
  } = {},
): Promise<{ pending: number; incompatible: number; skipped: number; ready: number }> {
  const existing = await tx.query<{ id: string; binding_id: string; details: ItemRow["details"] }>(
    `select id, binding_id, details from parameter_spec_property_key_cutover_items where run_id = $1`,
    [runId],
  );
  const existingByBinding = new Map(existing.rows.map((row) => [row.binding_id, row]));
  const seen = new Set<string>();

  for (const location of locations) {
    seen.add(location.bindingId);
    const disposition = itemDispositionFromLocationStatus(location.status);
    const previous = existingByBinding.get(location.bindingId);
    const itemId = previous?.id ?? randomUUID();
    const details: Record<string, unknown> = {
      ...locationDetails(location),
      ...parseDetails(previous?.details ?? null),
    };
    let status = disposition.status;
    let incompatibilityCode = disposition.incompatibilityCode;
    const staged = options.stagedByBinding?.get(location.bindingId);
    if (location.status === "would-rewrite" && staged) {
      if ("errorCode" in staged) {
        status = "incompatible";
        incompatibilityCode = staged.errorCode;
        delete details.stagedRewrite;
      } else {
        status = "ready";
        incompatibilityCode = null;
        details.stagedRewrite = staged;
      }
    } else if (location.status !== "would-rewrite") {
      delete details.stagedRewrite;
    }
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
        status,
        location.status,
        incompatibilityCode,
        JSON.stringify(details),
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
  const mappedItems = items.rows.map((row) => {
    const details = parseDetails(row.details);
    return {
      id: row.id,
      bindingId: row.binding_id,
      projectId: row.project_id,
      status: row.status,
      locationStatus: row.location_status,
      incompatibilityCode: row.incompatibility_code,
      fileName: typeof details.fileName === "string" ? details.fileName : null,
      fileId: typeof details.fileId === "string" ? details.fileId : null,
      configSetId: typeof details.configSetId === "string" ? details.configSetId : null,
      nodePath: typeof details.nodePath === "string" ? details.nodePath : null,
      stagedRewrite: parseStagedRewrite(details),
    };
  });
  const hydrated = await Promise.all(
    mappedItems.map(async (item) => {
      if (!item.stagedRewrite || !item.projectId) return item;
      const live = await getParameterFileCandidateById(tx, {
        organizationId: auth.organization.id,
        projectId: item.projectId,
        candidateId: item.stagedRewrite.id,
      });
      return {
        ...item,
        stagedRewrite: resolveLiveStagedRewrite(item.stagedRewrite, live),
      };
    }),
  );
  return {
    id: run.id,
    parameterSpecId: run.parameter_spec_id,
    fromKey: run.from_key,
    toKey: run.to_key,
    status: run.status,
    referenceCount: referenceCounts.get(run.parameter_spec_id) ?? 0,
    writesCatalog: run.status === "finalized",
    writesSource: false,
    stagedSource: hydrated.some((item) => Boolean(item.stagedRewrite)),
    startBlockers,
    items: hydrated,
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
  phase: "start" | "prepare" | "finalize",
) {
  if (blockers.length === 0) return;
  const message =
    phase === "start"
      ? "Property-key cutover cannot start while blockers remain."
      : phase === "prepare"
        ? "Property-key cutover cannot prepare while blockers remain."
        : "Property-key cutover cannot finalize while blockers remain.";
  throw new ApiError("CONFLICT", message, { parameterSpecId: specId, startBlockers: blockers });
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

async function reusableStagedRewrite(
  db: Queryable,
  auth: AuthContext,
  projectId: string,
  staged: StagedPropertyKeyRewrite | null,
): Promise<StagedPropertyKeyRewrite | null> {
  if (!staged) return null;
  const candidate = await getParameterFileCandidateById(db, {
    organizationId: auth.organization.id,
    projectId,
    candidateId: staged.id,
  });
  if (!candidate) return null;
  if (candidate.status === "abandoned" || candidate.status === "active") return null;
  return { kind: "file-candidate", id: candidate.id, status: candidate.status };
}

function errorCodeFromUnknown(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const reason = error.details.reason;
    if (typeof reason === "string" && reason.trim()) return reason;
    return error.code.toLowerCase().replace(/_/g, "-");
  }
  return fallback;
}

async function stageWouldRewriteLocations(
  db: Database,
  auth: AuthContext,
  input: {
    locations: PropertyKeyCutoverPreviewLocation[];
    existingDetailsByBinding: Map<string, Record<string, unknown>>;
    objectStore: ObjectStore;
    createCandidate: typeof createCandidate;
    context: TrustedSensitiveNodeWriteContext;
  },
): Promise<Map<string, StagedPropertyKeyRewrite | { errorCode: string }>> {
  const stagedByBinding = new Map<string, StagedPropertyKeyRewrite | { errorCode: string }>();
  const groups = new Map<string, PropertyKeyCutoverPreviewLocation[]>();
  for (const location of input.locations) {
    if (location.status !== "would-rewrite") continue;
    const key = `${location.projectId}:${location.fileId ?? location.fileVersionId ?? location.bindingId}`;
    const group = groups.get(key) ?? [];
    group.push(location);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const projectId = group[0]?.projectId;
    const fileId = group[0]?.fileId;
    const fileName = group[0]?.fileName;
    const fileVersionId = group[0]?.fileVersionId;
    if (!projectId || !fileId || !fileName || !fileVersionId) {
      for (const location of group) {
        stagedByBinding.set(location.bindingId, { errorCode: "missing-file" });
      }
      continue;
    }
    if (!fileName.endsWith(".dts")) {
      for (const location of group) {
        stagedByBinding.set(location.bindingId, { errorCode: "unsupported-format" });
      }
      continue;
    }

    const writable: Array<PropertyKeyCutoverPreviewLocation & { nodePath: string }> = [];
    for (const location of group) {
      const nodePath = location.nodePath?.trim() ?? "";
      if (!nodePath) {
        stagedByBinding.set(location.bindingId, { errorCode: "missing-node-path" });
        continue;
      }
      writable.push({ ...location, nodePath });
    }
    if (writable.length === 0) continue;

    const reused: StagedPropertyKeyRewrite[] = [];
    for (const location of writable) {
      const existing = parseStagedRewrite(input.existingDetailsByBinding.get(location.bindingId) ?? {});
      const reusable = await reusableStagedRewrite(db, auth, projectId, existing);
      if (reusable) reused.push(reusable);
    }
    if (reused.length === writable.length && new Set(reused.map((item) => item.id)).size === 1) {
      for (const location of writable) {
        stagedByBinding.set(location.bindingId, reused[0]!);
      }
      continue;
    }

    try {
      const version = await getFileVersionById(db, { versionId: fileVersionId });
      if (!version) {
        throw new ApiError("NOT_FOUND", "Source file version was not found for rewrite.", {
          reason: "missing-file",
          fileVersionId,
        });
      }
      const source = (await input.objectStore.get(version.storageKey)).toString("utf8");
      let rewritten = source;
      for (const location of writable) {
        rewritten = rewritePropertyKeyInDtsSource(rewritten, {
          fromKey: location.fromKey,
          toKey: location.toKey,
          nodePath: location.nodePath,
        });
      }

      const candidate = await input.createCandidate(
        db,
        input.objectStore,
        auth,
        {
          projectId,
          fileId,
          fileName,
          bytes: Buffer.from(rewritten, "utf8"),
        },
        input.context,
      );
      const staged: StagedPropertyKeyRewrite = {
        kind: "file-candidate",
        id: candidate.id,
        status: candidate.status,
      };
      if (candidate.status !== "ready") {
        for (const location of writable) {
          stagedByBinding.set(location.bindingId, { errorCode: `candidate-${candidate.status}` });
        }
        continue;
      }
      for (const location of writable) {
        stagedByBinding.set(location.bindingId, staged);
      }
    } catch (error) {
      const errorCode = errorCodeFromUnknown(error, "stage-failed");
      for (const location of writable) {
        stagedByBinding.set(location.bindingId, { errorCode });
      }
    }
  }

  return stagedByBinding;
}

export async function getOpenPropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  specId: string,
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  requireCanAdmin(auth);
  const spec = await requireGovernableSpec(db, auth, specId);
  const run = await loadOpenRun(db, specId, auth.organization.id);
  if (!run) {
    throw new ApiError("NOT_FOUND", "No open property-key cutover run for this spec.", { specId });
  }
  return {
    item: await loadRunDto(
      db,
      auth,
      run,
      await collectStartBlockers(db, spec, run.to_key, { excludePropertyKeyRunId: run.id }),
    ),
  };
}

async function preparePropertyKeySourceCutoverInTransaction(
  db: Database,
  auth: AuthContext,
  input: { specId: string; reason?: string },
  context: TrustedSensitiveNodeWriteContext,
  deps?: PropertyKeyCutoverPrepareDeps,
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  requireCanAdmin(auth);
  if (!deps?.objectStore) {
    throw new ApiError(
      "INTERNAL_ERROR",
      "Object store is required to stage property-key source rewrites.",
    );
  }

  const spec = await requireGovernableSpec(db, auth, input.specId);
  const run = await loadOpenRun(db, input.specId, auth.organization.id);
  if (!run) {
    throw new ApiError("NOT_FOUND", "No open property-key cutover run for this spec.", {
      specId: input.specId,
    });
  }

  const startBlockers = await collectStartBlockers(db, spec, run.to_key, {
    excludePropertyKeyRunId: run.id,
  });
  throwIfStartBlockers(input.specId, startBlockers, "prepare");

  const locations = await loadPreviewLocations(db, {
    organizationId: auth.organization.id,
    specId: input.specId,
    fromKey: run.from_key,
    toKey: run.to_key,
  });
  for (const location of locations) {
    const nodePath = location.nodePath?.trim();
    const fileName = location.fileName?.trim();
    if (location.status !== "would-rewrite" || !nodePath || !fileName) continue;
    if (!location.fileVersionId) {
      throw new ApiError("CONFLICT", "Property-key cutover location has no exact source file version.", {
        code: "parameter-sensitive-source-version-mismatch",
        bindingId: location.bindingId,
        projectId: location.projectId,
        fileName
      });
    }
    await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
      organizationId: auth.organization.id,
      projectId: location.projectId,
      nodePath,
      sourceFileName: fileName,
      sourceFileVersionId: location.fileVersionId,
      invocation: context.invocation,
      requestId: context.requestId,
      refusalSink: context.refusalSink
    });
  }
  const existing = await db.query<{ binding_id: string; details: ItemRow["details"] }>(
    `select binding_id, details from parameter_spec_property_key_cutover_items where run_id = $1`,
    [run.id],
  );
  const existingDetailsByBinding = new Map(
    existing.rows.map((row) => [row.binding_id, parseDetails(row.details)]),
  );
  const stagedByBinding = await stageWouldRewriteLocations(db, auth, {
    locations,
    existingDetailsByBinding,
    objectStore: deps.objectStore,
    createCandidate: deps.createCandidate ?? createCandidate,
    context,
  });

  const counts = await syncItemsFromLocations(db, run.id, locations, { stagedByBinding });
    const nextStatus = runStatusFromCounts(counts);
    await db.query(`update parameter_spec_property_key_cutover_runs set status = $2 where id = $1`, [
      run.id,
      nextStatus,
    ]);

    await writeTrustedGovernanceAudit(
      asAuditTx(db),
      context.invocation,
      {
        action: "spec-property-key-cutover-prepared",
        organizationId: auth.organization.id,
        targetType: "parameter-spec",
        targetId: input.specId,
        metadata: {
          parameterSpecId: input.specId,
          runId: run.id,
          nextStatus,
          reasonHash: input.reason ? hashReason(input.reason) : null,
          itemCounts: counts,
          writesSource: false,
          stagedCandidateCount: [...stagedByBinding.values()].filter(
            (value) => !("errorCode" in value),
          ).length,
        },
      },
      context.requestId,
    );

    return {
      item: await loadRunDto(db, auth, { ...run, status: nextStatus }, []),
    };
}

export async function preparePropertyKeySourceCutover(
  db: Database,
  auth: AuthContext,
  input: { specId: string; reason?: string },
  context: TrustedSensitiveNodeWriteContext,
  deps?: PropertyKeyCutoverPrepareDeps,
): Promise<{ item: PropertyKeyCutoverRunDto }> {
  const trustedContext = assertTrustedSensitiveNodeWriteContext(auth, context, "property-key cutover prepare");
  return db.transaction((tx) =>
    preparePropertyKeySourceCutoverInTransaction(tx, auth, input, trustedContext, deps)
  );
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
