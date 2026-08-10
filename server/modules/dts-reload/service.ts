import { createHash, randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { parseDtsValue, type DtsValue } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import type { SensitiveWriteActorType } from "../parameters/sensitiveNode";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildReloadBaseSource } from "./baseSource";
import { classifyReloadCandidate, type CandidateValueShape } from "./candidates";
import { assertDebugValueConstraints } from "./constraints";
import {
  generateDebugOverlay,
  groupDebugOverlayTargets,
  type DebugOverlayPropertyBinding
} from "./debugOverlay";
import { requireDtsReload } from "./policy";
import { runDebugOverlayPreflight } from "./preflight";
import {
  getReloadCandidateRow,
  getReloadRunRow,
  insertReloadRun,
  insertReloadRunTarget,
  listProjectDtsMemberSources,
  listReloadCandidateRows,
  listReloadRunTargets,
  readLibraryFingerprint,
  toReloadRunDto,
  updateReloadRunDeployState,
  type LibraryFingerprint,
  type ReloadCandidateRow
} from "./repository";
import {
  assertSensitiveReloadBatchAllowed,
  matchReloadCandidatesSensitive,
  type ReloadTargetSensitiveHit
} from "./sensitiveGate";
import { executeReloadDeploy, type DeployReloadDeps, type DeployReloadRunInput } from "./deploy";
import type { ReloadCandidateDto, ReloadRunDto, ReloadRunStatus } from "./types";
import { DTS_RELOAD_CONFIRMATION_TOKEN } from "./types";

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
};

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
  "synthesised-anchor":
    "parameter locator is a synthesised /label anchor, not a genuine device-tree path usable as target-path",
  "unsupported-value-shape":
    "parameter value shape is outside the supported set (u32 cell arrays and string lists)",
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

function rowToCandidate(row: ReloadCandidateRow): ReloadCandidateDto {
  const valueShape = asValueShape(row.value_shape);
  const classified = classifyReloadCandidate({
    bindingId: row.binding_id,
    projectId: row.project_id,
    propertyKey: row.property_key,
    displayName: row.display_name,
    module: row.module_name,
    nodePath: row.node_path,
    baselineValue: row.baseline_value,
    valueShape,
    valueShapeKind: valueShape?.kind ?? null,
    unit: row.unit,
    constraints: asConstraints(row.constraints)
  });
  return {
    ...classified,
    compatible: row.compatible ?? null,
    sensitiveMatch: null
  };
}

async function writeReloadAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind:
      | "dts-reload-run-start"
      | "dts-reload-run-blocked"
      | "dts-reload-run-validated"
      | "dts-reload-run-deploy-started"
      | "dts-reload-run-unverifiable"
      | "dts-reload-run-failed";
    action: "start" | "blocked" | "validated" | "deploy" | "unverifiable" | "failed";
    projectId: string;
    runId: string;
    severity?: "High" | "Medium" | "Low";
    actorType?: SensitiveWriteActorType;
    metadata: Record<string, unknown>;
  },
  context: DtsReloadServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: input.actorType ?? context.actorType ?? "user",
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    targetType: "dts-reload-run",
    targetId: input.runId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
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

export async function listReloadCandidates(
  db: Queryable,
  auth: AuthContext,
  projectId: string
): Promise<{ items: ReloadCandidateDto[] }> {
  requireDtsReload(auth);
  const rows = await listReloadCandidateRows(db, {
    organizationId: auth.organization.id,
    projectId
  });
  const baseItems = rows.map(rowToCandidate);
  const matches = await matchReloadCandidatesSensitive(db, {
    organizationId: auth.organization.id,
    projectId,
    candidates: rows.map((row) => ({
      nodePath: row.node_path,
      compatible: row.compatible
    }))
  });
  return {
    items: baseItems.map((item, index) => ({
      ...item,
      sensitiveMatch: matches[index] ?? null
    }))
  };
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
      409,
      { code: "reload-base-missing", projectId }
    );
  }

  const sources = [];
  for (const member of members) {
    const bytes = await objectStore.get(member.storage_key);
    sources.push({
      fileName: member.file_name,
      role: member.role,
      sortOrder: Number(member.sort_order),
      content: bytes.toString("utf8")
    });
  }

  return { configSetId, baseSource: buildReloadBaseSource(sources) };
}

