import { randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { resolveDtsConfigSet } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import {
  createDtsToolchainRunner,
  type DtsToolchainDiagnostic,
  type DtsToolchainRunner
} from "../parameter-files/dtsToolchain";
import {
  countDismissedSpecBlockersForRevision,
  countOpenSpecReviewTasksForRevision
} from "../parameter-specs/repository";
import { verifyEffectiveDriverParameterDefinitions } from "../parameter-specs/definitionVerification";
import { canAdminParameters, canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import type { TrustedSensitiveNodeWriteContext } from "../parameter-kernel/sensitiveNode";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError, pinnedSourceGraphConflict } from "../../shared/http/errors";
import { readCanonicalBindingChangeHistory } from "../parameter-bindings/catalogProjectValueSync";
import {
  countBlockingIdentityMappingTasksForRevision,
  listCanonicalBindingCompareRows,
  listCanonicalBindingHistoryValueRows,
  listIdentityMappingTaskRows,
  listProjectBindingRows,
  countSingletonCardinalityConflicts
} from "./bindingService";
import { normalizeBindingSchemaState } from "./schemaState";
import {
  createNodeEnablementDraft as createNodeEnablementDraftEdit,
  type NodeEnablementDraftResult
} from "./editService";
import { type CreateBindingDraftDeps } from "./overlayWriteback";
import { writeGovernanceAudit } from "./governanceAudit";
import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { getProjectById } from "../projects/repository";
import { getConfigSetById } from "../parameter-files/configSetRepository";
import { listStructuralPropertyKeys } from "./parameterSurface";
import {
  assertManifestStateReady,
  clearStatusAfterValidationFailure,
  MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
  normalizePersistedManifest,
} from "./configRevisionManifest";
import {
  getConfigRevisionById,
  getLatestConfigRevision,
  isConfigRevisionSourcePinned,
  insertValidationDiagnostics,
  insertValidationRun,
  listConfigRevisionMembers,
  listConfigRevisions as listConfigRevisionRows,
  listEffectiveTopology,
  listRevisionDiagnostics,
  listSourceTopology,
  updateConfigRevisionStatus,
  type ConfigRevisionMemberRow
} from "./repository";
import type {
  CreateNodeEnablementDraftBody,
  DtsValueDto,
  ProjectBindingDto,
  TopologyView
} from "./schemas";
import { dtsValueSchema, projectBindingDtoSchema } from "./schemas";
import type { ConfigRevisionStatus, PersistedValidationDiagnostic } from "./types";

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  }
}

export function requireCanViewProject(auth: AuthContext, projectId: string) {
  requireCanView(auth);
  if (!auth.roles.some((role) =>
    role.roleId === "admin" ||
    role.roleId === "platform-admin" ||
    role.projectId === null ||
    role.projectId === projectId
  )) {
    throw new ApiError("FORBIDDEN", "Project parameter scope is required.");
  }
}

function visibleProjectIds(auth: AuthContext): readonly string[] | null {
  if (auth.roles.some((role) =>
    role.roleId === "admin" ||
    role.roleId === "platform-admin" ||
    role.projectId === null
  )) return null;
  return [...new Set(auth.roles.map((role) => role.projectId).filter((id): id is string => Boolean(id)))];
}

function requireCanEdit(auth: AuthContext) {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter edit permission is required.");
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
  }
}

type CanonicalHistoryReader = Parameters<typeof readCanonicalBindingChangeHistory>[0];

function canonicalHistoryReader(db: Database): CanonicalHistoryReader {
  return getRootPostgresPool(db) ?? (db as unknown as CanonicalHistoryReader);
}

async function rejectLegacyTopologyBinding(
  _db: Database,
  input: { bindingId: string },
): Promise<never> {
  throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
    bindingId: input.bindingId,
  });
}

function toEffectiveValue(typedValue: unknown): DtsValueDto {
  const parsed = dtsValueSchema.safeParse(typedValue);
  if (parsed.success) {
    return parsed.data;
  }
  if (typedValue && typeof typedValue === "object" && !Array.isArray(typedValue) && "kind" in typedValue) {
    // Preserve typed AST shapes that may include additive optional fields.
    return typedValue as DtsValueDto;
  }
  return { kind: "empty" };
}

