import { createHash, randomUUID } from "node:crypto";

import { asAuditTx, withAuditedWrite, writeAuditEventInTx, writeMilestoneAudit, type AuditSpec } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { DtsValue } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import type { SensitiveWriteActorType } from "../parameter-kernel/sensitiveNode";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildReloadBaseSource } from "./baseSource";
import { classifyReloadCandidate, normalizeReloadCandidates } from "./candidates";
import {
  describeReloadValueShapeAuthoring,
  resolveReloadValueShape,
  validateAuthoredDebugValue,
  type CandidateValueShape,
  type ReloadAuthoringIssue,
  type ReloadValueShape
} from "./valueShape";
import { assertDebugValueConstraints } from "./constraints";
import {
  generateDebugOverlay,
  groupDebugOverlayTargets,
  type DebugOverlayPropertyBinding
} from "./debugOverlay";
import { assertDtsReloadHumanActor, requireDtsReload, requireDtsReloadView } from "./policy";
import { runDebugOverlayPreflight } from "./preflight";
import {
  clearReloadRunStorageKeys,
  getReloadCandidateRow,
  getReloadRunRow,
  insertReloadRun,
  insertReloadRunTarget,
  listExpiredReloadArtifactRuns,
  listLastReloadByBindingIds,
  listProjectDtsMemberSources,
  listReloadCandidateRows,
  listReloadRunRows,
  listReloadRunTargets,
  readLibraryFingerprint,
  claimReloadRunForDeploy,
  reclaimStaleDeployingReloadRunRows,
  toReloadRunDto,
  updateReloadRunDeployState,
  type LibraryFingerprint,
  type ReloadCandidateRow
} from "./repository";
import {
  applyResidueForDeployTerminal,
  getDeviceResidue
} from "./residue";
import {
  assertSensitiveReloadBatchAllowed,
  matchReloadCandidatesSensitive,
  SENSITIVE_RELOAD_CONFIRMATION_TOKEN,
  type ReloadTargetSensitiveHit
} from "./sensitiveGate";
import {
  bridgeCanonicalDeviceId,
  executeReloadDeploy,
  type DeployReloadDeps,
  type DeployReloadRunInput
} from "./deploy";
import type {
  ReloadCandidateDto,
  ReloadResidueDto,
  ReloadRunDto,
  ReloadRunListCursor,
  ReloadRunListItemDto,
  ReloadRunPurpose,
  ReloadRunStatus
} from "./types";
import {
  DEPLOY_RECLAIMED_FAILURE_CODE,
  DTS_RELOAD_CONFIRMATION_TOKEN,
  RELOAD_ARTIFACT_RETENTION_DAYS,
  RELOAD_DEPLOY_RECLAIM_AFTER_MS
} from "./types";

export { RELOAD_ARTIFACT_RETENTION_DAYS } from "./types";

export type DtsReloadServiceContext = AuditCorrelationContext & {
  actorType?: SensitiveWriteActorType;
};

export type StartReloadRunTargetInput = {
  bindingId: string;
  debugValue: string;
};

export type StartReloadRunInput = {
  projectId: string;
  targets: StartReloadRunTargetInput[];
  confirmationToken?: string;
  purpose?: ReloadRunPurpose;
  /** Required when purpose is restore-baseline — pinned for deploy device checks. */
  deviceId?: string;
  /** Residue source run this restore compensates. */
  restoresSourceRunId?: string;
};

export type RestoreBaselineInput = {
  projectId: string;
  deviceId: string;
  confirmationToken?: string;
};

type ReloadAuditKind =
  | "dts-reload-run-start"
  | "dts-reload-run-blocked"
  | "dts-reload-run-validated"
  | "dts-reload-run-deploy-started"
  | "dts-reload-run-unverifiable"
  | "dts-reload-run-verified"
  | "dts-reload-run-contradicted"
  | "dts-reload-run-failed"
  | "dts-reload-restore-started"
  | "dts-reload-restore-blocked"
  | "dts-reload-restore-validated"
  | "dts-reload-restore-deploy-started"
  | "dts-reload-restore-unverifiable"
  | "dts-reload-restore-verified"
  | "dts-reload-restore-contradicted"
  | "dts-reload-restore-failed";

type ReloadAuditAction =
  | "start"
  | "blocked"
  | "validated"
  | "deploy"
  | "unverifiable"
  | "verified"
  | "contradicted"
  | "failed";

type ResolvedReloadTarget = {
  candidate: ReloadCandidateDto;
  configRevisionId: string | null;
  debugValue: string;
  parsedValue: DtsValue;
  binding: DebugOverlayPropertyBinding;
  compatible: string | null;
};

const BLOCK_REASON_MESSAGES: Record<NonNullable<ReloadCandidateDto["blockReason"]>, string> = {
  "no-node-path": "parameter has no absolute device-tree node path",
  "unsupported-value-shape":
    "parameter value shape is outside the supported set (u32/u8/u16 cell arrays, single strings, string lists, GPIO-style phandle arrays, bare phandle lists, booleans, empty properties, mixed values, and /delete-property/)",
  "no-baseline-value": "parameter has no library baseline value"
};

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asConstraints(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asValueShape(value: unknown): CandidateValueShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CandidateValueShape;
}

function rowToCandidate(row: ReloadCandidateRow): {
  candidate: ReloadCandidateDto;
  resolvedShape: CandidateValueShape;
} {
  const valueShape = asValueShape(row.value_shape);
  const resolvedShape = resolveReloadValueShape(valueShape, row.baseline_value);
  const classified = classifyReloadCandidate({
    bindingId: row.binding_id,
    projectId: row.project_id,
    propertyKey: row.property_key,
    displayName: row.display_name,
    module: row.module_name,
    nodePath: row.node_path,
    baselineValue: row.baseline_value,
    description: row.description,
    valueShape,
    valueShapeKind: valueShape?.kind ?? null,
    unit: row.unit,
    constraints: asConstraints(row.constraints)
  });
  return {
    candidate: {
      ...classified,
      moduleId: row.module_id ?? null,
      compatible: row.compatible ?? null,
      sensitiveMatch: null,
      lastReload: null
    },
    resolvedShape
  };
}

