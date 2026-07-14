import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { diffResolvedDts, type StructuralChange } from "./baselineDiff";
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
import { getFileVersionById, getProjectParameterFileById, insertFileVersion, setCurrentVersion } from "./repository";
import type { ReleaseBaselineDto, ReleaseBaselineMemberDto } from "./types";

export type BaselineServiceContext = AuditCorrelationContext;

export type BaselineMemberCompareStatus = "unchanged" | "version_changed" | "file_added" | "file_removed";

export type BaselineMemberComparison = {
  fileId: string;
  fileName?: string;
  status: BaselineMemberCompareStatus;
  baselineVersionId?: string;
  currentVersionId?: string;
  structuralDiff?: StructuralChange[];
};

export type CompareBaselineResult = {
  baselineId: string;
  members: BaselineMemberComparison[];
};

export type CompareBaselineDeps = {
  objectStore?: ObjectStore;
};

export type RollbackBaselineResult = {
  baselineId: string;
  restored: number;
};

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

async function loadStructuralDiff(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { fileId: string; baselineVersionId: string; currentVersionId: string }
): Promise<StructuralChange[] | undefined> {
  const file = await getProjectParameterFileById(db, { organizationId: auth.organization.id, fileId: input.fileId });
  if (!file || file.format !== "dts") {
    return undefined;
  }

  const baselineVersion = await getFileVersionById(db, { versionId: input.baselineVersionId });
  const currentVersion = await getFileVersionById(db, { versionId: input.currentVersionId });
  if (!baselineVersion || !currentVersion) {
    return undefined;
  }

  const baselineBytes = await objectStore.get(baselineVersion.storageKey);
  const currentBytes = await objectStore.get(currentVersion.storageKey);

  return diffResolvedDts(baselineBytes.toString("utf8"), currentBytes.toString("utf8"));
}

/**
 * Per-member status: unchanged | version_changed | file_added | file_removed.
 * When an objectStore is injected and the member is a dts file, version_changed
 * members also get a structural diff computed via resolveDts + normalizedValue,
 * so equivalent reorderings (hex case, multi-group flatten) never produce a false diff.
 */
export async function compareBaseline(
  db: Queryable,
  auth: AuthContext,
  baselineId: string,
  deps: CompareBaselineDeps = {}
): Promise<CompareBaselineResult> {
  requireParameterFileAdmin(auth);

  const baseline = await getReleaseBaselineById(db, { organizationId: auth.organization.id, baselineId });
  if (!baseline) {
    throw new ApiError("NOT_FOUND", "Baseline not found.", 404, { baselineId });
  }

  const baselineMembers = await listReleaseBaselineMembers(db, { baselineId });
  const currentMembers = await listConfigSetMemberFiles(db, baseline.configSetId);

  const baselineByFile = new Map(baselineMembers.map((member) => [member.fileId, member]));
  const currentByFile = new Map(currentMembers.map((member) => [member.fileId, member]));
  const fileIds = [...new Set([...baselineByFile.keys(), ...currentByFile.keys()])].sort();

  const members: BaselineMemberComparison[] = [];

  for (const fileId of fileIds) {
    const baselineMember = baselineByFile.get(fileId);
    const currentMember = currentByFile.get(fileId);

    if (baselineMember && !currentMember) {
      members.push({ fileId, status: "file_removed", baselineVersionId: baselineMember.fileVersionId });
      continue;
    }

    if (!baselineMember && currentMember) {
      members.push({
        fileId,
        fileName: currentMember.fileName,
        status: "file_added",
        currentVersionId: currentMember.currentVersionId
      });
      continue;
    }

    if (!baselineMember || !currentMember) {
      continue;
    }

    if (baselineMember.fileVersionId === currentMember.currentVersionId) {
      members.push({
        fileId,
        fileName: currentMember.fileName,
        status: "unchanged",
        baselineVersionId: baselineMember.fileVersionId,
        currentVersionId: currentMember.currentVersionId
      });
      continue;
    }

    const comparison: BaselineMemberComparison = {
      fileId,
      fileName: currentMember.fileName,
      status: "version_changed",
      baselineVersionId: baselineMember.fileVersionId,
      currentVersionId: currentMember.currentVersionId
    };

    if (deps.objectStore && currentMember.currentVersionId) {
      const structuralDiff = await loadStructuralDiff(db, deps.objectStore, auth, {
        fileId,
        baselineVersionId: baselineMember.fileVersionId,
        currentVersionId: currentMember.currentVersionId
      });
      if (structuralDiff) {
        comparison.structuralDiff = structuralDiff;
      }
    }

    members.push(comparison);
  }

  return { baselineId, members };
}