function toSchemaState(value: string | null | undefined): ProjectBindingDto["schemaState"] {
  return normalizeBindingSchemaState(value);
}

function toPolicyState(value: string | null | undefined): ProjectBindingDto["policyState"] {
  if (value === "pass" || value === "fail" || value === "not_applicable") return value;
  return "not_applicable";
}

const CURRENT_REVISION_ALIASES = new Set(["current", "latest", "head"]);

export async function getTopology(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; configSetId: string; revisionId: string; view: TopologyView }
) {
  requireCanView(auth);
  const revision = CURRENT_REVISION_ALIASES.has(input.revisionId)
    ? await getLatestConfigRevision(db, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        configSetId: input.configSetId
      })
    : await getConfigRevisionById(db, {
        organizationId: auth.organization.id,
        projectId: input.projectId,
        configSetId: input.configSetId,
        revisionId: input.revisionId
      });
  if (!revision) {
    throw new ApiError("NOT_FOUND", "Config revision was not found.", {
      projectId: input.projectId,
      configSetId: input.configSetId,
      revisionId: input.revisionId
    });
  }

  const members = await listConfigRevisionMembers(db, revision.id);
  const incompleteBase = !members.some((member) => member.role === "base");
  const diagnostics = (await listRevisionDiagnostics(db, revision.id)).map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.message,
    ...(item.path ? { path: item.path } : {}),
    ...(item.startLine !== undefined ? { startLine: item.startLine } : {}),
    ...(item.startColumn !== undefined ? { startColumn: item.startColumn } : {}),
    ...(item.guidance ? { guidance: item.guidance } : {})
  }));

  if (input.view === "source") {
    const source = await listSourceTopology(db, revision.id);
    return {
      view: "source" as const,
      revisionId: revision.id,
      configSetId: revision.configSetId,
      projectId: revision.projectId,
      status: revision.status,
      incompleteBase,
      diagnostics,
      nodes: source.nodes
    };
  }

  const effective = await listEffectiveTopology(db, revision.id);
  return {
    view: "effective" as const,
    revisionId: revision.id,
    configSetId: revision.configSetId,
    projectId: revision.projectId,
    status: revision.status,
    incompleteBase,
    diagnostics,
    nodes: effective.nodes
  };
}

export async function listConfigRevisions(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; configSetId: string }
) {
  requireCanView(auth);
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }
  const configSet = await getConfigSetById(db, {
    organizationId: auth.organization.id,
    configSetId: input.configSetId
  });
  if (!configSet || configSet.projectId !== input.projectId) {
    throw new ApiError("NOT_FOUND", "Config set was not found.", {
      projectId: input.projectId,
      configSetId: input.configSetId
    });
  }
  const items = await listConfigRevisionRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: input.configSetId
  });
  return { items };
}

export async function listProjectBindings(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; revisionId?: string }
): Promise<{ items: ProjectBindingDto[] }> {
  requireCanView(auth);
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }
  const rows = await listProjectBindingRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    revisionId: input.revisionId
  });

  const items = rows.map((row) =>
    projectBindingDtoSchema.parse({
      id: row.id,
      parameterSpecId: row.parameterSpecId,
      parameterSpecVersionId: row.parameterSpecVersionId,
      propertyKey: row.propertyKey,
      driverModule: row.driverModule,
      logicalNodeId: row.logicalNodeId,
      instanceName: row.instanceName,
      locator: row.locator,
      effectiveValue: toEffectiveValue(row.typedValue),
      rawValue: row.rawValue,
      schemaState: toSchemaState(row.schemaState),
      policyState: toPolicyState(row.policyState),
      moduleId: row.moduleId,
      displayName: row.displayName,
      description: row.description,
      documentation: row.documentation
    })
  );

  return { items };
}

