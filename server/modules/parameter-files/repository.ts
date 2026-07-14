import type { Queryable } from "../../shared/database/client";
import type {
  InsertFileVersionInput,
  InsertProjectParameterFileInput,
  ParameterFileFormat,
  ParameterFileVersionOrigin,
  ParsedIndex,
  ProjectParameterFileDto,
  ProjectParameterFileVersionDto
} from "./types";

type ProjectParameterFileRow = {
  id: string;
  organization_id: string;
  project_id: string;
  file_name: string;
  format: ParameterFileFormat;
  module_hint: string | null;
  current_version_id: string | null;
  enabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  current_version_number?: number | string | null;
};

type ProjectParameterFileVersionRow = {
  id: string;
  file_id: string;
  version_number: number | string;
  storage_key: string;
  checksum: string;
  size_bytes: number | string;
  parsed_index: ParsedIndex;
  origin: ParameterFileVersionOrigin;
  created_by_user_id: string | null;
  created_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function toFileDto(row: ProjectParameterFileRow): ProjectParameterFileDto {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    format: row.format,
    moduleHint: row.module_hint ?? undefined,
    enabled: row.enabled,
    currentVersionId: row.current_version_id ?? undefined,
    currentVersionNumber:
      row.current_version_number == null ? undefined : Number(row.current_version_number),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toVersionDto(row: ProjectParameterFileVersionRow): ProjectParameterFileVersionDto {
  return {
    id: row.id,
    fileId: row.file_id,
    versionNumber: Number(row.version_number),
    storageKey: row.storage_key,
    checksum: row.checksum,
    sizeBytes: Number(row.size_bytes),
    parsedIndex: row.parsed_index ?? {},
    origin: row.origin,
    createdAt: dateTimeToIso(row.created_at),
    createdByUserId: row.created_by_user_id ?? undefined
  };
}

const fileSelectColumns = `
  pf.id,
  pf.organization_id,
  pf.project_id,
  pf.file_name,
  pf.format,
  pf.module_hint,
  pf.current_version_id,
  pf.enabled,
  pf.created_at,
  pf.updated_at,
  v.version_number as current_version_number
`;

const fileFromClause = `
  from project_parameter_files pf
  left join project_parameter_file_versions v
    on v.id = pf.current_version_id
`;

export async function insertProjectParameterFile(
  db: Queryable,
  input: InsertProjectParameterFileInput
): Promise<ProjectParameterFileDto> {
  const result = await db.query<ProjectParameterFileRow>(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, module_hint, enabled
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    returning *
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.fileName,
      input.format,
      input.moduleHint ?? null,
      input.enabled ?? true
    ]
  );

  return toFileDto(result.rows[0]);
}

export async function listProjectParameterFiles(
  db: Queryable,
  query: { organizationId: string; projectId: string }
): Promise<ProjectParameterFileDto[]> {
  const result = await db.query<ProjectParameterFileRow>(
    `
    select ${fileSelectColumns}
    ${fileFromClause}
    where pf.organization_id = $1
      and pf.project_id = $2
    order by pf.file_name asc, pf.id asc
    `,
    [query.organizationId, query.projectId]
  );

  return result.rows.map(toFileDto);
}

export async function getProjectParameterFileById(
  db: Queryable,
  query: { organizationId: string; fileId: string }
): Promise<ProjectParameterFileDto | null> {
  const result = await db.query<ProjectParameterFileRow>(
    `
    select ${fileSelectColumns}
    ${fileFromClause}
    where pf.organization_id = $1
      and pf.id = $2
    limit 1
    `,
    [query.organizationId, query.fileId]
  );

  const row = result.rows[0];
  return row ? toFileDto(row) : null;
}

export async function getProjectParameterFileByName(
  db: Queryable,
  query: { organizationId: string; projectId: string; fileName: string }
): Promise<ProjectParameterFileDto | null> {
  const result = await db.query<ProjectParameterFileRow>(
    `
    select ${fileSelectColumns}
    ${fileFromClause}
    where pf.organization_id = $1
      and pf.project_id = $2
      and pf.file_name = $3
    limit 1
    `,
    [query.organizationId, query.projectId, query.fileName]
  );

  const row = result.rows[0];
  return row ? toFileDto(row) : null;
}

export async function insertFileVersion(
  db: Queryable,
  input: InsertFileVersionInput
): Promise<ProjectParameterFileVersionDto> {
  const result = await db.query<ProjectParameterFileVersionRow>(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    returning *
    `,
    [
      input.id,
      input.fileId,
      input.versionNumber,
      input.storageKey,
      input.checksum,
      input.sizeBytes,
      JSON.stringify(input.parsedIndex ?? {}),
      input.origin,
      input.createdByUserId ?? null
    ]
  );

  return toVersionDto(result.rows[0]);
}

export async function setCurrentVersion(
  db: Queryable,
  input: { fileId: string; versionId: string }
): Promise<void> {
  await db.query(
    `
    update project_parameter_files
    set current_version_id = $2,
        updated_at = now()
    where id = $1
    `,
    [input.fileId, input.versionId]
  );
}

export async function listFileVersions(
  db: Queryable,
  query: { fileId: string }
): Promise<ProjectParameterFileVersionDto[]> {
  const result = await db.query<ProjectParameterFileVersionRow>(
    `
    select *
    from project_parameter_file_versions
    where file_id = $1
    order by version_number desc, id desc
    `,
    [query.fileId]
  );

  return result.rows.map(toVersionDto);
}

export async function getFileVersionById(
  db: Queryable,
  query: { versionId: string }
): Promise<ProjectParameterFileVersionDto | null> {
  const result = await db.query<ProjectParameterFileVersionRow>(
    `
    select *
    from project_parameter_file_versions
    where id = $1
    limit 1
    `,
    [query.versionId]
  );

  const row = result.rows[0];
  return row ? toVersionDto(row) : null;
}