type ReloadAuditInput = {
  kind: ReloadAuditKind;
  action: ReloadAuditAction;
  projectId: string;
  runId: string;
  severity?: "High" | "Medium" | "Low";
  actorType?: SensitiveWriteActorType;
  metadata: Record<string, unknown>;
};

function reloadAuditSpec(input: ReloadAuditInput, context: DtsReloadServiceContext): AuditSpec {
  return {
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    projectId: input.projectId,
    targetType: "dts-reload-run",
    targetId: input.runId,
    actorType: input.actorType ?? context.actorType ?? "user",
    metadata: input.metadata
  };
}

/**
 * Milestone evidence for the reload state machine (started / deploy-started / a
 * refused deploy's terminal): recorded immediately on the pool handle so it exists
 * even if a later step fails or throws. Step RESULTS (blocked / validated / the
 * deploy terminal) instead commit with their state write inside that step's
 * transaction — see persistRunOutcome and the deploy terminal persist.
 */
async function writeReloadMilestoneAudit(
  db: Database,
  auth: AuthContext,
  input: ReloadAuditInput,
  context: DtsReloadServiceContext = {}
) {
  await writeMilestoneAudit(db, auth, { requestId: context.requestId ?? randomUUID() }, reloadAuditSpec(input, context));
}

function auditKindsForPurpose(purpose: ReloadRunPurpose): {
  start: ReloadAuditKind;
  blocked: ReloadAuditKind;
  validated: ReloadAuditKind;
  deployStarted: ReloadAuditKind;
  unverifiable: ReloadAuditKind;
  verified: ReloadAuditKind;
  contradicted: ReloadAuditKind;
  failed: ReloadAuditKind;
} {
  if (purpose === "restore-baseline") {
    return {
      start: "dts-reload-restore-started",
      blocked: "dts-reload-restore-blocked",
      validated: "dts-reload-restore-validated",
      deployStarted: "dts-reload-restore-deploy-started",
      unverifiable: "dts-reload-restore-unverifiable",
      verified: "dts-reload-restore-verified",
      contradicted: "dts-reload-restore-contradicted",
      failed: "dts-reload-restore-failed"
    };
  }
  return {
    start: "dts-reload-run-start",
    blocked: "dts-reload-run-blocked",
    validated: "dts-reload-run-validated",
    deployStarted: "dts-reload-run-deploy-started",
    unverifiable: "dts-reload-run-unverifiable",
    verified: "dts-reload-run-verified",
    contradicted: "dts-reload-run-contradicted",
    failed: "dts-reload-run-failed"
  };
}

function sensitiveAuditSummary(hits: ReloadTargetSensitiveHit[]) {
  return hits.map((hit) => ({
    bindingId: hit.bindingId,
    propertyKey: hit.propertyKey,
    nodePath: hit.nodePath,
    ruleId: hit.rule.id,
    riskTier: hit.rule.riskTier,
    matchType: hit.rule.matchType,
    pattern: hit.rule.pattern,
    requiredCapability: hit.rule.requiredCapability
  }));
}

/**
 * Compact reload-snapshot view for audit metadata. Deliberately drops the verbatim kernel log
 * (`rawText`, up to 256 KiB) and the matched-line contents — the full snapshot is already
 * persisted on the run row, so copying it into every audit event only bloats the audit table.
 */
function reloadSnapshotAuditSummary(snapshot: ReloadRunDto["reloadSnapshot"]) {
  if (!snapshot) return null;
  return {
    libraryBaselineCount: snapshot.libraryBaselines.length,
    artifactDigest: snapshot.artifactDigest,
    kernelSignal: snapshot.kernelSignal
      ? {
          command: snapshot.kernelSignal.command,
          captureStatus: snapshot.kernelSignal.captureStatus,
          captureError: snapshot.kernelSignal.captureError,
          truncated: snapshot.kernelSignal.truncated,
          matchedParameterCount: snapshot.kernelSignal.matchedByParameter.length,
          hasRawText: typeof snapshot.kernelSignal.rawText === "string" && snapshot.kernelSignal.rawText.length > 0
        }
      : null,
    behaviouralVerification: snapshot.behaviouralVerification
      ? {
          outcomes: snapshot.behaviouralVerification.outcomes.map((outcome) => ({
            bindingId: outcome.bindingId,
            propertyKey: outcome.propertyKey,
            outcome: outcome.outcome
          }))
        }
      : null
  };
}

/**
 * Re-evaluate organisation sensitive-node rules against a persisted run's pinned targets, using
 * the CURRENT compatible for each binding. Device writes happen at deploy, so the deployer must
 * independently satisfy elevated capability + confirmation — the start-time gate cannot vouch for
 * a different subject who later triggers the actual write.
 */
async function assertDeploySensitiveReloadAllowed(
  db: Database,
  auth: AuthContext,
  run: ReloadRunDto,
  input: DeployReloadRunInput,
  context: DtsReloadServiceContext
): Promise<void> {
  const sensitiveTargets = [];
  for (const target of run.targets) {
    const candidate = await getReloadCandidateRow(db, {
      organizationId: auth.organization.id,
      projectId: run.projectId,
      bindingId: target.bindingId
    });
    sensitiveTargets.push({
      bindingId: target.bindingId,
      propertyKey: target.propertyKey,
      nodePath: target.nodePath,
      compatible: candidate?.compatible ?? null
    });
  }

  await assertSensitiveReloadBatchAllowed(db, auth, {
    projectId: run.projectId,
    actorType: context.actorType ?? "user",
    confirmationToken: input.confirmationTokens.includes(SENSITIVE_RELOAD_CONFIRMATION_TOKEN)
      ? SENSITIVE_RELOAD_CONFIRMATION_TOKEN
      : undefined,
    targets: sensitiveTargets,
    requestId: context.requestId
  });
}

