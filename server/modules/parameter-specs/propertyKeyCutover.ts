/**
 * ADR-0034 / TD-117: referenced property_key rename is a source-file rewrite
 * cutover. This module is the first slice — a read-only preview of locations
 * that would be rewritten. It does not start a run, write drafts, or change
 * the catalog triple.
 */
import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  findParameterSpecByIdentity,
  getParameterSpecRow,
  loadReferenceCountsBySpecIds,
  type ParameterSpecDetailRow,
} from "./repository";
import { requireOrgOrGlobalSpec, requireOrgOwnedSpec } from "./reviewApply";
import { assertNonStructuralPropertyKey } from "./structuralPropertyGuard";

export type PropertyKeySourceLocationStatus =
  | "would-rewrite"
  | "already-new-key"
  | "missing-from-source"
  | "no-occurrence"
  | "conflict";

export type PropertyKeyCutoverStartBlockerCode = "triple-collision" | "open-version-cutover";

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

function isPlatformSuperAdmin(auth: AuthContext) {
  return auth.roles.some((binding) => binding.roleId === "platform-admin");
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
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

  return blockers;
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
  const referenceCount = referenceCounts.get(input.specId) ?? 0;
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
