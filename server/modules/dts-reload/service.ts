import { createHash, randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { parseDtsValue } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildReloadBaseSource } from "./baseSource";
import { classifyReloadCandidate } from "./candidates";
import { assertDebugValueConstraints } from "./constraints";
import { generateDebugOverlay } from "./debugOverlay";
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
  type LibraryFingerprint,
  type ReloadCandidateRow
} from "./repository";
import type { ReloadCandidateDto, ReloadRunDto } from "./types";

export type DtsReloadServiceContext = AuditCorrelationContext;

export type StartReloadRunInput = {
  projectId: string;
  bindingId: string;
  debugValue: string;
};

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asConstraints(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asValueShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as { kind?: string; bits?: number; cellsPerGroup?: number; groups?: number };
}

function rowToCandidate(row: ReloadCandidateRow): ReloadCandidateDto {
  const valueShape = asValueShape(row.value_shape);
  return classifyReloadCandidate({
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
}

async function writeReloadAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: "dts-reload-run-start" | "dts-reload-run-blocked" | "dts-reload-run-validated";
    action: "start" | "blocked" | "validated";
    projectId: string;
    runId: string;
    metadata: Record<string, unknown>;
  },
  context: DtsReloadServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "dts-reload",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    targetType: "dts-reload-run",
    targetId: input.runId,
    metadata: input.metadata,
    traceId: context.requestId ?? randomUUID()
  });
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
  return { items: rows.map(rowToCandidate) };
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

export async function startReloadRun(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: StartReloadRunInput,
  context: DtsReloadServiceContext = {}
): Promise<ReloadRunDto> {
  requireDtsReload(auth);

  const row = await getReloadCandidateRow(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId
  });
  if (!row) {
    throw new ApiError("NOT_FOUND", "Parameter binding was not found for this project.", 404, {
      bindingId: input.bindingId,
      projectId: input.projectId
    });
  }

  const candidate = rowToCandidate(row);
  if (!candidate.debuggable || !candidate.nodePath) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Parameter is not debuggable${candidate.blockReason ? `: ${candidate.blockReason}` : ""}.`,
      400,
      { bindingId: candidate.bindingId, blockReason: candidate.blockReason }
    );
  }

  let parsedValue;
  try {
    parsedValue = parseDtsValue(candidate.propertyKey, input.debugValue.trim()).value;
  } catch (error) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Debug value could not be parsed: ${error instanceof Error ? error.message : "invalid value"}`,
      400,
      { bindingId: candidate.bindingId, debugValue: input.debugValue }
    );
  }
  if (
    parsedValue.kind !== "cells" ||
    parsedValue.bits !== 32 ||
    parsedValue.groups.length !== 1 ||
    parsedValue.groups[0]?.length !== 1 ||
    parsedValue.groups[0]?.[0]?.kind !== "integer"
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Debug value must be a single unsigned 32-bit cell (for example <6000> or <0x1770>).",
      400,
      { bindingId: candidate.bindingId, debugValue: input.debugValue }
    );
  }
  assertDebugValueConstraints(parsedValue, candidate.constraints);

  const beforeFingerprint = await readLibraryFingerprint(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });

  const runId = randomUUID();
  const overlaySource = generateDebugOverlay([
    {
      nodePath: candidate.nodePath,
      properties: [{ name: candidate.propertyKey, value: parsedValue }]
    }
  ]);

  await writeReloadAudit(
    db,
    auth,
    {
      kind: "dts-reload-run-start",
      action: "start",
      projectId: input.projectId,
      runId,
      metadata: {
        projectId: input.projectId,
        bindingId: candidate.bindingId,
        propertyKey: candidate.propertyKey,
        nodePath: candidate.nodePath,
        baselineValue: candidate.baselineValue,
        debugValue: input.debugValue
      }
    },
    context
  );

  let baseSource: string;
  try {
    ({ baseSource } = await loadBaseSource(db, objectStore, auth, input.projectId));
  } catch (error) {
    const failureCode = error instanceof ApiError ? String(error.details?.code ?? "reload-base-missing") : "reload-base-missing";
    const message = error instanceof Error ? error.message : "Failed to build base device tree.";
    await assertLibraryUntouched(db, input.projectId, auth.organization.id, beforeFingerprint);
    const persisted = await persistRunOutcome(db, objectStore, auth, {
      runId,
      projectId: input.projectId,
      configRevisionId: row.config_revision_id,
      candidate,
      debugValue: input.debugValue,
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
        metadata: {
          projectId: input.projectId,
          bindingId: candidate.bindingId,
          propertyKey: candidate.propertyKey,
          baselineValue: candidate.baselineValue,
          debugValue: input.debugValue,
          failureCode,
          configRevisionId: row.config_revision_id
        }
      },
      context
    );
    return persisted;
  }

  const preflight = await runDebugOverlayPreflight({
    baseSource,
    overlaySource,
    targets: [
      {
        nodePath: candidate.nodePath,
        properties: [{ name: candidate.propertyKey, value: parsedValue }]
      }
    ]
  });

  const status = preflight.ok ? "validated" : "blocked";
  const failureCode = preflight.ok ? null : (preflight.diagnostics[0]?.code ?? "overlay-not-applicable");

  // Library fingerprint check runs before persistence so a concurrent library edit cannot
  // leave a completed run behind a 500 that falsely claims this path mutated the library.
  await assertLibraryUntouched(db, input.projectId, auth.organization.id, beforeFingerprint);

  const persisted = await persistRunOutcome(db, objectStore, auth, {
    runId,
    projectId: input.projectId,
    configRevisionId: row.config_revision_id,
    candidate,
    debugValue: input.debugValue,
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
      metadata: {
        projectId: input.projectId,
        bindingId: candidate.bindingId,
        propertyKey: candidate.propertyKey,
        nodePath: candidate.nodePath,
        baselineValue: candidate.baselineValue,
        debugValue: input.debugValue,
        failureCode,
        configRevisionId: row.config_revision_id,
        overlaySourceSha256: persisted.overlaySourceSha256,
        artifactSha256: persisted.artifact?.sha256 ?? null
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
    candidate: ReloadCandidateDto;
    debugValue: string;
    status: "blocked" | "validated";
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

    await insertReloadRunTarget(tx, {
      id: randomUUID(),
      reloadRunId: input.runId,
      bindingId: input.candidate.bindingId,
      nodePath: input.candidate.nodePath!,
      propertyKey: input.candidate.propertyKey,
      baselineValue: input.candidate.baselineValue,
      debugValue: input.debugValue,
      sortOrder: 0
    });

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