export async function listReloadCandidates(
  db: Queryable,
  auth: AuthContext,
  projectId: string
): Promise<{ items: ReloadCandidateDto[] }> {
  requireDtsReloadView(auth);
  const rows = await listReloadCandidateRows(db, {
    organizationId: auth.organization.id,
    projectId
  });
  const mapped = rows.map(rowToCandidate);
  const baseItems = mapped.map((entry) => entry.candidate);
  const matches = await matchReloadCandidatesSensitive(db, {
    organizationId: auth.organization.id,
    projectId,
    candidates: rows.map((row) => ({
      nodePath: row.node_path,
      compatible: row.compatible
    }))
  });
  const lastReloadByBinding = await listLastReloadByBindingIds(db, {
    organizationId: auth.organization.id,
    projectId,
    bindingIds: rows.map((row) => row.binding_id)
  });
  const enriched = baseItems.map((item, index) => ({
    ...item,
    sensitiveMatch: matches[index] ?? null,
    lastReload: lastReloadByBinding.get(item.bindingId) ?? null
  }));
  return {
    items: normalizeReloadCandidates(enriched)
  };
}

export type ListReloadRunsInput = {
  projectId?: string;
  deviceId?: string;
  cursor?: ReloadRunListCursor;
  limit?: number;
};

export async function listReloadRuns(
  db: Queryable,
  auth: AuthContext,
  input: ListReloadRunsInput
): Promise<{ items: ReloadRunListItemDto[]; nextCursor: ReloadRunListCursor | null }> {
  requireDtsReloadView(auth);
  const projectId = input.projectId?.trim() || undefined;
  const deviceId = input.deviceId?.trim() || undefined;
  if (!projectId && !deviceId) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "List reload runs requires projectId and/or deviceId.",
      { code: "reload-run-list-filter-required" }
    );
  }
  const limit = input.limit ?? 20;
  return listReloadRunRows(db, {
    organizationId: auth.organization.id,
    projectId,
    deviceId,
    cursor: input.cursor,
    limit
  });
}

function isReloadArtifactRetentionExpired(createdAt: string, completedAt: string | null): boolean {
  const anchor = completedAt ?? createdAt;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) {
    return false;
  }
  const retentionMs = RELOAD_ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - anchorMs > retentionMs;
}

async function loadBaseSource(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  projectId: string
): Promise<{ configSetId: string; baseSource: string }> {
  const { configSetId, members } = await listProjectDtsMemberSources(db, {
    organizationId: auth.organization.id,
    projectId
  });

  if (!configSetId || members.length === 0) {
    throw new ApiError(
      "CONFLICT",
      "The project has no DTS configuration-set members to build a base device tree from.",
      { code: "reload-base-missing", projectId }
    );
  }

  const sources = [];
  for (const member of members) {
    let bytes: Buffer;
    try {
      bytes = await objectStore.get(member.storage_key);
    } catch (error) {
      // A storage read failure is not a "missing config set" — surface it distinctly so the
      // blocked run does not mislead operators into thinking the project has no DTS members.
      throw new ApiError(
        "CONFLICT",
        `Failed to read DTS configuration-set member "${member.file_name}" from storage.`,
        {
          code: "reload-base-read-failed",
          projectId,
          fileName: member.file_name,
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }
    sources.push({
      fileName: member.file_name,
      role: member.role,
      sortOrder: Number(member.sort_order),
      content: bytes.toString("utf8")
    });
  }

  return { configSetId, baseSource: buildReloadBaseSource(sources) };
}

/**
 * Edge mapping from pure authoring issues (ReloadValueShape module) onto the HTTP error
 * contract. Message wording and `details` fields are part of the API behavior — keep
 * them stable; the validation rules themselves live in `validateAuthoredDebugValue`.
 */
function throwAuthoringIssue(
  issue: ReloadAuthoringIssue,
  valueShape: ReloadValueShape,
  bindingId: string,
  debugValue: string
): never {
  const { placeholder } = describeReloadValueShapeAuthoring(valueShape);
  switch (issue.reason) {
    case "unparsable":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value could not be parsed: ${issue.message}`,
        { bindingId, debugValue }
      );
    case "not-single-string":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a single string (for example ${placeholder}).`,
        { bindingId, debugValue }
      );
    case "not-string-list":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a string list (for example ${placeholder}).`,
        { bindingId, debugValue }
      );
    case "not-phandle-cell-array":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a GPIO-style phandle cell array (for example ${placeholder}).`,
        { bindingId, debugValue }
      );
    case "not-phandle-list":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a bare phandle list (for example ${placeholder}).`,
        { bindingId, debugValue }
      );
    case "not-mixed":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a mixed string+cell value (for example ${placeholder}).`,
        { bindingId, debugValue }
      );
    case "not-boolean":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be a boolean (for example ${placeholder}, false, or /delete-property/).`,
        { bindingId, debugValue }
      );
    case "not-empty":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must be an empty property (leave blank or /delete-property/).`,
        { bindingId, debugValue }
      );
    case "not-integer-cell-array":
      throw new ApiError(
        "VALIDATION_FAILED",
        issue.expectedBits === 32
          ? `Debug value must be an unsigned 32-bit cell array (for example ${placeholder}).`
          : `Debug value must be a /bits/ ${issue.expectedBits} cell array (for example ${placeholder}).`,
        { bindingId, debugValue, expectedBits: issue.expectedBits }
      );
    case "cells-per-group-mismatch":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must have ${issue.expectedCellsPerGroup} cell(s) per group.`,
        {
          bindingId,
          debugValue,
          expectedCellsPerGroup: issue.expectedCellsPerGroup,
          actualCellsPerGroup: issue.actualCellsPerGroup
        }
      );
    case "group-count-mismatch":
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must have ${issue.expectedGroups} cell group(s).`,
        {
          bindingId,
          debugValue,
          expectedGroups: issue.expectedGroups,
          actualGroups: issue.actualGroups
        }
      );
  }
}

