import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  clearFileConfigSetMembership,
  getConfigSetById,
  getConfigSetByProjectAndName,
  getFileConfigSetMembership,
  insertConfigSet,
  listConfigSetsByProject,
  setFileConfigSetMembership,
  updateConfigSetRow
} from "./configSetRepository";
import type { ConfigSetDto, ConfigSetFileDto, ConfigSetRole } from "./types";

export const DEFAULT_CONFIG_SET_NAME = "default";

export type ConfigSetServiceContext = AuditCorrelationContext;

function requireParameterFileAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}

async function writeConfigSetAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    action: "created" | "updated" | "member_changed";
    projectId: string | null;
    targetId: string;
    metadata: Record<string, unknown>;
  },
  context: ConfigSetServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "config-set",
    action: input.action,
    severity: "Medium",
    targetType: "dts-config-set",
    targetId: input.targetId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
}

export async function createConfigSet(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; name: string; description?: string; derivedFromId?: string },
  context: ConfigSetServiceContext = {}
): Promise<ConfigSetDto> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const existing = await getConfigSetByProjectAndName(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      name: input.name
    });
    if (existing) {
      throw new ApiError("CONFLICT", "A config set with this name already exists in the project.", 409, {
        projectId: input.projectId,
        name: input.name
      });
    }

    const configSet = await insertConfigSet(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      derivedFromId: input.derivedFromId
    });

    await writeConfigSetAudit(
      tx,
      auth,
      {
        action: "created",
        projectId: configSet.projectId,
        targetId: configSet.id,
        metadata: {
          name: configSet.name,
          description: configSet.description,
          derivedFromId: configSet.derivedFromId
        }
      },
      context
    );

    return configSet;
  });
}

export async function listConfigSets(db: Queryable, auth: AuthContext, projectId: string): Promise<ConfigSetDto[]> {
  requireParameterFileAdmin(auth);
  return listConfigSetsByProject(db, { organizationId: auth.organization.id, projectId });
}

export async function ensureDefaultConfigSet(
  db: Database,
  auth: AuthContext,
  projectId: string,
  context: ConfigSetServiceContext = {}
): Promise<ConfigSetDto> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const existing = await getConfigSetByProjectAndName(tx, {
      organizationId: auth.organization.id,
      projectId,
      name: DEFAULT_CONFIG_SET_NAME
    });
    if (existing) {
      return existing;
    }

    const configSet = await insertConfigSet(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId,
      name: DEFAULT_CONFIG_SET_NAME,
      description: "Auto-created default configuration set."
    });

    await writeConfigSetAudit(
      tx,
      auth,
      {
        action: "created",
        projectId: configSet.projectId,
        targetId: configSet.id,
        metadata: { name: configSet.name, ensuredDefault: true }
      },
      context
    );

    return configSet;
  });
}

export async function addConfigSetFile(
  db: Database,
  auth: AuthContext,
  input: { configSetId: string; fileId: string; role: ConfigSetRole; sortOrder?: number },
  context: ConfigSetServiceContext = {}
): Promise<ConfigSetFileDto> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const configSet = await getConfigSetById(tx, {
      organizationId: auth.organization.id,
      configSetId: input.configSetId
    });
    if (!configSet) {
      throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId: input.configSetId });
    }

    const membership = await getFileConfigSetMembership(tx, {
      organizationId: auth.organization.id,
      fileId: input.fileId
    });
    if (!membership) {
      throw new ApiError("NOT_FOUND", "Parameter file not found.", 404, { fileId: input.fileId });
    }

    if (membership.projectId !== configSet.projectId) {
      throw new ApiError("VALIDATION_FAILED", "File does not belong to the config set's project.", 400, {
        fileId: input.fileId,
        configSetId: input.configSetId
      });
    }

    if (membership.configSetId && membership.configSetId !== input.configSetId) {
      throw new ApiError("CONFLICT", "File already belongs to a different config set.", 409, {
        fileId: input.fileId,
        currentConfigSetId: membership.configSetId
      });
    }

    const sortOrder = input.sortOrder ?? 0;
    await setFileConfigSetMembership(tx, {
      fileId: input.fileId,
      configSetId: input.configSetId,
      role: input.role,
      sortOrder
    });

    await writeConfigSetAudit(
      tx,
      auth,
      {
        action: "member_changed",
        projectId: configSet.projectId,
        targetId: configSet.id,
        metadata: { fileId: input.fileId, role: input.role, sortOrder, change: "added" }
      },
      context
    );

    return { configSetId: input.configSetId, fileId: input.fileId, role: input.role, sortOrder };
  });
}

export async function removeConfigSetFile(
  db: Database,
  auth: AuthContext,
  input: { configSetId: string; fileId: string },
  context: ConfigSetServiceContext = {}
): Promise<void> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const membership = await getFileConfigSetMembership(tx, {
      organizationId: auth.organization.id,
      fileId: input.fileId
    });
    if (!membership || membership.configSetId !== input.configSetId) {
      throw new ApiError("NOT_FOUND", "File is not a member of this config set.", 404, {
        fileId: input.fileId,
        configSetId: input.configSetId
      });
    }

    await clearFileConfigSetMembership(tx, { fileId: input.fileId });

    await writeConfigSetAudit(
      tx,
      auth,
      {
        action: "member_changed",
        projectId: membership.projectId,
        targetId: input.configSetId,
        metadata: { fileId: input.fileId, previousRole: membership.configSetRole, change: "removed" }
      },
      context
    );
  });
}

export async function updateConfigSet(
  db: Database,
  auth: AuthContext,
  input: { configSetId: string; name?: string; description?: string | null; derivedFromId?: string | null },
  context: ConfigSetServiceContext = {}
): Promise<ConfigSetDto> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const existing = await getConfigSetById(tx, {
      organizationId: auth.organization.id,
      configSetId: input.configSetId
    });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId: input.configSetId });
    }

    const nextName = input.name ?? existing.name;
    const nextDescription =
      input.description === undefined ? existing.description : input.description === null ? undefined : input.description;
    const nextDerivedFromId =
      input.derivedFromId === undefined
        ? existing.derivedFromId
        : input.derivedFromId === null
          ? undefined
          : input.derivedFromId;

    if (nextName !== existing.name) {
      const conflict = await getConfigSetByProjectAndName(tx, {
        organizationId: auth.organization.id,
        projectId: existing.projectId,
        name: nextName
      });
      if (conflict && conflict.id !== input.configSetId) {
        throw new ApiError("CONFLICT", "A config set with this name already exists in the project.", 409, {
          projectId: existing.projectId,
          name: nextName
        });
      }
    }

    const updated = await updateConfigSetRow(tx, {
      id: input.configSetId,
      name: nextName,
      description: nextDescription,
      derivedFromId: nextDerivedFromId
    });

    await writeConfigSetAudit(
      tx,
      auth,
      {
        action: "updated",
        projectId: updated.projectId,
        targetId: updated.id,
        metadata: { name: updated.name, description: updated.description, derivedFromId: updated.derivedFromId }
      },
      context
    );

    return updated;
  });
}
