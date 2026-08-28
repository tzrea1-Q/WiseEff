import { createHash, randomUUID } from "node:crypto";

import type { Database, Queryable } from "../../shared/database/client";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { createSystemInvocation } from "../auth/trustedInvocation";
import {
  ensureDriverRegistrationPlacement,
  getDriverRegistrationPlacement,
} from "../parameter-modules/driverRegistrationPlacement";
import { normalizeMatchToken } from "../parameter-modules/modulePlacement";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";

export type DefinitionReconciliationMode = "dry-run" | "apply";

export type DefinitionReconciliationItemStatus =
  "pending" | "already-reconciled" | "applied" | "blocked" | "skipped";

export type DefinitionReconciliationReport = {
  runId: string;
  mode: DefinitionReconciliationMode;
  status: "completed" | "blocked" | "failed";
  organizations: number;
  candidates: number;
  applied: number;
  alreadyReconciled: number;
  blocked: number;
  skipped: number;
  blockers: Array<{ code: string; count: number }>;
};

type SuspectRow = {
  organization_id: string;
  current_parameter_spec_id: string;
  previous_subject_id: string | null;
  property_key: string;
  current_version_id: string | null;
  current_version: number | string | null;
  current_version_status: string | null;
  current_version_lifecycle: string | null;
  current_driver_schema_id: string | null;
  current_parameter_property_key: string | null;
  current_dts_property_key: string | null;
  active_version_count: number | string | null;
  current_value_shape: unknown;
  binding_modules: unknown;
  observed_compatibles: unknown;
};

type BindingModuleEvidence = {
  id: string;
  kind: "business" | "driver-group" | "node-type" | "unclassified" | null;
  origin: "curated" | "auto" | null;
  parentId: string | null;
};

type CandidateRow = {
  parameter_spec_id: string;
  parameter_spec_version_id: string;
  attribution_subject_id: string | null;
  property_key: string;
  driver_schema_id: string;
  driver_schema_version_id: string;
  driver_schema_version: number | string;
  driver_schema_version_fingerprint: string;
  compatible_patterns: unknown;
  value_shape: unknown;
  display_name: string;
  description: string;
  schema_default: unknown;
  example_value: unknown;
  units: string | null;
  constraints: unknown;
  documentation: string | null;
  schema_namespace: string;
};

type CandidateDecision = {
  status: DefinitionReconciliationItemStatus;
  blockerCode: string | null;
  evidence: Record<string, unknown>;
  candidate: CandidateRow | null;
  nextSubjectId: string | null;
  placementModuleId: string | null;
  placementCategoryId: string | null;
};

type ReconciliationItemRow = {
  id: string;
  run_id: string;
  organization_id: string;
  property_key: string;
  current_parameter_spec_id: string | null;
  candidate_parameter_spec_id: string | null;
  previous_subject_id: string | null;
  next_subject_id: string | null;
  status: DefinitionReconciliationItemStatus;
  blocker_code: string | null;
  evidence: Record<string, unknown>;
};

class ReconciliationApplyBlocked extends Error {
  readonly blockerCode = "apply-skipped";

  constructor(readonly itemId: string) {
    super(
      `Reconciliation item ${itemId} no longer satisfies the apply preconditions.`,
    );
    this.name = "ReconciliationApplyBlocked";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBindingModuleEvidence(value: unknown): BindingModuleEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (typeof row.id !== "string") return [];
    return [
      {
        id: row.id,
        kind:
          row.kind === "business" ||
          row.kind === "driver-group" ||
          row.kind === "node-type" ||
          row.kind === "unclassified"
            ? row.kind
            : null,
        origin:
          row.origin === "curated" || row.origin === "auto" ? row.origin : null,
        parentId: typeof row.parentId === "string" ? row.parentId : null,
      } satisfies BindingModuleEvidence,
    ];
  });
}

function canonicalValues(value: unknown): string[] {
  return asStringArray(value)
    .map((item) => normalizeMatchToken(item))
    .filter((item): item is string => item !== null);
}

function shapeKind(value: unknown): string | null {
  const kind = asRecord(value).kind;
  return typeof kind === "string" && kind.length > 0 ? kind : null;
}

function shapesCompatible(left: unknown, right: unknown): boolean {
  const leftKind = shapeKind(left);
  const rightKind = shapeKind(right);
  if (
    !leftKind ||
    !rightKind ||
    leftKind === "unknown" ||
    rightKind === "unknown"
  )
    return true;
  return leftKind === rightKind;
}

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  return pattern.endsWith("*") && value.startsWith(pattern.slice(0, -1));
}

function deterministicItemId(input: {
  runId: string;
  organizationId: string;
  currentSpecId: string;
  propertyKey: string;
}): string {
  const digest = createHash("sha256")
    .update(
      `${input.runId}\u001f${input.organizationId}\u001f${input.currentSpecId}\u001f${input.propertyKey}`,
    )
    .digest("hex")
    .slice(0, 24);
  return `pdr-item:${digest}`;
}

