import type { Queryable } from "../../shared/database/client";
import type {
  ProjectAdminDetailDto,
  ProjectAdminSummaryDto,
  ProjectDto,
  ProjectModuleDto
} from "./types";
import { parameterIdentityMode } from "./parameterIdentityMode";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";
import { deletePreCutoverProjectParameterValues } from "./legacyParameterIdentityAdapter";
import { dateTimeToIso } from "./repository";

type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status?: string;
  initialization_status?: string;
  updated_at?: string | Date;
  module_count?: number | string;
  parameter_count?: number | string;
  open_conflict_count?: number | string;
  released_baseline_count?: number | string;
};

type ProjectModuleRow = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  parent_id?: string | null;
  path?: string | null;
  depth?: number | string | null;
  parameter_module_id?: string | null;
};

function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code
  };
}

function toProjectAdminSummaryDto(row: ProjectRow): ProjectAdminSummaryDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status ?? "initialized",
    initializationStatus: row.initialization_status ?? "initialized",
    moduleCount: Number(row.module_count ?? 0),
    parameterCount: Number(row.parameter_count ?? 0),
    openConflictCount: Number(row.open_conflict_count ?? 0),
    releasedBaselineCount: Number(row.released_baseline_count ?? 0),
    updatedAt: row.updated_at ? dateTimeToIso(row.updated_at) : new Date(0).toISOString()
  };
}

function toProjectModuleDto(row: ProjectModuleRow): ProjectModuleDto {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
    parentId: row.parent_id ?? null,
    path: row.path ?? undefined,
    depth: row.depth === null || row.depth === undefined ? undefined : Number(row.depth),
    parameterModuleId: row.parameter_module_id ?? null
  };
}

export async function listProjects(db: Queryable, query: { organizationId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
    order by name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectDto);
}