async function resolveStartTargets(
  db: Queryable,
  auth: AuthContext,
  input: StartReloadRunInput
): Promise<ResolvedReloadTarget[]> {
  if (input.targets.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one reload target is required.");
  }

  const seen = new Set<string>();
  const seenOverlayIdentity = new Set<string>();
  const resolved: ResolvedReloadTarget[] = [];

  for (const target of input.targets) {
    if (seen.has(target.bindingId)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Duplicate bindingId in reload batch: ${target.bindingId}.`,
        { bindingId: target.bindingId }
      );
    }
    seen.add(target.bindingId);

    const row = await getReloadCandidateRow(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: target.bindingId
    });
    if (!row) {
      throw new ApiError("NOT_FOUND", "Parameter binding was not found for this project.", {
        bindingId: target.bindingId,
        projectId: input.projectId
      });
    }

    const { candidate, resolvedShape } = rowToCandidate(row);
    if (!candidate.debuggable || !candidate.nodePath) {
      const detail = candidate.blockReason
        ? BLOCK_REASON_MESSAGES[candidate.blockReason]
        : "parameter is not debuggable";
      throw new ApiError("VALIDATION_FAILED", `Parameter is not debuggable: ${detail}.`, {
        bindingId: candidate.bindingId,
        blockReason: candidate.blockReason
      });
    }

    const overlayIdentity = `${candidate.propertyKey}\0${candidate.nodePath}`;
    if (seenOverlayIdentity.has(overlayIdentity)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Duplicate overlay target in reload batch: ${candidate.nodePath} :: ${candidate.propertyKey}.`,
        {
          code: "reload-duplicate-overlay-target",
          bindingId: candidate.bindingId,
          nodePath: candidate.nodePath,
          propertyKey: candidate.propertyKey
        }
      );
    }
    seenOverlayIdentity.add(overlayIdentity);

    const validated = validateAuthoredDebugValue(
      candidate.propertyKey,
      target.debugValue,
      resolvedShape
    );
    if (!validated.ok) {
      throwAuthoringIssue(validated.issue, resolvedShape, candidate.bindingId, target.debugValue);
    }
    const parsedValue = validated.parsed;
    if (!validated.deleteProperty) {
      assertDebugValueConstraints(parsedValue, candidate.constraints);
    }

    resolved.push({
      candidate,
      configRevisionId: row.config_revision_id,
      debugValue: target.debugValue,
      parsedValue,
      binding: {
        nodePath: candidate.nodePath,
        propertyKey: candidate.propertyKey,
        value: parsedValue,
        ...(validated.deleteProperty ? { deleteProperty: true } : {})
      },
      compatible: row.compatible ?? null
    });
  }

  return resolved;
}

export async function startReloadRun(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: StartReloadRunInput,
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  requireDtsReload(auth);

  const purpose: ReloadRunPurpose = input.purpose ?? "ordinary";
  await assertDtsReloadHumanActor(db, auth, {
    actorType: context.actorType,
    action: purpose === "restore-baseline" ? "restore" : "start",
    projectId: input.projectId,
    requestId: context.requestId
  });
  const audits = auditKindsForPurpose(purpose);

  if (purpose === "restore-baseline") {
    if (!input.deviceId?.trim()) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "restore-baseline runs require a pinned deviceId at start.",
        { code: "restore-device-required" }
      );
    }
    if (!input.restoresSourceRunId?.trim()) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "restore-baseline runs require restoresSourceRunId naming the residue source run.",
        { code: "restore-source-run-required" }
      );
    }
  }

  const resolved = await resolveStartTargets(db, auth, input);
  const sensitiveHits = await assertSensitiveReloadBatchAllowed(db, auth, {
    projectId: input.projectId,
    actorType: context.actorType ?? "user",
    confirmationToken: input.confirmationToken,
    targets: resolved.map((item) => ({
      bindingId: item.candidate.bindingId,
      propertyKey: item.candidate.propertyKey,
      nodePath: item.candidate.nodePath!,
      compatible: item.compatible
    })),
    requestId: context.requestId
  });
  const hasCriticalSensitive = sensitiveHits.some((hit) => hit.rule.riskTier === "critical");
  const sensitiveSummary = sensitiveAuditSummary(sensitiveHits);

  const overlayTargets = groupDebugOverlayTargets(resolved.map((item) => item.binding));
  const overlaySource = generateDebugOverlay(overlayTargets);
  const runId = randomUUID();
  const configRevisionId = resolved[0]?.configRevisionId ?? null;

  const beforeFingerprint = await readLibraryFingerprint(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });

  await writeReloadMilestoneAudit(
    db,
    auth,
    {
      kind: audits.start,
      action: "start",
      projectId: input.projectId,
      runId,
      severity: hasCriticalSensitive ? "High" : "Medium",
      metadata: {
        projectId: input.projectId,
        purpose,
        targetCount: resolved.length,
        fragmentCount: overlayTargets.length,
        targets: resolved.map((item) => ({
          bindingId: item.candidate.bindingId,
          propertyKey: item.candidate.propertyKey,
          nodePath: item.candidate.nodePath,
          baselineValue: item.candidate.baselineValue,
          debugValue: item.debugValue
        })),
        ...(sensitiveSummary.length > 0
          ? {
              sensitiveMatches: sensitiveSummary,
              criticalSensitiveConfirmation: hasCriticalSensitive
                ? "confirm-sensitive-reload"
                : undefined
            }
          : {})
      }
    },
    context
  );

  let baseSource: string;
  try {
    ({ baseSource } = await loadBaseSource(db, objectStore, auth, input.projectId));
  } catch (error) {
    const failureCode =
      error instanceof ApiError ? String(error.details?.code ?? "reload-base-missing") : "reload-base-missing";
    const message = error instanceof Error ? error.message : "Failed to build base device tree.";
    await assertLibraryUntouched(db, input.projectId, auth.organization.id, beforeFingerprint);
    const persisted = await persistRunOutcome(db, objectStore, auth, {
      runId,
      projectId: input.projectId,
      configRevisionId,
      purpose,
      deviceId: purpose === "restore-baseline" ? input.deviceId ?? null : null,
      restoresSourceRunId: purpose === "restore-baseline" ? input.restoresSourceRunId ?? null : null,
      targets: resolved,
      status: "blocked",
      failureCode,
      steps: [],
      diagnostics: [{ stage: "compile-base", code: "base-compile-failed", message }],
      toolVersions: { dtc: null, fdtoverlay: null },
      overlaySource,
      overlayBlob: null,
      audit: {
        kind: audits.blocked,
        action: "blocked",
        projectId: input.projectId,
        runId,
        severity: hasCriticalSensitive ? "High" : "Medium",
        metadata: {
          projectId: input.projectId,
          purpose,
          targetCount: resolved.length,
          failureCode,
          configRevisionId,
          ...(sensitiveSummary.length > 0 ? { sensitiveMatches: sensitiveSummary } : {})
        }
      }
    }, context);
    return persisted;
  }

  const preflight = await runDebugOverlayPreflight({
    baseSource,
    overlaySource,
    targets: overlayTargets
  });

  const status = preflight.ok ? "validated" : "blocked";
  const failureCode = preflight.ok ? null : (preflight.diagnostics[0]?.code ?? "overlay-not-applicable");

  // Library fingerprint check runs before persistence so a concurrent library edit cannot
  // leave a completed run behind a 500 that falsely claims this path mutated the library.
  await assertLibraryUntouched(db, input.projectId, auth.organization.id, beforeFingerprint);

  const persisted = await persistRunOutcome(db, objectStore, auth, {
    runId,
    projectId: input.projectId,
    configRevisionId,
    purpose,
    deviceId: purpose === "restore-baseline" ? input.deviceId ?? null : null,
    restoresSourceRunId: purpose === "restore-baseline" ? input.restoresSourceRunId ?? null : null,
    targets: resolved,
    status,
    failureCode,
    steps: preflight.steps,
    diagnostics: preflight.diagnostics,
    toolVersions: preflight.toolVersions,
    overlaySource,
    overlayBlob: preflight.overlayBlob ?? null,
    audit: {
      kind: status === "validated" ? audits.validated : audits.blocked,
      action: status === "validated" ? "validated" : "blocked",
      projectId: input.projectId,
      runId,
      severity: hasCriticalSensitive ? "High" : "Medium",
      metadata: {
        projectId: input.projectId,
        purpose,
        targetCount: resolved.length,
        fragmentCount: overlayTargets.length,
        failureCode,
        configRevisionId,
        ...(sensitiveSummary.length > 0 ? { sensitiveMatches: sensitiveSummary } : {})
      }
    }
  }, context);

  return persisted;
}

