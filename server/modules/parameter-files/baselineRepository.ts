import type { Queryable } from "../../shared/database/client";
import type {
  ConfigSetMemberFileDto,
  InsertReleaseBaselineInput,
  InsertReleaseBaselineMemberInput,
  ReleaseBaselineDto,
  ReleaseBaselineMemberDto
} from "./types";

type ReleaseBaselineRow = {
  id: string;
  organization_id: string;
  config_set_id: string;
  name: string;
  notes: string | null;
  status: "draft" | "released";
  created_by_user_id: string | null;
  created_at: string | Date;
};

type ReleaseBaselineMemberRow = {
  id: string;
  baseline_id: string;
  file_id: string;
  file_version_id: string;
  version_number: number | string;
};

type ConfigSetMemberFileRow = {
  file_id: string;
  file_name: string;
  current_version_id: string | null;
  version_number: number | string | null;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toReleaseBaselineDto(row: ReleaseBaselineRow): ReleaseBaselineDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    configSetId: row.config_set_id,
    name: row.name,
    notes: row.notes ?? undefined,
    status: row.status,
    createdBy: row.created_by_user_id ?? undefined,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toReleaseBaselineMemberDto(row: ReleaseBaselineMemberRow): ReleaseBaselineMemberDto {
  return {
    baselineId: row.baseline_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    versionNumber: Number(row.version_number)
  };
}

function toConfigSetMemberFileDto(row: ConfigSetMemberFileRow): ConfigSetMemberFileDto {
  return {
    fileId: row.file_id,
    fileName: row.file_name,
    currentVersionId: row.current_version_id ?? undefined,
    currentVersionNumber: row.version_number === null || row.version_number === undefined
      ? undefined
      : Number(row.version_number)
  };
}

export async function insertReleaseBaseline(
  db: Queryable,
  input: InsertReleaseBaselineInput
): Promise<ReleaseBaselineDto> {
  const result = await db.query<ReleaseBaselineRow>(
    `
    insert into dts_release_baseline (
      id, organization_id, config_set_id, name, notes, created_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6)
    returning *
    `,
    [input.id, input.organizationId, input.configSetId, input.name, input.notes ?? null, input.createdByUserId ?? null]
  );

  return toReleaseBaselineDto(result.rows[0]);
}

export async function getReleaseBaselineByConfigSetAndName(
  db: Queryable,
  query: { configSetId: string; name: string }
): Promise<ReleaseBaselineDto | null> {
  const result = await db.query<ReleaseBaselineRow>(
    `
    select *
    from dts_release_baseline
    where config_set_id = $1
      and name = $2
    limit 1
    `,
    [query.configSetId, query.name]
  );

  const row = result.rows[0];
  return row ? toReleaseBaselineDto(row) : null;
}

export async function getReleaseBaselineById(
  db: Queryable,
  query: { organizationId: string; baselineId: string }
): Promise<ReleaseBaselineDto | null> {
  const result = await db.query<ReleaseBaselineRow>(
    `
    select *
    from dts_release_baseline
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [query.organizationId, query.baselineId]
  );

  const row = result.rows[0];
  return row ? toReleaseBaselineDto(row) : null;
}

export async function listReleaseBaselinesByConfigSet(
  db: Queryable,
  query: { configSetId: string }
): Promise<ReleaseBaselineDto[]> {
  const result = await db.query<ReleaseBaselineRow>(
    `
    select *
    from dts_release_baseline
    where config_set_id = $1
    order by created_at desc, id desc
    `,
    [query.configSetId]
  );

  return result.rows.map(toReleaseBaselineDto);
}

export async function insertReleaseBaselineMember(
  db: Queryable,
  input: InsertReleaseBaselineMemberInput
): Promise<ReleaseBaselineMemberDto> {
  const result = await db.query<ReleaseBaselineMemberRow>(
    `
    insert into dts_release_baseline_members (
      id, baseline_id, file_id, file_version_id, version_number
    )
    values ($1, $2, $3, $4, $5)
    returning *
    `,
    [input.id, input.baselineId, input.fileId, input.fileVersionId, input.versionNumber]
  );

  return toReleaseBaselineMemberDto(result.rows[0]);
}

export async function listReleaseBaselineMembers(
  db: Queryable,
  query: { baselineId: string }
): Promise<ReleaseBaselineMemberDto[]> {
  const result = await db.query<ReleaseBaselineMemberRow>(
    `
    select *
    from dts_release_baseline_members
    where baseline_id = $1
    order by file_id asc
    `,
    [query.baselineId]
  );

  return result.rows.map(toReleaseBaselineMemberDto);
}

export async function listConfigSetMemberFiles(
  db: Queryable,
  configSetId: string
): Promise<ConfigSetMemberFileDto[]> {
  const result = await db.query<ConfigSetMemberFileRow>(
    `
    select
      ppf.id as file_id,
      ppf.file_name as file_name,
      ppf.current_version_id as current_version_id,
      v.version_number as version_number
    from project_parameter_files ppf
    left join project_parameter_file_versions v on v.id = ppf.current_version_id
    where ppf.config_set_id = $1
    order by ppf.config_set_sort_order asc, ppf.file_name asc
    `,
    [configSetId]
  );

  return result.rows.map(toConfigSetMemberFileDto);
}