async function listSuspects(
  db: Queryable,
  organizationId?: string,
): Promise<SuspectRow[]> {
  const values: unknown[] = [];
  const scope = organizationId
    ? `and ps.organization_id = $1`
    : "and ps.organization_id is not null";
  if (organizationId) values.push(organizationId);
  const result = await db.query<SuspectRow>(
    `
    select
      ps.organization_id,
      ps.id as current_parameter_spec_id,
      ps.attribution_subject_id as previous_subject_id,
      coalesce(ps.property_key, dps.property_key,
        nullif((string_to_array(ps.specification_key, '/'))[
          cardinality(string_to_array(ps.specification_key, '/'))
        ], '')) as property_key,
      current_version.id as current_version_id,
      current_version.version as current_version,
      current_version.version_status as current_version_status,
      current_version.lifecycle as current_version_lifecycle,
      dps.driver_schema_id as current_driver_schema_id,
      ps.property_key as current_parameter_property_key,
      dps.property_key as current_dts_property_key,
      current_version.value_shape as current_value_shape,
      (
        select count(*)
        from parameter_spec_versions active_versions
        where active_versions.parameter_spec_id = ps.id
          and active_versions.version_status = 'active'
          and active_versions.lifecycle = 'active'
      ) as active_version_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', b.module_id,
        'kind', binding_module.kind,
        'origin', binding_module.origin,
        'parentId', binding_module.parent_id
      )) filter (where b.module_id is not null) as binding_modules,
      array_agg(distinct lnr.compatible) filter (where lnr.compatible is not null) as observed_compatibles
    from parameter_specs ps
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    left join attribution_subjects asub on asub.id = ps.attribution_subject_id
    left join driver_schemas current_driver_schema on current_driver_schema.id = dps.driver_schema_id
    left join project_parameter_bindings b
      on b.parameter_spec_id = ps.id
     and b.organization_id = ps.organization_id
    left join parameter_modules binding_module on binding_module.id = b.module_id
    left join parameter_spec_versions current_version
      on current_version.id = (
          select psv.id
          from parameter_spec_versions psv
          where psv.parameter_spec_id = ps.id
          order by
          case when psv.version_status = 'active' and psv.lifecycle = 'active' then 0
               when psv.version_status = 'active' then 1
               when psv.version_status = 'superseded' then 2
               else 3 end,
          psv.version desc
        limit 1
      )
    left join lateral (
      select lnr.compatible
      from dts_logical_node_revisions lnr
      inner join dts_config_revisions lnr_revision
        on lnr_revision.id = lnr.config_revision_id
       and lnr_revision.project_id = b.project_id
       and lnr_revision.organization_id = b.organization_id
       and lnr_revision.status <> 'resolving'
       and (
         (
           select binding_node.config_set_id
           from dts_logical_nodes binding_node
           where binding_node.id = b.logical_node_id
         ) is null
         or lnr_revision.config_set_id = (
           select binding_node.config_set_id
           from dts_logical_nodes binding_node
           where binding_node.id = b.logical_node_id
         )
       )
      where lnr.logical_node_id = b.logical_node_id
      order by lnr_revision.revision_number desc, lnr_revision.id desc, lnr.id desc
      limit 1
    ) lnr on true
      where ps.source_kind in ('manual', 'dts')
      and ps.definition_lifecycle in ('draft', 'active')
      and (
        dps.driver_schema_id is null
        or ps.attribution_subject_id is null
        or (
          ps.attribution_subject_id is not null
          and asub.organization_id is not null
          and asub.organization_id is distinct from ps.organization_id
        )
        or (
          dps.driver_schema_id is not null
          and (
            (current_driver_schema.organization_id is not null
              and current_driver_schema.organization_id is distinct from ps.organization_id)
            or current_driver_schema.attribution_subject_id is distinct from ps.attribution_subject_id
            or not exists (
              select 1
              from driver_schema_versions active_schema_version
              where active_schema_version.driver_schema_id = dps.driver_schema_id
                and active_schema_version.lifecycle = 'active'
            )
          )
        )
        or (
          ps.source_kind = 'dts'
          and asub.subject_kind is distinct from 'driver-registration'
        )
        or (
          dps.id is not null
          and (
            ps.property_key is null
            or dps.property_key is null
            or ps.property_key is distinct from dps.property_key
          )
        )
        or (
          asub.subject_kind = 'driver-registration'
          and not exists (
            select 1
            from driver_registration_placements declared_placement
            inner join parameter_modules declared_group
              on declared_group.id = declared_placement.driver_group_module_id
             and declared_group.organization_id = declared_placement.organization_id
             and declared_group.kind = 'driver-group'
             and declared_group.attribution_subject_id = declared_placement.attribution_subject_id
            left join parameter_modules declared_category
              on declared_category.id = declared_placement.default_business_category_module_id
            where declared_placement.organization_id = ps.organization_id
              and declared_placement.attribution_subject_id = ps.attribution_subject_id
              and (
                declared_placement.default_business_category_module_id is null
                or (
                  declared_category.id is not null
                  and declared_category.organization_id = declared_placement.organization_id
                  and declared_category.kind = 'business'
                )
              )
          )
        )
        or b.module_id is null
        or binding_module.id is null
        or binding_module.kind not in ('driver-group', 'node-type')
        or binding_module.attribution_subject_id is null
        or (
          select count(*)
          from parameter_spec_versions active_versions
          where active_versions.parameter_spec_id = ps.id
            and active_versions.version_status = 'active'
            and active_versions.lifecycle = 'active'
        ) <> 1
      )
      and (dps.id is not null or ps.attribution_subject_id is not null)
      -- Node-type definitions are a separate taxonomy surface (ADR-0013),
      -- not driver/property catalog candidates for this reconciliation.
      and asub.subject_kind is distinct from 'node-type-definition'
      ${scope}
    group by
      ps.organization_id,
      ps.id,
      ps.attribution_subject_id,
      ps.property_key,
      dps.property_key,
      current_version.id,
      current_version.version,
      current_version.version_status,
      current_version.lifecycle,
      current_version.value_shape
      ,dps.driver_schema_id
      ,dps.property_key
      ,ps.property_key
    order by ps.organization_id, ps.id
    `,
    values,
  );
  return result.rows;
}

async function listPlatformCandidates(
  db: Queryable,
  propertyKey: string,
): Promise<CandidateRow[]> {
  const result = await db.query<CandidateRow>(
    `
    select
      ps.id as parameter_spec_id,
      psv.id as parameter_spec_version_id,
      ps.attribution_subject_id,
      coalesce(ps.property_key, dps.property_key) as property_key,
      ds.id as driver_schema_id,
      ds.schema_namespace,
      dsv.id as driver_schema_version_id,
      dsv.version as driver_schema_version,
      md5(dsv.compatible_patterns::text) as driver_schema_version_fingerprint,
      dsv.compatible_patterns,
      psv.value_shape,
      psv.display_name,
      psv.description,
      psv.schema_default,
      psv.example_value,
      psv.units,
      psv.constraints,
      psv.documentation
    from parameter_specs ps
    inner join parameter_spec_versions psv on psv.parameter_spec_id = ps.id
    inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
    inner join attribution_subjects asub
      on asub.id = ps.attribution_subject_id
     and asub.organization_id is null
    inner join driver_schemas ds
      on ds.organization_id is null
     and ds.attribution_subject_id is not null
     and (ps.attribution_subject_id is null or ds.attribution_subject_id = ps.attribution_subject_id)
     and (
       ds.id = dps.driver_schema_id
       or (dps.driver_schema_id is null and ds.schema_namespace = dps.schema_namespace)
     )
    inner join lateral (
      select id, version, compatible_patterns, lifecycle,
             md5(compatible_patterns::text) as compatible_patterns_fingerprint
      from driver_schema_versions
      where driver_schema_id = ds.id
        and lifecycle = 'active'
      order by version desc, id desc
      limit 1
    ) dsv on true
    where ps.organization_id is null
      and ps.source_kind = 'dts'
      and ps.definition_lifecycle = 'active'
      and psv.version_status = 'active'
      and psv.lifecycle = 'active'
      and (
        select count(*)
        from parameter_spec_versions active_versions
        where active_versions.parameter_spec_id = ps.id
          and active_versions.version_status = 'active'
          and active_versions.lifecycle = 'active'
      ) = 1
      and coalesce(ps.property_key, dps.property_key) = $1
    order by ps.id
    `,
    [propertyKey],
  );
  return result.rows;
}

