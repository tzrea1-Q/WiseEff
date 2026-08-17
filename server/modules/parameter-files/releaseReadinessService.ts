import { createHash } from "node:crypto";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameter-kernel/policy";
import { listOpenConflicts } from "../parameters/fileSyncConflictRepository";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listConfigSetMemberFiles, listReleaseBaselineMembers, listReleaseBaselinesByConfigSet } from "./baselineRepository";
import { getConfigSetById } from "./configSetRepository";
import { getFileVersionById } from "./repository";
import {
  countBlockingIdentityMappingTasksForRevision,
  syncSingletonCardinalityBlockingTasks
} from "../parameter-topology/bindingService";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import { runValidationGate, type ValidationGateDeps, type ValidationGateResult } from "./validationGate";
import type { DtsSourceLocatorDto } from "./structuralReadRepository";

export type ReleaseReadinessLevel = "blocked" | "warning" | "ready" | "in-sync";

export type ReleaseReadinessSeverity = "blocker" | "warning";

export type ReleaseReadinessRemediationKind =
  | "assign-member-version"
  | "resolve-conflict"
  | "complete-pending-change"
  | "fix-validation"
  | "resolve-governance-task"
  | "acknowledge-warning"
  | "retry-evaluation";

export type ReleaseReadinessTarget = {
  fileId?: string;
  fileName?: string;
  nodePath?: string;
  propertyName?: string;
  source?: DtsSourceLocatorDto;
  conflictId?: string;
  changeRequestId?: string;
  configRevisionId?: string;
};

export type ReleaseReadinessIssue = {
  id: string;
  severity: ReleaseReadinessSeverity;
  code: string;
  message: string;
  target?: ReleaseReadinessTarget;
  remediation: {
    kind: ReleaseReadinessRemediationKind;
    label: string;
  };
  acknowledgementRequired?: boolean;
  acknowledged?: boolean;
};

export type ReleaseReadinessResult = {
  available: boolean;
  level: ReleaseReadinessLevel;
  blockers: ReleaseReadinessIssue[];
  warnings: ReleaseReadinessIssue[];
  gateToken: string;
  evaluatedAt: string;
  configSetId: string;
  projectId: string;
  releasedBaselineId?: string;
  canCreateBaseline: boolean;
  canRelease: boolean;
  unavailableReason?: string;
};

export type EvaluateReleaseReadinessInput = {
  configSetId: string;
  acknowledgedWarningIds?: string[];
};

export type EvaluateReleaseReadinessDeps = Partial<ValidationGateDeps> & {
  objectStore?: ObjectStore;
  /** Test seam: skip live validation gate and inject result. */
  validationGate?: ValidationGateResult | null;
  /** Test seam: skip open-conflict lookup. */
  openConflicts?: Awaited<ReturnType<typeof listOpenConflicts>>;
  /** Test seam: skip pending CR count. */
  pendingChangeCount?: number;
};

function requireParameterFileAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" });
  }
}

function issueId(code: string, targetKey: string) {
  return `${code}:${targetKey}`;
}

function fingerprintPayload(parts: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function countPendingChangeRequests(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `
    select count(*)::int as count
    from parameter_change_requests
    where organization_id = $1
      and project_id = $2
      and status in ('submitted', 'hardware_review', 'software_review', 'software_merge')
    `,
    [input.organizationId, input.projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

function sortIssues(issues: ReleaseReadinessIssue[]) {
  const severityRank = { blocker: 0, warning: 1 };
  return [...issues].sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity];
    if (severity !== 0) return severity;
    return a.id.localeCompare(b.id);
  });
}

async function workingMatchesReleasedTip(
  db: Queryable,
  input: {
    configSetId: string;
    members: Awaited<ReturnType<typeof listConfigSetMemberFiles>>;
    releasedBaselineId: string;
  }
): Promise<boolean> {
  const tipMembers = await listReleaseBaselineMembers(db, { baselineId: input.releasedBaselineId });
  const tipByFile = new Map(tipMembers.map((member) => [member.fileId, member]));
  const workingByFile = new Map(input.members.map((member) => [member.fileId, member]));

  if (tipByFile.size !== workingByFile.size) {
    return false;
  }

  for (const [fileId, tipMember] of tipByFile) {
    const working = workingByFile.get(fileId);
    if (!working?.currentVersionId) {
      return false;
    }
    if (working.currentVersionId === tipMember.fileVersionId) {
      continue;
    }
    const tipVersion = await getFileVersionById(db, { versionId: tipMember.fileVersionId });
    const workingVersion = await getFileVersionById(db, { versionId: working.currentVersionId });
    if (!tipVersion || !workingVersion || tipVersion.storageKey !== workingVersion.storageKey) {
      return false;
    }
  }

  for (const fileId of workingByFile.keys()) {
    if (!tipByFile.has(fileId)) {
      return false;
    }
  }

  return true;
}

