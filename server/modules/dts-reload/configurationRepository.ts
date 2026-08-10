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

export type DeviceOverrideRow = {
  id: string;
  organization_id: string;
  device_id: string;
  destination_directory: string;
  destination_filename: string;
  trigger_node_path: string;
  trigger_payload: string;
  kernel_log_command: string;
  updated_by_user_id: string | null;
  updated_at: string;
  created_at: string;
  device_name?: string | null;
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

export async function getDeviceOverrideRow(
  db: Queryable,
  organizationId: string,
  deviceId: string
): Promise<DeviceOverrideRow | null> {
  const result = await db.query<DeviceOverrideRow>(
    `select id, organization_id, device_id, destination_directory, destination_filename,
            trigger_node_path, trigger_payload, kernel_log_command, updated_by_user_id,
            updated_at, created_at
       from dts_reload_device_overrides
      where organization_id = $1 and device_id = $2`,
    [organizationId, deviceId]
  );
  return result.rows[0] ?? null;
}

export async function listDeviceOverrideRows(
  db: Queryable,
  organizationId: string
): Promise<DeviceOverrideRow[]> {
  const result = await db.query<DeviceOverrideRow>(
    `select o.id, o.organization_id, o.device_id, o.destination_directory, o.destination_filename,
            o.trigger_node_path, o.trigger_payload, o.kernel_log_command, o.updated_by_user_id,
            o.updated_at, o.created_at, d.name as device_name
       from dts_reload_device_overrides o
       left join debugging_devices d
         on d.id = o.device_id and d.organization_id = o.organization_id
      where o.organization_id = $1
      order by o.updated_at desc, o.device_id asc`,
    [organizationId]
  );
  return result.rows;
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

export async function upsertDeviceOverride(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    deviceId: string;
    contract: ReloadConfigurationContract;
    updatedByUserId: string;
  }
): Promise<DeviceOverrideRow> {
  const result = await db.query<DeviceOverrideRow>(
    `insert into dts_reload_device_overrides (
       id, organization_id, device_id, destination_directory, destination_filename,
       trigger_node_path, trigger_payload, kernel_log_command, updated_by_user_id, updated_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     on conflict (organization_id, device_id) do update set
       destination_directory = excluded.destination_directory,
       destination_filename = excluded.destination_filename,
       trigger_node_path = excluded.trigger_node_path,
       trigger_payload = excluded.trigger_payload,
       kernel_log_command = excluded.kernel_log_command,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = now()
     returning id, organization_id, device_id, destination_directory, destination_filename,
               trigger_node_path, trigger_payload, kernel_log_command, updated_by_user_id,
               updated_at, created_at`,
    [
      input.id,
      input.organizationId,
      input.deviceId,
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

export async function deleteDeviceOverride(
  db: Queryable,
  organizationId: string,
  deviceId: string
): Promise<DeviceOverrideRow | null> {
  const result = await db.query<DeviceOverrideRow>(
    `delete from dts_reload_device_overrides
      where organization_id = $1 and device_id = $2
      returning id, organization_id, device_id, destination_directory, destination_filename,
                trigger_node_path, trigger_payload, kernel_log_command, updated_by_user_id,
                updated_at, created_at`,
    [organizationId, deviceId]
  );
  return result.rows[0] ?? null;
}

export async function getOrganisationDevice(
  db: Queryable,
  organizationId: string,
  deviceId: string
): Promise<{ id: string; name: string } | null> {
  const result = await db.query<{ id: string; name: string }>(
    `select id, name
       from debugging_devices
      where organization_id = $1 and id = $2`,
    [organizationId, deviceId]
  );
  return result.rows[0] ?? null;
}