async function subjectOrigin(
  db: Queryable,
  subjectId: string | null,
): Promise<string | null> {
  if (!subjectId) return null;
  const result = await db.query<{ origin: string | null }>(
    `select origin from attribution_subjects where id = $1 limit 1`,
    [subjectId],
  );
  return result.rows[0]?.origin ?? null;
}

async function identityCollision(
  db: Queryable,
  input: {
    organizationId: string;
    subjectId: string;
    propertyKey: string;
    currentSpecId: string;
  },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    select ps.id
    from parameter_specs ps
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    where ps.organization_id = $1
      and ps.attribution_subject_id = $2
      and coalesce(ps.property_key, dps.property_key) = $3
      and ps.id <> $4
    limit 1
    `,
    [
      input.organizationId,
      input.subjectId,
      input.propertyKey,
      input.currentSpecId,
    ],
  );
  return result.rows[0]?.id ?? null;
}

async function classifySuspect(
  db: Queryable,
  suspect: SuspectRow,
  platformCandidates: CandidateRow[],
): Promise<CandidateDecision> {
  const bindingModules = asBindingModuleEvidence(suspect.binding_modules);
  const observed = canonicalValues(suspect.observed_compatibles);
  const activeVersionCount = Number(suspect.active_version_count ?? 0);
  if (
    suspect.current_dts_property_key !== null &&
    (suspect.current_parameter_property_key === null ||
      suspect.current_parameter_property_key !==
        suspect.current_dts_property_key)
  ) {
    return {
      status: "blocked",
      blockerCode: "property-key-mismatch",
      evidence: {
        parameterPropertyKey: suspect.current_parameter_property_key,
        dtsPropertyKey: suspect.current_dts_property_key,
        bindingModules,
      },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }
  if (activeVersionCount > 1) {
    return {
      status: "blocked",
      blockerCode: "multiple-active-versions",
      evidence: { activeVersionCount, bindingModules },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }
  const moduleSources = bindingModules.length
    ? await db.query<{ id: string; source_key: string | null }>(
        `select id, source_key from parameter_modules where id = any($1::text[])`,
        [bindingModules.map((module) => module.id)],
      )
    : { rows: [] as Array<{ id: string; source_key: string | null }> };
  const moduleCompatibles = moduleSources.rows.flatMap((module) => {
    if (!module.source_key?.startsWith("compatible:")) return [];
    const normalized = normalizeMatchToken(
      module.source_key.slice("compatible:".length),
    );
    return normalized ? [normalized] : [];
  });
  const evidenceCompatible = [...new Set([...observed, ...moduleCompatibles])];
  if (evidenceCompatible.length === 0) {
    return {
      status: "blocked",
      blockerCode: "missing-driver-evidence",
      evidence: { observedCompatibles: observed, bindingModules },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }

  const matches = platformCandidates.filter((candidate) => {
    const patterns = canonicalValues(candidate.compatible_patterns);
    return patterns.some((pattern) =>
      evidenceCompatible.some((value) => patternMatches(pattern, value)),
    );
  });
  if (matches.length === 0) {
    return {
      status: "blocked",
      blockerCode: "no-active-platform-candidate",
      evidence: {
        observedCompatibles: evidenceCompatible,
        propertyKey: suspect.property_key,
      },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }
  if (matches.length > 1) {
    return {
      status: "blocked",
      blockerCode: "multiple-active-platform-candidates",
      evidence: {
        observedCompatibles: evidenceCompatible,
        candidateSpecIds: matches.map((row) => row.parameter_spec_id),
      },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }

  const candidate = matches[0]!;
  if (!candidate.attribution_subject_id) {
    return {
      status: "blocked",
      blockerCode: "candidate-missing-subject",
      evidence: { candidateSpecId: candidate.parameter_spec_id },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }
  if (!shapesCompatible(suspect.current_value_shape, candidate.value_shape)) {
    return {
      status: "blocked",
      blockerCode: "incompatible-value-shape",
      evidence: {
        currentShapeKind: shapeKind(suspect.current_value_shape),
        candidateShapeKind: shapeKind(candidate.value_shape),
        candidateSpecId: candidate.parameter_spec_id,
      },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }

  const placement = await getDriverRegistrationPlacement(db, {
    organizationId: suspect.organization_id,
    attributionSubjectId: candidate.attribution_subject_id,
  });
  let placementModuleId = placement?.driverGroupModuleId ?? null;
  let placementCategoryId = placement?.defaultBusinessCategoryModuleId ?? null;
  if (!placementModuleId) {
    const candidateModules = await db.query<{
      id: string;
      parent_id: string | null;
      origin: "curated" | "auto";
    }>(
      `select id, parent_id, origin
       from parameter_modules
       where organization_id = $1
         and kind = 'driver-group'
         and attribution_subject_id = $2
       order by case when origin = 'curated' then 0 else 1 end, id
       limit 2`,
      [suspect.organization_id, candidate.attribution_subject_id],
    );
    if (candidateModules.rows.length > 1) {
      return {
        status: "blocked",
        blockerCode: "multiple-driver-placements",
        evidence: {
          candidateSubjectId: candidate.attribution_subject_id,
          candidateModuleIds: candidateModules.rows.map((module) => module.id),
        },
        candidate: null,
        nextSubjectId: null,
        placementModuleId: null,
        placementCategoryId: null,
      };
    }
    const autoDriverGroup = bindingModules.filter(
      (module) => module.kind === "driver-group" && module.origin === "auto",
    );
    const fallbackModule =
      candidateModules.rows[0] ??
      (autoDriverGroup.length === 1
        ? {
            id: autoDriverGroup[0]!.id,
            parent_id: autoDriverGroup[0]!.parentId,
            origin: "auto" as const,
          }
        : null);
    if (!fallbackModule) {
      return {
        status: "blocked",
        blockerCode: "missing-driver-placement",
        evidence: {
          candidateSubjectId: candidate.attribution_subject_id,
          bindingModules,
        },
        candidate: null,
        nextSubjectId: null,
        placementModuleId: null,
        placementCategoryId: null,
      };
    }
    const category = await db.query<{ kind: string | null; id: string | null }>(
      `select id, kind from parameter_modules where id = $1 limit 1`,
      [fallbackModule.parent_id],
    );
    if (category.rows[0]?.kind !== "business") {
      return {
        status: "blocked",
        blockerCode: "missing-driver-placement-category",
        evidence: {
          moduleId: fallbackModule.id,
          parentId: fallbackModule.parent_id,
          bindingModules,
        },
        candidate: null,
        nextSubjectId: null,
        placementModuleId: null,
        placementCategoryId: null,
      };
    }
    placementModuleId = fallbackModule.id;
    placementCategoryId = category.rows[0].id;
  }

  const origin = await subjectOrigin(db, suspect.previous_subject_id);
  if (origin === "curated") {
    return {
      status: "blocked",
      blockerCode: "curated-subject-requires-review",
      evidence: { previousSubjectId: suspect.previous_subject_id },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }

  const collision = await identityCollision(db, {
    organizationId: suspect.organization_id,
    subjectId: candidate.attribution_subject_id,
    propertyKey: suspect.property_key,
    currentSpecId: suspect.current_parameter_spec_id,
  });
  if (collision) {
    return {
      status: "blocked",
      blockerCode: "identity-collision",
      evidence: {
        collidingSpecId: collision,
        candidateSubjectId: candidate.attribution_subject_id,
      },
      candidate: null,
      nextSubjectId: null,
      placementModuleId: null,
      placementCategoryId: null,
    };
  }

  const bindingHasPlacement = placementModuleId
    ? bindingModules.some((module) => module.id === placementModuleId)
    : false;
  const alreadyReconciled =
    suspect.previous_subject_id === candidate.attribution_subject_id &&
    suspect.current_version_id === candidate.parameter_spec_version_id &&
    bindingHasPlacement;
  return {
    status: alreadyReconciled ? "already-reconciled" : "pending",
    blockerCode: null,
    evidence: {
      observedCompatibles: evidenceCompatible,
      bindingModules,
      candidateSpecId: candidate.parameter_spec_id,
      candidateVersionId: candidate.parameter_spec_version_id,
      candidateDriverSchemaId: candidate.driver_schema_id,
      candidateDriverSchemaVersionId: candidate.driver_schema_version_id,
      candidateDriverSchemaVersion: Number(candidate.driver_schema_version),
      candidateDriverSchemaVersionFingerprint:
        candidate.driver_schema_version_fingerprint,
      placementModuleId,
      placementCategoryId,
    },
    candidate,
    nextSubjectId: candidate.attribution_subject_id,
    placementModuleId,
    placementCategoryId,
  };
}

async function insertRun(
  db: Queryable,
  input: {
    runId: string;
    organizationId?: string;
    mode: DefinitionReconciliationMode;
    phase: "preflight" | "apply";
  },
): Promise<void> {
  await db.query(
    `
    insert into parameter_definition_reconciliation_runs
      (id, organization_id, mode, phase, status, invocation, report)
    values ($1, $2, $3, $4, 'planned', $5::jsonb, '{}'::jsonb)
    on conflict (id) do nothing
    `,
    [
      input.runId,
      input.organizationId ?? null,
      input.mode,
      input.phase,
      JSON.stringify({
        kind: "job",
        name: "parameter-definition-reconciliation",
      }),
    ],
  );
}

async function persistItem(
  db: Queryable,
  input: {
    runId: string;
    suspect: SuspectRow;
    decision: CandidateDecision;
  },
): Promise<ReconciliationItemRow> {
  const candidate = input.decision.candidate;
  const itemId = deterministicItemId({
    runId: input.runId,
    organizationId: input.suspect.organization_id,
    currentSpecId: input.suspect.current_parameter_spec_id,
    propertyKey: input.suspect.property_key,
  });
  const evidence = {
    ...input.decision.evidence,
    currentVersionId: input.suspect.current_version_id,
    currentVersion: input.suspect.current_version,
    currentVersionStatus: input.suspect.current_version_status,
    currentVersionLifecycle: input.suspect.current_version_lifecycle,
    currentDriverSchemaId: input.suspect.current_driver_schema_id,
    currentParameterPropertyKey: input.suspect.current_parameter_property_key,
    currentDtsPropertyKey: input.suspect.current_dts_property_key,
    previousSubjectId: input.suspect.previous_subject_id,
    bindingModules: asBindingModuleEvidence(input.suspect.binding_modules),
    candidateDisplayName: candidate?.display_name ?? null,
  };
  const result = await db.query<ReconciliationItemRow>(
    `
    insert into parameter_definition_reconciliation_items (
      id, run_id, organization_id, property_key,
      current_parameter_spec_id, candidate_parameter_spec_id,
      previous_subject_id, next_subject_id, status, blocker_code, evidence
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    on conflict (run_id, organization_id, current_parameter_spec_id, property_key) do update set
      candidate_parameter_spec_id = excluded.candidate_parameter_spec_id,
      previous_subject_id = excluded.previous_subject_id,
      next_subject_id = excluded.next_subject_id,
      status = excluded.status,
      blocker_code = excluded.blocker_code,
      evidence = excluded.evidence,
      updated_at = now()
    returning *
    `,
    [
      itemId,
      input.runId,
      input.suspect.organization_id,
      input.suspect.property_key,
      input.suspect.current_parameter_spec_id,
      candidate?.parameter_spec_id ?? null,
      input.suspect.previous_subject_id,
      input.decision.nextSubjectId,
      input.decision.status,
      input.decision.blockerCode,
      JSON.stringify(evidence),
    ],
  );
  return result.rows[0]!;
}

function buildReport(
  runId: string,
  mode: DefinitionReconciliationMode,
  items: ReconciliationItemRow[],
): DefinitionReconciliationReport {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  const blockerCounts = new Map<string, number>();
  for (const item of items) {
    if (item.blocker_code)
      blockerCounts.set(
        item.blocker_code,
        (blockerCounts.get(item.blocker_code) ?? 0) + 1,
      );
  }
  const organizations = new Set(items.map((item) => item.organization_id)).size;
  const blocked = counts.get("blocked") ?? 0;
  return {
    runId,
    mode,
    // An apply item that cannot be committed is converted to a blocker below;
    // never report a partially repaired run as completed merely because the
    // transaction did not throw.
    status:
      blocked > 0 || (counts.get("skipped") ?? 0) > 0 ? "blocked" : "completed",
    organizations,
    candidates: items.filter(
      (item) => item.candidate_parameter_spec_id !== null,
    ).length,
    applied: counts.get("applied") ?? 0,
    alreadyReconciled: counts.get("already-reconciled") ?? 0,
    blocked,
    skipped: counts.get("skipped") ?? 0,
    blockers: [...blockerCounts.entries()].map(([code, count]) => ({
      code,
      count,
    })),
  };
}

async function applyItem(
  tx: Queryable,
  item: ReconciliationItemRow,
  runId: string,
): Promise<DefinitionReconciliationItemStatus> {
  if (
    !item.current_parameter_spec_id ||
    !item.candidate_parameter_spec_id ||
    !item.next_subject_id
  ) {
    return "skipped";
  }
  const evidence = asRecord(item.evidence);
  const expectedPreviousSubjectId =
    typeof evidence.previousSubjectId === "string"
      ? evidence.previousSubjectId
      : item.previous_subject_id;
  const expectedCurrentVersionId =
    typeof evidence.currentVersionId === "string"
      ? evidence.currentVersionId
      : null;
  const expectedCurrentVersion =
    typeof evidence.currentVersion === "number" ||
    typeof evidence.currentVersion === "string"
      ? Number(evidence.currentVersion)
      : null;
  const expectedCurrentVersionStatus =
    typeof evidence.currentVersionStatus === "string"
      ? evidence.currentVersionStatus
      : null;
  const expectedCurrentVersionLifecycle =
    typeof evidence.currentVersionLifecycle === "string"
      ? evidence.currentVersionLifecycle
      : null;
  const expectedCurrentDriverSchemaId =
    typeof evidence.currentDriverSchemaId === "string"
      ? evidence.currentDriverSchemaId
      : null;
  const expectedCurrentDtsPropertyKey =
    typeof evidence.currentDtsPropertyKey === "string"
      ? evidence.currentDtsPropertyKey
      : null;
  const expectedVersionId =
    typeof evidence.candidateVersionId === "string"
      ? evidence.candidateVersionId
      : null;
  const expectedSchemaId =
    typeof evidence.candidateDriverSchemaId === "string"
      ? evidence.candidateDriverSchemaId
      : null;
  const expectedSchemaVersionId =
    typeof evidence.candidateDriverSchemaVersionId === "string"
      ? evidence.candidateDriverSchemaVersionId
      : null;
  const expectedSchemaVersion =
    typeof evidence.candidateDriverSchemaVersion === "number" ||
    typeof evidence.candidateDriverSchemaVersion === "string"
      ? Number(evidence.candidateDriverSchemaVersion)
      : null;
  const expectedSchemaVersionFingerprint =
    typeof evidence.candidateDriverSchemaVersionFingerprint === "string"
      ? evidence.candidateDriverSchemaVersionFingerprint
      : null;
  if (
    !expectedVersionId ||
    !expectedSchemaId ||
    !expectedSchemaVersionId ||
    expectedSchemaVersion === null ||
    !expectedSchemaVersionFingerprint
  )
    return "skipped";

  // Preflight evidence is advisory. Lock both the dirty organization row and
  // the platform candidate, then re-read their identity/lifecycle tuple so a
  // concurrent registry edit cannot apply a stale repair.
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [
    item.current_parameter_spec_id,
  ]);
  const currentSpec = await tx.query<{
    id: string;
    organization_id: string | null;
    attribution_subject_id: string | null;
    property_key: string | null;
    parameter_property_key: string | null;
    definition_lifecycle: string;
    driver_schema_id: string | null;
    dts_property_key: string | null;
  }>(
    `
    select ps.id, ps.organization_id,
           ps.attribution_subject_id,
           coalesce(ps.property_key, dps.property_key) as property_key,
           ps.property_key as parameter_property_key,
           ps.definition_lifecycle,
           dps.driver_schema_id,
           dps.property_key as dts_property_key
    from parameter_specs ps
    left join dts_property_specs dps on dps.parameter_spec_id = ps.id
    where ps.id = $1
    for update of ps
    `,
    [item.current_parameter_spec_id],
  );
  const current = currentSpec.rows[0];
  const currentDts = await tx.query<{
    driver_schema_id: string | null;
    property_key: string | null;
  }>(
    `select driver_schema_id, property_key
     from dts_property_specs
     where parameter_spec_id = $1
     for update`,
    [item.current_parameter_spec_id],
  );
  const lockedDts = currentDts.rows[0] ?? null;
  const currentPropertyKey =
    current?.parameter_property_key ?? lockedDts?.property_key ?? null;
  const currentVersion = await tx.query<{
    id: string;
    version: number;
    version_status: string;
    lifecycle: string;
  }>(
    `
    select id, version, version_status, lifecycle
    from parameter_spec_versions
    where parameter_spec_id = $1
    order by
      case when version_status = 'active' and lifecycle = 'active' then 0
           when version_status = 'active' then 1
           when version_status = 'superseded' then 2
           else 3 end,
      version desc
    limit 1
    for update
    `,
    [item.current_parameter_spec_id],
  );
  const currentVersionRow = currentVersion.rows[0];
  if (
    !current ||
    current.organization_id !== item.organization_id ||
    currentPropertyKey !== item.property_key ||
    current.attribution_subject_id !== expectedPreviousSubjectId ||
    (lockedDts?.driver_schema_id ?? null) !== expectedCurrentDriverSchemaId ||
    (lockedDts?.property_key ?? null) !== expectedCurrentDtsPropertyKey ||
    (currentVersionRow?.id ?? null) !== expectedCurrentVersionId ||
    (currentVersionRow?.version ?? null) !== expectedCurrentVersion ||
    (currentVersionRow?.version_status ?? null) !==
      expectedCurrentVersionStatus ||
    (currentVersionRow?.lifecycle ?? null) !==
      expectedCurrentVersionLifecycle ||
    current.definition_lifecycle === "deprecated"
  ) {
    return "skipped";
  }

  // Existing non-null subject/schema disagreements are deliberately retained
  // as migration evidence, while 0124 rejects that tuple on ordinary writes.
  // Clear only the transient property-to-schema link inside this locked,
  // audited transaction; the next statement writes the canonical subject and
  // the later upsert restores the verified schema/property tuple. The row is
  // never externally visible between these statements, and any failure rolls
  // the whole organization transaction back.
  if (expectedCurrentDriverSchemaId) {
    const detached = await tx.query(
      `update dts_property_specs
       set driver_schema_id = null
       where parameter_spec_id = $1
         and driver_schema_id = $2`,
      [item.current_parameter_spec_id, expectedCurrentDriverSchemaId],
    );
    if (detached.rowCount !== 1) return "skipped";
  }
  await tx.query(
    `select id from parameter_spec_versions where id = $1 for update`,
    [expectedVersionId],
  );
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [
    expectedSchemaId,
  ]);
  await tx.query(`select id from parameter_specs where id = $1 for update`, [
    item.candidate_parameter_spec_id,
  ]);
  const placementModuleId =
    typeof evidence.placementModuleId === "string"
      ? evidence.placementModuleId
      : null;
  const placementCategoryId =
    typeof evidence.placementCategoryId === "string"
      ? evidence.placementCategoryId
      : null;
  const candidate = await tx.query<CandidateRow>(
    `
    select
      ps.id as parameter_spec_id,
      psv.id as parameter_spec_version_id,
      ps.attribution_subject_id,
      coalesce(ps.property_key, dps.property_key) as property_key,
      ds.id as driver_schema_id,
      ds.schema_namespace,
      dsv.id as driver_schema_version_id,
      dsv.version as driver_schema_version,
      md5(dsv.compatible_patterns::text) as driver_schema_version_fingerprint,
      dsv.compatible_patterns,
      psv.value_shape,
      psv.display_name,
      psv.description,
      psv.schema_default,
      psv.example_value,
      psv.units,
      psv.constraints,
      psv.documentation
    from parameter_specs ps
    inner join parameter_spec_versions psv on psv.parameter_spec_id = ps.id
    inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
    inner join driver_schemas ds
      on ds.id = dps.driver_schema_id
     and ds.organization_id is null
     and ds.attribution_subject_id = ps.attribution_subject_id
    inner join lateral (
      select id, version, compatible_patterns, lifecycle
      from driver_schema_versions
      where driver_schema_id = ds.id
        and lifecycle = 'active'
      order by version desc, id desc
      limit 1
    ) dsv on true
    where ps.id = $1
      and ps.organization_id is null
      and ps.source_kind = 'dts'
      and ps.definition_lifecycle = 'active'
      and psv.id = $2
      and psv.version_status = 'active'
      and psv.lifecycle = 'active'
      and (
        select count(*)
        from parameter_spec_versions active_versions
        where active_versions.parameter_spec_id = ps.id
          and active_versions.version_status = 'active'
          and active_versions.lifecycle = 'active'
      ) = 1
      and coalesce(ps.property_key, dps.property_key) = $3
    limit 1
    `,
    [item.candidate_parameter_spec_id, expectedVersionId, item.property_key],
  );
  const candidateRow = candidate.rows[0];
  if (
    !candidateRow?.attribution_subject_id ||
    candidateRow.attribution_subject_id !== item.next_subject_id ||
    candidateRow.driver_schema_id !== expectedSchemaId ||
    candidateRow.driver_schema_version_id !== expectedSchemaVersionId ||
    Number(candidateRow.driver_schema_version) !== expectedSchemaVersion ||
    candidateRow.driver_schema_version_fingerprint !==
      expectedSchemaVersionFingerprint
  ) {
    return "skipped";
  }

  let targetModuleId = placementModuleId;
  if (!targetModuleId) return "skipped";
  const existingModule = await tx.query<{
    id: string;
    kind: string;
    origin: string;
    source_key: string | null;
    attribution_subject_id: string | null;
  }>(
    `select id, kind, origin, source_key, attribution_subject_id
     from parameter_modules where id = $1 and organization_id = $2`,
    [targetModuleId, item.organization_id],
  );
  let module = existingModule.rows[0];
  if (!module || module.kind !== "driver-group") return "skipped";
  if (module.attribution_subject_id !== candidateRow.attribution_subject_id) {
    if (module.origin !== "auto") return "skipped";
    const candidatePatterns = canonicalValues(candidateRow.compatible_patterns);
    const moduleCompatible = module.source_key?.startsWith("compatible:")
      ? normalizeMatchToken(module.source_key.slice("compatible:".length))
      : null;
    if (
      !moduleCompatible ||
      !candidatePatterns.some((pattern) =>
        patternMatches(pattern, moduleCompatible),
      )
    ) {
      return "skipped";
    }
    // Match the ingest placement lock order (placements before module) so a
    // concurrent replay cannot deadlock while moving an auto group between
    // canonical subjects.
    const modulePlacements = await tx.query<{ id: string }>(
      `select id
       from driver_registration_placements
       where organization_id = $1 and driver_group_module_id = $2
       for update`,
      [item.organization_id, targetModuleId],
    );
    const collision = await tx.query<{ id: string }>(
      `select id
       from driver_registration_placements
       where organization_id = $1
         and attribution_subject_id = $2
         and driver_group_module_id <> $3
       for update`,
      [
        item.organization_id,
        candidateRow.attribution_subject_id,
        targetModuleId,
      ],
    );
    if (collision.rows.length > 0) return "skipped";
    const lockedModule = await tx.query<{
      id: string;
      kind: string;
      origin: string;
      source_key: string | null;
      attribution_subject_id: string | null;
    }>(
      `select id, kind, origin, source_key, attribution_subject_id
       from parameter_modules where id = $1 and organization_id = $2 for update`,
      [targetModuleId, item.organization_id],
    );
    module = lockedModule.rows[0];
    if (
      !module ||
      module.kind !== "driver-group" ||
      module.origin !== "auto" ||
      module.attribution_subject_id !==
        existingModule.rows[0]?.attribution_subject_id
    ) {
      return "skipped";
    }
    await tx.query(
      `update parameter_modules set attribution_subject_id = $2, updated_at = now() where id = $1`,
      [targetModuleId, candidateRow.attribution_subject_id],
    );
    if (modulePlacements.rows.length > 0) {
      await tx.query(
        `update driver_registration_placements
         set attribution_subject_id = $2, updated_at = now()
         where organization_id = $1 and driver_group_module_id = $3`,
        [
          item.organization_id,
          candidateRow.attribution_subject_id,
          targetModuleId,
        ],
      );
    }
  }
  const placement = await ensureDriverRegistrationPlacement(tx, {
    organizationId: item.organization_id,
    attributionSubjectId: candidateRow.attribution_subject_id,
    driverGroupModuleId: targetModuleId,
    defaultBusinessCategoryModuleId: placementCategoryId,
  });
  if (!placement) return "skipped";
  if (placement.driverGroupModuleId !== targetModuleId) return "skipped";

  const repairedIdentity = buildSubjectScopedManualSpecIds({
    organizationId: item.organization_id,
    attributionSubjectId: candidateRow.attribution_subject_id,
    propertyKey: item.property_key,
  });
  await tx.query(
    `
    update parameter_specs
    set attribution_subject_id = $2,
        property_key = $3,
        specification_key = $4,
        definition_lifecycle = 'active'
    where id = $1
    `,
    [
      item.current_parameter_spec_id,
      candidateRow.attribution_subject_id,
      item.property_key,
      repairedIdentity.specificationKey,
    ],
  );
  await tx.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    on conflict (parameter_spec_id) do update set
      driver_schema_id = excluded.driver_schema_id,
      property_key = excluded.property_key,
      schema_namespace = excluded.schema_namespace,
      units = excluded.units,
      constraints = excluded.constraints,
      documentation = excluded.documentation
    `,
    [
      `dps:${item.current_parameter_spec_id}`,
      item.current_parameter_spec_id,
      candidateRow.driver_schema_id,
      item.property_key,
      candidateRow.schema_namespace,
      candidateRow.units,
      JSON.stringify(candidateRow.constraints ?? {}),
      candidateRow.documentation,
    ],
  );

  const nextVersion = await tx.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version from parameter_spec_versions where parameter_spec_id = $1`,
    [item.current_parameter_spec_id],
  );
  const version = Number(nextVersion.rows[0]?.version ?? 1);
  const successorId = `psv:reconciliation:${createHash("sha256")
    .update(
      `${runId}\u001f${item.current_parameter_spec_id}\u001f${candidateRow.parameter_spec_version_id}`,
    )
    .digest("hex")
    .slice(0, 24)}:v${version}`;
  await tx.query(
    `
    update parameter_spec_versions
    set lifecycle = 'deprecated',
        version_status = 'superseded'
    where parameter_spec_id = $1
      and version_status = 'active'
    `,
    [item.current_parameter_spec_id],
  );
  await tx.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle, version_status, activated_at,
      units, constraints, documentation
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'active', 'active', now(), $9, $10::jsonb, $11)
    on conflict (parameter_spec_id, version) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      value_shape = excluded.value_shape,
      schema_default = excluded.schema_default,
      example_value = excluded.example_value,
      lifecycle = excluded.lifecycle,
      version_status = excluded.version_status,
      activated_at = coalesce(parameter_spec_versions.activated_at, excluded.activated_at),
      units = excluded.units,
      constraints = excluded.constraints,
      documentation = excluded.documentation
    `,
    [
      successorId,
      item.current_parameter_spec_id,
      version,
      candidateRow.display_name,
      candidateRow.description,
      JSON.stringify(candidateRow.value_shape ?? { kind: "unknown" }),
      candidateRow.schema_default === undefined
        ? null
        : JSON.stringify(candidateRow.schema_default),
      candidateRow.example_value === undefined
        ? null
        : JSON.stringify(candidateRow.example_value),
      candidateRow.units,
      JSON.stringify(candidateRow.constraints ?? {}),
      candidateRow.documentation,
    ],
  );

  // Lock every binding that will receive the repaired version before choosing
  // its config-set head. A concurrent ingest must either finish before this
  // transaction or observe the repaired tuple afterwards; it must never be
  // silently overwritten by the broad update below.
  const bindingsToUpdate = await tx.query<{
    id: string;
    logical_node_id: string | null;
    project_id: string;
  }>(
    `select id, logical_node_id, project_id
     from project_parameter_bindings
     where parameter_spec_id = $1 and organization_id = $2
     order by id
     for update`,
    [item.current_parameter_spec_id, item.organization_id],
  );
  for (const binding of bindingsToUpdate.rows) {
    const head = await tx.query<{
      parameter_spec_version_id: string;
    }>(
      `select br.parameter_spec_version_id
       from project_parameter_binding_revisions br
       inner join dts_config_revisions cr on cr.id = br.config_revision_id
       left join dts_logical_nodes binding_node on binding_node.id = $2
       where br.binding_id = $1
         and cr.project_id = $3
         and cr.organization_id = $4
         and cr.status <> 'resolving'
         and (
           binding_node.config_set_id is null
           or (
             cr.config_set_id = binding_node.config_set_id
             and exists (
               select 1
               from dts_logical_node_revisions binding_node_revision
               where binding_node_revision.config_revision_id = cr.id
                 and binding_node_revision.logical_node_id = binding_node.id
             )
           )
         )
       order by cr.revision_number desc, br.created_at desc, br.id desc
       limit 1
       for update of br`,
      [
        binding.id,
        binding.logical_node_id,
        binding.project_id,
        item.organization_id,
      ],
    );
    if (
      expectedCurrentVersionId &&
      head.rows[0] &&
      head.rows[0].parameter_spec_version_id !== expectedCurrentVersionId
    ) {
      return "skipped";
    }
  }
  await tx.query(
    `
    update project_parameter_binding_revisions br
    set parameter_spec_version_id = $2,
        schema_state = 'valid'
    from project_parameter_bindings b
      where b.id = br.binding_id
      and b.parameter_spec_id = $1
      and b.organization_id = $3
      and br.config_revision_id = (
        select cr.id
        from dts_config_revisions cr
        left join dts_logical_nodes binding_node on binding_node.id = b.logical_node_id
        where cr.project_id = b.project_id
          and cr.organization_id = b.organization_id
          and cr.status <> 'resolving'
          and (
            (
              binding_node.config_set_id is not null
              and cr.config_set_id = binding_node.config_set_id
              and exists (
                select 1
                from dts_logical_node_revisions binding_node_revision
                where binding_node_revision.config_revision_id = cr.id
                  and binding_node_revision.logical_node_id = b.logical_node_id
              )
            )
            or (
              binding_node.config_set_id is null
              and exists (
                select 1
                from project_parameter_binding_revisions existing_revision
                where existing_revision.binding_id = b.id
                  and existing_revision.config_revision_id = cr.id
              )
            )
          )
        order by cr.revision_number desc, cr.id desc
        limit 1
      )
    `,
    [item.current_parameter_spec_id, successorId, item.organization_id],
  );
  await tx.query(
    `update project_parameter_bindings set module_id = $2 where parameter_spec_id = $1 and organization_id = $3`,
    [
      item.current_parameter_spec_id,
      placement.driverGroupModuleId,
      item.organization_id,
    ],
  );
  await writeTrustedAuditEventInTx(asAuditTx(tx), {
    invocation: createSystemInvocation({
      kind: "job",
      name: "parameter-definition-reconciliation",
    }),
    organizationId: item.organization_id,
    projectId: null,
    app: "parameter-management",
    kind: "parameter-definition-reconciliation",
    action: "reconcile",
    severity: "Medium",
    targetType: "parameter-spec",
    targetId: item.current_parameter_spec_id,
    metadata: {
      runId,
      propertyKey: item.property_key,
      previousSubjectId: item.previous_subject_id,
      nextSubjectId: candidateRow.attribution_subject_id,
      candidateParameterSpecId: candidateRow.parameter_spec_id,
      candidateDriverSchemaId: candidateRow.driver_schema_id,
      successorVersionId: successorId,
      placementModuleId: placement.driverGroupModuleId,
      placementCategoryId: placement.defaultBusinessCategoryModuleId,
    },
    traceId: runId,
  });
  return "applied";
}