export async function listIdentityMappingTasks(
  db: Database,
  auth: AuthContext,
  input: { projectId?: string; status?: "open" | "resolved" | "dismissed" | "new_identity" } = {}
) {
  requireCanView(auth);
  if (input.projectId) {
    const project = await getProjectById(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!project) {
      throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
        projectId: input.projectId
      });
    }
  }
  const items = await listIdentityMappingTaskRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    status: input.status
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      configRevisionId: item.configRevisionId,
      previousLogicalNodeId: item.previousLogicalNodeId,
      candidateLogicalNodeIds: item.candidateLogicalNodeIds,
      candidateCount: item.candidateLogicalNodeIds.length,
      evidence: item.evidence ?? {},
      taskKind: item.taskKind,
      status: item.status,
      reason: item.reason,
      createdAt: item.createdAt,
      resolvedAt: item.resolvedAt
    }))
  };
}

export type BindingHistoryItem = {
  id: string;
  changedAt: string;
  fromRawValue?: string | null;
  toRawValue?: string | null;
  bindingId?: string;
  definitionId?: string;
  definitionRevisionId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
  sourceOccurrenceId?: string | null;
  sourceIdentity?: string | null;
  sourceRef?: string | null;
  configSetId?: string | null;
  fileId?: string | null;
  fileVersionId?: string | null;
  fileName?: string | null;
  sourceLocator?: Record<string, unknown> | null;
  sourceAvailable?: boolean;
  valueState?: "present" | "deleted" | null;
  oldDefinitionRevisionId?: string | null;
  newDefinitionRevisionId?: string | null;
  oldCurrentValueId?: string | null;
  newCurrentValueId?: string | null;
  reason?: string;
  successAuditRef?: string;
  catalogReleaseId?: string;
  recordedAt?: string;
};

/**
 * Per-binding change history sourced from the canonical Binding/value event
 * owner. Legacy topology revisions are archived and never used as a fallback.
 */
export async function getBindingHistory(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; bindingId: string }
): Promise<{ items: BindingHistoryItem[] }> {
  requireCanView(auth);
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }
  requireCanViewProject(auth, input.projectId);

  const events = await readCanonicalBindingChangeHistory(canonicalHistoryReader(db), {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId,
  });
  if (events === null) {
    return rejectLegacyTopologyBinding(db, { bindingId: input.bindingId });
  }

  const valueIds = events.flatMap((event) => [event.oldCurrentValueId, event.newCurrentValueId])
    .filter((id): id is string => Boolean(id));
  const values = await listCanonicalBindingHistoryValueRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId,
    valueIds,
  });
  const valuesById = new Map(values.map((value) => [value.id, value]));
  for (const valueId of valueIds) {
    if (!valuesById.has(valueId)) {
      throw new ApiError("CONFLICT", "Canonical history value is unavailable for this binding.", {
        bindingId: input.bindingId,
        valueId,
      });
    }
  }

  return {
    items: events.map((event): BindingHistoryItem => {
      const oldValue = event.oldCurrentValueId ? valuesById.get(event.oldCurrentValueId) : undefined;
      const newValue = event.newCurrentValueId ? valuesById.get(event.newCurrentValueId) : undefined;
      const source = newValue ?? oldValue;
      const effectiveRevisionId = event.newDefinitionRevisionId ?? event.oldDefinitionRevisionId ?? undefined;
      const definitionRevisionId = source?.definitionRevisionId ?? effectiveRevisionId;
      const currentValueId = event.newCurrentValueId ?? event.oldCurrentValueId ?? undefined;
      return {
        id: event.id,
        changedAt: event.createdAt,
        recordedAt: event.createdAt,
        fromRawValue: oldValue?.rawValue ?? null,
        toRawValue: newValue?.rawValue ?? null,
        bindingId: event.bindingId,
        definitionId: event.definitionId,
        definitionRevisionId,
        effectiveRevisionId,
        currentValueId,
        sourceOccurrenceId: source?.sourceOccurrenceId ?? null,
        sourceIdentity: source?.sourceIdentity ?? null,
        sourceRef: source?.sourceRef ?? null,
        configSetId: source?.configSetId ?? null,
        fileId: source?.fileId ?? null,
        fileVersionId: source?.fileVersionId ?? null,
        fileName: source?.fileName ?? null,
        sourceLocator: source?.sourceLocator ?? null,
        sourceAvailable: source?.sourceAvailable ?? false,
        valueState: event.valueState,
        oldDefinitionRevisionId: event.oldDefinitionRevisionId,
        newDefinitionRevisionId: event.newDefinitionRevisionId,
        oldCurrentValueId: event.oldCurrentValueId,
        newCurrentValueId: event.newCurrentValueId,
        reason: event.reason,
        successAuditRef: event.successAuditRef,
        catalogReleaseId: event.catalogReleaseId,
      };
    }),
  };
}

