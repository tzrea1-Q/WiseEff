import type { Queryable } from "../../shared/database/client";
import type {
  ConfigSetDto,
  ConfigSetRole,
  FileConfigSetMembershipDto,
  InsertConfigSetInput,
  SetFileConfigSetMembershipInput,
  UpdateConfigSetInput
} from "./types";

type ConfigSetRow = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  derived_from_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type FileConfigSetMembershipRow = {
  id: string;
  organization_id: string;
  project_id: string;
  config_set_id: string | null;
  config_set_role: ConfigSetRole | null;
  config_set_sort_order: number | string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toConfigSetDto(row: ConfigSetRow): ConfigSetDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    derivedFromId: row.derived_from_id ?? undefined,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toFileMembershipDto(row: FileConfigSetMembershipRow): FileConfigSetMembershipDto {
  return {
    fileId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    configSetId: row.config_set_id ?? undefined,
    configSetRole: row.config_set_role ?? undefined,
    configSetSortOrder: Number(row.config_set_sort_order)
  };
}

export async function insertConfigSet(db: Queryable, input: InsertConfigSetInput): Promise<ConfigSetDto> {
  const result = await db.query<ConfigSetRow>(
    `
    insert into dts_config_set (
      id, organization_id, project_id, name, description, derived_from_id
    )
    values ($1, $2, $3, $4, $5, $6)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.name,
      input.description ?? null,
      input.derivedFromId ?? null
    ]
  );

  return toConfigSetDto(result.rows[0]);
}

export async function listConfigSetsByProject(
  db: Queryable,
  query: { organizationId: string; projectId: string }
): Promise<ConfigSetDto[]> {
  const result = await db.query<ConfigSetRow>(
    `
    select *
    from dts_config_set
    where organization_id = $1
      and project_id = $2
    order by name asc, id asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toConfigSetDto);
}

export async function getConfigSetById(
  db: Queryable,
  query: { organizationId: string; configSetId: string }
): Promise<ConfigSetDto | null> {
  const result = await db.query<ConfigSetRow>(
    `
    select *
    from dts_config_set
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.configSetId]
  );

  const row = result.rows[0];
  return row ? toConfigSetDto(row) : null;
}

export async function getConfigSetByProjectAndName(
  db: Queryable,
  query: { organizationId: string; projectId: string; name: string }
): Promise<ConfigSetDto | null> {
  const result = await db.query<ConfigSetRow>(
    `
    select *
    from dts_config_set
    where organization_id = $1
      and project_id = $2
      and name = $3
    limit 1
    `,
    [query.organizationId, query.projectId, query.name]
  );

  const row = result.rows[0];
  return row ? toConfigSetDto(row) : null;
}

export async function updateConfigSetRow(db: Queryable, input: UpdateConfigSetInput): Promise<ConfigSetDto> {
  const result = await db.query<ConfigSetRow>(
    `
    update dts_config_set
    set name = $2,
        description = $3,
        derived_from_id = $4,
        updated_at = now()
    where id = $1
    returning *
    `,
    [input.id, input.name, input.description ?? null, input.derivedFromId ?? null]
  );

  return toConfigSetDto(result.rows[0]);
}

export async function setFileConfigSetMembership(
  db: Queryable,
  input: SetFileConfigSetMembershipInput
): Promise<void> {
  await db.query(
    `
    update project_parameter_files
    set config_set_id = $2,
        config_set_role = $3,
        config_set_sort_order = $4,
        updated_at = now()
    where id = $1
    `,
    [input.fileId, input.configSetId, input.role, input.sortOrder]
  );
}

export async function clearFileConfigSetMembership(db: Queryable, input: { fileId: string }): Promise<void> {
  await db.query(
    `
    update project_parameter_files
    set config_set_id = null,
        config_set_role = null,
        config_set_sort_order = 0,
        updated_at = now()
    where id = $1
    `,
    [input.fileId]
  );
}

export async function getFileConfigSetMembership(
  db: Queryable,
  query: { organizationId: string; fileId: string }
): Promise<FileConfigSetMembershipDto | null> {
  const result = await db.query<FileConfigSetMembershipRow>(
    `
    select id, organization_id, project_id, config_set_id, config_set_role, config_set_sort_order
    from project_parameter_files
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.fileId]
  );

  const row = result.rows[0];
  return row ? toFileMembershipDto(row) : null;
}
