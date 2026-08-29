import { ApiError } from "../../shared/http/errors";
import type { Queryable } from "../../shared/database/client";
import {
  createOrReuseBinding,
  type ProjectParameterBinding,
} from "../parameter-topology/bindingService";
import {
  getDriverRegistrationPlacement,
  getNodeTypeDefinitionPlacement,
} from "../parameter-modules/driverRegistrationPlacement";
import {
  selectEffectiveDefinition,
  type EffectiveDefinitionCandidate,
} from "./effectiveDefinition";

export type EffectiveDefinition = {
  parameterSpecId: string;
  parameterSpecVersionId: string;
  attributionSubjectId: string;
  driverSchemaId: string | null;
  organizationId: string | null;
  propertyKey: string;
  sourceKind: "dts" | "json" | "manual";
  declaredPlacement: {
    moduleId: string;
    categoryId: string | null;
  };
};

type CandidateRow = {
  parameter_spec_id: string;
  parameter_spec_version_id: string | null;
  organization_id: string | null;
  attribution_subject_id: string | null;
  attribution_subject_kind:
    "driver-registration" | "node-type-definition" | null;
  property_key: string | null;
  source_kind: "dts" | "json" | "manual";
  definition_lifecycle: "draft" | "active" | "deprecated";
  version_status: "draft" | "active" | "superseded" | null;
  version_lifecycle: "draft" | "active" | "deprecated" | null;
  active_version_count: number | string | null;
  driver_schema_id: string | null;
  driver_schema_subject_id: string | null;
  driver_registration_id: string | null;
  driver_identity_key: string;
  placement_id: string | null;
  driver_group_module_id: string | null;
  default_business_category_module_id: string | null;
  node_type_module_id: string | null;
  placement_ready: boolean;
};

function toCandidate(row: CandidateRow): EffectiveDefinitionCandidate {
  return {
    id: row.parameter_spec_id,
    organizationId: row.organization_id,
    attributionSubjectId: row.attribution_subject_id,
    driverIdentityKey: row.driver_identity_key,
    propertyKey: row.property_key ?? "",
    lifecycle: row.definition_lifecycle,
    versionStatus: row.version_status,
    versionLifecycle: row.version_lifecycle,
    versionId: row.parameter_spec_version_id,
    activeVersionCount: Number(row.active_version_count ?? 0),
    placementReady: row.placement_ready,
    sourceKind: row.source_kind,
  };
}