/**
 * Start a compensating restore-baseline reload for a device that carries residue.
 * Debug values are the library baseline values for the same parameter set as the
 * residue-producing run. The run still requires normal deploy confirmation — no shortcut.
 */
export async function startRestoreBaselineRun(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: RestoreBaselineInput,
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  requireDtsReload(auth);

  const residue = await getDeviceResidue(db, {
    organizationId: auth.organization.id,
    deviceId: input.deviceId
  });
  if (!residue) {
    throw new ApiError(
      "CONFLICT",
      "No reload residue is recorded for this device; restore-baseline has nothing to compensate.",
      { code: "reload-residue-missing", deviceId: input.deviceId }
    );
  }
  if (residue.projectId !== input.projectId) {
    throw new ApiError(
      "CONFLICT",
      "Residue for this device belongs to a different project.",
      {
        code: "reload-residue-project-mismatch",
        deviceId: input.deviceId,
        residueProjectId: residue.projectId,
        projectId: input.projectId
      }
    );
  }
  if (residue.parameters.length === 0) {
    throw new ApiError(
      "CONFLICT",
      "Residue record has no parameters to restore.",
      { code: "reload-residue-empty", deviceId: input.deviceId, sourceRunId: residue.sourceRunId }
    );
  }

  const targets: StartReloadRunTargetInput[] = [];
  for (const parameter of residue.parameters) {
    const candidate = await getReloadCandidateRow(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      bindingId: parameter.bindingId
    });
    if (!candidate) {
      throw new ApiError(
        "NOT_FOUND",
        `Residue parameter binding ${parameter.bindingId} is no longer available in the project.`,
        { code: "reload-residue-binding-missing", bindingId: parameter.bindingId }
      );
    }
    // The residue was written against a specific node path. If the library has since re-anchored
    // this binding to a different node, a compensating overlay would restore the wrong node while
    // the original node keeps its debug values — refuse rather than silently clearing residue later.
    if ((candidate.node_path ?? "") !== parameter.nodePath) {
      throw new ApiError(
        "CONFLICT",
        `Residue parameter ${parameter.propertyKey} now resolves to a different device-tree node than when its debug value was written; refuse restore to avoid stranding debug values on the original node.`,
        {
          code: "reload-residue-node-drift",
          bindingId: parameter.bindingId,
          recordedNodePath: parameter.nodePath,
          currentNodePath: candidate.node_path
        }
      );
    }
    const baselineValue = candidate.baseline_value;
    if (baselineValue === null || baselineValue === undefined || baselineValue === "") {
      throw new ApiError(
        "CONFLICT",
        `Residue parameter ${parameter.propertyKey} has no library baseline value to restore.`,
        { code: "reload-residue-baseline-missing", bindingId: parameter.bindingId }
      );
    }
    targets.push({ bindingId: parameter.bindingId, debugValue: baselineValue });
  }

  return startReloadRun(
    db,
    objectStore,
    auth,
    {
      projectId: input.projectId,
      targets,
      confirmationToken: input.confirmationToken,
      purpose: "restore-baseline",
      deviceId: input.deviceId,
      restoresSourceRunId: residue.sourceRunId
    },
    context
  );
}

export async function getReloadResidue(
  db: Queryable,
  auth: AuthContext,
  deviceId: string
): Promise<ReloadResidueDto | null> {
  requireDtsReloadView(auth);
  return getDeviceResidue(db, {
    organizationId: auth.organization.id,
    deviceId
  });
}

