import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { requireDebugAdmin } from "../debugging/policy";
import type { SensitiveWriteActorType } from "../parameters/sensitiveNode";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  SEEDED_RELOAD_CONFIGURATION,
  type DeviceReloadConfigurationOverrideDto,
  type OrganisationReloadConfigurationDto,
  type ReloadConfigurationAdminView,
  type ReloadConfigurationContract
} from "./configurationTypes";
import { parseReloadConfigurationContract } from "./configurationValidation";
import {
  deleteDeviceOverride,
  getDeviceOverrideRow,
  getOrganisationDefaultRow,
  getOrganisationDevice,
  listDeviceOverrideRows,
  rowToContract,
  upsertDeviceOverride,
  upsertOrganisationDefault,
  type DeviceOverrideRow,
  type OrganisationDefaultRow
} from "./configurationRepository";
import { assertDtsReloadHumanActor } from "./policy";

export type ReloadConfigurationServiceContext = AuditCorrelationContext & {
  /**
   * Caller-supplied actor label (parameters `SensitiveWriteActorType` pattern).
   * Mutating entry points must pass this through rather than hard-coding `"user"`.
   * HTTP admin routes omit it and default to `"user"` at the gate/audit boundary.
   */
  actorType?: SensitiveWriteActorType;
};

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function organisationDto(row: OrganisationDefaultRow | null): OrganisationReloadConfigurationDto {
  if (!row) {
    return {
      scope: "organisation",
      source: "seeded-default",
      ...SEEDED_RELOAD_CONFIGURATION,
      updatedAt: null,
      updatedByUserId: null
    };
  }
  return {
    scope: "organisation",
    source: "organisation",
    ...rowToContract(row),
    updatedAt: toIso(row.updated_at),
    updatedByUserId: row.updated_by_user_id
  };
}

function deviceDto(row: DeviceOverrideRow): DeviceReloadConfigurationOverrideDto {
  return {
    scope: "device",
    deviceId: row.device_id,
    deviceName: row.device_name ?? null,
    ...rowToContract(row),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    updatedByUserId: row.updated_by_user_id
  };
}

async function writeConfigurationAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    action: "update" | "delete";
    kind: "dts-reload-configuration-update" | "dts-reload-configuration-delete";
    scope: "organisation" | "device";
    targetId: string;
    previous: ReloadConfigurationContract | null;
    next: ReloadConfigurationContract | null;
    deviceId?: string;
    actorType: SensitiveWriteActorType;
  },
  context: ReloadConfigurationServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: input.actorType,
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    targetType: "dts-reload-configuration",
    targetId: input.targetId,
    metadata: {
      scope: input.scope,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      previous: input.previous,
      next: input.next
    },
    traceId: context.requestId ?? randomUUID()
  });
}

async function assertConfigurationHumanActor(
  db: Queryable,
  auth: AuthContext,
  context: ReloadConfigurationServiceContext
) {
  await assertDtsReloadHumanActor(db, auth, {
    actorType: context.actorType,
    action: "configure",
    requestId: context.requestId
  });
}

export async function getReloadConfigurationAdminView(
  db: Queryable,
  auth: AuthContext
): Promise<ReloadConfigurationAdminView> {
  requireDebugAdmin(auth);
  const orgRow = await getOrganisationDefaultRow(db, auth.organization.id);
  const deviceRows = await listDeviceOverrideRows(db, auth.organization.id);
  return {
    organisation: organisationDto(orgRow),
    deviceOverrides: deviceRows.map(deviceDto)
  };
}

export async function updateOrganisationReloadConfiguration(
  db: Database,
  auth: AuthContext,
  body: unknown,
  context: ReloadConfigurationServiceContext = {}
): Promise<OrganisationReloadConfigurationDto> {
  requireDebugAdmin(auth);
  await assertConfigurationHumanActor(db, auth, context);
  const actorType = context.actorType ?? "user";
  const contract = parseReloadConfigurationContract(body);

  return db.transaction(async (tx) => {
    const previousRow = await getOrganisationDefaultRow(tx, auth.organization.id);
    const previous = previousRow ? rowToContract(previousRow) : { ...SEEDED_RELOAD_CONFIGURATION };
    const saved = await upsertOrganisationDefault(tx, {
      organizationId: auth.organization.id,
      contract,
      updatedByUserId: auth.user.id
    });
    await writeConfigurationAudit(
      tx,
      auth,
      {
        action: "update",
        kind: "dts-reload-configuration-update",
        scope: "organisation",
        targetId: auth.organization.id,
        previous,
        next: rowToContract(saved),
        actorType
      },
      context
    );
    return organisationDto(saved);
  });
}

export async function upsertDeviceReloadConfiguration(
  db: Database,
  auth: AuthContext,
  deviceId: string,
  body: unknown,
  context: ReloadConfigurationServiceContext = {}
): Promise<DeviceReloadConfigurationOverrideDto> {
  requireDebugAdmin(auth);
  await assertConfigurationHumanActor(db, auth, context);
  const actorType = context.actorType ?? "user";
  const contract = parseReloadConfigurationContract(body);

  return db.transaction(async (tx) => {
    const device = await getOrganisationDevice(tx, auth.organization.id, deviceId);
    if (!device) {
      throw new ApiError("NOT_FOUND", "Debug device was not found in this organisation.", 404, { deviceId });
    }

    const existing = await getDeviceOverrideRow(tx, auth.organization.id, deviceId);
    const previous = existing ? rowToContract(existing) : null;

    const saved = await upsertDeviceOverride(tx, {
      id: existing?.id ?? randomUUID(),
      organizationId: auth.organization.id,
      deviceId,
      contract,
      updatedByUserId: auth.user.id
    });

    await writeConfigurationAudit(
      tx,
      auth,
      {
        action: "update",
        kind: "dts-reload-configuration-update",
        scope: "device",
        targetId: deviceId,
        deviceId,
        previous,
        next: rowToContract(saved),
        actorType
      },
      context
    );

    return deviceDto({ ...saved, device_name: device.name });
  });
}

export async function removeDeviceReloadConfiguration(
  db: Database,
  auth: AuthContext,
  deviceId: string,
  context: ReloadConfigurationServiceContext = {}
): Promise<{ deviceId: string }> {
  requireDebugAdmin(auth);
  await assertConfigurationHumanActor(db, auth, context);
  const actorType = context.actorType ?? "user";

  return db.transaction(async (tx) => {
    const removed = await deleteDeviceOverride(tx, auth.organization.id, deviceId);
    if (!removed) {
      throw new ApiError("NOT_FOUND", "Device reload configuration override was not found.", 404, { deviceId });
    }
    await writeConfigurationAudit(
      tx,
      auth,
      {
        action: "delete",
        kind: "dts-reload-configuration-delete",
        scope: "device",
        targetId: deviceId,
        deviceId,
        previous: rowToContract(removed),
        next: null,
        actorType
      },
      context
    );
    return { deviceId };
  });
}
