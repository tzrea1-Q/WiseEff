import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type {
  InsertFileVersionInput,
  InsertProjectParameterFileInput,
  ParameterFileFormat,
  ParameterFileVersionOrigin,
  ParsedIndex,
  ProjectParameterFileDto,
  ProjectParameterFileVersionDto
} from "./types";
import {
  trustedDomainAttributionFromRow,
  trustedPublicExecutionLabelFromAttribution,
  type TrustedInvocationDomainAttributionRow
} from "../auth/trustedInvocation";

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

type ProjectParameterFileVersionRow = TrustedInvocationDomainAttributionRow & {
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
  created_by_display_name?: string | null;
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
  const attribution = trustedDomainAttributionFromRow(row, row.created_by_user_id);
  const executionDisplayName = trustedPublicExecutionLabelFromAttribution(
    attribution,
    row.created_by_display_name ?? ""
  ) || null;
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
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: executionDisplayName,
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

/** Return the persisted source membership for a file without widening the public file DTO. */
export async function getProjectParameterFileConfigSetId(
  db: Queryable,
  query: { organizationId: string; projectId: string; fileId: string }
): Promise<string | null> {
  const result = await db.query<{ config_set_id: string | null }>(
    `select config_set_id
       from project_parameter_files
      where organization_id = $1 and project_id = $2 and id = $3
      limit 1`,
    [query.organizationId, query.projectId, query.fileId]
  );
  return result.rows[0]?.config_set_id ?? null;
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
  const accountableUserId = input.attribution ? input.attribution.userId : input.createdByUserId ?? null;
  const initiatorType = input.attribution?.initiatorType ?? (accountableUserId ? "user" : "legacy");
  const result = await db.query<ProjectParameterFileVersionRow>(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id,
      initiator_type, initiator_system_kind, initiator_system_name,
      initiator_session_id, initiator_tool_call_id, initiator_approval_id
    )
    values (
      $1,
      $2,
      coalesce(
        (select max(version_number) from project_parameter_file_versions where file_id = $2),
        0
      ) + 1,
      $3,
      $4,
      $5,
      $6::jsonb,
      $7,
      $8,
      $9, $10, $11, $12, $13, $14
    )
    returning *
    `,
    [
      input.id,
      input.fileId,
      input.storageKey,
      input.checksum,
      input.sizeBytes,
      JSON.stringify(input.parsedIndex ?? {}),
      input.origin,
      accountableUserId,
      initiatorType,
      input.attribution?.systemKind ?? null,
      input.attribution?.systemName ?? null,
      input.attribution?.sessionId ?? null,
      input.attribution?.toolCallId ?? null,
      input.attribution?.approvalId ?? null
    ]
  );

  return toVersionDto(result.rows[0]);
}

/** Fence legacy source or membership changes against canonical initialization/apply. */
export async function assertLegacySourceMutationAllowed(db: Queryable, fileId: string | string[], destinationConfigSetId?: string): Promise<void> {
  const fileIds = [...new Set(typeof fileId === "string" ? [fileId] : fileId)].sort();
  const before = await db.query<{ id: string; config_set_id: string | null }>(`select id,config_set_id from project_parameter_files where id=any($1::text[]) order by id`, [fileIds]);
  const setIds = [...new Set([...before.rows.map((row) => row.config_set_id),destinationConfigSetId].filter((id): id is string => Boolean(id)))].sort();
  await db.query(`select id from dts_config_set where id=any($1::text[]) order by id for update`, [setIds]);
  const locked = await db.query<{ id: string; config_set_id: string | null }>(`select id,config_set_id from project_parameter_files where id=any($1::text[]) order by id for update`, [fileIds]);
  if (JSON.stringify(before.rows) !== JSON.stringify(locked.rows)) throw new ApiError("CONFLICT", "Source membership changed during mutation.");
  const canonical = await db.query(
    `select 1 from parameter_catalog.project_parameter_source_occurrences where file_id=any($1::text[]) or config_set_id=any($2::text[]) limit 1`,
    [fileIds,setIds],
  );
  if (canonical.rows.length) throw new ApiError("CONFLICT", "Canonical source changes require a prepared and approved source transaction.");
}

export async function setCurrentVersion(
  db: Queryable,
  input: { fileId: string; versionId: string }
): Promise<void> {
  await assertLegacySourceMutationAllowed(db,input.fileId);
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
    select v.*, u.name as created_by_display_name
    from project_parameter_file_versions v
    left join users u on u.id = v.created_by_user_id
    where v.file_id = $1
    order by v.version_number desc, v.id desc
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