async function persistRunOutcome(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    runId: string;
    projectId: string;
    configRevisionId: string | null;
    purpose: ReloadRunPurpose;
    deviceId?: string | null;
    restoresSourceRunId?: string | null;
    targets: ResolvedReloadTarget[];
    status: ReloadRunStatus;
    failureCode: string | null;
    steps: ReloadRunDto["steps"];
    diagnostics: ReloadRunDto["diagnostics"];
    toolVersions: ReloadRunDto["toolVersions"];
    overlaySource: string;
    overlayBlob: Buffer | null;
    /** Outcome audit (blocked/validated): commits with the run row (ADR-0027). */
    audit: ReloadAuditInput;
  },
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  const sourceBytes = Buffer.from(input.overlaySource, "utf8");
  const storedSource = await objectStore.put({
    organizationId: auth.organization.id,
    fileName: `debug-overlay-${input.runId}.dts`,
    contentType: "text/plain",
    bytes: sourceBytes
  });

  let artifactKey: string | null = null;
  let artifactSha: string | null = null;
  let artifactBytes: number | null = null;
  if (input.overlayBlob && input.status === "validated") {
    const storedArtifact = await objectStore.put({
      organizationId: auth.organization.id,
      fileName: `debug-overlay-${input.runId}.dtbo`,
      contentType: "application/octet-stream",
      bytes: input.overlayBlob
    });
    artifactKey = storedArtifact.storageKey;
    artifactSha = storedArtifact.checksumSha256;
    artifactBytes = storedArtifact.fileSizeBytes;
  }

  const completedAt = new Date().toISOString();
  // Run row, targets, and the outcome audit commit together (ADR-0027); the object
  // store uploads above deliberately stay outside (orphaned blobs are swept).
  const row = await db.transaction(async (tx) => {
    const run = await insertReloadRun(tx, {
      id: input.runId,
      organizationId: auth.organization.id,
      projectId: input.projectId,
      configRevisionId: input.configRevisionId,
      status: input.status,
      purpose: input.purpose,
      deviceId: input.deviceId ?? null,
      restoresSourceRunId: input.restoresSourceRunId ?? null,
      failureCode: input.failureCode,
      steps: input.steps,
      diagnostics: input.diagnostics,
      toolVersions: input.toolVersions,
      overlaySourceStorageKey: storedSource.storageKey,
      overlaySourceSha256: storedSource.checksumSha256 || sha256Hex(sourceBytes),
      overlayArtifactStorageKey: artifactKey,
      overlayArtifactSha256: artifactSha,
      overlayArtifactBytes: artifactBytes,
      createdByUserId: auth.user.id,
      completedAt
    });

    for (const [index, target] of input.targets.entries()) {
      await insertReloadRunTarget(tx, {
        id: randomUUID(),
        reloadRunId: input.runId,
        bindingId: target.candidate.bindingId,
        nodePath: target.candidate.nodePath!,
        propertyKey: target.candidate.propertyKey,
        baselineValue: target.candidate.baselineValue,
        debugValue: target.debugValue,
        sortOrder: index
      });
    }

    const auditSpec = reloadAuditSpec(input.audit, context);
    await writeAuditEventInTx(
      asAuditTx(tx),
      auth,
      { requestId: context.requestId ?? randomUUID() },
      {
        ...auditSpec,
        metadata: {
          ...auditSpec.metadata,
          overlaySourceSha256: storedSource.checksumSha256 || sha256Hex(sourceBytes),
          artifactSha256: artifactSha
        }
      }
    );

    return run;
  });

  const targets = await listReloadRunTargets(db, input.runId);
  return toReloadRunDto(row, targets, input.overlaySource);
}

async function assertLibraryUntouched(
  db: Queryable,
  projectId: string,
  organizationId: string,
  before: LibraryFingerprint
) {
  const after = await readLibraryFingerprint(db, { organizationId, projectId });
  if (
    after.bindingRevisionCount !== before.bindingRevisionCount ||
    after.bindingRevisionChecksum !== before.bindingRevisionChecksum ||
    after.draftCount !== before.draftCount ||
    after.baselineCount !== before.baselineCount ||
    after.workingFileVersionTip !== before.workingFileVersionTip
  ) {
    throw new ApiError(
      "CONFLICT",
      "The parameter library changed while the reload run was in progress. Retry the run.",
      { code: "reload-library-changed", before, after }
    );
  }
}

export async function getReloadRun(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  runId: string
): Promise<ReloadRunDto> {
  requireDtsReloadView(auth);
  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", { runId });
  }

  const targets = await listReloadRunTargets(db, runId);
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const completedAt = row.completed_at
    ? row.completed_at instanceof Date
      ? row.completed_at.toISOString()
      : String(row.completed_at)
    : null;
  const artifactRetentionExpired = isReloadArtifactRetentionExpired(createdAt, completedAt);

  let overlaySource: string | null = null;
  if (row.overlay_source_storage_key && !artifactRetentionExpired) {
    const bytes = await objectStore.get(row.overlay_source_storage_key);
    overlaySource = bytes.toString("utf8");
  }
  return toReloadRunDto(row, targets, overlaySource, { artifactRetentionExpired });
}

/**
 * Read a reload run as its stored DTO without touching the object store
 * (overlaySource stays null). Same gate as `getReloadRun`: the reload read
 * permission (`debugging:view` or `debugging:dts-reload`) plus organization
 * scope. Serves cross-module readers of the run evidence — currently the
 * knowledge distillation path, which must couple ONLY to this stored DTO.
 */
export async function getReloadRunRecord(
  db: Queryable,
  auth: AuthContext,
  runId: string
): Promise<ReloadRunDto> {
  requireDtsReloadView(auth);
  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", { runId });
  }

  const targets = await listReloadRunTargets(db, runId);
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const completedAt = row.completed_at
    ? row.completed_at instanceof Date
      ? row.completed_at.toISOString()
      : String(row.completed_at)
    : null;
  return toReloadRunDto(row, targets, null, {
    artifactRetentionExpired: isReloadArtifactRetentionExpired(createdAt, completedAt)
  });
}