export type BindingCompareItem = {
  projectId: string;
  projectName: string;
  rawValue: string;
  moduleName?: string | null;
  driverModule?: string | null;
  bindingId?: string;
  definitionId?: string;
  definitionRevisionId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string;
  sourceOccurrenceId?: string;
  sourceIdentity?: string;
  sourceRef?: string;
  configSetId?: string | null;
  fileId?: string | null;
  fileVersionId?: string | null;
  fileName?: string | null;
  sourceLocator?: Record<string, unknown> | null;
  sourceAvailable?: boolean;
  valueState?: "present" | "deleted";
};

/**
 * Compare current canonical bindings by Definition identity. Each peer retains
 * its own effective DefinitionRevision; same-project sibling source instances
 * remain visible, and only the requested Binding is excluded.
 */
export async function getBindingCompare(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; bindingId: string }
): Promise<{ items: BindingCompareItem[] }> {
  requireCanView(auth);
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }
  requireCanViewProject(auth, input.projectId);

  const rows = await listCanonicalBindingCompareRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    bindingId: input.bindingId,
    visibleProjectIds: visibleProjectIds(auth),
  });
  if (rows === null) {
    return rejectLegacyTopologyBinding(db, { bindingId: input.bindingId });
  }

  return {
    items: rows.map((row): BindingCompareItem => ({
      projectId: row.projectId,
      projectName: row.projectName,
      rawValue: row.rawValue,
      moduleName: row.moduleName,
      driverModule: row.driverModule,
      bindingId: row.bindingId,
      definitionId: row.definitionId,
      definitionRevisionId: row.definitionRevisionId,
      effectiveRevisionId: row.effectiveRevisionId,
      currentValueId: row.currentValueId,
      sourceOccurrenceId: row.sourceOccurrenceId,
      sourceIdentity: row.sourceIdentity,
      sourceRef: row.sourceRef,
      configSetId: row.configSetId,
      fileId: row.fileId,
      fileVersionId: row.fileVersionId,
      fileName: row.fileName,
      sourceLocator: row.sourceLocator,
      sourceAvailable: row.sourceAvailable,
      valueState: row.valueState,
    })),
  };
}

export type ValidateConfigRevisionDeps = {
  objectStore?: ObjectStore;
  toolchain?: DtsToolchainRunner;
};

type ValidateFailureCode =
  | "empty-config-set"
  | "open-mapping"
  | "open-review"
  | "dismissed-review"
  | "schema-policy-blocker"
  | "unreviewed-driver-tip"
  | "effective-driver-definition"
  | "resolve-failed"
  | "toolchain-unavailable"
  | "version-mismatch"
  | "compile-failed"
  | "schema-failed"
  | "overlay-order"
  | "path-escape"
  | "timeout"
  | "missing-content"
  | typeof MANIFEST_NEEDS_REVIEW_FAILURE_CODE;

