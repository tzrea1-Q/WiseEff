import { createHash, randomUUID } from "node:crypto";

import type { Database, Queryable } from "../../shared/database/client";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { createSystemInvocation } from "../auth/trustedInvocation";
import { ensureDriverRegistrationPlacement, getDriverRegistrationPlacement } from "../parameter-modules/driverRegistrationPlacement";
import { normalizeMatchToken } from "../parameter-modules/modulePlacement";

export type DefinitionReconciliationMode = "dry-run" | "apply";

export type DefinitionReconciliationItemStatus =
  | "pending"
  | "already-reconciled"
  | "applied"
  | "blocked"
  | "skipped";

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
    return [{
      id: row.id,
      kind:
        row.kind === "business" ||
        row.kind === "driver-group" ||
        row.kind === "node-type" ||
        row.kind === "unclassified"
          ? row.kind
          : null,
      origin: row.origin === "curated" || row.origin === "auto" ? row.origin : null,
      parentId: typeof row.parentId === "string" ? row.parentId : null,
    } satisfies BindingModuleEvidence];
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
  if (!leftKind || !rightKind || leftKind === "unknown" || rightKind === "unknown") return true;
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
    .update(`${input.runId}\u001f${input.organizationId}\u001f${input.currentSpecId}\u001f${input.propertyKey}`)
    .digest("hex")
    .slice(0, 24);
  return `pdr-item:${digest}`;
}