function assertParsedValueMatchesShape(
  parsedValue: DtsValue,
  valueShape: CandidateValueShape,
  bindingId: string,
  debugValue: string
) {
  if (valueShape?.kind === "string-list") {
    if (parsedValue.kind !== "strings" || parsedValue.values.length === 0) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Debug value must be a string list (for example \"okay\" or \"a\", \"b\").",
        400,
        { bindingId, debugValue }
      );
    }
    return;
  }

  if (
    parsedValue.kind !== "cells" ||
    parsedValue.bits !== 32 ||
    parsedValue.groups.length === 0 ||
    parsedValue.groups.some((group) => group.length === 0 || group.some((cell) => cell.kind !== "integer"))
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Debug value must be an unsigned 32-bit cell array (for example <6000>, <0x1770>, or <1 2 3>).",
      400,
      { bindingId, debugValue }
    );
  }

  const cellsPerGroup = valueShape?.cellsPerGroup;
  if (typeof cellsPerGroup === "number" && Number.isInteger(cellsPerGroup) && cellsPerGroup >= 1) {
    const mismatched = parsedValue.groups.some((group) => group.length !== cellsPerGroup);
    if (mismatched) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must have ${cellsPerGroup} cell(s) per group.`,
        400,
        {
          bindingId,
          debugValue,
          expectedCellsPerGroup: cellsPerGroup,
          actualCellsPerGroup: parsedValue.groups.map((group) => group.length)
        }
      );
    }
  }

  const expectedGroups = valueShape?.groups;
  if (typeof expectedGroups === "number" && Number.isInteger(expectedGroups) && expectedGroups >= 1) {
    if (parsedValue.groups.length !== expectedGroups) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value must have ${expectedGroups} cell group(s).`,
        400,
        {
          bindingId,
          debugValue,
          expectedGroups,
          actualGroups: parsedValue.groups.length
        }
      );
    }
  }
}