function deriveLevel(input: {
  blockers: ReleaseReadinessIssue[];
  warnings: ReleaseReadinessIssue[];
  inSync: boolean;
}): ReleaseReadinessLevel {
  if (input.blockers.length > 0) return "blocked";
  const unacked = input.warnings.filter((item) => item.acknowledgementRequired && !item.acknowledged);
  if (unacked.length > 0) return "warning";
  if (input.inSync) return "in-sync";
  return "ready";
}

/**
 * Server-owned release readiness for one config set (PCW-D7 / #237).
 * Callers must not reconstruct create/release permission from unrelated client counts.
 */
export async function evaluateReleaseReadiness(
  db: Database,
  auth: AuthContext,
  input: EvaluateReleaseReadinessInput,
  deps: EvaluateReleaseReadinessDeps = {}
): Promise<ReleaseReadinessResult> {
  requireParameterFileAdmin(auth);

  const evaluatedAt = new Date().toISOString();
  const acknowledged = new Set(input.acknowledgedWarningIds ?? []);

  const configSet = await getConfigSetById(db, {
    organizationId: auth.organization.id,
    configSetId: input.configSetId
  });
  if (!configSet) {
    throw new ApiError("NOT_FOUND", "Config set not found.", { configSetId: input.configSetId });
  }

  const unavailable = (reason: string): ReleaseReadinessResult => {
    const blockers: ReleaseReadinessIssue[] = [
      {
        id: issueId("readiness-unavailable", input.configSetId),
        severity: "blocker",
        code: "readiness-unavailable",
        message: reason,
        remediation: { kind: "retry-evaluation", label: "Retry readiness evaluation" }
      }
    ];
    const gateToken = fingerprintPayload({
      v: 1,
      available: false,
      configSetId: input.configSetId,
      reason,
      evaluatedAt
    });
    return {
      available: false,
      level: "blocked",
      blockers,
      warnings: [],
      gateToken,
      evaluatedAt,
      configSetId: input.configSetId,
      projectId: configSet.projectId,
      canCreateBaseline: false,
      canRelease: false,
      unavailableReason: reason
    };
  };

  let members;
  try {
    members = await listConfigSetMemberFiles(db, input.configSetId);
  } catch {
    return unavailable("Release readiness could not load config set members.");
  }

  const blockers: ReleaseReadinessIssue[] = [];
  const warnings: ReleaseReadinessIssue[] = [];

  const primary = members.find((member) => member.role === "base");
  if (members.length === 0 || !primary) {
    blockers.push({
      id: issueId("missing-primary-version", input.configSetId),
      severity: "blocker",
      code: "missing-primary-version",
      message: "Config set has no primary (base) member version to snapshot.",
      remediation: { kind: "assign-member-version", label: "Assign a base member with an active version" }
    });
  } else if (!primary.currentVersionId) {
    blockers.push({
      id: issueId("missing-primary-version", primary.fileId),
      severity: "blocker",
      code: "missing-primary-version",
      message: `Primary member “${primary.fileName}” has no current version.`,
      target: { fileId: primary.fileId, fileName: primary.fileName },
      remediation: { kind: "assign-member-version", label: "Activate or upload a current version for the base member" }
    });
  }

  for (const member of members) {
    if (!member.currentVersionId) {
      blockers.push({
        id: issueId("missing-member-version", member.fileId),
        severity: "blocker",
        code: "missing-member-version",
        message: `Member “${member.fileName}” has no current version and cannot be baselined.`,
        target: { fileId: member.fileId, fileName: member.fileName },
        remediation: { kind: "assign-member-version", label: "Activate a current version for this member" }
      });
    }
  }

  const memberFileIds = new Set(members.map((member) => member.fileId));
  let openConflicts = deps.openConflicts;
  if (openConflicts === undefined) {
    try {
      openConflicts = await listOpenConflicts(db, {
        organizationId: auth.organization.id,
        projectId: configSet.projectId
      });
    } catch {
      // Infrastructure faults must not masquerade as open conflicts (CW-B2).
      return unavailable("Release readiness could not load open conflicts.");
    }
  }

  for (const conflict of openConflicts) {
    if (conflict.fileId && memberFileIds.size > 0 && !memberFileIds.has(conflict.fileId)) {
      continue;
    }
    blockers.push({
      id: issueId("open-conflict", conflict.id),
      severity: "blocker",
      code: "open-conflict",
      message: `Open file/UI conflict on ${conflict.parameterName ?? conflict.fileName ?? conflict.id}.`,
      target: {
        conflictId: conflict.id,
        fileId: conflict.fileId,
        fileName: conflict.fileName,
        nodePath: conflict.nodePath ?? conflict.sourceNodePath,
        propertyName: conflict.propertyName,
        source: conflict.source
      },
      remediation: { kind: "resolve-conflict", label: "Resolve conflict in the Conflicts task dock" }
    });
  }

  let pendingChangeCount = deps.pendingChangeCount;
  if (pendingChangeCount === undefined) {
    try {
      pendingChangeCount = await countPendingChangeRequests(db, {
        organizationId: auth.organization.id,
        projectId: configSet.projectId
      });
    } catch {
      return unavailable("Release readiness could not load pending change requests.");
    }
  }
  if (pendingChangeCount > 0) {
    blockers.push({
      id: issueId("pending-change", configSet.projectId),
      severity: "blocker",
      code: "pending-change",
      message: `${pendingChangeCount} server-visible pending change request(s) must complete before release.`,
      remediation: { kind: "complete-pending-change", label: "Complete or withdraw pending change requests" }
    });
  }

  let blockingTaskCount = 0;
  let configRevisionId: string | undefined;
  try {
    const revision = await getLatestConfigRevision(db, {
      organizationId: auth.organization.id,
      projectId: configSet.projectId,
      configSetId: input.configSetId
    });
    if (revision) {
      configRevisionId = revision.id;
      await syncSingletonCardinalityBlockingTasks(db, {
        organizationId: auth.organization.id,
        projectId: revision.projectId,
        configRevisionId: revision.id
      });
      blockingTaskCount = await countBlockingIdentityMappingTasksForRevision(db, {
        organizationId: auth.organization.id,
        configRevisionId: revision.id
      });
    }
  } catch (error) {
    blockers.push({
      id: issueId("publish-blocking-governance", input.configSetId),
      severity: "blocker",
      code: "publish-blocking-governance",
      message: error instanceof Error ? error.message : "Failed to evaluate governance tasks.",
      remediation: { kind: "resolve-governance-task", label: "Resolve identity mapping governance tasks" }
    });
  }
  if (blockingTaskCount > 0) {
    blockers.push({
      id: issueId("publish-blocking-governance", configRevisionId ?? input.configSetId),
      severity: "blocker",
      code: "publish-blocking-governance",
      message: `${blockingTaskCount} publish-blocking identity/cardinality task(s) remain open.`,
      target: { configRevisionId },
      remediation: { kind: "resolve-governance-task", label: "Resolve identity mapping governance tasks" }
    });
  }

  let gate: ValidationGateResult | null = deps.validationGate ?? null;
  if (deps.validationGate === undefined) {
    if (!deps.objectStore) {
      // Without an object store, skip toolchain validation rather than claiming ready falsely.
      // Create/release paths inject the store; read path may still report other blockers.
      gate = null;
    } else {
      try {
        gate = await runValidationGate(
          db,
          auth,
          { configSetId: input.configSetId, forRelease: false },
          { objectStore: deps.objectStore, validator: deps.validator, toolchain: deps.toolchain }
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") {
          const diagnostics = (error.details as { diagnostics?: Array<{ file?: string; message?: string; severity?: string }> } | undefined)
            ?.diagnostics;
          const hard = (diagnostics ?? []).filter((item) => item.severity === "error");
          if (hard.length === 0) {
            blockers.push({
              id: issueId("hard-validation-error", input.configSetId),
              severity: "blocker",
              code: "hard-validation-error",
              message: error.message,
              remediation: { kind: "fix-validation", label: "Fix hard validation errors" }
            });
          } else {
            for (const diagnostic of hard) {
              const fileName = diagnostic.file ?? "config-set";
              blockers.push({
                id: issueId("hard-validation-error", `${fileName}:${diagnostic.message ?? "error"}`),
                severity: "blocker",
                code: "hard-validation-error",
                message: diagnostic.message ?? error.message,
                target: { fileName },
                remediation: { kind: "fix-validation", label: "Fix hard validation errors" }
              });
            }
          }
          gate = null;
        } else {
          blockers.push({
            id: issueId("hard-validation-error", input.configSetId),
            severity: "blocker",
            code: "hard-validation-error",
            message: error instanceof Error ? error.message : "Validation gate unavailable.",
            remediation: { kind: "fix-validation", label: "Fix or restore validation toolchain" }
          });
          gate = null;
        }
      }
    }
  }

  if (gate) {
    const hardErrors = gate.diagnostics.filter((item) => item.severity === "error");
    if (!gate.ok || hardErrors.length > 0) {
      for (const diagnostic of hardErrors.length > 0 ? hardErrors : [{ message: "Validation gate failed.", file: undefined as string | undefined }]) {
        blockers.push({
          id: issueId("hard-validation-error", `${diagnostic.file ?? "config-set"}:${diagnostic.message}`),
          severity: "blocker",
          code: "hard-validation-error",
          message: diagnostic.message,
          target: diagnostic.file ? { fileName: diagnostic.file } : undefined,
          remediation: { kind: "fix-validation", label: "Fix hard validation errors" }
        });
      }
    } else if (gate.requiresConfirmation) {
      const warningDiagnostics = gate.diagnostics.filter((item) => item.severity === "warning");
      const items =
        warningDiagnostics.length > 0
          ? warningDiagnostics
          : [{ message: "Toolchain validation requires explicit acknowledgement before release.", file: undefined as string | undefined }];
      for (const diagnostic of items) {
        const id = issueId("toolchain-warning", `${diagnostic.file ?? "config-set"}:${diagnostic.message}`);
        warnings.push({
          id,
          severity: "warning",
          code: "toolchain-warning",
          message: diagnostic.message,
          target: diagnostic.file ? { fileName: diagnostic.file } : undefined,
          remediation: { kind: "acknowledge-warning", label: "Review and acknowledge this warning" },
          acknowledgementRequired: true,
          acknowledged: acknowledged.has(id)
        });
      }
    }
  }

  const sortedBlockers = sortIssues(blockers);
  const sortedWarnings = sortIssues(warnings);

  let releasedBaselineId: string | undefined;
  let inSync = false;
  try {
    const baselines = await listReleaseBaselinesByConfigSet(db, { configSetId: input.configSetId });
    releasedBaselineId = baselines.find((item) => item.status === "released")?.id;
    if (releasedBaselineId && sortedBlockers.length === 0) {
      inSync = await workingMatchesReleasedTip(db, {
        configSetId: input.configSetId,
        members,
        releasedBaselineId
      });
    }
  } catch {
    // Released identity is optional for create; do not fail the whole gate.
  }

  const resolvedLevel = deriveLevel({
    blockers: sortedBlockers,
    warnings: sortedWarnings,
    inSync
  });

  const gateToken = fingerprintPayload({
    v: 1,
    available: true,
    configSetId: input.configSetId,
    memberVersions: members.map((m) => `${m.fileId}:${m.currentVersionId ?? ""}`).sort(),
    blockerIds: sortedBlockers.map((item) => item.id),
    warningIds: sortedWarnings.map((item) => `${item.id}:${item.acknowledged ? "1" : "0"}`),
    pendingChangeCount,
    blockingTaskCount,
    acknowledged: [...acknowledged].sort()
  });

  const canCreateBaseline = resolvedLevel !== "blocked";
  const canRelease = resolvedLevel === "ready" || resolvedLevel === "in-sync";

  return {
    available: true,
    level: resolvedLevel,
    blockers: sortedBlockers,
    warnings: sortedWarnings,
    gateToken,
    evaluatedAt,
    configSetId: input.configSetId,
    projectId: configSet.projectId,
    releasedBaselineId,
    canCreateBaseline,
    canRelease
  };
}