export async function reconcileDriverParameterDefinitions(
  db: Database,
  options: {
    mode: DefinitionReconciliationMode;
    organizationId?: string;
    runId?: string;
  },
): Promise<DefinitionReconciliationReport> {
  const runId = options.runId ?? `pdr:${randomUUID()}`;
  await insertRun(db, {
    runId,
    organizationId: options.organizationId,
    mode: options.mode,
    phase: options.mode === "apply" ? "preflight" : "preflight",
  });
  const items = await db.transaction(async (tx) => {
    await tx.query(
      `update parameter_definition_reconciliation_runs set status = 'running' where id = $1`,
      [runId],
    );
    const suspects = await listSuspects(tx, options.organizationId);
    const platformByProperty = new Map<string, CandidateRow[]>();
    const persisted: ReconciliationItemRow[] = [];
    for (const suspect of suspects) {
      let candidates = platformByProperty.get(suspect.property_key);
      if (!candidates) {
        candidates = await listPlatformCandidates(tx, suspect.property_key);
        platformByProperty.set(suspect.property_key, candidates);
      }
      const decision = await classifySuspect(tx, suspect, candidates);
      persisted.push(await persistItem(tx, { runId, suspect, decision }));
    }
    return persisted;
  });

  if (options.mode === "apply") {
    const pendingByOrg = new Map<string, ReconciliationItemRow[]>();
    for (const item of items) {
      if (item.status !== "pending") continue;
      const list = pendingByOrg.get(item.organization_id) ?? [];
      list.push(item);
      pendingByOrg.set(item.organization_id, list);
    }
    for (const [organizationId, organizationItems] of pendingByOrg) {
      try {
        await db.transaction(async (tx) => {
          for (const item of organizationItems) {
            const attemptedStatus = await applyItem(tx, item, runId);
            if (attemptedStatus === "skipped") {
              // The organization is the atomic unit of reconciliation. A
              // stale or incomplete item must roll back earlier writes rather
              // than commit a partially repaired taxonomy.
              throw new ReconciliationApplyBlocked(item.id);
            }
            const status = attemptedStatus;
            await tx.query(
              `update parameter_definition_reconciliation_items
               set status = $2, blocker_code = coalesce($3, blocker_code),
                   evidence = case when $4::jsonb = '{}'::jsonb then evidence else evidence || $4::jsonb end,
                   updated_at = now()
               where id = $1`,
              [item.id, status, null, "{}"],
            );
            item.status = status;
          }
        });
      } catch (error) {
        // Business writes and their audit roll back together. Persist the
        // blocker on the root handle so a failed organization is resumable.
        const blockerCode =
          error instanceof ReconciliationApplyBlocked
            ? error.blockerCode
            : "apply-transaction-failed";
        await db.query(
          `
          update parameter_definition_reconciliation_items
          set status = 'blocked', blocker_code = $2,
              evidence = evidence || $3::jsonb, updated_at = now()
          where run_id = $1 and organization_id = $4 and status = 'pending'
          `,
          [
            runId,
            blockerCode,
            JSON.stringify({
              ...(error instanceof ReconciliationApplyBlocked
                ? { applySkipped: true }
                : {}),
              error: error instanceof Error ? error.message : String(error),
            }),
            organizationId,
          ],
        );
        for (const item of organizationItems) {
          item.status = "blocked";
          item.blocker_code = blockerCode;
          item.evidence = {
            ...item.evidence,
            ...(error instanceof ReconciliationApplyBlocked
              ? { applySkipped: true }
              : {}),
            applyError: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }
  }

  const report = buildReport(runId, options.mode, items);
  await db.query(
    `
    update parameter_definition_reconciliation_runs
    set phase = $2, status = $3, report = $4::jsonb, completed_at = now()
    where id = $1
    `,
    [
      runId,
      options.mode === "apply" ? "verify" : "preflight",
      report.status,
      JSON.stringify(report),
    ],
  );
  return report;
}