async function writeBaselineRolledBackAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string | null;
    baselineId: string;
    configSetId: string;
    restored: number;
    memberCount: number;
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
    action: "rolled_back",
    severity: "High",
    targetType: "dts-release-baseline",
    targetId: input.baselineId,
    metadata: {
      configSetId: input.configSetId,
      restored: input.restored,
      memberCount: input.memberCount
    },
    traceId: context.requestId ?? randomUUID()
  });
}

/**
 * Atomic rollback (decision C): pins every baseline member's current_version_id back
 * to the frozen version. History is never deleted. Members whose current_version_id
 * already equals the pinned version are no-ops. Otherwise a new version row is created
 * with origin='rollback' (reusing the target version's storageKey/checksum/sizeBytes/
 * parsedIndex as a pointer version) and current_version_id is repointed to it, so the
 * pointer never jumps backwards to an older version_number without an audit trail.
 * Files added to the config set after the baseline was taken are left untouched.
 * If a pinned file no longer exists at all, the whole rollback fails atomically.
 */
export async function rollbackToBaseline(
  db: Database,
  auth: AuthContext,
  baselineId: string,
  context: BaselineServiceContext = {}
): Promise<RollbackBaselineResult> {
  requireParameterFileAdmin(auth);

  return db.transaction(async (tx) => {
    const baseline = await getReleaseBaselineById(tx, { organizationId: auth.organization.id, baselineId });
    if (!baseline) {
      throw new ApiError("NOT_FOUND", "Baseline not found.", 404, { baselineId });
    }

    const configSet = await getConfigSetById(tx, {
      organizationId: auth.organization.id,
      configSetId: baseline.configSetId
    });

    const members = await listReleaseBaselineMembers(tx, { baselineId });

    let restored = 0;
    for (const member of members) {
      const file = await getProjectParameterFileById(tx, {
        organizationId: auth.organization.id,
        fileId: member.fileId
      });
      if (!file) {
        throw new ApiError("NOT_FOUND", "A baseline member file no longer exists; rollback aborted.", 404, {
          baselineId,
          fileId: member.fileId
        });
      }

      if (file.currentVersionId === member.fileVersionId) {
        continue;
      }

      const targetVersion = await getFileVersionById(tx, { versionId: member.fileVersionId });
      if (!targetVersion) {
        throw new ApiError("NOT_FOUND", "The baseline-pinned file version no longer exists; rollback aborted.", 404, {
          baselineId,
          fileId: member.fileId,
          versionId: member.fileVersionId
        });
      }

      const rollbackVersion = await insertFileVersion(tx, {
        id: randomUUID(),
        fileId: file.id,
        versionNumber: (file.currentVersionNumber ?? 0) + 1,
        storageKey: targetVersion.storageKey,
        checksum: targetVersion.checksum,
        sizeBytes: targetVersion.sizeBytes,
        parsedIndex: targetVersion.parsedIndex,
        origin: "rollback",
        createdByUserId: auth.user.id
      });

      await setCurrentVersion(tx, { fileId: file.id, versionId: rollbackVersion.id });
      restored += 1;
    }

    await writeBaselineRolledBackAudit(
      tx,
      auth,
      {
        projectId: configSet?.projectId ?? null,
        baselineId,
        configSetId: baseline.configSetId,
        restored,
        memberCount: members.length
      },
      context
    );

    return { baselineId, restored };
  });
}
