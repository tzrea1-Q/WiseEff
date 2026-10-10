/**
 * Canonical import preview and staged-draft provenance in `parameter_import_batches`.
 */

import type { Queryable } from "../../shared/database/client";
import type {
  ParameterImportBatchDto,
  ParameterImportSummaryDto,
  ParameterImportStagedDraftDto
} from "./types";
import { type ParameterRiskLevel } from "./status";
import { dateTimeToIso } from "../../shared/database/sqlUtil";

export type ImportPreviewClassification = "added" | "updated" | "unchanged" | "conflict";

export type PersistedImportBatchItem = {
  id: string;
  name: string;
  module: string;
  risk: ParameterRiskLevel;
  unit: string;
  range: string;
  currentValue?: string;
  recommendedValue?: string;
  description?: string;
  explanation?: string;
  configFormat?: string;
  classification: ImportPreviewClassification;
  definitionId?: string;
  projectParameterValueId?: string;
  baseRevisionId?: string;
  baseCurrentValueId?: string;
  stagedDraft?: ParameterImportStagedDraftDto;
  riskFlag: boolean;
};

export type PersistedImportBatchDto = Omit<ParameterImportBatchDto, "items"> & {
  items: PersistedImportBatchItem[];
};

type ImportBatchRow = {
  id: string;
  project_id: string;
  source_name: string;
  status: "previewed" | "staged" | "applied";
  summary: ParameterImportSummaryDto;
  items: PersistedImportBatchItem[];
  created_at: string | Date;
  applied_at: string | Date | null;
};

function toImportBatchDto(row: ImportBatchRow): PersistedImportBatchDto {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceName: row.source_name,
    status: row.status,
    createdAt: dateTimeToIso(row.created_at),
    appliedAt: row.applied_at ? dateTimeToIso(row.applied_at) : undefined,
    summary: row.summary,
    items: row.items
  };
}

export async function insertImportBatch(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    projectId: string;
    createdByUserId: string;
    sourceName: string;
    summary: ParameterImportSummaryDto;
    items: PersistedImportBatchItem[];
  }
) {
  const result = await db.query<ImportBatchRow>(
    `
    insert into parameter_import_batches (
      id, organization_id, project_id, created_by_user_id, source_name, status, summary, items
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    returning id, project_id, source_name, status, summary, items, created_at, applied_at
    `,
    [
      input.id,
      input.organizationId,
      input.projectId,
      input.createdByUserId,
      input.sourceName,
      "previewed",
      JSON.stringify(input.summary),
      JSON.stringify(input.items)
    ]
  );

  return toImportBatchDto(result.rows[0]);
}

export async function getImportBatchForUpdate(
  db: Queryable,
  query: { organizationId: string; batchId: string }
) {
  const result = await db.query<ImportBatchRow>(
    `
    select id, project_id, source_name, status, summary, items, created_at, applied_at
    from parameter_import_batches
    where organization_id = $1
      and id = $2
    for update
    `,
    [query.organizationId, query.batchId]
  );

  return result.rows[0] ? toImportBatchDto(result.rows[0]) : null;
}