function candidateQuery(input: {
  organizationId: string;
  propertyKey?: string;
  parameterSpecId?: string;
}): { text: string; values: unknown[] } {
  const identityPredicate = input.parameterSpecId
    ? "and ps.id = $2"
    : "and coalesce(ps.property_key, dps.property_key) = $2";
  return {
    text: `
      select
        ps.id as parameter_spec_id,
        psv.id as parameter_spec_version_id,
        ps.organization_id,
        ps.attribution_subject_id,
        asub.subject_kind as attribution_subject_kind,
        coalesce(ps.property_key, dps.property_key) as property_key,
        ps.source_kind,
        ps.definition_lifecycle,
        psv.version_status,
        psv.lifecycle as version_lifecycle,
        psv.active_version_count,
        dps.driver_schema_id,
        driver_schema.attribution_subject_id as driver_schema_subject_id,
        dr.attribution_subject_id as driver_registration_id,
        coalesce(lower(asub.source_key), 'subject:' || coalesce(ps.attribution_subject_id, ps.id))
          as driver_identity_key,
        drp.id as placement_id,
        drp.driver_group_module_id,
        drp.default_business_category_module_id,
        node_type_module.id as node_type_module_id,
        case
          -- Legacy/manual policy rows are not driver definitions and do not
          -- participate in the driver-placement invariant.
          when ps.source_kind <> 'dts'
            and dps.driver_schema_id is null then true
          when asub.subject_kind = 'node-type-definition'
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and node_type_module.id is not null
            and exists (
              select 1
              from node_type_definitions node_type_definition
              where node_type_definition.attribution_subject_id = ps.attribution_subject_id
            )
            and (
              ps.source_kind <> 'dts'
              or (
                dps.driver_schema_id is not null
                and driver_schema.attribution_subject_id = ps.attribution_subject_id
                and (driver_schema.organization_id is null or driver_schema.organization_id = ps.organization_id)
                and exists (
                  select 1
                  from parameter_specs driver_schema_root
                  where driver_schema_root.id = driver_schema.parameter_spec_id
                    and driver_schema_root.organization_id is not distinct from driver_schema.organization_id
                    and driver_schema_root.attribution_subject_id is not distinct from driver_schema.attribution_subject_id
                )
                and exists (
                  select 1
                  from driver_schema_versions active_schema_version
                  where active_schema_version.driver_schema_id = dps.driver_schema_id
                    and active_schema_version.lifecycle = 'active'
                )
              )
            ) then true
          when ps.source_kind <> 'dts'
            and dps.driver_schema_id is null
            and ps.attribution_subject_id is not null
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and dr.attribution_subject_id is not null
            and drp.id is not null
            and dgm.id is not null
            and dgm.organization_id = $1
            and dgm.kind = 'driver-group'
            and dgm.attribution_subject_id = ps.attribution_subject_id
            and (
              drp.default_business_category_module_id is null
              or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
            ) then true
          when dps.driver_schema_id is not null
            and asub.subject_kind = 'driver-registration'
            and (asub.organization_id is null or asub.organization_id = ps.organization_id)
            and driver_schema.attribution_subject_id is not distinct from ps.attribution_subject_id
            and (driver_schema.organization_id is null or driver_schema.organization_id = ps.organization_id)
            and exists (
              select 1
              from parameter_specs driver_schema_root
              where driver_schema_root.id = driver_schema.parameter_spec_id
                and driver_schema_root.organization_id is not distinct from driver_schema.organization_id
                and driver_schema_root.attribution_subject_id is not distinct from driver_schema.attribution_subject_id
            )
            and exists (
              select 1
              from driver_schema_versions active_schema_version
              where active_schema_version.driver_schema_id = dps.driver_schema_id
                and active_schema_version.lifecycle = 'active'
            )
            and dr.attribution_subject_id is not null
            and drp.id is not null
            and dgm.id is not null
            and dgm.organization_id = $1
            and dgm.kind = 'driver-group'
            and dgm.attribution_subject_id = ps.attribution_subject_id
            and (
              drp.default_business_category_module_id is null
              or (category.id is not null and category.organization_id = $1 and category.kind = 'business')
            ) then true
          else false
        end as placement_ready
      from parameter_specs ps
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join lateral (
        select
          psv.id,
          psv.version_status,
          psv.lifecycle,
          count(*) filter (where psv.version_status = 'active' and psv.lifecycle = 'active') over () as active_version_count
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
        order by
          case
            when psv.version_status = 'active' and psv.lifecycle = 'active' then 0
            when psv.version_status = 'active' then 1
            when psv.version_status = 'superseded' then 2
            else 3
          end,
          psv.version desc
        limit 1
      ) psv on true
      left join attribution_subjects asub on asub.id = ps.attribution_subject_id
      left join driver_schemas driver_schema on driver_schema.id = dps.driver_schema_id
      left join driver_registrations dr on dr.attribution_subject_id = ps.attribution_subject_id
      left join driver_registration_placements drp
        on drp.organization_id = $1
       and drp.attribution_subject_id = ps.attribution_subject_id
      left join parameter_modules dgm on dgm.id = drp.driver_group_module_id
      left join parameter_modules category on category.id = drp.default_business_category_module_id
      left join parameter_modules node_type_module
        on node_type_module.organization_id = $1
       and node_type_module.kind = 'node-type'
       and (
         node_type_module.attribution_subject_id = ps.attribution_subject_id
         or lower(coalesce(node_type_module.source_key, '')) = lower(coalesce(asub.source_key, ''))
       )
      where (ps.organization_id = $1 or ps.organization_id is null)
        and not exists (
          select 1 from driver_schemas driver_root
          where driver_root.parameter_spec_id = ps.id
        )
        and (ps.source_kind <> 'dts' or ps.property_key is not distinct from dps.property_key)
        ${identityPredicate}
        and ps.source_kind in ('dts', 'json', 'manual')
      order by ps.id
    `,
    values: [input.organizationId, input.parameterSpecId ?? input.propertyKey],
  };
}

