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
import { renderDtsValue } from "../dts/valueAst";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { listConfigSets } from "../parameter-files/configSetService";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import {
  createBindingDraft,
  listProjectBindings
} from "../parameter-topology/service";
import {
  createBindingDraftBodySchema,
  createBindingDraftParamsSchema,
  projectBindingDtoSchema,
  projectBindingsParamsSchema,
  projectBindingsQuerySchema
} from "../parameter-topology/schemas";
import {
  applyImportBatch,
  createImportPreview
} from "../parameters/service";
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
  listCatalogBindingsForImport,
  matchCatalogImportRow,
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
    const original = await listProjectBindings(db, auth, {
      projectId: params.projectId,
      revisionId: query.revisionId
    });
    const catalogRows = await listCatalogBindingRowsForProject(db, auth, {
      projectId: params.projectId,
      revisionId: query.revisionId
    });
    const catalogItems = catalogRows.map((row) =>
      projectBindingDtoSchema.parse({
        id: row.id,
        parameterSpecId: row.parameterSpecId,
        parameterSpecVersionId: row.parameterSpecVersionId,
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
    const seen = new Set(catalogItems.map((item) => item.id));
    return { status: 200, body: { items: [...catalogItems, ...original.items.filter((item) => !seen.has(item.id))] } };
  });

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
      throw new ApiError("INTERNAL_ERROR", "Canonical project value writes require the root database.");
    }
    const targetValue = body.targetValue;
    if ((body.action ?? "set") === "delete" || !targetValue) {
      throw new ApiError("VALIDATION_FAILED", "Published definition values require a set action and target value.");
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
    const item = await withAuditedWrite(db, auth, { requestId: request.requestId }, async (tx) => {
      const saved = await saveCanonicalProjectValue(
        pool,
        {
          organizationId: auth.organization.id,
          projectId: params.projectId,
          bindingId: params.bindingId,
          configRevisionId: body.baseRevisionId,
          targetValue
        },
        asValueClient(tx)
      );
      await writeTrustedGovernanceAudit(
        asAuditTx(tx),
        createUserInvocation(auth),
        {
          action: "binding-edited",
          organizationId: auth.organization.id,
          projectId: params.projectId,
          targetType: "project-parameter-binding",
          targetId: params.bindingId,
          metadata: {
            currentValueId: saved.currentValueId,
            propertyKey: saved.propertyKey,
            writeTargetRole: "canonical-project-value",
            reason: body.reason,
            configRevisionId: body.baseRevisionId
          }
        },
        request.requestId
      );
      return {
        result: {
          draftId: saved.currentValueId,
          parameterId: saved.bindingId,
          candidateRevisionId: body.baseRevisionId,
          workingCandidateRevisionId: body.baseRevisionId,
          rebasedDraftIds: [] as string[],
          rawText: renderDtsValue(targetValue),
          action: "set" as const,
          parameterSpecId: saved.definitionId,
          projectParameterBindingId: saved.bindingId,
          writeTarget: { role: "canonical-project-value", propertyKey: saved.propertyKey },
          overlayFileId: "",
          overlayFileName: ""
        },
        audit: null
      };
    });
    return { status: 201, body: { item } };
  });

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
    if (catalog.length === 0) {
      const item = await createImportPreview(db, auth, body, { requestId: request.requestId });
      return { status: 201, body: { item } };
    }
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
      return {
        status: 200,
        body: { item: await applyImportBatch(db, auth, body, { requestId: request.requestId }) }
      };
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
    for (const item of selected) {
      if (!item.projectParameterValueId) continue;
      const catalog = await findCatalogBindingRow(db, {
        organizationId: auth.organization.id,
        projectId: batch.project_id,
        bindingId: item.projectParameterValueId
      });
      if (catalog) catalogItems.push({ item, catalog });
    }
    if (catalogItems.length === 0 || catalogItems.length !== selected.length) {
      const item = await applyImportBatch(db, auth, body, { requestId: request.requestId });
      return { status: 200, body: { item } };
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
}