export async function getReloadRunArtifact(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  runId: string
): Promise<{ fileName: string; contentType: string; bytes: Buffer; sha256: string }> {
  requireDtsReloadView(auth);
  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", { runId });
  }

  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const completedAt = row.completed_at
    ? row.completed_at instanceof Date
      ? row.completed_at.toISOString()
      : String(row.completed_at)
    : null;
  // Retention is checked before artifact presence so a swept run (blob deleted, key nulled) still
  // reports the honest 410-expired rather than a misleading 409 "may have been blocked".
  if (isReloadArtifactRetentionExpired(createdAt, completedAt)) {
    throw new ApiError(
      "GONE",
      "This reload run's overlay artifact has passed its retention window and is no longer downloadable.",
      {
        code: "reload-artifact-expired",
        runId,
        retentionDays: RELOAD_ARTIFACT_RETENTION_DAYS,
        completedAt,
        createdAt
      }
    );
  }

  if (!row.overlay_artifact_storage_key || !row.overlay_artifact_sha256) {
    throw new ApiError(
      "CONFLICT",
      "This reload run has no compiled artifact to download (it may have been blocked).",
      { runId, status: row.status }
    );
  }

  const bytes = await objectStore.get(row.overlay_artifact_storage_key);
  return {
    fileName: `debug-overlay-${runId}.dtbo`,
    contentType: "application/octet-stream",
    bytes,
    sha256: row.overlay_artifact_sha256
  };
}

export type ReclaimStaleDeployingResult = {
  reclaimedRuns: number;
  runIds: string[];
};

/**
 * Reclaim reload runs wedged in `deploying` by a crashed deployer: those whose deploy heartbeat is
 * older than `RELOAD_DEPLOY_RECLAIM_AFTER_MS` are reset to `failed` (`deploy-reclaimed`) so they can
 * be deployed again. The in-request try/finally already handles thrown errors; this covers process
 * death. Cross-organization platform maintenance intended for a scheduled / ops invocation. The
 * time gate exceeds the worst-case deploy window, so a live deployer's run is never reclaimed.
 */
export async function reclaimStaleDeployingReloadRuns(
  db: Database,
  options: { now?: () => Date; staleAfterMs?: number; batchLimit?: number } = {}
): Promise<ReclaimStaleDeployingResult> {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? RELOAD_DEPLOY_RECLAIM_AFTER_MS;
  const batchLimit = options.batchLimit ?? 200;
  const olderThanIso = new Date(now().getTime() - staleAfterMs).toISOString();

  const reclaimed = await reclaimStaleDeployingReloadRunRows(db, {
    olderThanIso,
    failureCode: DEPLOY_RECLAIMED_FAILURE_CODE,
    limit: batchLimit
  });
  return { reclaimedRuns: reclaimed.length, runIds: reclaimed.map((row) => row.id) };
}

export type SweepReloadArtifactsResult = {
  scannedRuns: number;
  reclaimedRuns: number;
  deletedBlobs: number;
};

/**
 * Physically reclaim overlay blobs (artifact + source) for reload runs past the retention window
 * and null their storage keys. Digests, byte sizes, and the reload snapshot stay on the row, and
 * retention checks keep reporting the artifact as expired by timestamp — this only reclaims storage.
 *
 * Cross-organization platform maintenance intended for a scheduled / ops invocation. No-op when the
 * object store cannot delete. Per-run failures leave that run's keys in place so a later sweep
 * retries rather than orphaning an undeleted blob.
 */
export async function sweepExpiredReloadArtifacts(
  db: Database,
  objectStore: ObjectStore,
  options: { now?: () => Date; batchLimit?: number; organizationId?: string } = {}
): Promise<SweepReloadArtifactsResult> {
  const remove = objectStore.delete?.bind(objectStore);
  if (!remove) {
    return { scannedRuns: 0, reclaimedRuns: 0, deletedBlobs: 0 };
  }

  const now = options.now ?? (() => new Date());
  const batchLimit = options.batchLimit ?? 200;
  const retentionMs = RELOAD_ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const olderThanIso = new Date(now().getTime() - retentionMs).toISOString();

  const expired = await listExpiredReloadArtifactRuns(db, {
    olderThanIso,
    limit: batchLimit,
    organizationId: options.organizationId
  });
  let reclaimedRuns = 0;
  let deletedBlobs = 0;
  for (const run of expired) {
    const keys = [run.overlay_artifact_storage_key, run.overlay_source_storage_key].filter(
      (key): key is string => typeof key === "string" && key.length > 0
    );
    try {
      for (const key of keys) {
        await remove(key);
        deletedBlobs += 1;
      }
      await clearReloadRunStorageKeys(db, { organizationId: run.organization_id, runId: run.id });
      reclaimedRuns += 1;
    } catch {
      // Leave this run's keys in place so a later sweep retries; never null a key whose blob survived.
    }
  }

  return { scannedRuns: expired.length, reclaimedRuns, deletedBlobs };
}