/**
 * Resolve the one product-visible definition for a driver/property key.
 * Callers must pass the canonical subject identity; this function never falls
 * back to display names or property key alone when candidates are ambiguous.
 */
export async function resolveEffectiveDefinition(
  db: Queryable,
  input: {
    organizationId: string;
    propertyKey: string;
    driverIdentityKey?: string;
  },
): Promise<EffectiveDefinition | null> {
  const query = candidateQuery(input);
  const result = await db.query<CandidateRow>(query.text, query.values);
  const candidates = result.rows
    .filter(
      (row) =>
        !input.driverIdentityKey ||
        row.driver_identity_key === input.driverIdentityKey,
    )
    .map(toCandidate);
  const resolution = selectEffectiveDefinition(candidates);
  if (resolution.kind === "none") return null;
  if (resolution.kind === "needs-governance") {
    throw new ApiError(
      "CONFLICT",
      `The driver property has no unique effective definition (${resolution.reason}).`,
      {
        reason: resolution.reason,
        propertyKey: input.propertyKey,
        candidates: resolution.candidates.map((candidate) => ({
          id: candidate.id,
          organizationId: candidate.organizationId,
          subject: candidate.attributionSubjectId,
          placementReady: candidate.placementReady,
        })),
      },
    );
  }
  const winner = resolution.winner;
  const winnerRow = result.rows.find(
    (row) => row.parameter_spec_id === winner.id,
  );
  if (!winnerRow?.attribution_subject_id) {
    throw new ApiError(
      "CONFLICT",
      "An effective driver property is missing its canonical subject.",
      {
        parameterSpecId: winner.id,
        propertyKey: input.propertyKey,
      },
    );
  }
  const placement =
    winnerRow.attribution_subject_kind === "node-type-definition"
      ? await getNodeTypeDefinitionPlacement(db, {
          organizationId: input.organizationId,
          attributionSubjectId: winnerRow.attribution_subject_id,
          sourceKey: winnerRow.driver_identity_key,
        })
      : await getDriverRegistrationPlacement(db, {
          organizationId: input.organizationId,
          attributionSubjectId: winnerRow.attribution_subject_id,
        });
  if (!placement) {
    throw new ApiError(
      "CONFLICT",
      "An effective driver property is missing its organization placement.",
      {
        parameterSpecId: winner.id,
        attributionSubjectId: winnerRow.attribution_subject_id,
        propertyKey: input.propertyKey,
      },
    );
  }
  return {
    parameterSpecId: winner.id,
    parameterSpecVersionId: winner.versionId!,
    attributionSubjectId: winnerRow.attribution_subject_id,
    driverSchemaId: winnerRow.driver_schema_id,
    organizationId: winnerRow.organization_id,
    propertyKey: winner.propertyKey,
    sourceKind: winner.sourceKind,
    declaredPlacement: {
      moduleId:
        "driverGroupModuleId" in placement
          ? placement.driverGroupModuleId
          : placement.moduleId,
      categoryId:
        "driverGroupModuleId" in placement
          ? placement.defaultBusinessCategoryModuleId
          : placement.categoryId,
    },
  };
}