async function resolveStartTargets(
  db: Queryable,
  auth: AuthContext,
  input: StartReloadRunInput
): Promise<ResolvedReloadTarget[]> {
  if (input.targets.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "At least one reload target is required.", 400);
  }

  const seen = new Set<string>();
  const resolved: ResolvedReloadTarget[] = [];

  for (const target of input.targets) {
    if (seen.has(target.bindingId)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Duplicate bindingId in reload batch: ${target.bindingId}.`,
        400,
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
      throw new ApiError("NOT_FOUND", "Parameter binding was not found for this project.", 404, {
        bindingId: target.bindingId,
        projectId: input.projectId
      });
    }

    const candidate = rowToCandidate(row);
    if (!candidate.debuggable || !candidate.nodePath) {
      const detail = candidate.blockReason
        ? BLOCK_REASON_MESSAGES[candidate.blockReason]
        : "parameter is not debuggable";
      throw new ApiError("VALIDATION_FAILED", `Parameter is not debuggable: ${detail}.`, 400, {
        bindingId: candidate.bindingId,
        blockReason: candidate.blockReason
      });
    }

    let parsedValue: DtsValue;
    try {
      parsedValue = parseDtsValue(candidate.propertyKey, target.debugValue.trim()).value;
    } catch (error) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Debug value could not be parsed: ${error instanceof Error ? error.message : "invalid value"}`,
        400,
        { bindingId: candidate.bindingId, debugValue: target.debugValue }
      );
    }

    assertParsedValueMatchesShape(
      parsedValue,
      asValueShape(row.value_shape),
      candidate.bindingId,
      target.debugValue
    );
    assertDebugValueConstraints(parsedValue, candidate.constraints);

    resolved.push({
      candidate,
      configRevisionId: row.config_revision_id,
      debugValue: target.debugValue,
      parsedValue,
      binding: {
        nodePath: candidate.nodePath,
        propertyKey: candidate.propertyKey,
        value: parsedValue
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

  await writeReloadAudit(
    db,
    auth,
    {
      kind: "dts-reload-run-start",
      action: "start",
      projectId: input.projectId,
      runId,
      severity: hasCriticalSensitive ? "High" : "Medium",
      metadata: {
        projectId: input.projectId,
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
      targets: resolved,
      status: "blocked",
      failureCode,
      steps: [],
      diagnostics: [{ stage: "compile-base", code: "base-compile-failed", message }],
      toolVersions: { dtc: null, fdtoverlay: null },
      overlaySource,
      overlayBlob: null
    });
    await writeReloadAudit(
      db,
      auth,
      {
        kind: "dts-reload-run-blocked",
        action: "blocked",
        projectId: input.projectId,
        runId,
        severity: hasCriticalSensitive ? "High" : "Medium",
        metadata: {
          projectId: input.projectId,
          targetCount: resolved.length,
          failureCode,
          configRevisionId,
          ...(sensitiveSummary.length > 0 ? { sensitiveMatches: sensitiveSummary } : {})
        }
      },
      context
    );
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
    targets: resolved,
    status,
    failureCode,
    steps: preflight.steps,
    diagnostics: preflight.diagnostics,
    toolVersions: preflight.toolVersions,
    overlaySource,
    overlayBlob: preflight.overlayBlob ?? null
  });

  await writeReloadAudit(
    db,
    auth,
    {
      kind: status === "validated" ? "dts-reload-run-validated" : "dts-reload-run-blocked",
      action: status === "validated" ? "validated" : "blocked",
      projectId: input.projectId,
      runId,
      severity: hasCriticalSensitive ? "High" : "Medium",
      metadata: {
        projectId: input.projectId,
        targetCount: resolved.length,
        fragmentCount: overlayTargets.length,
        failureCode,
        configRevisionId,
        overlaySourceSha256: persisted.overlaySourceSha256,
        artifactSha256: persisted.artifact?.sha256 ?? null,
        ...(sensitiveSummary.length > 0 ? { sensitiveMatches: sensitiveSummary } : {})
      }
    },
    context
  );

  return persisted;
}

async function persistRunOutcome(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    runId: string;
    projectId: string;
    configRevisionId: string | null;
    targets: ResolvedReloadTarget[];
    status: ReloadRunStatus;
    failureCode: string | null;
    steps: ReloadRunDto["steps"];
    diagnostics: ReloadRunDto["diagnostics"];
    toolVersions: ReloadRunDto["toolVersions"];
    overlaySource: string;
    overlayBlob: Buffer | null;
  }
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
  const row = await db.transaction(async (tx) => {
    const run = await insertReloadRun(tx, {
      id: input.runId,
      organizationId: auth.organization.id,
      projectId: input.projectId,
      configRevisionId: input.configRevisionId,
      status: input.status,
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
      409,
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
  requireDtsReload(auth);
  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", 404, { runId });
  }

  const targets = await listReloadRunTargets(db, runId);
  let overlaySource: string | null = null;
  if (row.overlay_source_storage_key) {
    const bytes = await objectStore.get(row.overlay_source_storage_key);
    overlaySource = bytes.toString("utf8");
  }
  return toReloadRunDto(row, targets, overlaySource);
}

export async function getReloadRunArtifact(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  runId: string
): Promise<{ fileName: string; contentType: string; bytes: Buffer; sha256: string }> {
  requireDtsReload(auth);
  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Reload run was not found.", 404, { runId });
  }
  if (!row.overlay_artifact_storage_key || !row.overlay_artifact_sha256) {
    throw new ApiError(
      "CONFLICT",
      "This reload run has no compiled artifact to download (it may have been blocked).",
      409,
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

export async function deployReloadRun(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: DeployReloadRunInput,
  deps: DeployReloadDeps,
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  requireDtsReload(auth);

  if (!input.confirmationTokens.includes(DTS_RELOAD_CONFIRMATION_TOKEN)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Deploying a reload run requires confirmation token "${DTS_RELOAD_CONFIRMATION_TOKEN}".`,
      400,
      { code: "missing-dts-reload-confirmation", requiredToken: DTS_RELOAD_CONFIRMATION_TOKEN }
    );
  }

  const run = await getReloadRun(db, objectStore, auth, input.runId);
  if (!run.artifact?.sha256) {
    throw new ApiError("CONFLICT", "Reload run has no compiled overlay artifact to deploy.", 409, {
      code: "reload-artifact-missing",
      runId: input.runId
    });
  }

  const row = await getReloadRunRow(db, { organizationId: auth.organization.id, runId: input.runId });
  if (!row?.overlay_artifact_storage_key) {
    throw new ApiError("CONFLICT", "Reload run has no compiled overlay artifact to deploy.", 409, {
      code: "reload-artifact-missing",
      runId: input.runId
    });
  }
  const artifactBytes = await objectStore.get(row.overlay_artifact_storage_key);

  await writeReloadAudit(
    db,
    auth,
    {
      kind: "dts-reload-run-deploy-started",
      action: "deploy",
      projectId: run.projectId,
      runId: run.id,
      severity: "High",
      metadata: {
        phase: "deploy",
        deviceId: input.deviceId,
        bridgeId: input.bridgeId,
        targetRef: input.targetRef,
        protocol: input.protocol,
        confirmationToken: "confirm-dts-reload",
        artifactSha256: run.artifact.sha256
      }
    },
    context
  );

  const result = await executeReloadDeploy({
    db,
    auth,
    run,
    artifactBytes,
    deploy: input,
    deps,
    persistProgress: async (update) => {
      const updated = await updateReloadRunDeployState(db, {
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
      });
      return toReloadRunDto(updated, run.targets, run.overlaySource);
    }
  });

  await writeReloadAudit(
    db,
    auth,
    {
      kind: result.status === "unverifiable" ? "dts-reload-run-unverifiable" : "dts-reload-run-failed",
      action: result.status === "unverifiable" ? "unverifiable" : "failed",
      projectId: run.projectId,
      runId: run.id,
      severity: "High",
      metadata: {
        phase: "deploy",
        status: result.status,
        failureCode: result.failureCode,
        deviceId: result.deviceId,
        bridgeId: result.bridgeId,
        integrityCheck: result.integrityCheck,
        reloadSnapshot: result.reloadSnapshot
      }
    },
    context
  );

  return result;
}