export async function getProjectById(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectRow>(
    `
    select id, name, code
    from projects
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows[0] ? toProjectDto(result.rows[0]) : null;
}

export async function listProjectAdminSummaries(db: Queryable, query: { organizationId: string }) {
  const semantic = parameterIdentityMode() === "semantic";
  const parameterCountSql = semantic
    ? `
      select project_id, count(*)::int as parameter_count
      from project_parameter_bindings
      where organization_id = $1
      group by project_id
    `
    : `
      select project_id, count(*)::int as parameter_count
      from ${LEGACY_IDENTITY_SQL.valuesTable}
      where organization_id = $1
      group by project_id
    `;

  const result = await db.query<ProjectRow>(
    `
    select
      p.id,
      p.name,
      p.code,
      p.status,
      p.initialization_status,
      p.updated_at,
      coalesce(module_counts.module_count, 0) as module_count,
      coalesce(param_counts.parameter_count, 0) as parameter_count,
      coalesce(conflict_counts.open_conflict_count, 0) as open_conflict_count,
      coalesce(baseline_counts.released_baseline_count, 0) as released_baseline_count
    from projects p
    left join (
      select project_id, count(*)::int as module_count
      from project_modules
      where organization_id = $1
      group by project_id
    ) module_counts on module_counts.project_id = p.id
    left join (
      ${parameterCountSql}
    ) param_counts on param_counts.project_id = p.id
    left join (
      select project_id, count(*)::int as open_conflict_count
      from parameter_file_sync_conflicts
      where organization_id = $1
        and status = 'open'
      group by project_id
    ) conflict_counts on conflict_counts.project_id = p.id
    left join (
      select cs.project_id, count(*)::int as released_baseline_count
      from dts_release_baseline b
      inner join dts_config_set cs on cs.id = b.config_set_id
      where b.organization_id = $1
        and b.status = 'released'
      group by cs.project_id
    ) baseline_counts on baseline_counts.project_id = p.id
    where p.organization_id = $1
    order by p.name asc
    `,
    [query.organizationId]
  );

  return result.rows.map(toProjectAdminSummaryDto);
}

export async function getProjectAdminDetail(
  db: Queryable,
  query: { organizationId: string; projectId: string }
): Promise<ProjectAdminDetailDto | null> {
  const summaries = await listProjectAdminSummaries(db, { organizationId: query.organizationId });
  const summary = summaries.find((item) => item.id === query.projectId);
  if (!summary) {
    return null;
  }

  const modules = await listProjectModules(db, query);
  return { ...summary, modules };
}

export async function createProject(
  db: Queryable,
  input: { organizationId: string; id: string; name: string; code: string; status?: string }
) {
  const result = await db.query<ProjectRow>(
    `
    insert into projects (id, organization_id, name, code, status, initialization_status)
    values ($1, $2, $3, $4, $5, 'not_initialized')
    returning id, name, code, status, initialization_status, updated_at
    `,
    [input.id, input.organizationId, input.name, input.code, input.status ?? "initialized"]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create project.");
  }

  return toProjectAdminSummaryDto({
    ...row,
    initialization_status: row.initialization_status ?? "not_initialized",
    module_count: 0,
    parameter_count: 0,
    open_conflict_count: 0,
    released_baseline_count: 0
  });
}

export async function updateProject(
  db: Queryable,
  input: { organizationId: string; projectId: string; name?: string; code?: string; status?: string }
) {
  const assignments: string[] = [];
  const values: unknown[] = [input.organizationId, input.projectId];

  if (input.name !== undefined) {
    values.push(input.name);
    assignments.push(`name = $${values.length}`);
  }
  if (input.code !== undefined) {
    values.push(input.code);
    assignments.push(`code = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (assignments.length === 0) {
    return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
  }

  assignments.push("updated_at = now()");

  const result = await db.query<ProjectRow>(
    `
    update projects
    set ${assignments.join(", ")}
    where organization_id = $1
      and id = $2
    returning id, name, code, status, updated_at
    `,
    values
  );

  if (!result.rows[0]) {
    return null;
  }

  return getProjectAdminDetail(db, { organizationId: input.organizationId, projectId: input.projectId });
}

export async function deleteProject(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<{ deleted: boolean; reason?: "not_found" }> {
  const exists = await db.query<{ id: string }>(
    `
    select id
    from projects
    where organization_id = $1
      and id = $2
    `,
    [input.organizationId, input.projectId]
  );

  if (!exists.rows[0]) {
    return { deleted: false, reason: "not_found" };
  }

  const { organizationId, projectId } = input;

  await db.query(
    `
    delete from parameter_review_decisions
    where organization_id = $1
      and request_id in (
        select id
        from parameter_change_requests
        where organization_id = $1
          and project_id = $2
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_items
    where organization_id = $1
      and (
        change_request_id in (
          select id
          from parameter_change_requests
          where organization_id = $1
            and project_id = $2
        )
        or submission_round_id in (
          select id
          from parameter_submission_rounds
          where organization_id = $1
            and project_id = $2
        )
      )
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_history_entries
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_change_requests
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_drafts
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_submission_rounds
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  await db.query(
    `
    delete from parameter_import_batches
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  // Post-cutover: clear semantic topology without querying renamed flat tables.
  // Pre-cutover: delete flat values via explicit transitional adapter only.
  if (parameterIdentityMode() !== "semantic") {
    await deletePreCutoverProjectParameterValues(db, { organizationId, projectId });
  } else {
    await db.query(
      `
      update legacy_parameter_migration_evidence
      set project_parameter_binding_id = null,
          parameter_spec_id = null,
          parameter_spec_version_id = null
      where project_parameter_binding_id in (
        select id from project_parameter_bindings
        where organization_id = $1 and project_id = $2
      )
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      update node_operations
      set project_parameter_binding_id = null,
          parameter_spec_id = null
      where organization_id = $1
        and project_parameter_binding_id in (
          select id from project_parameter_bindings
          where organization_id = $1 and project_id = $2
        )
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      delete from dts_property_occurrence_spec_decisions
      where organization_id = $1
        and binding_id in (
          select id from project_parameter_bindings
          where organization_id = $1 and project_id = $2
        )
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      delete from project_parameter_bindings
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
    // Delete config revisions before files cascade from projects (member FKs).
    await db.query(
      `
      delete from dts_config_revisions
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
    await db.query(
      `
      delete from dts_logical_nodes
      where organization_id = $1
        and project_id = $2
      `,
      [organizationId, projectId]
    );
  }

  await db.query(
    `
    delete from project_modules
    where organization_id = $1
      and project_id = $2
    `,
    [organizationId, projectId]
  );

  const result = await db.query<{ id: string }>(
    `
    delete from projects
    where organization_id = $1
      and id = $2
    returning id
    `,
    [organizationId, projectId]
  );

  return result.rows[0] ? { deleted: true } : { deleted: false, reason: "not_found" };
}

export async function listProjectModules(db: Queryable, query: { organizationId: string; projectId: string }) {
  const result = await db.query<ProjectModuleRow>(
    `
    select id, project_id, name, sort_order, parent_id, path, depth, parameter_module_id
    from project_modules
    where organization_id = $1
      and project_id = $2
    order by sort_order asc, name asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toProjectModuleDto);
}
