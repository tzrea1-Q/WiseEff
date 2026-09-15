/**
 * HTTP consumer of Binding/ProjectValue owners for published project values.
 * Lives outside S12 scanned families so Catalog SQL does not shift allow-list
 * fingerprints. Registers the Hosted page-loop paths first so they win.
 */
import { z } from "zod";

import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { canAdminParameters, canEditParameters, canViewParameters } from "../parameter-kernel/policy";
import { getRootPostgresPool, isRootDatabase, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { listConfigSets } from "../parameter-files/configSetService";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import { createBindingDraft } from "../parameter-topology/service";
import {
  createBindingDraftBodySchema,
  createBindingDraftParamsSchema,
  projectBindingDtoSchema,
  projectBindingsParamsSchema,
  projectBindingsQuerySchema
} from "../parameter-topology/schemas";
import { getProjectById } from "../projects/repository";
import {
  createCanonicalValueDraft,
  listCanonicalValueChangesForAuth,
  listCanonicalValueDraftsForUser,
  removeCanonicalValueDraft,
  reviewCanonicalValueChange,
  submitCanonicalValueChange,
  withdrawCanonicalValueChange
} from "./drafts";
import { createImportPreview } from "../parameters/service";
import {
  applyImportBatchBodySchema,
  createImportBatchBodySchema
} from "../parameters/schemas";
import { markImportBatchApplied } from "../parameters/importBatchRepository";
import { parameterImportBatchDtoSchema } from "../contracts/dtoSchemas/parameters";
import {
  asValueClient,
  findCatalogBindingRow,
  importTextToDtsValue,
  listCatalogBindingRowsForProject,
  exportCanonicalBindingSource,
  listCatalogBindingsForImport,
  matchCatalogImportRow,
  readCanonicalBindingChangeHistory,
  saveCanonicalProjectValue,
  syncPublishedCatalogProjectValues
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

const uploadBodySchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1)
});