/** Verify the exact spec/version/module tuple before creating a recognized binding. */
export async function requireRecognizedDefinitionForBinding(
  db: Queryable,
  input: {
    organizationId: string;
    parameterSpecId: string;
    parameterSpecVersionId: string;
    moduleId: string;
  },
): Promise<EffectiveDefinition> {
  const rowResult = await db.query<CandidateRow>(
    candidateQuery({
      organizationId: input.organizationId,
      parameterSpecId: input.parameterSpecId,
    }).text,
    [input.organizationId, input.parameterSpecId],
  );
  const row = rowResult.rows[0];
  if (
    !row ||
    row.parameter_spec_version_id !== input.parameterSpecVersionId ||
    row.definition_lifecycle !== "active" ||
    row.version_status !== "active" ||
    row.version_lifecycle !== "active" ||
    Number(row.active_version_count ?? 0) !== 1
  ) {
    throw new ApiError(
      "CONFLICT",
      "A recognized binding must target the active current definition version.",
      {
        parameterSpecId: input.parameterSpecId,
        parameterSpecVersionId: input.parameterSpecVersionId,
      },
    );
  }
  // NodeTypeDefinition-only schemas and legacy/manual policy specs are
  // intentionally outside the driver-only placement invariant (ADR-0013).
  // They still require an active current version, but retain their existing
  // binding route. DTS driver definitions take the strict branch below.
  if (
    row.attribution_subject_kind === "node-type-definition" ||
    // Manual/organization overlay specs without a concrete DriverSchema are
    // policy-governed definitions rather than DTS driver definitions. They
    // retain the review/activation workflow even when the review evidence has
    // already assigned a subject for provenance; DTS rows take the strict
    // effective-definition and placement checks below.
    (row.source_kind !== "dts" && row.driver_schema_id === null)
  ) {
    if (row.attribution_subject_kind === "node-type-definition") {
      if (!row.attribution_subject_id) {
        throw new ApiError(
          "CONFLICT",
          "A node-type definition is missing its canonical subject.",
          {
            parameterSpecId: input.parameterSpecId,
          },
        );
      }
      // A DTS-backed node type is still a driver definition. Its taxonomy
      // module is necessary but not sufficient: the property must resolve
      // through the same active-schema/active-version gate as a registered
      // driver. Non-DTS policy rows retain the legacy node-type workflow.
      if (row.source_kind === "dts") {
        const effective = await resolveEffectiveDefinition(db, {
          organizationId: input.organizationId,
          propertyKey: row.property_key ?? "",
          driverIdentityKey: row.driver_identity_key,
        });
        if (!effective || effective.parameterSpecId !== input.parameterSpecId) {
          throw new ApiError(
            "CONFLICT",
            "The requested node-type definition is not effective and active.",
            {
              parameterSpecId: input.parameterSpecId,
              propertyKey: row.property_key,
            },
          );
        }
        if (input.moduleId !== effective.declaredPlacement.moduleId) {
          throw new ApiError(
            "CONFLICT",
            "A recognized node-type binding must use its declared module.",
            {
              parameterSpecId: input.parameterSpecId,
              moduleId: input.moduleId,
              declaredModuleId: effective.declaredPlacement.moduleId,
            },
          );
        }
        return effective;
      }
      const placement = await getNodeTypeDefinitionPlacement(db, {
        organizationId: input.organizationId,
        attributionSubjectId: row.attribution_subject_id,
        sourceKey: row.driver_identity_key,
      });
      if (!placement) {
        throw new ApiError(
          "CONFLICT",
          "A node-type definition is missing its organization module placement.",
          {
            parameterSpecId: input.parameterSpecId,
            attributionSubjectId: row.attribution_subject_id,
            propertyKey: row.property_key,
          },
        );
      }
      if (input.moduleId !== placement.moduleId) {
        const moduleResult = await db.query<{ id: string }>(
          `
          select id
          from parameter_modules
          where id = $1 and organization_id = $2 and kind = 'node-type'
            and lower(coalesce(source_key, '')) = lower($3)
          limit 1
          `,
          [input.moduleId, input.organizationId, row.driver_identity_key],
        );
        if (!moduleResult.rows[0]) {
          throw new ApiError(
            "CONFLICT",
            "A recognized node-type binding must use its declared module.",
            {
              parameterSpecId: input.parameterSpecId,
              moduleId: input.moduleId,
              declaredModuleId: placement.moduleId,
            },
          );
        }
      }
      return {
        parameterSpecId: input.parameterSpecId,
        parameterSpecVersionId: input.parameterSpecVersionId,
        attributionSubjectId: row.attribution_subject_id,
        driverSchemaId: row.driver_schema_id,
        organizationId: row.organization_id,
        propertyKey: row.property_key ?? "",
        sourceKind: row.source_kind,
        declaredPlacement: {
          moduleId: placement.moduleId,
          categoryId: placement.categoryId,
        },
      };
    }
    return {
      parameterSpecId: input.parameterSpecId,
      parameterSpecVersionId: input.parameterSpecVersionId,
      attributionSubjectId:
        row.attribution_subject_id ?? `non-driver:${input.parameterSpecId}`,
      driverSchemaId: row.driver_schema_id,
      organizationId: row.organization_id,
      propertyKey: row.property_key ?? "",
      sourceKind: row.source_kind,
      declaredPlacement: { moduleId: input.moduleId, categoryId: null },
    };
  }
  const effective = await resolveEffectiveDefinition(db, {
    organizationId: input.organizationId,
    propertyKey: row.property_key ?? "",
    driverIdentityKey: row.driver_identity_key,
  });
  if (!effective || effective.parameterSpecId !== input.parameterSpecId) {
    throw new ApiError(
      "CONFLICT",
      "The requested definition is not the effective active driver property.",
      {
        parameterSpecId: input.parameterSpecId,
        propertyKey: row.property_key,
      },
    );
  }
  const moduleResult = await db.query<{
    organization_id: string;
    kind: "business" | "driver-group" | "node-type" | "unclassified";
    attribution_subject_id: string | null;
  }>(
    `select organization_id, kind, attribution_subject_id from parameter_modules where id = $1 limit 1`,
    [input.moduleId],
  );
  const module = moduleResult.rows[0];
  if (
    !module ||
    module.organization_id !== input.organizationId ||
    (row.source_kind === "dts" && module.kind !== "driver-group") ||
    (row.source_kind !== "dts" &&
      module.kind !== "driver-group" &&
      module.kind !== "node-type") ||
    module.attribution_subject_id !== effective.attributionSubjectId
  ) {
    throw new ApiError(
      "CONFLICT",
      "A recognized binding module must belong to the effective driver subject.",
      {
        parameterSpecId: input.parameterSpecId,
        moduleId: input.moduleId,
        attributionSubjectId: effective.attributionSubjectId,
        moduleOrganizationId: module?.organization_id ?? null,
        moduleKind: module?.kind ?? null,
        moduleAttributionSubjectId: module?.attribution_subject_id ?? null,
      },
    );
  }
  return effective;
}

/** The only binding-creation seam for recognized driver properties. */
export async function createRecognizedBinding(
  db: Queryable,
  input: {
    organizationId: string;
    projectId: string;
    logicalNodeId: string | null;
    parameterSpecId: string;
    parameterSpecVersionId: string;
    moduleId: string;
  },
): Promise<{
  binding: ProjectParameterBinding;
  definition: EffectiveDefinition;
}> {
  const definition = await requireRecognizedDefinitionForBinding(db, input);
  const binding = await createOrReuseBinding(db, {
    organizationId: input.organizationId,
    key: {
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId,
      parameterSpecId: input.parameterSpecId,
      moduleId: input.moduleId,
    },
  });
  return { binding, definition };
}