async function listSuspects(
  db: Queryable,
  organizationId?: string,
): Promise<SuspectRow[]> {
  const values: unknown[] = [];
  const scope = organizationId ? `and ps.organization_id = $1` : "and ps.organization_id is not null";
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
      current_version.value_shape as current_value_shape,
      (
        select count(*)
        from parameter_spec_versions active_versions
        where active_versions.parameter_spec_id = ps.id
          and active_versions.version_status = 'active'
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
          case psv.version_status when 'active' then 0 when 'superseded' then 1 else 2 end,
          psv.version desc
        limit 1
      )
    left join dts_logical_node_revisions lnr
      on lnr.logical_node_id = b.logical_node_id
    where ps.source_kind in ('manual', 'dts')
      and ps.definition_lifecycle in ('draft', 'active')
      and (
        dps.driver_schema_id is null
        or ps.attribution_subject_id is null
        or b.module_id is null
        or binding_module.id is null
        or binding_module.kind not in ('driver-group', 'node-type')
        or binding_module.attribution_subject_id is null
        or (
          select count(*)
          from parameter_spec_versions active_versions
          where active_versions.parameter_spec_id = ps.id
            and active_versions.version_status = 'active'
        ) <> 1
      )
      and (dps.id is not null or ps.attribution_subject_id is not null)
      -- Node-type definitions are a separate taxonomy surface (ADR-0013),
      -- not driver/property catalog candidates for this reconciliation.
      and asub.subject_kind is distinct from 'node-type-definition'
      and coalesce(lower(asub.source_key), '') not like 'nodetype:%'
      ${scope}
    group by
      ps.organization_id,
      ps.id,
      ps.attribution_subject_id,
      ps.property_key,
      dps.property_key,
      current_version.id,
      current_version.version,
      current_version.value_shape
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
      on ds.organization_id is null
     and ds.attribution_subject_id is not null
     and (
       ds.id = dps.driver_schema_id
       or (dps.driver_schema_id is null and ds.schema_namespace = dps.schema_namespace)
     )
    inner join lateral (
      select compatible_patterns, lifecycle
      from driver_schema_versions
      where driver_schema_id = ds.id
        and lifecycle = 'active'
      order by version desc
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
      ) = 1
      and coalesce(ps.property_key, dps.property_key) = $1
    order by ps.id
    `,
    [propertyKey],
  );
  return result.rows;
}

async function subjectOrigin(db: Queryable, subjectId: string | null): Promise<string | null> {
  if (!subjectId) return null;
  const result = await db.query<{ origin: string | null }>(
    `select origin from attribution_subjects where id = $1 limit 1`,
    [subjectId],
  );
  return result.rows[0]?.origin ?? null;
}

async function identityCollision(
  db: Queryable,
  input: { organizationId: string; subjectId: string; propertyKey: string; currentSpecId: string },
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
    [input.organizationId, input.subjectId, input.propertyKey, input.currentSpecId],
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
    const normalized = normalizeMatchToken(module.source_key.slice("compatible:".length));
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
    return patterns.some((pattern) => evidenceCompatible.some((value) => patternMatches(pattern, value)));
  });
  if (matches.length === 0) {
    return {
      status: "blocked",
      blockerCode: "no-active-platform-candidate",
      evidence: { observedCompatibles: evidenceCompatible, propertyKey: suspect.property_key },
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
      evidence: { observedCompatibles: evidenceCompatible, candidateSpecIds: matches.map((row) => row.parameter_spec_id) },
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
    const fallbackModule = candidateModules.rows[0] ?? (autoDriverGroup.length === 1 ? {
      id: autoDriverGroup[0]!.id,
      parent_id: autoDriverGroup[0]!.parentId,
      origin: "auto" as const,
    } : null);
    if (!fallbackModule) {
      return {
        status: "blocked",
        blockerCode: "missing-driver-placement",
        evidence: { candidateSubjectId: candidate.attribution_subject_id, bindingModules },
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
      evidence: { collidingSpecId: collision, candidateSubjectId: candidate.attribution_subject_id },
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
  input: { runId: string; organizationId?: string; mode: DefinitionReconciliationMode; phase: "preflight" | "apply" },
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
      JSON.stringify({ kind: "job", name: "parameter-definition-reconciliation" }),
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
    if (item.blocker_code) blockerCounts.set(item.blocker_code, (blockerCounts.get(item.blocker_code) ?? 0) + 1);
  }
  const organizations = new Set(items.map((item) => item.organization_id)).size;
  const blocked = counts.get("blocked") ?? 0;
  return {
    runId,
    mode,
    // An apply item that cannot be committed is converted to a blocker below;
    // never report a partially repaired run as completed merely because the
    // transaction did not throw.
    status: blocked > 0 || (counts.get("skipped") ?? 0) > 0 ? "blocked" : "completed",
    organizations,
    candidates: items.filter((item) => item.candidate_parameter_spec_id !== null).length,
    applied: counts.get("applied") ?? 0,
    alreadyReconciled: counts.get("already-reconciled") ?? 0,
    blocked,
    skipped: counts.get("skipped") ?? 0,
    blockers: [...blockerCounts.entries()].map(([code, count]) => ({ code, count })),
  };
}

async function applyItem(
  tx: Queryable,
  item: ReconciliationItemRow,
  runId: string,
): Promise<DefinitionReconciliationItemStatus> {
  if (!item.current_parameter_spec_id || !item.candidate_parameter_spec_id || !item.next_subject_id) {
    return "skipped";
  }
  const evidence = asRecord(item.evidence);
  const placementModuleId = typeof evidence.placementModuleId === "string" ? evidence.placementModuleId : null;
  const placementCategoryId = typeof evidence.placementCategoryId === "string" ? evidence.placementCategoryId : null;
  const candidate = await tx.query<CandidateRow>(
    `
    select
      ps.id as parameter_spec_id,
      psv.id as parameter_spec_version_id,
      ps.attribution_subject_id,
      coalesce(ps.property_key, dps.property_key) as property_key,
      ds.id as driver_schema_id,
      ds.schema_namespace,
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
    inner join driver_schemas ds on ds.id = dps.driver_schema_id
    inner join lateral (
      select compatible_patterns, lifecycle
      from driver_schema_versions
      where driver_schema_id = ds.id
        and lifecycle = 'active'
      order by version desc
      limit 1
    ) dsv on true
    where ps.id = $1 and psv.id = $2
    limit 1
    `,
    [item.candidate_parameter_spec_id, evidence.candidateVersionId],
  );
  const candidateRow = candidate.rows[0];
  if (!candidateRow?.attribution_subject_id) return "skipped";

  let targetModuleId = placementModuleId;
  if (!targetModuleId) return "skipped";
  const existingModule = await tx.query<{ id: string; kind: string; origin: string; attribution_subject_id: string | null }>(
    `select id, kind, origin, attribution_subject_id from parameter_modules where id = $1 and organization_id = $2 for update`,
    [targetModuleId, item.organization_id],
  );
  const module = existingModule.rows[0];
  if (!module || module.kind !== "driver-group") return "skipped";
  if (module.attribution_subject_id !== candidateRow.attribution_subject_id) {
    if (module.origin !== "auto") return "skipped";
    await tx.query(
      `update parameter_modules set attribution_subject_id = $2, updated_at = now() where id = $1`,
      [targetModuleId, candidateRow.attribution_subject_id],
    );
  }
  const placement = await ensureDriverRegistrationPlacement(tx, {
    organizationId: item.organization_id,
    attributionSubjectId: candidateRow.attribution_subject_id,
    driverGroupModuleId: targetModuleId,
    defaultBusinessCategoryModuleId: placementCategoryId,
  });
  if (!placement) return "skipped";

  await tx.query(
    `
    update parameter_specs
    set attribution_subject_id = $2,
        definition_lifecycle = 'active'
    where id = $1
    `,
    [item.current_parameter_spec_id, candidateRow.attribution_subject_id],
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
    .update(`${runId}\u001f${item.current_parameter_spec_id}\u001f${candidateRow.parameter_spec_version_id}`)
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
      candidateRow.schema_default === undefined ? null : JSON.stringify(candidateRow.schema_default),
      candidateRow.example_value === undefined ? null : JSON.stringify(candidateRow.example_value),
      candidateRow.units,
      JSON.stringify(candidateRow.constraints ?? {}),
      candidateRow.documentation,
    ],
  );
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
        where cr.project_id = b.project_id
          and cr.organization_id = b.organization_id
        order by cr.revision_number desc, cr.id desc
        limit 1
      )
    `,
    [item.current_parameter_spec_id, successorId, item.organization_id],
  );
  await tx.query(
    `update project_parameter_bindings set module_id = $2 where parameter_spec_id = $1 and organization_id = $3`,
    [item.current_parameter_spec_id, placement.driverGroupModuleId, item.organization_id],
  );
  await writeTrustedAuditEventInTx(asAuditTx(tx), {
    invocation: createSystemInvocation({ kind: "job", name: "parameter-definition-reconciliation" }),
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
    await tx.query(`update parameter_definition_reconciliation_runs set status = 'running' where id = $1`, [runId]);
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
            const status = attemptedStatus === "skipped" ? "blocked" : attemptedStatus;
            if (attemptedStatus === "skipped") {
              item.blocker_code = "apply-skipped";
              item.evidence = {
                ...item.evidence,
                applySkipped: true,
              };
            }
            await tx.query(
              `update parameter_definition_reconciliation_items
               set status = $2, blocker_code = coalesce($3, blocker_code),
                   evidence = case when $4::jsonb = '{}'::jsonb then evidence else evidence || $4::jsonb end,
                   updated_at = now()
               where id = $1`,
              [
                item.id,
                status,
                attemptedStatus === "skipped" ? "apply-skipped" : null,
                attemptedStatus === "skipped" ? JSON.stringify({ applySkipped: true }) : "{}",
              ],
            );
            item.status = status;
          }
        });
      } catch (error) {
        // Business writes and their audit roll back together. Persist the
        // blocker on the root handle so a failed organization is resumable.
        await db.query(
          `
          update parameter_definition_reconciliation_items
          set status = 'blocked', blocker_code = 'apply-transaction-failed',
              evidence = evidence || $2::jsonb, updated_at = now()
          where run_id = $1 and organization_id = $3 and status = 'pending'
          `,
          [runId, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), organizationId],
        );
        for (const item of organizationItems) {
          item.status = "blocked";
          item.blocker_code = "apply-transaction-failed";
          item.evidence = {
            ...item.evidence,
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
    [runId, options.mode === "apply" ? "verify" : "preflight", report.status, JSON.stringify(report)],
  );
  return report;
}