export async function deployReloadRun(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: DeployReloadRunInput,
  deps: DeployReloadDeps,
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  requireDtsReload(auth);

  await assertDtsReloadHumanActor(db, auth, {
    actorType: context.actorType,
    action: "deploy",
    runId: input.runId,
    requestId: context.requestId
  });

  if (!input.confirmationTokens.includes(DTS_RELOAD_CONFIRMATION_TOKEN)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Deploying a reload run requires confirmation token "${DTS_RELOAD_CONFIRMATION_TOKEN}".`,
      { code: "missing-dts-reload-confirmation", requiredToken: DTS_RELOAD_CONFIRMATION_TOKEN }
    );
  }

  const run = await getReloadRun(db, objectStore, auth, input.runId);
  if (!run.artifact?.sha256) {
    throw new ApiError("CONFLICT", "Reload run has no compiled overlay artifact to deploy.", {
      code: "reload-artifact-missing",
      runId: input.runId
    });
  }

  // An artifact past its retention window must not be deployed — deploy is more dangerous than
  // download (which already refuses expired artifacts), and the library has likely drifted.
  if (run.artifactRetentionExpired) {
    throw new ApiError(
      "GONE",
      "This reload run's overlay artifact has passed its retention window and can no longer be deployed. Start a fresh run.",
      { code: "reload-artifact-expired", runId: run.id, retentionDays: RELOAD_ARTIFACT_RETENTION_DAYS }
    );
  }

  // Device identity is derived from the bridge server-side; the pinned restore device must match it.
  const canonicalDeviceId = bridgeCanonicalDeviceId(input.bridgeId);
  if (run.purpose === "restore-baseline") {
    if (!run.deviceId?.trim()) {
      throw new ApiError(
        "CONFLICT",
        "Restore-baseline run is missing its pinned device id; refuse deploy.",
        { code: "restore-device-unpinned", runId: run.id }
      );
    }
    if (canonicalDeviceId !== run.deviceId) {
      throw new ApiError(
        "CONFLICT",
        "Restore-baseline deploy must target the same device the restore run was started for.",
        {
          code: "restore-device-mismatch",
          runId: run.id,
          pinnedDeviceId: run.deviceId,
          deployDeviceId: canonicalDeviceId
        }
      );
    }
  }

  // Re-run the sensitive-node gate against the deployer's capability + confirmation. The start-time
  // gate cannot vouch for a different subject who triggers the actual device write here.
  await assertDeploySensitiveReloadAllowed(db, auth, run, input, context);

  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId: input.runId });
  if (!row?.overlay_artifact_storage_key) {
    throw new ApiError("CONFLICT", "Reload run has no compiled overlay artifact to deploy.", {
      code: "reload-artifact-missing",
      runId: input.runId
    });
  }
  const artifactBytes = await objectStore.get(row.overlay_artifact_storage_key);

  const audits = auditKindsForPurpose(run.purpose);

  // Emitted only after every cheap refusal above has passed, so a rejected deploy never leaves a
  // dangling "deploy-started" with no terminal counterpart.
  await writeReloadMilestoneAudit(
    db,
    auth,
    {
      kind: audits.deployStarted,
      action: "deploy",
      projectId: run.projectId,
      runId: run.id,
      severity: "High",
      metadata: {
        phase: "deploy",
        purpose: run.purpose,
        deviceId: canonicalDeviceId,
        bridgeId: input.bridgeId,
        targetRef: input.targetRef,
        protocol: input.protocol,
        confirmationToken: "confirm-dts-reload",
        artifactSha256: run.artifact.sha256
      }
    },
    context
  );

  // Residue is applied inside the persistProgress callback so it runs while the device lease is
  // still held (executeReloadDeploy releases the lease only after this callback returns). This
  // serialises residue bookkeeping against a concurrent restore-baseline on the same device.
  let residueAction: "set" | "clear" | "none" = "none";

  let result: ReloadRunDto;
  try {
    result = await executeReloadDeploy({
      db,
      auth,
      run,
      artifactBytes,
      deploy: input,
      deps,
      persistProgress: async (update, options) => {
        const payload = {
          runId: run.id,
          organizationId: auth.organization.id,
          status: update.status,
          failureCode: update.failureCode,
          steps: update.steps,
          deviceId: update.deviceId,
          bridgeId: update.bridgeId,
          bridgeMachineLabel: update.bridgeMachineLabel,
          targetRef: update.targetRef,
          protocol: update.protocol,
          integrityCheck: update.integrityCheck,
          reloadSnapshot: update.reloadSnapshot,
          completedAt: update.completedAt
        };
        if (options?.claim) {
          const claimed = await claimReloadRunForDeploy(db, payload);
          if (!claimed) {
            throw new ApiError(
              "CONFLICT",
              "Reload run is already being deployed (or is no longer deployable).",
              { code: "reload-deploy-already-in-progress", runId: run.id, status: run.status }
            );
          }
          return toReloadRunDto(claimed, run.targets, run.overlaySource);
        }
        if (update.completedAt === null) {
          const updated = await updateReloadRunDeployState(db, payload);
          return toReloadRunDto(updated, run.targets, run.overlaySource);
        }

        // Terminal persist (has completedAt): deploy state, residue bookkeeping (while
        // the device lease is still held), and the terminal audit commit together
        // (ADR-0027). The deploy-started milestone above deliberately stays outside.
        const terminalAudit =
          update.status === "verified"
            ? { kind: audits.verified, action: "verified" as const }
            : update.status === "contradicted"
              ? { kind: audits.contradicted, action: "contradicted" as const }
              : update.status === "unverifiable"
                ? { kind: audits.unverifiable, action: "unverifiable" as const }
                : { kind: audits.failed, action: "failed" as const };
        return withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async (tx) => {
          const updated = await updateReloadRunDeployState(tx, payload);
          if (update.deviceId) {
            residueAction = await applyResidueForDeployTerminal(tx, {
              organizationId: auth.organization.id,
              deviceId: update.deviceId,
              projectId: run.projectId,
              runId: run.id,
              purpose: run.purpose,
              status: update.status,
              failureCode: update.failureCode,
              targets: run.targets,
              restoresSourceRunId: run.restoresSourceRunId
            });
          }
          const dto = toReloadRunDto(updated, run.targets, run.overlaySource);
          return {
            result: dto,
            audit: reloadAuditSpec(
              {
                kind: terminalAudit.kind,
                action: terminalAudit.action,
                projectId: run.projectId,
                runId: run.id,
                severity: "High",
                metadata: {
                  phase: "deploy",
                  purpose: run.purpose,
                  status: update.status,
                  failureCode: update.failureCode,
                  deviceId: update.deviceId,
                  bridgeId: update.bridgeId,
                  integrityCheck: update.integrityCheck,
                  reloadSnapshot: reloadSnapshotAuditSummary(update.reloadSnapshot),
                  residueAction
                }
              },
              context
            )
          };
        });
      }
    });
  } catch (error) {
    // A throw after the deploy-started audit (bridge offline / not-found / upgrade required /
    // claim conflict) still gets a terminal audit so the started event is never left dangling.
    await writeReloadMilestoneAudit(
      db,
      auth,
      {
        kind: audits.failed,
        action: "failed",
        projectId: run.projectId,
        runId: run.id,
        severity: "High",
        metadata: {
          phase: "deploy",
          purpose: run.purpose,
          status: "failed",
          bridgeId: input.bridgeId,
          deviceId: canonicalDeviceId,
          refused: true,
          failureCode: error instanceof ApiError ? String(error.details?.code ?? error.code) : "deploy-error",
          message: error instanceof Error ? error.message : String(error)
        }
      },
      context
    );
    throw error;
  }

  return result;
}