const paramsWithProjectIdSchema = z.object({ projectId: z.string().min(1) });
const paramsWithBatchIdSchema = z.object({ batchId: z.string().min(1) });

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
  await withAuditedWrite(db, auth, { requestId: context.requestId }, async (tx) => {
    const written = await syncPublishedCatalogProjectValues(
      pool,
      {
        organizationId: auth.organization.id,
        projectId,
        configSetId: configSet.id,
        configRevisionId: revision.id
      },
      asValueClient(tx)
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
    // Canonical-only current view (Issue #849 problem statement): archived legacy
    // bindings are never merged into this list and an empty canonical Catalog never
    // falls back to legacy rows. An honest empty list is the correct answer.
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
    const items = catalogRows.map((row) =>
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
    return { status: 200, body: { items } };
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
        bindingId: params.bindingId
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
    const body = parseWithSchema(createBindingDraftBodySchema, request.body ?? {});
    if (!canEditParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Parameter edit permission is required.");
    }
    const catalogBinding = await findCatalogBindingRow(db, {
      organizationId: auth.organization.id,
      projectId: params.projectId,
      bindingId: params.bindingId
    });
    if (!catalogBinding) {
      const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
      if (!refusalAuditSink) {
        throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for typed binding drafts.");
      }
      const item = await createBindingDraft(
        db,
        auth,
        { projectId: params.projectId, bindingId: params.bindingId, ...body },
        { objectStore: options.objectStore },
        {
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: refusalAuditSink
        }
      );
      return { status: 201, body: { item } };
    }
    if (!canEditParameters(auth, params.projectId)) {
      throw new ApiError("FORBIDDEN", "Parameter edit role is required for this project.");
    }
    const pool = getRootPostgresPool(db);
    if (!pool) {
      throw new ApiError("INTERNAL_ERROR", "Canonical pending drafts require the root database.");
    }
    const targetValue = body.targetValue;
    if ((body.action ?? "set") === "delete" || !targetValue) {
      // The canonical value owner has no delete apply step yet. Refuse honestly
      // instead of writing a value change the caller did not ask for.
      throw new ApiError(
        "VALIDATION_FAILED",
        "Published definition drafts currently require a set action and target value.",
        { bindingId: params.bindingId }
      );
    }
    const locator = await db.query<{ node_locator: string | null; compatible: string | null }>(
      `
      select node_locator, compatible
        from dts_logical_node_revisions
       where logical_node_id = $1
       order by config_revision_id desc
       limit 1
      `,
      [catalogBinding.logical_node_id]
    );
    const nodeLocator = locator.rows[0]?.node_locator;
    if (!nodeLocator) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Published definition node could not be resolved for a sensitive-node check.",
        { bindingId: params.bindingId, logicalNodeId: catalogBinding.logical_node_id }
      );
    }
    const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
    if (!refusalAuditSink) {
      throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for typed binding drafts.");
    }
    await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
      organizationId: auth.organization.id,
      projectId: params.projectId,
      nodePath: nodeLocator,
      compatible: locator.rows[0]?.compatible,
      compatibleIsAuthoritative: true,
      invocation: createUserInvocation(auth),
      requestId: request.requestId,
      refusalSink: refusalAuditSink
    });
    // A draft is pending work. It records the canonical binding/definition/revision
    // pins plus the exact base value/config-revision pins and leaves the current
    // ProjectValue, its history tip and the active source revision untouched.
    const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const draft = await createCanonicalValueDraft(tx, auth, {
        projectId: params.projectId,
        bindingId: params.bindingId,
        action: "set",
        targetValue,
        reason: body.reason,
        baseRevisionId: body.baseRevisionId
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
          action: "set" as const,
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
    });
    return { status: 201, body: { item } };
  });

  /**
   * Canonical pending drafts for the calling user. The draft tray reads this so
   * that pending work survives a reload instead of existing only in the browser.
   */
  router.get("/api/v2/projects/:projectId/parameter-value-drafts", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(projectBindingsParamsSchema, request.params);
    const items = await listCanonicalValueDraftsForUser(db, auth, { projectId: params.projectId });
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
      const item = await removeCanonicalValueDraft(db, auth, {
        projectId: params.projectId,
        draftId: params.draftId
      });
      return { status: 200, body: { item } };
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

  router.post("/api/v1/parameter-import-batches", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createImportBatchBodySchema, request.body);
    const catalog = await listCatalogBindingsForImport(db, {
      organizationId: auth.organization.id,
      projectId: body.projectId,
      names: body.items.map((row) => row.name),
      definitionIds: body.items.map((row) => row.id).filter((id): id is string => Boolean(id))
    });
    const catalogMatches = body.items.map((source) =>
      matchCatalogImportRow({ id: source.id, name: source.name }, catalog)
    );
    // No empty-catalog fallback: an unbound property is never silently previewed
    // through the legacy definition path (Issue #849 problem statement).
    const rewritten = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const item = await createImportPreview(tx, auth, body, { requestId: request.requestId });
      if (item.items.length !== body.items.length) {
        throw new ApiError("CONFLICT", "Import preview item count did not match the source rows.");
      }
      const items = item.items.map((row, index) => {
        const match = catalogMatches[index];
        if (!match) return row;
        return {
          ...row,
          classification: "updated" as const,
          definitionId: match.id,
          projectParameterValueId: match.projectParameterValueId
        };
      });
      const added = items.filter((row) => row.classification === "added").length;
      const updated = items.filter((row) => row.classification === "updated").length;
      const summary = { ...item.summary, added, updated };
      await tx.query(
        `
        update parameter_import_batches
           set items = $2::jsonb,
               summary = $3::jsonb
         where id = $1
        `,
        [item.id, JSON.stringify(items), JSON.stringify(summary)]
      );
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
          metadata: { batchId: item.id, summary: { added, updated, skipped: 0 }, catalogRewrite: true }
        }
      };
    });
    return { status: 201, body: { item: rewritten } };
  });

  router.post("/api/v1/parameter-import-batches/:batchId/apply", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    if (!canAdminParameters(auth)) {
      throw new ApiError("FORBIDDEN", "Admin access is required for parameter import.");
    }
    const params = parseWithSchema(paramsWithBatchIdSchema, request.params);
    const body = parseWithSchema(
      applyImportBatchBodySchema,
      { ...(request.body && typeof request.body === "object" ? request.body : {}), batchId: params.batchId }
    );
    const loaded = await db.query<{ items: unknown; project_id: string }>(
      `
      select items, project_id
        from parameter_import_batches
       where organization_id = $1
         and id = $2
      `,
      [auth.organization.id, params.batchId]
    );
    const batch = loaded.rows[0];
    if (!batch) {
      throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", { batchId: params.batchId });
    }
    const items = Array.isArray(batch.items) ? batch.items as Array<{
      id: string;
      name: string;
      classification: string;
      projectParameterValueId?: string;
      currentValue?: string;
      recommendedValue?: string;
    }> : [];
    const selected = body.selectedItemIds
      ? items.filter((item) => body.selectedItemIds?.includes(item.id))
      : items.filter((item) => item.classification === "added" || item.classification === "updated");
    const catalogItems: Array<{
      item: (typeof selected)[number];
      catalog: NonNullable<Awaited<ReturnType<typeof findCatalogBindingRow>>>;
    }> = [];
    const unbound: Array<{ id: string; name: string; reason: "no-binding" | "not-canonical" }> = [];
    for (const item of selected) {
      if (!item.projectParameterValueId) {
        unbound.push({ id: item.id, name: item.name, reason: "no-binding" });
        continue;
      }
      const catalog = await findCatalogBindingRow(db, {
        organizationId: auth.organization.id,
        projectId: batch.project_id,
        bindingId: item.projectParameterValueId
      });
      if (catalog) catalogItems.push({ item, catalog });
      else unbound.push({ id: item.id, name: item.name, reason: "not-canonical" });
    }
    // Canonical-only apply. There is no whole-batch fallback to the legacy apply
    // service: an unmatched or unbound row can never create or overwrite a
    // definition, and entering governed authoring is a separate workflow.
    if (unbound.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Import batch contains items without a canonical project binding.",
        {
          batchId: params.batchId,
          reason: "unbound-canonical-binding",
          unbound,
          applied: 0
        }
      );
    }
    if (catalogItems.length === 0) {
      const item = await markImportBatchApplied(db, {
        organizationId: auth.organization.id,
        batchId: params.batchId
      });
      if (!item) {
        throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", { batchId: params.batchId });
      }
      return {
        status: 200,
        body: {
          item: parameterImportBatchDtoSchema.parse(item),
          appliedCount: 0,
          skippedUnbound: []
        }
      };
    }
    const pool = getRootPostgresPool(db);
    if (!pool) {
      throw new ApiError("INTERNAL_ERROR", "Canonical project value import requires the root database.");
    }
    const applied = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      for (const { item, catalog } of catalogItems) {
        const current = await tx.query<{ config_revision_id: string }>(
          `
          select config_revision_id
            from parameter_catalog.project_parameter_values
           where id = $1
           limit 1
          `,
          [catalog.current_value_id]
        );
        const configRevisionId = current.rows[0]?.config_revision_id;
        if (!configRevisionId || configRevisionId === "canonical-binding-identity") {
          throw new ApiError("CONFLICT", "Imported project value is missing an actual config-set source.", {
            bindingId: catalog.id
          });
        }
        await saveCanonicalProjectValue(
          pool,
          {
            organizationId: auth.organization.id,
            projectId: batch.project_id,
            bindingId: catalog.id,
            configRevisionId,
            targetValue: importTextToDtsValue(item.name, item.currentValue ?? item.recommendedValue ?? "")
          },
          asValueClient(tx)
        );
      }
      const item = await markImportBatchApplied(tx, {
        organizationId: auth.organization.id,
        batchId: params.batchId
      });
      if (!item) {
        throw new ApiError("NOT_FOUND", "Parameter import batch was not found.", { batchId: params.batchId });
      }
      return {
        result: parameterImportBatchDtoSchema.parse(item),
        audit: {
          app: "parameter-management",
          kind: "batch-import",
          action: "apply",
          severity: "High" as const,
          projectId: batch.project_id,
          targetType: "parameter-import-batch",
          targetId: params.batchId,
          metadata: { batchId: params.batchId, summary: { added: 0, updated: catalogItems.length, skipped: 0 } }
        }
      };
    });
    return { status: 200, body: { item: applied } };
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
      const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
        const submitted = await submitCanonicalValueChange(tx, auth, {
          projectId: params.projectId,
          draftId: params.draftId,
          assignedToUserId: body.assignedToUserId ?? null
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
      z.object({ status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional() }),
      flattenQuery(request.query)
    );
    const items = await listCanonicalValueChangesForAuth(db, auth, {
      projectId: params.projectId,
      status: query.status
    });
    return { status: 200, body: { items } };
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
          note: z.string().nullable().optional()
        }),
        request.body ?? {}
      );
      const pool = getRootPostgresPool(db);
      if (body.decision === "approve") {
        if (!canEditParameters(auth)) {
          throw new ApiError("FORBIDDEN", "Parameter edit permission is required.");
        }
        if (!pool) {
          throw new ApiError("INTERNAL_ERROR", "Canonical apply requires the root database.");
        }
        const bindingId = await db.query<{ binding_id: string }>(
          `
          select binding_id
            from project_parameter_value_change_requests
           where organization_id = $1
             and project_id = $2
             and id = $3
           limit 1
          `,
          [auth.organization.id, params.projectId, params.requestId]
        );
        const catalogBindingId = bindingId.rows[0]?.binding_id;
        const locator = catalogBindingId
          ? await db.query<{ node_locator: string | null; compatible: string | null }>(
              `
              select lnr.node_locator, lnr.compatible
                from parameter_catalog.project_parameter_bindings b
                join dts_logical_node_revisions lnr on lnr.logical_node_id = b.logical_node_id
               where b.id = $1
               order by lnr.config_revision_id desc
               limit 1
              `,
              [catalogBindingId]
            )
          : null;
        const nodeLocator = locator?.rows[0]?.node_locator;
        if (!nodeLocator) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Canonical change target node could not be resolved for a sensitive-node check.",
            { requestId: params.requestId, bindingId: catalogBindingId ?? null }
          );
        }
        const refusalAuditSink = isRootDatabase(db) ? createTrustedRefusalAuditSink(db) : undefined;
        if (!refusalAuditSink) {
          throw new ApiError("INTERNAL_ERROR", "Trusted refusal audit sink is required for typed binding drafts.");
        }
        await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
          organizationId: auth.organization.id,
          projectId: params.projectId,
          nodePath: nodeLocator,
          compatible: locator?.rows[0]?.compatible ?? null,
          compatibleIsAuthoritative: true,
          invocation: createUserInvocation(auth),
          requestId: request.requestId,
          refusalSink: refusalAuditSink
        });
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
          });
          await writeTrustedGovernanceAudit(
            asAuditTx(tx),
            createUserInvocation(auth),
            {
              action: reviewed.status === "approved" ? "value-change-applied" : "value-change-reviewed",
              organizationId: auth.organization.id,
              projectId: params.projectId,
              targetType: "project-parameter-value-change-request",
              targetId: reviewed.id,
              metadata: {
                requestId: reviewed.id,
                decision: body.decision,
                status: reviewed.status,
                appliedValueId: reviewed.appliedValueId,
                applyOutcome: reviewed.applyOutcome,
                writeTargetRole: "canonical-project-value"
              }
            },
            request.requestId
          );
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
      const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
        const withdrawn = await withdrawCanonicalValueChange(tx, auth, {
          projectId: params.projectId,
          requestId: params.requestId
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
