import type { Queryable } from "../../shared/database/client";
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
            trigger_payload, kernel_log_command, updated_by_user_id, updated_at, created_at
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
  }
): Promise<OrganisationDefaultRow> {
  const result = await db.query<OrganisationDefaultRow>(
    `insert into dts_reload_org_defaults (
       organization_id, destination_directory, destination_filename, trigger_node_path,
       trigger_payload, kernel_log_command, updated_by_user_id, updated_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, now(), now())
     on conflict (organization_id) do update set
       destination_directory = excluded.destination_directory,
       destination_filename = excluded.destination_filename,
       trigger_node_path = excluded.trigger_node_path,
       trigger_payload = excluded.trigger_payload,
       kernel_log_command = excluded.kernel_log_command,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = now()
     returning organization_id, destination_directory, destination_filename, trigger_node_path,
               trigger_payload, kernel_log_command, updated_by_user_id, updated_at, created_at`,
    [
      input.organizationId,
      input.contract.destinationDirectory,
      input.contract.destinationFilename,
      input.contract.triggerNodePath,
      input.contract.triggerPayload,
      input.contract.kernelLogCommand,
      input.updatedByUserId
    ]
  );
  return result.rows[0]!;
}
