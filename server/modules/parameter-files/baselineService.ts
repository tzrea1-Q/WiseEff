import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  getReleaseBaselineByConfigSetAndName,
  getReleaseBaselineById,
  insertReleaseBaseline,
  insertReleaseBaselineMember,
  listConfigSetMemberFiles,
  listReleaseBaselineMembers,
  listReleaseBaselinesByConfigSet
} from "./baselineRepository";
import { getConfigSetById } from "./configSetRepository";
import type { ReleaseBaselineDto, ReleaseBaselineMemberDto } from "./types";

export type BaselineServiceContext = AuditCorrelationContext;

function requireParameterFileAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}

async function writeBaselineAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    action: "created";
    projectId: string | null;
    targetId: string;
    metadata: Record<string, unknown>;
  },
  context: BaselineServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "baseline",
    action: input.action,
    severity: "Medium",
    targetType: "dts-release-baseline",
    targetId: input.targetId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
}

export async function createBaseline(
  db: Database,
  auth: AuthContext,
  input: { configSetId: string; name: string; notes?: string },
  context: BaselineServiceContext = {}
): Promise<ReleaseBaselineDto> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const configSet = await getConfigSetById(tx, {
      organizationId: auth.organization.id,
      configSetId: input.configSetId
    });
    if (!configSet) {
      throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId: input.configSetId });
    }

    const existing = await getReleaseBaselineByConfigSetAndName(tx, {
      configSetId: input.configSetId,
      name: input.name
    });
    if (existing) {
      throw new ApiError("CONFLICT", "A baseline with this name already exists for this config set.", 409, {
        configSetId: input.configSetId,
        name: input.name
      });
    }

    const members = await listConfigSetMemberFiles(tx, input.configSetId);
    const incompleteMember = members.find((member) => !member.currentVersionId);
    if (incompleteMember) {
      throw new ApiError(
        "CONFLICT",
        "Config set is incomplete: one or more member files have no current version and cannot be baselined.",
        409,
        { configSetId: input.configSetId, fileId: incompleteMember.fileId }
      );
    }

    const baseline = await insertReleaseBaseline(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      configSetId: input.configSetId,
      name: input.name,
      notes: input.notes,
      createdByUserId: auth.user.id
    });

    for (const member of members) {
      await insertReleaseBaselineMember(tx, {
        id: randomUUID(),
        baselineId: baseline.id,
        fileId: member.fileId,
        fileVersionId: member.currentVersionId as string,
        versionNumber: member.currentVersionNumber as number
      });
    }

    await writeBaselineAudit(
      tx,
      auth,
      {
        action: "created",
        projectId: configSet.projectId,
        targetId: baseline.id,
        metadata: {
          configSetId: input.configSetId,
          name: baseline.name,
          memberCount: members.length
        }
      },
      context
    );

    return baseline;
  });
}

export async function getBaseline(
  db: Queryable,
  auth: AuthContext,
  baselineId: string
): Promise<{ baseline: ReleaseBaselineDto; members: ReleaseBaselineMemberDto[] }> {
  requireParameterFileAdmin(auth);

  const baseline = await getReleaseBaselineById(db, { organizationId: auth.organization.id, baselineId });
  if (!baseline) {
    throw new ApiError("NOT_FOUND", "Baseline not found.", 404, { baselineId });
  }

  const members = await listReleaseBaselineMembers(db, { baselineId });
  return { baseline, members };
}

export async function listBaselines(
  db: Queryable,
  auth: AuthContext,
  configSetId: string
): Promise<ReleaseBaselineDto[]> {
  requireParameterFileAdmin(auth);
  return listReleaseBaselinesByConfigSet(db, { configSetId });
}
