import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ReloadConfigurationContract } from "./configurationTypes";

export type OrganisationDefaultRow = {
  organization_id: string;
  destination_directory: string;
  destination_filename: string;
  trigger_node_path: string;
  trigger_payload: string;
  kernel_log_command: string;
  updated_by_user_id: string | null;
  updated_at: string;
  created_at: string;
};

export function rowToContract(
  row: Pick<
    OrganisationDefaultRow,
    | "destination_directory"
    | "destination_filename"
    | "trigger_node_path"
    | "trigger_payload"
    | "kernel_log_command"
  >
): ReloadConfigurationContract {
  return {
    destinationDirectory: row.destination_directory,
    destinationFilename: row.destination_filename,
    triggerNodePath: row.trigger_node_path,
    triggerPayload: row.trigger_payload,
    kernelLogCommand: row.kernel_log_command
  };
}

export async function getOrganisationDefaultRow(
  db: Queryable,
  organizationId: string
): Promise<OrganisationDefaultRow | null> {
  const result = await db.query<OrganisationDefaultRow>(
    `select organization_id, destination_directory, destination_filename, trigger_node_path,
            trigger_payload, kernel_log_command, updated_by_user_id,
            to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at, created_at
       from dts_reload_org_defaults
      where organization_id = $1`,
    [organizationId]
  );
  return result.rows[0] ?? null;
}

export async function upsertOrganisationDefault(
  db: Queryable,
  input: {
    organizationId: string;
    contract: ReloadConfigurationContract;
    updatedByUserId: string;
    expectedUpdatedAt: string | null;
  }
): Promise<OrganisationDefaultRow> {
  const result = await db.query<OrganisationDefaultRow>(
    `insert into dts_reload_org_defaults (
       organization_id, destination_directory, destination_filename, trigger_node_path,
       trigger_payload, kernel_log_command, updated_by_user_id, updated_at, created_at
     ) select $1, $2, $3, $4, $5, $6, $7, clock_timestamp(), now()
       where $8::timestamptz is null or exists (
         select 1 from dts_reload_org_defaults where organization_id = $1 and updated_at = $8::timestamptz
       )
     on conflict (organization_id) do update set
       destination_directory = excluded.destination_directory,
       destination_filename = excluded.destination_filename,
       trigger_node_path = excluded.trigger_node_path,
       trigger_payload = excluded.trigger_payload,
       kernel_log_command = excluded.kernel_log_command,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = greatest(clock_timestamp(), dts_reload_org_defaults.updated_at + interval '1 microsecond')
     where dts_reload_org_defaults.updated_at = $8::timestamptz
     returning organization_id, destination_directory, destination_filename, trigger_node_path,
               trigger_payload, kernel_log_command, updated_by_user_id,
               to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at, created_at`,
    [
      input.organizationId,
      input.contract.destinationDirectory,
      input.contract.destinationFilename,
      input.contract.triggerNodePath,
      input.contract.triggerPayload,
      input.contract.kernelLogCommand,
      input.updatedByUserId,
      input.expectedUpdatedAt
    ]
  );
  const row = result.rows[0];
  if (!row) throw new ApiError("CONFLICT", "重载配置已被其他管理员更新，请重新加载并核对后保存。", { reason: "stale-configuration" });
  return row;
}
