/**
 * HTTP consumer of Binding/ProjectValue owners for published project values.
 * Lives outside S12 scanned families so Catalog SQL does not shift allow-list
 * fingerprints. Registers the Hosted page-loop paths first so they win.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage, canViewParameters } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { getRootPostgresPool, isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { readCanonicalBatchSourceDiff, readCanonicalSourceDiff } from "../parameter-files/canonicalSourceDiff";
import { getCanonicalMemberRemovalForAuth, listCanonicalMemberRemovalsForAuth,
  reviewCanonicalMemberRemoval, submitCanonicalMemberRemoval,
  withdrawCanonicalMemberRemoval } from "./drafts/memberRemovalChangeService";
import { assertSingleRequestReview } from "./drafts/changeService";
import { withCanonicalSourceAttemptTransaction } from "../parameter-files/canonicalSourceAttemptTransaction";
import { loadPublishedCatalog } from "./catalogProjectValueSync";
import { listConfigSets } from "../parameter-files/configSetService";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import { createBindingDraft, listProjectBindings, requireCanViewProject } from "../parameter-topology/service";
import {
  createBindingDraftBodySchema,
  createBindingDraftParamsSchema,
  dtsValueSchema,
  projectBindingDtoSchema,
  projectBindingsParamsSchema,
  projectBindingsQuerySchema
} from "../parameter-topology/schemas";
import { getProjectById } from "../projects/repository";
import {
  createCanonicalValueDraft,
  approveCanonicalBatchValueChange,
  getCanonicalBatchValueChangeForReviewer,
  getCanonicalBatchValueChangeForAuth,
  listCanonicalBatchValueChangesForAuth,
  listCanonicalValueChangesForAuth,
  listCanonicalValueDraftsForUser,
  removeCanonicalValueDraft,
  rejectCanonicalBatchValueChange,
  reviewCanonicalValueChange,
  submitCanonicalBatchValueChange,
  withdrawCanonicalBatchValueChange,
  submitCanonicalValueChange,
  withdrawCanonicalValueChange,
  type CanonicalValueDraftDto
} from "./drafts";
import {
  applyImportBatchBodySchema,
  createImportBatchBodySchema
} from "../parameters/schemas";
import { insertImportBatch } from "../parameters/importBatchRepository";
import { deleteDraft as deleteTopologyDraft, listDrafts as listTopologyDrafts } from "../parameters/service";
import type { ParameterDraftDto } from "../parameter-drafts/types";
import { stageCanonicalImportBatch } from "./drafts/importService";
import { parameterImportBatchDtoSchema } from "../contracts/dtoSchemas/parameters";
import { catalogBindingExportDtoSchema } from "../contracts/dtoSchemas/parameterCatalog";
import {
  asValueClient,
  findCatalogBindingRow,
  listCatalogBindingRowsForProject,
  exportCanonicalBindingSource,
  verifyCanonicalSourceReimport,
  listCatalogBindingsForImport,
  matchCatalogImportRow,
  canonicalImportValueUnchanged,
  readCanonicalBindingChangeHistory,
  syncPublishedCatalogProjectValuesInTransaction
} from "./catalogProjectValueSync";

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for published project values.");
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid published project-value input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }
  return parsed.data;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

async function visibleValueChangeRequests(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; status?: "pending" | "approved" | "rejected" | "withdrawn"; mine?: boolean },
  concealProject = false
) {
  if (!auth.user.isActive || !canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view access is required for this project.");
  }
  if (!auth.roles.some((role) => role.projectId === null || role.projectId === input.projectId)) {
    throw new ApiError(concealProject ? "NOT_FOUND" : "FORBIDDEN", "Project parameter requests are not available.");
  }
  const items = await listCanonicalValueChangesForAuth(db, auth, input);
  const canReadReviewQueue = !input.mine && canReviewParameters(auth)
    && canReviewParameterStage(auth, input.projectId, "software_review")
    && await hasCurrentCanonicalReviewRole(db, {
      organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
    });
  if (!canReadReviewQueue) return items.filter((item) => item.submitterUserId === auth.user.id);
  const conflictIds = await db.query<{ id: string }>(`
    select distinct target_id as id from audit_events
     where organization_id=$1 and project_id=$2 and action='value-change-submitted'
       and metadata ? 'decisionProofDigest'
    union
    select impact->'canonicalSourceWorkflow'->>'requestId' as id
      from project_parameter_file_candidates
     where organization_id=$1 and project_id=$2
       and impact->'canonicalSourceWorkflow'->'conflictDecision' is not null`,
    [auth.organization.id, input.projectId]);
  const frozenConflictIds = new Set(conflictIds.rows.map((row) => row.id));
  return items.filter((item) => (!frozenConflictIds.has(item.id)
    || item.assignedToUserId === auth.user.id || item.submitterUserId === auth.user.id)
    && (input.status !== "pending" || item.submitterUserId !== auth.user.id));
}

async function visibleConflictDecision(
  db: Database, auth: AuthContext, input: { projectId: string; requestId: string }
) {
  const links = await db.query<{ candidate_id: string; link: {
    requestId: string; preparedCandidateId: string; bindingId: string; fingerprint: string;
    conflictDecision: { choice: "file" | "draft"; selectedDraftId: string; decisionProofDigest: string }
  } }>(`select id as candidate_id, impact->'canonicalSourceWorkflow' as link
      from project_parameter_file_candidates
     where organization_id=$1 and project_id=$2
       and impact->'canonicalSourceWorkflow'->>'requestId'=$3
      and impact->'canonicalSourceWorkflow'->'conflictDecision' is not null`,
    [auth.organization.id, input.projectId, input.requestId]);
  const receipts = await db.query<{ metadata: Record<string, unknown> }>(`select metadata from audit_events
     where organization_id=$1 and project_id=$2 and target_id=$3
       and action='value-change-submitted' and metadata ? 'decisionProofDigest'`,
    [auth.organization.id, input.projectId, input.requestId]);
  if (!links.rows.length && !receipts.rows.length) return null;
  const requests = await visibleValueChangeRequests(db, auth, { projectId: input.projectId }, true);
  const visible = requests.find((item) => item.id === input.requestId);
  const mayRead = visible && (visible.submitterUserId === auth.user.id
    || (visible.assignedToUserId === auth.user.id && canReviewParameters(auth)
      && canReviewParameterStage(auth, input.projectId, "software_review")
      && await hasCurrentCanonicalReviewRole(db, {
        organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
      })));
  if (!mayRead) throw new ApiError("NOT_FOUND", "Source conflict decision was not found.");
  if (links.rows.length !== 1) throw new ApiError("CONFLICT", "Source conflict decision link is missing or duplicated.", {
    reason: "conflict-decision-stale"
  });
  const { candidate_id: sourceCandidateId, link } = links.rows[0]!;
  const decision = link?.conflictDecision;
  const receipt = receipts.rows[0]?.metadata;
  if (!decision || receipts.rows.length !== 1 || link.requestId !== visible.id
    || link.preparedCandidateId !== visible.candidateId || link.bindingId !== visible.bindingId
    || link.fingerprint !== decision.decisionProofDigest
    || receipt?.sourceCandidateId !== sourceCandidateId
    || receipt?.decisionProofDigest !== decision.decisionProofDigest
    || receipt?.choice !== decision.choice || receipt?.selectedDraftId !== decision.selectedDraftId) {
    throw new ApiError("CONFLICT", "Frozen source conflict decision is inconsistent.", {
      reason: "conflict-decision-stale"
    });
  }
  return { request: visible, sourceCandidateId, selectedBindingId: link.bindingId,
    selectedDraftId: decision.selectedDraftId, choice: decision.choice,
    decisionProofDigest: decision.decisionProofDigest };
}

function topologyDraftToValueDraftDto(draft: ParameterDraftDto): CanonicalValueDraftDto | null {
  if (draft.editSubjectKind === "node-enablement") {
    return null;
  }
  const bindingId = draft.bindingId ?? draft.projectParameterBindingId ?? "";
  const definitionId = draft.parameterSpecId ?? "";
  const baseRevisionId = draft.candidateConfigRevisionId ?? "";
  const effectiveRevisionId = draft.effectiveRevisionId ?? baseRevisionId;
  if (!bindingId || !definitionId || !baseRevisionId || !effectiveRevisionId) {
    return null;
  }
  return {
    id: draft.id,
    bindingId,
    definitionId,
    effectiveRevisionId,
    currentValueId: draft.currentValueId ?? null,
    targetValue: draft.targetValue,
    sourceFormat: "dts",
    baseRevisionId,
    sourcePinId: null,
    candidateId: null,
    reason: draft.reason,
    updatedAt: draft.updatedAt,
    action: "set"
  };
}

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1)
});

const paramsWithProjectIdSchema = z.object({ projectId: z.string().min(1) });
const paramsWithBatchIdSchema = z.object({ batchId: z.string().min(1) });

const canonicalDraftBodySchema = z
  .object({
    baseRevisionId: z.string().min(1),
    targetValue: dtsValueSchema.optional(),
    sourceTarget: z.object({ format: z.literal("json"), sourceText: z.string().min(1) }).optional(),
    action: z.enum(["set", "delete"]).optional(),
    reason: z.string().min(1)
  })
  .superRefine((value, ctx) => {
    const action = value.action ?? "set";
    if (action === "set" && ((value.targetValue === undefined) === (value.sourceTarget === undefined))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Exactly one typed target is required when action is set.", path: ["targetValue"] });
    }
    if (action === "delete" && (value.targetValue !== undefined || value.sourceTarget !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A property deletion does not accept a replacement target.", path: ["action"] });
    }
  });

function decodeContentBase64(contentBase64: string) {
  const trimmed = contentBase64.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is required.");
  }
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Parameter file contentBase64 is invalid.");
  }
}

async function syncLatestPublishedValues(
  db: Database,
  auth: AuthContext,
  projectId: string,
  context: { requestId: string }
) {
  const pool = getRootPostgresPool(db);
  if (!pool) return;
  const sets = await listConfigSets(db, auth, projectId);
  const configSet = sets.find((item) => item.name === "default") ?? sets[0];
  if (!configSet) return;
  const revision = await getLatestConfigRevision(db, {
    organizationId: auth.organization.id,
    projectId,
    configSetId: configSet.id
  });
  if (!revision || revision.status !== "resolved") return;
  const snapshot = await loadPublishedCatalog(pool);
  if (!snapshot) return;
  await withAuditedWrite(db, auth, { requestId: context.requestId }, async (tx) => {
    const written = await syncPublishedCatalogProjectValuesInTransaction(
      asValueClient(tx),snapshot,
      {
        organizationId: auth.organization.id,
        projectId,
        configSetId: configSet.id,
        configRevisionId: revision.id
      }
    );
    if (written === 0) {
      return { result: 0, audit: null };
    }
    return {
      result: written,
      audit: {
        app: "parameters",
        kind: "parameter-topology-governance",
        action: "binding-edited",
        severity: "Medium" as const,
        projectId,
        targetType: "dts-config-revision",
        targetId: revision.id,
        metadata: {
          writeTargetRole: "canonical-project-value",
          sourceRef: `config-set:${configSet.id}`,
          configRevisionId: revision.id,
          written
        }
      }
    };
  });
}

export function registerCatalogProjectValueConsumerRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v2/projects/:projectId/parameter-bindings", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    if (!canViewParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
    }
    const params = parseWithSchema(projectBindingsParamsSchema, request.params);
    const query = parseWithSchema(projectBindingsQuerySchema, flattenQuery(request.query));
    const project = await getProjectById(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId
    });
    if (!project) {
      throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
        projectId: params.projectId
      });
    }
    const catalogRows = await listCatalogBindingRowsForProject(db, auth, {
      projectId: params.projectId,
      revisionId: query.revisionId
    });
    const catalogItems = catalogRows.map((row) =>
      projectBindingDtoSchema.parse({
        id: row.id,
        parameterSpecId: row.parameterSpecId,
        parameterSpecVersionId: row.parameterSpecVersionId,
        definitionId: row.definitionId,
        effectiveRevisionId: row.effectiveRevisionId,
        currentValueId: row.currentValueId,
        projectId: row.projectId,
        propertyKey: row.propertyKey,
        driverModule: row.driverModule,
        logicalNodeId: row.logicalNodeId,
        instanceName: row.instanceName,
        locator: row.locator,
        effectiveValue: row.typedValue,
        rawValue: row.rawValue,
        schemaState: row.schemaState,
        policyState: row.policyState,
        moduleId: row.moduleId,
        displayName: row.displayName,
        description: row.description,
        documentation: row.documentation
      })
    );
    return { status: 200, body: { items: catalogItems } };
  });

  /**
   * Canonical binding change history. Reads the canonical
   * `binding_history_events` written by the value owner on every committed change,
   * including the reviewed apply path. Archived legacy payloads are never returned.
   */
  router.get(
    "/api/v2/projects/:projectId/parameter-bindings/:bindingId/change-history",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      if (!canViewParameters(auth)) {
        throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
      }
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), bindingId: z.string().min(1) }),
        request.params
      );
      const query = parseWithSchema(
        z.object({ limit: z.coerce.number().int().positive().max(200).optional() }),
        flattenQuery(request.query)
      );
      requireCanViewProject(auth, params.projectId);
      const project = await getProjectById(db, {
        organizationId: auth.organization.id,
        projectId: params.projectId
      });
      if (!project) {
        throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
          projectId: params.projectId
        });
      }
      const pool = getRootPostgresPool(db);
      if (!pool) {
        throw new ApiError("INTERNAL_ERROR", "Canonical history requires the root database.");
      }
      const items = await readCanonicalBindingChangeHistory(pool, {
        organizationId: auth.organization.id,
        projectId: params.projectId,
        bindingId: params.bindingId,
        limit: query.limit
      });
      if (items === null) {
        throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
          projectId: params.projectId,
          bindingId: params.bindingId
        });
      }
      return { status: 200, body: { items } };
    }
  );

  /**
   * Canonical export: the exact stored project-source bytes for the binding's pinned
   * config revision, together with the canonical identity pins, so a reimport can be
   * verified against the same value and revision.
   */
  router.get(
    "/api/v2/projects/:projectId/parameter-bindings/:bindingId/export",
    async (request) => {
      const db = requireDb(options.db);
      if (!options.objectStore) {
        throw new ApiError("INTERNAL_ERROR", "Object store is required for canonical export.");
      }
      const auth = await options.getCurrentAuthContext(request);
      if (!canViewParameters(auth)) {
        throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
      }
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), bindingId: z.string().min(1) }),
        request.params
      );
      requireCanViewProject(auth, params.projectId);
      const project = await getProjectById(db, {
        organizationId: auth.organization.id,
        projectId: params.projectId
      });
      if (!project) {
        throw new ApiError("NOT_FOUND", "Project was not found for this organization.", {
          projectId: params.projectId
        });
      }
      const item = await exportCanonicalBindingSource(db, options.objectStore, auth, {
        projectId: params.projectId,
        bindingId: params.bindingId,
        ...parseWithSchema(z.object({ projectValueId: z.string().min(1).optional() }).strict(),flattenQuery(request.query))
      });
      if (!item) {
        throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
          projectId: params.projectId,
          bindingId: params.bindingId
        });
      }
      return { status: 200, body: { item } };
    }
  );

  router.post("/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(createBindingDraftParamsSchema, request.params);
    const rawBody = request.body ?? {};
    if (!canEditParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter edit permission is required.");
    }
    const catalogBinding = await findCatalogBindingRow(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId,
      bindingId: params.bindingId
    });
    if (!catalogBinding) {
      const body = parseWithSchema(createBindingDraftBodySchema, rawBody);
      const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
      if (!refusalAuditSink) {
        throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for typed binding drafts.");
      }
      const item = await createBindingDraft(
        db,
        auth,
        {
          projectId: params.projectId,
          bindingId: params.bindingId,
          baseRevisionId: body.baseRevisionId,
          targetValue: body.targetValue,
          action: body.action,
          reason: body.reason
        },
        { objectStore: options.objectStore },
        {
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: refusalAuditSink
        }
      );
      return { status: 201, body: { item } };
    }
    const body = parseWithSchema(canonicalDraftBodySchema, rawBody);
    if (!canEditParameters(auth, params.projectId)) {
      throw new ApiError("FORBIDDEN", "Parameter edit role is required for this project.");
    }
    const pool = getRootPostgresPool(db);
    if (!pool) {
      throw new ApiError("INTERNAL_ERROR", "Canonical pending drafts require the root database.");
    }
    const targetValue = body.targetValue;
    if (!options.objectStore) {
      throw new ApiError("INTERNAL_ERROR", "Canonical source drafts require object storage.");
    }
    const canonicalRefusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
    if (!canonicalRefusalAuditSink) {
      throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for canonical source drafts.");
    }
    const sourcePin = await db.query<{ format: "dts" | "json"; config_revision_id: string; property_occurrence_id: string | null; node_locator: string | null; compatible: string | null }>(
      `select pin.format, pin.config_revision_id, pin.property_occurrence_id,
              coalesce(nullif(node.ref_target,''), node.node_path) as node_locator, logical.compatible
         from parameter_catalog.project_parameter_bindings binding
         join parameter_catalog.project_parameter_values value on value.id = binding.current_value_id
         join parameter_catalog.project_value_source_pins pin
           on pin.project_value_id = value.id and pin.binding_id = binding.id
         and pin.source_occurrence_id = binding.source_occurrence_id
         left join parameter_catalog.project_parameter_source_occurrences occurrence
           on occurrence.id=pin.source_occurrence_id and occurrence.organization_id=pin.organization_id
          and occurrence.project_id=pin.project_id and occurrence.file_id=pin.file_id
         left join dts_logical_node_revisions logical
           on logical.logical_node_id=occurrence.logical_node_id and logical.config_revision_id=pin.config_revision_id
         left join dts_property_occurrences property
           on property.id = pin.property_occurrence_id
          and property.config_revision_id = pin.config_revision_id
          and property.file_version_id = pin.file_version_id
         left join dts_node_occurrences node
           on node.id = property.node_occurrence_id
          and node.config_revision_id = property.config_revision_id
          and node.file_version_id = property.file_version_id
        where binding.organization_id = $1 and binding.project_id = $2 and binding.id = $3
          and pin.config_revision_id = value.config_revision_id
        limit 1`,
      [auth.organization.id, params.projectId, params.bindingId]
    );
    if (sourcePin.rows.length !== 1) {
      throw new ApiError("CONFLICT", "Canonical binding has no exact current source pin.", { bindingId: params.bindingId });
    }
    if (sourcePin.rows[0]!.format === "dts") {
      const nodeLocator = sourcePin.rows[0]!.node_locator;
      if (!nodeLocator) {
        throw new ApiError("VALIDATION_FAILED", "Pinned DTS node could not be resolved for a sensitive-node check.", {
          bindingId: params.bindingId,
          configRevisionId: sourcePin.rows[0]!.config_revision_id
        });
      }
      try {
        await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
          organizationId: auth.organization.id,
          projectId: params.projectId,
          nodePath: nodeLocator,
          compatible: sourcePin.rows[0]?.compatible,
          compatibleIsAuthoritative: true,
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: canonicalRefusalAuditSink
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === "FORBIDDEN") {
          await canonicalRefusalAuditSink.write({
            invocation: createUserInvocation(auth),
            projectId: params.projectId,
            app: "parameter-management",
            kind: "parameter-source-permission-denied",
            action: "deny",
            severity: "High",
            targetType: "sensitive-node",
            targetId: params.bindingId,
            metadata: { code: "parameter-source-permission-denied", operation: "canonical source draft", ...error.details },
            traceId: request.requestId
          });
        }
        throw error;
      }
    }
    // A draft is pending work. It records the canonical binding/definition/revision
    // pins plus the exact base value/config-revision pins and leaves the current
    // ProjectValue, its history tip and the active source revision untouched.
    const item = await withCanonicalSourceAttemptTransaction(
      db,
      options.objectStore,
      async (outerTx, attempt) => withAuditedWrite(outerTx, auth, { requestId: request.requestId }, async (tx) => {
        const draft = await createCanonicalValueDraft(tx, auth, {
          projectId: params.projectId,
          bindingId: params.bindingId,
          action: body.action ?? "set",
          targetValue,
          sourceTarget: body.sourceTarget,
          reason: body.reason,
          baseRevisionId: body.baseRevisionId
        }, {
          objectStore: attempt.objectStore,
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: canonicalRefusalAuditSink
        });
        await writeTrustedGovernanceAudit(
          asAuditTx(tx),
          createUserInvocation(auth),
          {
            action: "value-drafted",
            organizationId: auth.organization.id,
            projectId: params.projectId,
            targetType: "project-parameter-binding",
            targetId: params.bindingId,
            metadata: {
              draftId: draft.id,
              definitionId: draft.definitionId,
              effectiveRevisionId: draft.effectiveRevisionId,
              baseCurrentValueId: draft.currentValueId,
              configRevisionId: body.baseRevisionId,
              writeTargetRole: "canonical-project-value-draft",
              reason: body.reason
            }
          },
          request.requestId
        );
        return {
          result: {
            draftId: draft.id,
            parameterId: draft.bindingId,
            candidateRevisionId: body.baseRevisionId,
            workingCandidateRevisionId: body.baseRevisionId,
            rebasedDraftIds: [] as string[],
            rawText: draft.targetValue,
            action: (body.action ?? "set") as "set" | "delete",
            parameterSpecId: draft.definitionId,
            projectParameterBindingId: draft.bindingId,
            writeTarget: { role: "canonical-project-value-draft", propertyKey: catalogBinding.definition_id },
            overlayFileId: "",
            overlayFileName: "",
            definitionId: draft.definitionId,
            effectiveRevisionId: draft.effectiveRevisionId,
            currentValueId: draft.currentValueId,
            pending: true as const
          },
          audit: null
        };
      }),
    );
    return { status: 201, body: { item } };
  });

  /**
   * Pending drafts for the calling user. Catalog C4 rows are the preferred
   * owner; post-cutover DTS typed edit still persists topology `parameter_drafts`
   * when the binding is not a catalog row (TD-125). The tray hydrates this
   * union so a reload does not drop in-progress work.
   */
  router.get("/api/v2/projects/:projectId/parameter-value-drafts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectBindingsParamsSchema, request.params);
    const catalogItems = await listCanonicalValueDraftsForUser(db, auth, { projectId: params.projectId });
    const topologyDrafts = await listTopologyDrafts(
      db,
      auth,
      { projectId: params.projectId },
      { invocation: createUserInvocation(auth) }
    );
    const seen = new Set(catalogItems.map((item) => item.id));
    const items = [
      ...catalogItems,
      ...topologyDrafts.flatMap((draft) => {
        const mapped = topologyDraftToValueDraftDto(draft);
        if (!mapped || seen.has(mapped.id)) return [];
        seen.add(mapped.id);
        return [mapped];
      })
    ];
    return { status: 200, body: { items } };
  });

  router.delete(
    "/api/v2/projects/:projectId/parameter-value-drafts/:draftId",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), draftId: z.string().min(1) }),
        request.params
      );
      try {
        const item = await removeCanonicalValueDraft(db, auth, {
          projectId: params.projectId,
          draftId: params.draftId
        }, {
          invocation: createUserInvocation(auth),
          requestId: request.requestId
        });
        return { status: 200, body: { item } };
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") {
          throw error;
        }
        await deleteTopologyDraft(db, auth, params.draftId, {
          invocation: createUserInvocation(auth),
          projectId: params.projectId,
          requestId: request.requestId
        });
        return { status: 200, body: { item: { id: params.draftId } } };
      }
    }
  );

  router.post("/api/v1/projects/:projectId/parameter-files", async (request) => {
    const db = requireDb(options.db);
    if (!options.objectStore) {
      throw new ApiError("INTERNAL_ERROR", "Object store is required for parameter file routes.");
    }
    const auth = await options.getCurrentAuthContext(request);
    if (!canAdminParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter admin permission is required.");
    }
    const params = parseWithSchema(paramsWithProjectIdSchema, request.params);
    const body = parseWithSchema(uploadBodySchema, request.body, "Invalid parameter file upload payload.");
    const result = await uploadProjectParameterFile(
      db,
      options.objectStore,
      auth,
      {
        projectId: params.projectId,
        fileName: body.fileName.trim(),
        bytes: decodeContentBase64(body.contentBase64)
      },
      { requestId: request.requestId }
    );
    await syncLatestPublishedValues(db, auth, params.projectId, { requestId: request.requestId });
    return {
      status: 201,
      body: {
        item: result.file,
        version: result.version,
        ...(result.driverSummary ? { driverSummary: result.driverSummary } : {})
      }
    };
  });

  router.post("/api/v2/projects/:projectId/parameter-bindings/:bindingId/reimport-preview", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(z.object({ projectId: z.string().min(1),bindingId: z.string().min(1) }),request.params);
    const source = parseWithSchema(catalogBindingExportDtoSchema,request.body);
    if (!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Canonical reimport requires source storage.");
    const item = await verifyCanonicalSourceReimport(db,options.objectStore,auth,{ ...params,source });
    return { status: 200,body: { item } };
  });

  router.post("/api/v1/parameter-import-batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createImportBatchBodySchema, request.body);
    if (!canAdminParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter import administration is required.");
    if (!await getProjectById(db,{ organizationId: auth.organization.id,projectId: body.projectId })) throw new ApiError("NOT_FOUND", "Project was not found for this organization.");
    const catalog = await listCatalogBindingsForImport(db, {
      organizationId: auth.organization.id,
      projectId: body.projectId,
      names: body.items.map((row) => row.name),
      definitionIds: body.items.map((row) => row.id).filter((id): id is string => Boolean(id))
    });
    const catalogMatches = body.items.map((source) =>
      matchCatalogImportRow({ id: source.id, name: source.name }, catalog)
    );
    const topologyBindings = (await listProjectBindings(db, auth, { projectId: body.projectId })).items;
    const topologyCandidates = topologyBindings.map((binding) => ({
      id: binding.parameterSpecId,
      name: binding.propertyKey,
      description: binding.description ?? "",
      explanation: "",
      configFormat: "",
      module: binding.driverModule ?? "",
      range: "",
      unit: "",
      risk: "Low" as const,
      projectParameterValueId: binding.id,
      currentValue: binding.rawValue ?? ""
    }));
    // Unbound names stay conflict (never "added"/mint). A unique topology
    // propertyKey match is an update of existing post-cutover work, not a
    // legacy definition create (TD-125 / T21-12).
    const rewritten = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const items = body.items.map((row, index) => {
        const match = catalogMatches[index] ?? matchCatalogImportRow({ name: row.name }, topologyCandidates);
        return {
          ...row,
          id: randomUUID(),riskFlag: row.risk === "High",
          classification: match ? (canonicalImportValueUnchanged(match,row.currentValue ?? row.recommendedValue ?? "") ? "unchanged" as const : "updated" as const) : "conflict" as const,
          ...(match ? { definitionId: match.id,projectParameterValueId: match.projectParameterValueId,
            baseCurrentValueId: match.baseCurrentValueId,baseRevisionId: match.baseRevisionId,configFormat: row.configFormat ?? match.configFormat } : {})
        };
      });
      const added = 0;
      const updated = items.filter((row) => row.classification === "updated").length;
      const unchanged = items.filter((row) => row.classification === "unchanged").length;
      const summary = { added,updated,unchanged,conflict: items.length-updated-unchanged,highRisk: items.filter((row) => row.riskFlag).length };
      const item = await insertImportBatch(tx,{ id: randomUUID(),organizationId: auth.organization.id,projectId: body.projectId,
        createdByUserId: auth.user.id,sourceName: body.sourceName,summary,items });
      return {
        result: parameterImportBatchDtoSchema.parse({ ...item, items, summary }),
        audit: {
          app: "parameter-management",
          kind: "batch-import",
          action: "preview",
          severity: "High" as const,
          projectId: body.projectId,
          targetType: "parameter-import-batch",
          targetId: item.id,
          metadata: {
            batchId: item.id,
            summary: {
              added,
              updated,
              skipped: body.reviewMetadata?.skippedRows?.length ?? 0
            },
            catalogRewrite: true,
            ...(body.reviewMetadata ? { reviewMetadata: body.reviewMetadata } : {})
          }
        }
      };
    });
    return { status: 201, body: { item: rewritten } };
  });

  router.post("/api/v1/parameter-import-batches/:batchId/apply", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithBatchIdSchema, request.params);
    const body = parseWithSchema(
      applyImportBatchBodySchema,
      { ...(request.body && typeof request.body === "object" ? request.body : {}), batchId: params.batchId }
    );
    if (!isRootDatabase(db) || !options.objectStore) throw new ApiError("INTERNAL_ERROR", "Canonical import requires root database and source storage.");
    const item = await stageCanonicalImportBatch(db,options.objectStore,auth,body,{
      invocation: createUserInvocation(auth),requestId: request.requestId,refusalSink: createTrustedRefusalAuditSink(db)
    });
    return { status: 200,body: { item: parameterImportBatchDtoSchema.parse(item) } };
  });

  /**
   * Freeze one pending canonical draft into a reviewable change request.
   * Submission never writes the current value; it only pins the pending work.
   */
  router.post(
    "/api/v2/projects/:projectId/parameter-value-drafts/:draftId/submit",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), draftId: z.string().min(1) }),
        request.params
      );
      const body = parseWithSchema(
        z.object({ assignedToUserId: z.string().min(1).nullable().optional() }),
        request.body ?? {}
      );
      const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
      if (!refusalAuditSink) {
        throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for canonical value submission.");
      }
      const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
        const submitted = await submitCanonicalValueChange(tx, auth, {
          projectId: params.projectId,
          draftId: params.draftId,
          assignedToUserId: body.assignedToUserId ?? null,
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: refusalAuditSink
        });
        await writeTrustedGovernanceAudit(
          asAuditTx(tx),
          createUserInvocation(auth),
          {
            action: "value-change-submitted",
            organizationId: auth.organization.id,
            projectId: params.projectId,
            targetType: "project-parameter-value-change-request",
            targetId: submitted.id,
            metadata: {
              requestId: submitted.id,
              draftId: submitted.draftId,
              bindingId: submitted.bindingId,
              definitionId: submitted.definitionId,
              effectiveRevisionId: submitted.effectiveRevisionId,
              writeTargetRole: "canonical-project-value-change-request"
            }
          },
          request.requestId
        );
        return { result: submitted, audit: null };
      });
      return { status: 201, body: { item } };
    }
  );

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectBindingsParamsSchema, request.params);
    const query = parseWithSchema(
      z.object({
        status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
        mine: z.enum(["true", "false"]).optional()
      }),
      flattenQuery(request.query)
    );
    const items = await visibleValueChangeRequests(db, auth, {
      projectId: params.projectId,
      status: query.status,
      mine: query.mine === "true"
    });
    return { status: 200, body: { items } };
  });

  router.post("/api/v2/projects/:projectId/parameter-value-change-requests/batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const { projectId } = parseWithSchema(projectBindingsParamsSchema, request.params);
    const body = parseWithSchema(z.object({
      candidateId: z.string().min(1), expectedProofToken: z.string().min(1),
      reason: z.string().trim().min(1), assignedToUserId: z.string().min(1),
      selectedDrafts: z.array(z.object({ bindingId: z.string().min(1), draftId: z.string().min(1) })).optional(),
      targetDecisions: z.array(z.object({ bindingId: z.string().min(1),
        choice: z.enum(["file", "draft"]), draftId: z.string().min(1).optional() })).optional()
    }), request.body ?? {});
    if (!isRootDatabase(db)) throw new ApiError("INTERNAL_ERROR", "Canonical batch submit requires root database.");
    const item = await submitCanonicalBatchValueChange(db, options.objectStore, auth, {
      projectId, ...body, invocation: createUserInvocation(auth), requestId: request.requestId,
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    return { status: 201, body: { item } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const { projectId } = parseWithSchema(projectBindingsParamsSchema, request.params);
    const query = parseWithSchema(z.object({
      status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
      mine: z.enum(["true", "false"]).optional()
    }), flattenQuery(request.query));
    const items = await listCanonicalBatchValueChangesForAuth(db, auth, {
      projectId, status: query.status, mine: query.mine === "true"
    });
    return { status: 200, body: { items } };
  });

  router.post("/api/v2/projects/:projectId/parameter-value-change-requests/member-removals", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const { projectId } = parseWithSchema(projectBindingsParamsSchema, request.params);
    const body = parseWithSchema(z.object({
      configSetId: z.string().min(1), fileId: z.string().min(1),
      reason: z.string().trim().min(1), assignedToUserId: z.string().min(1)
    }), request.body ?? {});
    if (!isRootDatabase(db)) throw new ApiError("INTERNAL_ERROR", "Canonical member removal requires root database.");
    const item = await submitCanonicalMemberRemoval(db, options.objectStore, auth, {
      projectId, ...body, invocation: createUserInvocation(auth), traceId: request.requestId,
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    return { status: 201, body: { item } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/member-removals", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const { projectId } = parseWithSchema(projectBindingsParamsSchema, request.params);
    const query = parseWithSchema(z.object({
      status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
      mine: z.enum(["true", "false"]).optional()
    }), flattenQuery(request.query));
    const items = await listCanonicalMemberRemovalsForAuth(db, auth, {
      projectId, status: query.status, mine: query.mine === "true"
    });
    return { status: 200, body: { items } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/member-removal", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(z.object({ projectId: z.string().min(1), requestId: z.string().min(1) }), request.params);
    const item = await getCanonicalMemberRemovalForAuth(db, auth, params);
    if (!item) throw new ApiError("NOT_FOUND", "Member removal request was not found.");
    return { status: 200, body: { item } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/batch", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(z.object({ projectId: z.string().min(1), requestId: z.string().min(1) }), request.params);
    const item = await getCanonicalBatchValueChangeForAuth(db, auth, params);
    if (!item) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
    return { status: 200, body: { item } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/source-diff", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(z.object({ projectId: z.string().min(1),requestId: z.string().min(1) }),request.params);
    const kind = (await db.query<{ request_kind: string }>(`
      select request_kind from public.project_parameter_value_change_requests
       where id=$1 and organization_id=$2 and project_id=$3`,
      [params.requestId, auth.organization.id, params.projectId])).rows[0]?.request_kind;
    if (kind === "batch") {
      const item = await db.transaction(async (tx) => {
        const frozen = await getCanonicalBatchValueChangeForAuth(tx, auth, params);
        if (!frozen) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
        if (!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source object storage is required.");
        const source = await readCanonicalBatchSourceDiff(tx, options.objectStore, auth, params);
        if (source.requestId !== frozen.id || source.candidateId !== frozen.candidateId
          || source.batchProofDigest !== frozen.batchProofDigest
          || source.targets.length !== frozen.targets.length
          || source.targets.some((target, ordinal) => {
            const expected = frozen.targets[ordinal];
            return !expected || target.ordinal !== ordinal || target.bindingId !== expected.bindingId
              || target.sourcePinId !== expected.sourcePinId || target.action !== expected.action;
          })) {
          throw new ApiError("CONFLICT", "Batch source diff disagrees with the frozen reviewer targets.", {
            reason: "canonical-batch-proof-mismatch"
          });
        }
        return source;
      });
      return { status: 200, body: { item } };
    }
    const item = await db.transaction(async (tx) => {
      await visibleConflictDecision(tx, auth, params);
      // Keep the current-review-role lock through the frozen single-source object read.
      const visible = await visibleValueChangeRequests(tx, auth, { projectId: params.projectId }, true);
      if (!visible.some((request) => request.id === params.requestId)) {
        throw new ApiError("NOT_FOUND", "Source change request was not found.");
      }
      if (!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source object storage is required.");
      return readCanonicalSourceDiff(tx, options.objectStore, auth, params);
    });
    return { status: 200,body: { item } };
  });

  router.get("/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/conflict-decision", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(z.object({ projectId: z.string().min(1), requestId: z.string().min(1) }), request.params);
    const item = await db.transaction(async (tx) => {
      const decision = await visibleConflictDecision(tx, auth, params);
      if (!decision) throw new ApiError("NOT_FOUND", "Source conflict decision was not found.");
      if (!options.objectStore) throw new ApiError("INTERNAL_ERROR", "Source object storage is required.");
      const sourceDiff = await readCanonicalSourceDiff(tx, options.objectStore, auth, params);
      if (sourceDiff.bindingId !== decision.selectedBindingId
        || sourceDiff.candidateId !== decision.request.candidateId) {
        throw new ApiError("CONFLICT", "Frozen source conflict target disagrees with its source diff.");
      }
      return { ...decision, sourceDiff };
    });
    return { status: 200, body: { item } };
  });

  /**
   * Approve (apply) or reject one pending canonical change. Approval re-resolves the
   * frozen pins, rejects drift, writes the value and its source through the canonical
   * owners, and commits workflow status, history and audit in one transaction.
   */
  router.post(
    "/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/review",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), requestId: z.string().min(1) }),
        request.params
      );
      const body = parseWithSchema(
        z.object({
          decision: z.enum(["approve", "reject"]),
          note: z.string().nullable().optional(),
          batchProofDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          draftImpactDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
          memberProofDigest: z.string().regex(/^[0-9a-f]{64}$/).optional()
        }),
        request.body ?? {}
      );
      const pool = getRootPostgresPool(db);
      const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
      if (!refusalAuditSink) {
        throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for canonical value review.");
      }
      const requestKind = (await db.query<{ request_kind: string }>(`
        select request_kind from public.project_parameter_value_change_requests
         where id=$1 and organization_id=$2 and project_id=$3`,
        [params.requestId, auth.organization.id, params.projectId])).rows[0]?.request_kind;
      if (!requestKind) throw new ApiError("NOT_FOUND", "Canonical value request was not found.");
      if (requestKind === "member-removal") {
        const item = await reviewCanonicalMemberRemoval(db, options.objectStore, auth, {
          ...params, decision: body.decision, proofDigest: body.memberProofDigest ?? "",
          note: body.note ?? null, invocation: createUserInvocation(auth),
          traceId: request.requestId, refusalSink: refusalAuditSink
        });
        return { status: 200, body: { item } };
      }
      if (requestKind === "batch") {
        const visibleBatch = await getCanonicalBatchValueChangeForReviewer(db, auth, params, {
          invocation: createUserInvocation(auth), requestId: request.requestId, refusalSink: refusalAuditSink
        });
        if (!visibleBatch) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
        if (!body.batchProofDigest) {
          throw new ApiError("VALIDATION_FAILED", "The frozen batch proof digest is required.", {
            reason: "canonical-batch-proof-required"
          });
        }
        if (body.decision === "reject") {
          const item = await rejectCanonicalBatchValueChange(db, auth, {
            ...params, batchProofDigest: body.batchProofDigest,
            draftImpactDigest: body.draftImpactDigest, note: body.note ?? null,
            invocation: createUserInvocation(auth), traceId: request.requestId,
            refusalSink: refusalAuditSink
          });
          return { status: 200, body: { item } };
        }
        if (!pool || !options.objectStore) {
          throw new ApiError("INTERNAL_ERROR", "Canonical batch approval requires the root database and object storage.");
        }
        const batchSnapshot = await loadPublishedCatalog(pool);
        if (!batchSnapshot) throw new ApiError("CONFLICT", "The published catalog snapshot is unavailable.");
        const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => ({
          result: await approveCanonicalBatchValueChange(tx, options.objectStore!, auth, batchSnapshot, {
            projectId: params.projectId, requestId: params.requestId,
            batchProofDigest: body.batchProofDigest!, draftImpactDigest: body.draftImpactDigest,
            note: body.note ?? null,
            invocation: createUserInvocation(auth), traceId: request.requestId,
            refusalSink: refusalAuditSink
          }),
          audit: null
        }));
        return { status: 200, body: { item } };
      }
      // Conceal conflict requests from non-assignees before source storage or Catalog checks.
      await assertSingleRequestReview(db, auth, params.projectId, params.requestId, true);
      let snapshot: Awaited<ReturnType<typeof loadPublishedCatalog>> = null;
      if (body.decision === "approve") {
        if (!pool) {
          throw new ApiError("INTERNAL_ERROR", "Canonical apply requires the root database.");
        }
        if (!options.objectStore) {
          throw new ApiError("INTERNAL_ERROR", "Canonical source approval requires object storage.");
        }
        snapshot = await loadPublishedCatalog(pool);
        if (!snapshot) {
          throw new ApiError("CONFLICT", "The published catalog snapshot is unavailable.");
        }
        const sourcePin = await db.query<{
          format: "dts" | "json";
          config_revision_id: string;
          node_locator: string | null;
          compatible: string | null;
        }>(
          `select pin.format, pin.config_revision_id,
                  coalesce(nullif(node.ref_target,''), node.node_path) as node_locator, logical.compatible
             from project_parameter_value_change_requests change_request
             join parameter_catalog.project_value_source_pins pin
               on pin.id = change_request.source_pin_id
              and pin.organization_id = change_request.organization_id
              and pin.project_id = change_request.project_id
              and pin.binding_id = change_request.binding_id
             left join parameter_catalog.project_parameter_source_occurrences occurrence
               on occurrence.id=pin.source_occurrence_id and occurrence.organization_id=pin.organization_id
              and occurrence.project_id=pin.project_id and occurrence.file_id=pin.file_id
             left join dts_logical_node_revisions logical
               on logical.logical_node_id=occurrence.logical_node_id and logical.config_revision_id=pin.config_revision_id
             left join dts_property_occurrences property
               on property.id = pin.property_occurrence_id
              and property.config_revision_id = pin.config_revision_id
              and property.file_version_id = pin.file_version_id
             left join dts_node_occurrences node
               on node.id = property.node_occurrence_id
              and node.config_revision_id = property.config_revision_id
              and node.file_version_id = property.file_version_id
            where change_request.organization_id = $1
              and change_request.project_id = $2
              and change_request.id = $3
              and pin.id = change_request.source_pin_id
              and pin.project_value_id = change_request.base_current_value_id
              and pin.config_revision_id = change_request.config_revision_id
            limit 1`,
          [auth.organization.id, params.projectId, params.requestId]
        );
        if (sourcePin.rows.length !== 1) {
          throw new ApiError("CONFLICT", "Change request has no exact owned source pin.", { requestId: params.requestId });
        }
        if (sourcePin.rows[0]!.format === "dts") {
          const nodeLocator = sourcePin.rows[0]!.node_locator;
          if (!nodeLocator) {
            throw new ApiError("VALIDATION_FAILED", "Pinned DTS node could not be resolved for a sensitive-node check.", {
              requestId: params.requestId,
              configRevisionId: sourcePin.rows[0]!.config_revision_id
            });
          }
          const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
          if (!refusalAuditSink) {
            throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for typed binding drafts.");
          }
          try {
            await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
              organizationId: auth.organization.id,
              projectId: params.projectId,
              nodePath: nodeLocator,
              compatible: sourcePin.rows[0]?.compatible ?? null,
              compatibleIsAuthoritative: true,
              invocation: createUserInvocation(auth),
              requestId: request.requestId,
              refusalSink: refusalAuditSink
            });
          } catch (error) {
            if (error instanceof ApiError && error.code === "FORBIDDEN") {
              await refusalAuditSink.write({
                invocation: createUserInvocation(auth),
                projectId: params.projectId,
                app: "parameter-management",
                kind: "parameter-source-permission-denied",
                action: "deny",
                severity: "High",
                targetType: "sensitive-node",
                targetId: params.requestId,
                metadata: { code: "parameter-source-permission-denied", operation: "canonical source review", ...error.details },
                traceId: request.requestId
              });
            }
            throw error;
          }
        }
      }
      const item = await withAuditedWrite(
        db,
        auth,
        { requestId: request.requestId },
        async (tx) => {
          const reviewed = await reviewCanonicalValueChange(tx, auth, {
            projectId: params.projectId,
            requestId: params.requestId,
            decision: body.decision,
            note: body.note ?? null
          }, {
            objectStore: options.objectStore,
            snapshot: snapshot ?? undefined,
            invocation: createUserInvocation(auth),
            traceId: request.requestId,
            refusalSink: refusalAuditSink
          });
          if (body.decision === "reject") {
            await writeTrustedGovernanceAudit(
              asAuditTx(tx),
              createUserInvocation(auth),
              {
                action: "value-change-reviewed",
                organizationId: auth.organization.id,
                projectId: params.projectId,
                targetType: "project-parameter-value-change-request",
                targetId: reviewed.id,
                metadata: { requestId: reviewed.id, decision: body.decision, status: reviewed.status }
              },
              request.requestId
            );
          }
          return { result: reviewed, audit: null };
        }
      );
      return { status: 200, body: { item } };
    }
  );

  router.post(
    "/api/v2/projects/:projectId/parameter-value-change-requests/:requestId/withdraw",
    async (request) => {
      const db = requireDb(options.db);
      const auth = await options.getCurrentAuthContext(request);
      const params = parseWithSchema(
        z.object({ projectId: z.string().min(1), requestId: z.string().min(1) }),
        request.params
      );
      const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
      if (!refusalAuditSink) {
        throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for canonical value withdrawal.");
      }
      const requestKind = (await db.query<{ request_kind: string }>(`
        select request_kind from public.project_parameter_value_change_requests
         where id=$1 and organization_id=$2 and project_id=$3`,
        [params.requestId, auth.organization.id, params.projectId])).rows[0]?.request_kind;
      if (requestKind === "member-removal") {
        const item = await withdrawCanonicalMemberRemoval(db, auth, {
          ...params, invocation: createUserInvocation(auth), traceId: request.requestId,
          refusalSink: refusalAuditSink
        });
        return { status: 200, body: { item } };
      }
      if (requestKind === "batch") {
        const item = await withdrawCanonicalBatchValueChange(db, auth, {
          ...params, invocation: createUserInvocation(auth), traceId: request.requestId,
          refusalSink: refusalAuditSink
        });
        return { status: 200, body: { item } };
      }
      const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
        const withdrawn = await withdrawCanonicalValueChange(tx, auth, {
          projectId: params.projectId,
          requestId: params.requestId,
          invocation: createUserInvocation(auth),
          refusalSink: refusalAuditSink,
          traceId: request.requestId
        });
        await writeTrustedGovernanceAudit(
          asAuditTx(tx),
          createUserInvocation(auth),
          {
            action: "value-change-withdrawn",
            organizationId: auth.organization.id,
            projectId: params.projectId,
            targetType: "project-parameter-value-change-request",
            targetId: withdrawn.id,
            metadata: { requestId: withdrawn.id, draftId: withdrawn.draftId }
          },
          request.requestId
        );
        return { result: withdrawn, audit: null };
      });
      return { status: 200, body: { item } };
    }
  );
}