async function countSchemaPolicyBlockers(db: Queryable, configRevisionId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from project_parameter_binding_revisions
    where config_revision_id = $1
      and (
        schema_state = 'invalid'
        or policy_state = 'fail'
      )
    `,
    [configRevisionId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function loadMemberContent(
  member: ConfigRevisionMemberRow,
  objectStore: ObjectStore | undefined
): Promise<string | null> {
  if (member.parsedIndex && typeof member.parsedIndex === "object" && !Array.isArray(member.parsedIndex)) {
    const sourceText = (member.parsedIndex as Record<string, unknown>).sourceText;
    if (typeof sourceText === "string") {
      return sourceText;
    }
  }
  if (!objectStore) {
    return null;
  }
  try {
    const bytes = await objectStore.get(member.storageKey);
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

function toPersistedDiagnostics(
  diagnostics: Array<{
    code?: string;
    severity?: "error" | "warning" | "info";
    stage?: string;
    message: string;
    fileName?: string;
    file?: string;
    line?: number;
  }>,
  defaultStage: string,
  defaultCode: string
): PersistedValidationDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    id: randomUUID(),
    code: (diagnostic.code ?? defaultCode) as PersistedValidationDiagnostic["code"],
    severity: (diagnostic.severity ?? "error") as PersistedValidationDiagnostic["severity"],
    stage: diagnostic.stage ?? defaultStage,
    message: diagnostic.message,
    fileName: diagnostic.fileName ?? diagnostic.file ?? "<validation>",
    startLine: diagnostic.line
  }));
}

async function persistFailedValidation(
  db: Database,
  auth: AuthContext,
  input: {
    revisionId: string;
    projectId: string;
    configSetId: string;
    stage: string;
    failureCode: ValidateFailureCode;
    diagnostics: PersistedValidationDiagnostic[];
    toolchain?: Record<string, unknown>;
    artifactHashes?: Record<string, unknown>;
    currentStatus?: string;
  },
  context: AuditCorrelationContext
) {
  const runId = randomUUID();
  // Run record, revision status, and audit commit together (ADR-0027); previously
  // each write auto-committed and a mid-sequence failure left partial evidence.
  const nextStatus = await withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async (tx) => {
    await insertValidationRun(tx, {
      id: runId,
      organizationId: auth.organization.id,
      configRevisionId: input.revisionId,
      stage: input.stage,
      status: "failed",
      toolchain: input.toolchain ?? {},
      artifactHashes: input.artifactHashes ?? {}
    });
    if (input.diagnostics.length > 0) {
      await insertValidationDiagnostics(tx, runId, input.diagnostics);
    }

    const currentStatus =
      (input.currentStatus as ConfigRevisionStatus | undefined) ??
      (
        await tx.query<{ status: ConfigRevisionStatus }>(
          `select status from dts_config_revisions where id = $1`,
          [input.revisionId]
        )
      ).rows[0]?.status ??
      "resolved";
    const next = clearStatusAfterValidationFailure(currentStatus, input.failureCode);
    if (next !== currentStatus) {
      await updateConfigRevisionStatus(tx, {
        id: input.revisionId,
        status: next,
        resolvedAt: new Date().toISOString()
      });
    }

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "config-revision-validated",
        projectId: input.projectId,
        targetType: "dts-config-revision",
        targetId: input.revisionId,
        metadata: {
          validationRunId: runId,
          configRevisionId: input.revisionId,
          configSetId: input.configSetId,
          stage: input.stage,
          status: "failed",
          failureCode: input.failureCode,
          revisionStatus: next,
          artifactHashes: input.artifactHashes ?? {}
        }
      },
      context
    );
    return { result: next, audit: null };
  });
  return {
    id: runId,
    status: "failed" as const,
    stage: input.stage,
    failureCode: input.failureCode,
    artifactHashes: input.artifactHashes ?? {},
    diagnostics: input.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      stage: diagnostic.stage,
      message: diagnostic.message,
      fileName: diagnostic.fileName
    }))
  };
}

/**
 * Fail-closed production validate: load revision Config Set → resolve → toolchain
 * (dtc/fdtoverlay/dt-validate with pinned versions) → mapping/review/schema blockers.
 * Only marks the revision `validated` when every gate passes.
 */
export async function validateConfigRevision(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; revisionId: string; stage?: string },
  context: AuditCorrelationContext = {},
  deps: ValidateConfigRevisionDeps = {}
) {
  requireCanAdmin(auth);

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    revisionId: input.revisionId
  });
  if (!revision) {
    throw new ApiError("NOT_FOUND", "Config revision was not found.", {
      projectId: input.projectId,
      revisionId: input.revisionId
    });
  }

  if (await isConfigRevisionSourcePinned(db, revision.id)) {
    throw pinnedSourceGraphConflict();
  }

  const stage = input.stage ?? "toolchain";
  const members = await listConfigRevisionMembers(db, revision.id);

  const manifestGate = assertManifestStateReady(revision.manifestState);
  if (manifestGate) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage: "manifest",
        failureCode: MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
        currentStatus: revision.status,
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
              severity: "error",
              stage: "manifest",
              message: manifestGate.message,
              fileName: "<config-set>",
            },
          ],
          "manifest",
          MANIFEST_NEEDS_REVIEW_FAILURE_CODE,
        ),
      },
      context,
    );
  }

  if (members.length === 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "empty-config-set",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "empty-config-set",
              severity: "error",
              stage,
              message: "Config revision has an empty Config Set; release validation fails closed.",
              fileName: "<config-set>"
            }
          ],
          stage,
          "empty-config-set"
        )
      },
      context
    );
  }

  const singletonConflicts = await countSingletonCardinalityConflicts(db, {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configRevisionId: revision.id
  });
  const openMappings = await countBlockingIdentityMappingTasksForRevision(db, {
    organizationId: auth.organization.id,
    configRevisionId: revision.id
  });
  if (openMappings > 0 || singletonConflicts > 0 || revision.status === "needs_mapping") {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "open-mapping",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "open-mapping",
              severity: "error",
              stage: "identity",
              message: `Blocking identity/cardinality conflicts remain (${openMappings + singletonConflicts}); validation fails closed.`,
              fileName: "<identity>"
            }
          ],
          "identity",
          "open-mapping"
        )
      },
      context
    );
  }

  const openReviews = await countOpenSpecReviewTasksForRevision(db, {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configRevisionId: revision.id,
    excludePropertyKeys: listStructuralPropertyKeys(),
  });
  if (openReviews > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "open-review",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "open-review",
              severity: "error",
              stage: "review",
              message: `Open parameter spec review tasks remain (${openReviews}); validation fails closed.`,
              fileName: "<review>"
            }
          ],
          "review",
          "open-review"
        )
      },
      context
    );
  }

  // Dismissed reviews never pretend a property matched; release stays fail-closed.
  const dismissedReviews = await countDismissedSpecBlockersForRevision(db, {
    organizationId: auth.organization.id,
    projectId: revision.projectId,
    configRevisionId: revision.id
  });
  if (dismissedReviews > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "dismissed-review",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "dismissed-review",
              severity: "error",
              stage: "review",
              message: `Dismissed parameter spec reviews remain without bindings (${dismissedReviews}); validation fails closed.`,
              fileName: "<review>"
            }
          ],
          "review",
          "dismissed-review"
        )
      },
      context
    );
  }

  const schemaPolicyBlockers = await countSchemaPolicyBlockers(db, revision.id);
  if (schemaPolicyBlockers > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "schema-policy-blocker",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "schema-policy-blocker",
              severity: "error",
              stage: "schema",
              message: `Schema/policy blockers remain on binding revisions (${schemaPolicyBlockers}).`,
              fileName: "<schema>"
            }
          ],
          "schema",
          "schema-policy-blocker"
        )
      },
      context
    );
  }

  const files = new Map<string, { fileVersionId: string; content: string }>();
  const memberDtos = members.map((member) => ({
    fileId: member.fileId,
    fileVersionId: member.fileVersionId,
    fileName: member.fileName,
    role: member.role as import("./types").ConfigRevisionManifestMember["role"],
    sortOrder: member.sortOrder,
    content: "",
  }));

  for (const member of members) {
    const content = await loadMemberContent(member, deps.objectStore);
    if (content == null) {
      return persistFailedValidation(
        db,
        auth,
        {
          revisionId: revision.id,
          projectId: revision.projectId,
          configSetId: revision.configSetId,
          stage,
          failureCode: "missing-content",
          currentStatus: revision.status,
          diagnostics: toPersistedDiagnostics(
            [
              {
                code: "missing-content",
                severity: "error",
                stage,
                message: `Unable to load content for ${member.fileName} (file version ${member.fileVersionId}).`,
                fileName: member.fileName
              }
            ],
            stage,
            "missing-content"
          )
        },
        context
      );
    }
    files.set(member.fileName, { fileVersionId: member.fileVersionId, content });
    const dto = memberDtos.find((item) => item.fileVersionId === member.fileVersionId);
    if (dto) dto.content = content;
  }

  // Prefer persisted revision manifest; never invent entry from arbitrary first file.
  const persistedEntry = revision.entryFile;
  const persistedIncludes = revision.includeSearchPaths;
  const persistedOverlays = revision.overlayOrder;
  const fallbackOverlayOrder = members
    .filter((member) => member.role === "overlay")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.fileName.localeCompare(b.fileName))
    .map((member) => member.fileName);

  const normalized = normalizePersistedManifest({
    entryFile: persistedEntry ?? "",
    includeSearchPaths: persistedIncludes ?? [],
    overlayOrder: persistedOverlays && persistedOverlays.length > 0 ? persistedOverlays : fallbackOverlayOrder,
    members: memberDtos,
  });

  if (!normalized.ok) {
    const failureCode =
      normalized.failure.code === "missing-base" || normalized.failure.code === "missing-entry-file"
        ? ("empty-config-set" as ValidateFailureCode)
        : ("resolve-failed" as ValidateFailureCode);
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode,
        currentStatus: revision.status,
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: normalized.failure.code,
              severity: "error",
              stage,
              message: normalized.failure.message,
              fileName: "<config-set>"
            }
          ],
          stage,
          normalized.failure.code
        )
      },
      context
    );
  }

  if (files.size === 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "empty-config-set",
        currentStatus: revision.status,
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "empty-config-set",
              severity: "error",
              stage,
              message: "Config revision has no resolvable DTS entry file.",
              fileName: "<config-set>"
            }
          ],
          stage,
          "empty-config-set"
        )
      },
      context
    );
  }

  const entryFile = normalized.manifest.entryFile;
  const overlayOrder = normalized.manifest.overlayOrder;
  const includeSearchPaths = normalized.manifest.includeSearchPaths;

  const resolved = resolveDtsConfigSet({
    entryFile,
    includeSearchPaths,
    overlayOrder,
    files
  });
  const resolveErrors = resolved.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (resolveErrors.length > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage: "resolve",
        failureCode: "resolve-failed",
        diagnostics: toPersistedDiagnostics(
          resolveErrors.map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            stage: "resolve",
            message: diagnostic.message,
            fileName: diagnostic.fileName
          })),
          "resolve",
          "resolve-failed"
        )
      },
      context
    );
  }

  const toolchain = deps.toolchain ?? createDtsToolchainRunner();
  const toolchainFiles = new Map<string, { content: string }>();
  for (const [name, file] of files) {
    toolchainFiles.set(name, { content: file.content });
  }

  const toolchainResult = await toolchain.validate(
    {
      entryFile,
      includeSearchPaths,
      overlayOrder,
      files: toolchainFiles
    },
    { mode: "release" }
  );

  const toolchainPayload = {
    dtc: toolchainResult.compiler.dtc,
    fdtoverlay: toolchainResult.compiler.fdtoverlay,
    dtschema: toolchainResult.compiler.dtschema
  };
  const artifactHashes = {
    ...toolchainResult.artifacts,
    revisionId: revision.id,
    entryFile,
    overlayOrder
  };

  if (!toolchainResult.ok) {
    const failureCode = (toolchainResult.failureCode ?? "compile-failed") as ValidateFailureCode;
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode,
        diagnostics: toPersistedDiagnostics(
          toolchainResult.diagnostics.map((diagnostic: DtsToolchainDiagnostic) => ({
            code: diagnostic.code ?? failureCode,
            severity: diagnostic.severity,
            stage: diagnostic.stage ?? "toolchain",
            message: diagnostic.message,
            file: diagnostic.file,
            line: diagnostic.line
          })),
          "toolchain",
          failureCode
        ),
        toolchain: toolchainPayload,
        artifactHashes
      },
      context
    );
  }

  // Catalog identity is the final release gate after syntax/toolchain checks.
  // This preserves the existing failure precedence (for example a missing dtc
  // remains `toolchain-unavailable`) while still refusing to mark a revision
  // validated when any recognized driver definition is incomplete.
  const catalogVerification = await verifyEffectiveDriverParameterDefinitions(db, {
    organizationId: auth.organization.id,
    configRevisionId: revision.id,
  });
  const unreviewedDriverTips =
    catalogVerification.checks.find((check) => check.code === "unreviewed-driver-tip")?.count ?? 0;
  if (unreviewedDriverTips > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "unreviewed-driver-tip",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "unreviewed-driver-tip",
              severity: "error",
              stage: "schema",
              message: `Recognized vendor-backed parameter tips remain unreviewed (${unreviewedDriverTips}); validation fails closed.`,
              fileName: "<parameter-catalog>",
            },
          ],
          "schema",
          "unreviewed-driver-tip",
        ),
      },
      context,
    );
  }

  const effectiveDefinitionBlockers = catalogVerification.checks.filter(
    (check) => check.code !== "unreviewed-driver-tip" && check.count > 0,
  );
  if (effectiveDefinitionBlockers.length > 0) {
    return persistFailedValidation(
      db,
      auth,
      {
        revisionId: revision.id,
        projectId: revision.projectId,
        configSetId: revision.configSetId,
        stage,
        failureCode: "effective-driver-definition",
        diagnostics: toPersistedDiagnostics(
          [
            {
              code: "effective-driver-definition",
              severity: "error",
              stage: "catalog",
              message: `Effective driver definition blockers remain: ${effectiveDefinitionBlockers
                .map((check) => `${check.code}=${check.count}`)
                .join(", ")}.`,
              fileName: "<parameter-catalog>",
            },
          ],
          "catalog",
          "effective-driver-definition",
        ),
      },
      context,
    );
  }

  const runId = randomUUID();
  // Run record, revision status, and audit commit together (ADR-0027); the toolchain
  // execution above deliberately stays outside the transaction.
  await withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async (tx) => {
    await insertValidationRun(tx, {
      id: runId,
      organizationId: auth.organization.id,
      configRevisionId: revision.id,
      stage,
      status: "passed",
      toolchain: toolchainPayload,
      artifactHashes
    });

    if (toolchainResult.diagnostics.length > 0) {
      await insertValidationDiagnostics(
        tx,
        runId,
        toPersistedDiagnostics(
          toolchainResult.diagnostics.map((diagnostic) => ({
            code: diagnostic.code ?? "toolchain",
            severity: diagnostic.severity,
            stage: diagnostic.stage ?? "toolchain",
            message: diagnostic.message,
            file: diagnostic.file,
            line: diagnostic.line
          })),
          "toolchain",
          "toolchain"
        )
      );
    }

    await updateConfigRevisionStatus(tx, {
      id: revision.id,
      status: "validated",
      resolvedAt: new Date().toISOString()
    });

    await writeGovernanceAudit(
      asAuditTx(tx),
      auth,
      {
        action: "config-revision-validated",
        projectId: revision.projectId,
        targetType: "dts-config-revision",
        targetId: revision.id,
        metadata: {
          validationRunId: runId,
          configRevisionId: revision.id,
          configSetId: revision.configSetId,
          stage,
          status: "passed",
          toolchain: toolchainPayload,
          artifactHashes
        }
      },
      context
    );
    return { result: undefined, audit: null };
  });

  return {
    id: runId,
    status: "passed" as const,
    stage,
    artifactHashes,
    toolchain: toolchainPayload,
    ...(toolchainResult.diagnostics.length > 0 ? { requiresConfirmation: true } : {})
  };
}



export type CreateNodeEnablementDraftServiceResult = NodeEnablementDraftResult;

/**
 * Org-isolated node enablement draft API: status writeback via shared tip pipeline.
 */
export async function createNodeEnablementDraft(
  db: Database,
  auth: AuthContext,
  input: {
    projectId: string;
  } & CreateNodeEnablementDraftBody,
  deps: CreateBindingDraftDeps = {},
  context: TrustedSensitiveNodeWriteContext
): Promise<CreateNodeEnablementDraftServiceResult> {
  requireCanEdit(auth);

  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
      projectId: input.projectId
    });
  }

  return createNodeEnablementDraftEdit(
    db,
    auth,
    {
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId,
      baseRevisionId: input.baseRevisionId,
      target: input.target,
      reason: input.reason,
      acknowledgeNonstandard: input.acknowledgeNonstandard,
      spellingOverride: input.spellingOverride
    },
    deps,
    context
  );
}