export async function assertReleaseGateAllows(
  db: Database,
  auth: AuthContext,
  input: {
    configSetId: string;
    gateToken?: string;
    acknowledgedWarningIds?: string[];
    action: "create" | "release";
  },
  deps: EvaluateReleaseReadinessDeps = {}
): Promise<ReleaseReadinessResult> {
  if (!input.gateToken) {
    throw new ApiError("CONFLICT", "Release readiness gate token is required.", {
      code: "readiness-gate-required",
      configSetId: input.configSetId
    });
  }

  const readiness = await evaluateReleaseReadiness(
    db,
    auth,
    { configSetId: input.configSetId, acknowledgedWarningIds: input.acknowledgedWarningIds },
    deps
  );

  if (!readiness.available) {
    throw new ApiError("CONFLICT", readiness.unavailableReason ?? "Release readiness is unavailable.", {
      code: "readiness-unavailable",
      configSetId: input.configSetId,
      gateToken: readiness.gateToken
    });
  }

  if (readiness.gateToken !== input.gateToken) {
    throw new ApiError("CONFLICT", "Release readiness gate token is stale.", {
      code: "readiness-gate-stale",
      configSetId: input.configSetId,
      gateToken: readiness.gateToken,
      level: readiness.level
    });
  }

  if (input.action === "create" && !readiness.canCreateBaseline) {
    throw new ApiError("CONFLICT", "Baseline creation is blocked by release readiness.", {
      code: "readiness-blocked",
      configSetId: input.configSetId,
      level: readiness.level,
      blockers: readiness.blockers
    });
  }

  if (input.action === "release" && !readiness.canRelease) {
    throw new ApiError("CONFLICT", "Baseline release is blocked by release readiness.", {
      code: "readiness-blocked",
      configSetId: input.configSetId,
      level: readiness.level,
      blockers: readiness.blockers,
      warnings: readiness.warnings
    });
  }

  return readiness;
}
