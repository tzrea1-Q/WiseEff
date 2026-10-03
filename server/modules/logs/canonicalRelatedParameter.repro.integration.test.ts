import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createUserInvocation } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";
import { readProjectProtectedParameters } from "../parameter-bindings/adapters";
import { resolveAuthorizedRelatedParameter } from "./relatedParameter";
import type { RelatedParameterRunSnapshot } from "./relatedParameter";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createWorkerLogAnalysisToolBackends } from "./analyzer/tools/workerToolBackends";
import { createLocalObjectStore } from "./objectStore";
import { getLogWorkerRunSnapshot, listLogs } from "./repository";
import { buildLogResultWebhookPayload } from "./webhookDelivery";
import { processLogAnalysisJobById } from "./worker";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { appendSourceCommittedValue } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedCanonicalParameterFixture } from "../agent/testing/canonicalParameterFixture";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";

describe("project-scoped canonical related-parameter analysis", () => {
  let disposable: ParameterCatalogDatabase | undefined;
  let db: RootDatabase | undefined;
  let apiDb: RootDatabase | undefined;
  let workerDb: RootDatabase | undefined;
  let workerToken: string | undefined;
  let objectRoot: string | undefined;

  afterAll(async () => {
    await workerDb?.close();
    await apiDb?.close();
    if (workerToken && disposable) {
      expect((await dropLabRuntimeLogins(disposable.url, workerToken)).failed).toEqual([]);
    }
    await db?.close();
    await disposable?.close();
    if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
  });

  it("freezes the authorized pin per run, feeds it to the worker, and hides reports outside project scope", async () => {
    disposable = await createDisposableParameterCatalogDatabase("log904");
    db = createPostgresDatabase(disposable.url);
    const pool = getRootPostgresPool(db);
    if (!pool) throw new Error("Expected a root PostgreSQL pool for the disposable catalog database.");

    objectRoot = await mkdtemp(path.join(os.tmpdir(), "wiseeff-logs904-"));
    const localObjectStore = createLocalObjectStore(objectRoot);
    let objectStorePutCalls = 0;
    const objectStore = {
      ...localObjectStore,
      async put(input: Parameters<typeof localObjectStore.put>[0]) {
        objectStorePutCalls += 1;
        return localObjectStore.put(input);
      }
    };
    const fixture = await seedCanonicalParameterFixture(db, objectStore);

    const authorizedAuth = await getAuthContext(db, fixture.editorAuth.user.id);
    const readable = await readProjectProtectedParameters(pool, {
      invocation: createUserInvocation(authorizedAuth),
      projectId: fixture.projectId
    });
    const protectedPin = readable.find((item) => item.pin.bindingId === fixture.bindingId)?.pin;
    expect(protectedPin).toMatchObject({
      kind: "canonical-pin",
      bindingId: fixture.bindingId,
      organizationId: fixture.organizationId,
      projectId: fixture.projectId,
      definitionId: fixture.definitionId,
      definitionRevisionId: fixture.definitionRevisionId,
      currentValueId: fixture.currentValueId,
      source: { sourceRef: fixture.sourceRef, configRevisionId: fixture.configRevisionId },
      valueDigest: expect.any(String),
      catalogRelease: { id: fixture.catalogReleaseId, digest: expect.any(String) }
    });

    workerToken = `log904${randomBytes(5).toString("hex")}`;
    const workerRuntime = await provisionPublicationRuntimeLogins(disposable.url, {
      mode: "lab",
      runToken: workerToken
    });
    apiDb = createPostgresDatabase(workerRuntime.apiUrl);
    const apiPool = getRootPostgresPool(apiDb);
    if (!apiPool) throw new Error("Expected a PostgreSQL pool for the provisioned API LOGIN.");
    const apiIdentity = await apiPool.query<{
      sessionUser: string;
      currentUser: string;
      superuser: boolean;
      catalogSchemaUsage: boolean;
    }>(
      `select session_user as "sessionUser", current_user as "currentUser",
              role.rolsuper as superuser,
              has_schema_privilege(current_user, 'parameter_catalog', 'USAGE') as "catalogSchemaUsage"
         from pg_roles role
        where role.rolname = current_user`
    );
    expect(apiIdentity.rows[0]).toEqual({
      sessionUser: workerRuntime.apiRole,
      currentUser: workerRuntime.apiRole,
      superuser: false,
      catalogSchemaUsage: true
    });
    const resolved = await resolveAuthorizedRelatedParameter(apiPool, {
      invocation: createUserInvocation(authorizedAuth),
      projectId: fixture.projectId,
      bindingId: fixture.bindingId,
      definitionId: fixture.definitionId,
      definitionRevisionId: fixture.definitionRevisionId
    });
    expect(resolved.pin).toMatchObject({
      bindingId: fixture.bindingId,
      projectId: fixture.projectId,
      currentValueId: fixture.currentValueId,
      definitionId: fixture.definitionId,
      definitionRevisionId: fixture.definitionRevisionId,
      catalogRelease: { id: fixture.catalogReleaseId },
      valueDigest: expect.any(String)
    });
    expect(resolved.revision).toMatchObject({ id: fixture.definitionRevisionId, definitionId: fixture.definitionId });
    expect(resolved.sourcePin).toMatchObject({
      sourcePinId: fixture.sourcePinId,
      projectValueId: fixture.currentValueId,
      fileVersionId: fixture.sourceFileVersionId,
      configRevisionId: fixture.configRevisionId
    });
    await expect(resolveAuthorizedRelatedParameter(apiPool, {
      invocation: createUserInvocation(authorizedAuth),
      projectId: fixture.projectId,
      bindingId: "legacy-related-parameter-id"
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolveAuthorizedRelatedParameter(apiPool, {
      invocation: createUserInvocation(authorizedAuth),
      projectId: fixture.projectId,
      bindingId: fixture.bindingId,
      definitionRevisionId: "stale-revision"
    })).rejects.toMatchObject({ code: "CONFLICT" });
    workerDb = createPostgresDatabase(workerRuntime.workerUrl);
    const workerPool = getRootPostgresPool(workerDb);
    if (!workerPool) throw new Error("Expected a PostgreSQL pool for the provisioned worker LOGIN.");
    const workerIdentity = await workerPool.query<{
      sessionUser: string;
      currentUser: string;
      superuser: boolean;
      catalogSchemaUsage: boolean;
    }>(
      `select session_user as "sessionUser", current_user as "currentUser",
              role.rolsuper as superuser,
              has_schema_privilege(current_user, 'parameter_catalog', 'USAGE') as "catalogSchemaUsage"
         from pg_roles role
        where role.rolname = current_user`
    );
    expect(workerIdentity.rows[0]).toEqual({
      sessionUser: workerRuntime.workerRole,
      currentUser: workerRuntime.workerRole,
      superuser: false,
      catalogSchemaUsage: false
    });
    let workerReadError: unknown;
    try {
      await readProjectProtectedParameters(workerPool, {
        invocation: createUserInvocation(authorizedAuth),
        projectId: fixture.projectId
      });
    } catch (error) {
      workerReadError = error;
    }
    expect(workerReadError).toMatchObject({
      code: "42501",
      message: expect.stringContaining("parameter_catalog")
    });

    const router = createRouter();
    let requestAuth = authorizedAuth;
    const logDomainId = "log904-parameter-domain";
    await db.query("insert into log_domains (id, organization_id, name) values ($1, $2, $3)", [
      logDomainId,
      fixture.organizationId,
      "Issue 904 parameter domain"
    ]);
    registerLogRoutes(router, {
      db: apiDb,
      objectStore,
      getCurrentAuthContext: () => requestAuth
    });
    const putsBeforeLogUpload = objectStorePutCalls;
    requestAuth = await getAuthContext(db, fixture.otherAuth.user.id);
    const crossOrganizationUpload = await requestJson(createHttpServer(router), "/api/v1/log-files", {
      method: "POST",
      body: JSON.stringify({
        fileName: "other-organization.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("INFO no access\n").toString("base64"),
        relatedParameterPin: { kind: "canonical-pin", projectId: fixture.projectId, bindingId: fixture.bindingId }
      })
    });
    expect(crossOrganizationUpload.status).toBe(404);
    requestAuth = authorizedAuth;
    expect(objectStorePutCalls).toBe(putsBeforeLogUpload);
    const uploaded = await router.handle({
      method: "POST",
      path: "/api/v1/log-files",
      params: {},
      query: {},
      headers: {},
      requestId: "log904-canonical-route-repro",
      body: {
        fileName: "canonical-association.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("2026-09-29T12:00:00Z INFO device ready\n").toString("base64"),
        logDomainId,
        relatedParameterPin: {
          kind: "canonical-pin",
          projectId: fixture.projectId,
          bindingId: fixture.bindingId,
          definitionId: fixture.definitionId,
          definitionRevisionId: fixture.definitionRevisionId
        }
      }
    });
    expect(uploaded.status).toBe(201);
    if (!("body" in uploaded)) throw new Error("Expected JSON upload response.");
    const uploadBody = uploaded.body as {
      fileObject: { id: string };
      log: { id: string; relatedParameterId?: string; relatedParameterProjectId?: string };
      job: { id: string };
    };
    expect(uploadBody.log.relatedParameterId).toBe(fixture.bindingId);
    expect(uploadBody.log.relatedParameterProjectId).toBe(fixture.projectId);
    expect(objectStorePutCalls).toBe(putsBeforeLogUpload + 1);

    const rawIdUpload = await requestJson(createHttpServer(router), "/api/v1/log-files", {
      method: "POST",
      body: JSON.stringify({
        fileName: "raw-id.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("INFO no association\n").toString("base64"),
        relatedParameterId: fixture.bindingId
      })
    });
    expect(rawIdUpload.status).toBe(400);
    expect(objectStorePutCalls).toBe(putsBeforeLogUpload + 1);

    const frozenRun = await getLogWorkerRunSnapshot(workerDb, uploadBody.job.id);
    expect(frozenRun).toMatchObject({
      relatedParameterId: fixture.bindingId,
      relatedParameterProjectId: fixture.projectId,
      relatedParameterSnapshot: {
        schemaVersion: 1,
        pin: {
          bindingId: fixture.bindingId,
          projectId: fixture.projectId,
          currentValueId: fixture.currentValueId,
          definitionRevisionId: fixture.definitionRevisionId,
          catalogRelease: { id: fixture.catalogReleaseId }
        },
        sourcePin: {
          sourcePinId: fixture.sourcePinId,
          fileVersionId: fixture.sourceFileVersionId
        }
      }
    });
    if (!frozenRun) throw new Error("Expected the worker LOGIN to read the frozen run snapshot.");
    const firstRunSnapshot = frozenRun.relatedParameterSnapshot as RelatedParameterRunSnapshot;
    await expect(
      workerPool.query("update log_analysis_runs set related_parameter_snapshot = '{}'::jsonb where id = $1", [frozenRun.runId])
    ).rejects.toThrow(/immutable/);

    const model = createScriptedLogAnalysisModel([
      { content: { action: "tool", tool: "get_related_parameter_context", args: {} } },
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } } },
      {
        content: {
          action: "final",
          conclusion: "The canonical related parameter context was requested.",
          impact: "The conclusion uses the run-frozen canonical parameter value.",
          severity: "Info",
          confidence: 0.5,
          suggestedActions: ["Review the value against the device configuration."],
          evidence: [{ lineNumbers: [1], inference: "The worker read the uploaded line.", suggestedAction: "None." }]
        }
      }
    ]);
    const analyzer = createAgentLoopLogAnalyzer({
      model,
      modelLabel: "log904-scripted-reproduction",
      tokenBudget: 100_000,
      maxSteps: 4,
      bindToolBackends: (input) =>
        createWorkerLogAnalysisToolBackends({
          db: workerDb!,
          organizationId: input.organizationId ?? fixture.organizationId,
          relatedParameterId: input.relatedParameterId,
          relatedParameterSnapshot: input.relatedParameterSnapshot
        })
    });
    const webhooks = { notifyAnalysisTerminal: vi.fn() };

    await expect(
      processLogAnalysisJobById({
        db: workerDb,
        objectStore,
        jobId: uploadBody.job.id,
        analyzer,
        workerId: "log904-repro-worker",
        webhooks
      })
    ).resolves.toMatchObject({ status: "processed" });

    const mission = model.calls[0]?.find((message) => message.role === "user")?.content;
    expect(mission).toContain(fixture.bindingId);
    expect(mission).toContain(fixture.definitionRevisionId);
    expect(mission).toContain(fixture.sourceFileVersionId);
    const relatedToolResult = model.calls[1]?.find(
      (message) => message.role === "user" && message.content.startsWith("Tool result for get_related_parameter_context:")
    );
    expect(relatedToolResult?.content).toContain('"available":true');
    expect(relatedToolResult?.content).toContain(fixture.bindingId);
    expect(relatedToolResult?.content).toContain(fixture.sourceFileVersionId);

    expect(webhooks.notifyAnalysisTerminal).toHaveBeenCalledOnce();
    const webhookInput = webhooks.notifyAnalysisTerminal.mock.calls[0]?.[0];
    expect(webhookInput?.conclusion).toBeUndefined();
    const webhookPayload = buildLogResultWebhookPayload(webhookInput!);
    expect(webhookPayload.conclusionSummary).toBeUndefined();
    const notification = await db.query<{ body: string }>(
      `select body from user_notifications where organization_id = $1 and source_id = $2
       and category = 'log.analysis.completed' limit 1`,
      [fixture.organizationId, frozenRun.runId]
    );
    expect(notification.rows[0]?.body).toBe("分析报告已生成，可在日志分析页查看。");
    expect(notification.rows[0]?.body).not.toContain(JSON.stringify(resolved.pin.payload.value));

    const authorizedDetail = await requestJson<{
      item: { status: string; conclusion: string; analysisSource?: string; relatedParameterProjectId?: string };
    }>(createHttpServer(router), `/api/v1/logs/${uploadBody.log.id}`);
    expect(authorizedDetail.status).toBe(200);
    expect(authorizedDetail.body.item).toMatchObject({
      status: "complete",
      conclusion: "The canonical related parameter context was requested.",
      analysisSource: "agent",
      relatedParameterProjectId: fixture.projectId
    });
    const feedbackWrite = await requestJson(createHttpServer(router), `/api/v1/logs/${uploadBody.log.id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating: "helpful" })
    });
    expect(feedbackWrite.status).toBe(200);

    const oldReportBeforeRerun = await db.query<{
      id: string;
      conclusion: string;
      impact: string;
      severity: string;
      confidence: string | number;
      suggested_actions: unknown;
      raw_lines: unknown;
    }>(
      `select id, conclusion, impact, severity, confidence, suggested_actions, raw_lines
         from log_analysis_reports where organization_id = $1 and run_id = $2`,
      [fixture.organizationId, frozenRun.runId]
    );
    expect(oldReportBeforeRerun.rows).toHaveLength(1);

    if (resolved.pin.payload.kind !== "number") throw new Error("Expected the fixture Binding to contain a number value.");
    const nextValue = resolved.pin.payload.value + 1;
    const catalogSnapshot = await loadPublishedCatalog(pool);
    if (!catalogSnapshot) throw new Error("Expected the fixture Catalog release to remain available.");
    const advanced = await appendSourceCommittedValue(pool, {
      snapshot: catalogSnapshot,
      binding: fixture.binding,
      definitionRevisionId: fixture.definitionRevisionId,
      source: resolved.pin.source,
      payload: { kind: "number", value: nextValue },
      expectedTip: fixture.currentValueId
    });
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) throw new Error("Expected the canonical fixture source writer to advance the current value.");
    expect(advanced.value.outcome).toBe("committed");

    const currentParameter = await resolveAuthorizedRelatedParameter(apiPool, {
      invocation: createUserInvocation(authorizedAuth),
      projectId: fixture.projectId,
      bindingId: fixture.bindingId
    });
    expect(currentParameter.pin.currentValueId).toBe(advanced.value.value.id);
    expect(currentParameter.pin.currentValueId).not.toBe(firstRunSnapshot.pin.currentValueId);

    // Rerun is an explicit fresh analysis: resolve the then-current pin and freeze it in a new run.
    await db.query("update user_role_bindings set role_id = 'admin', project_id = null where id = $1", ["urb-905-editor"]);
    requestAuth = await getAuthContext(db, fixture.editorAuth.user.id);
    const rerun = await requestJson<{
      job: { id: string; runId: string };
    }>(createHttpServer(router), `/api/v1/logs/${uploadBody.log.id}/rerun`, {
      method: "POST",
      body: "{}"
    });
    expect(rerun.status).toBe(200);
    expect(rerun.body.job.runId).not.toBe(frozenRun.runId);
    const rerunSnapshot = await getLogWorkerRunSnapshot(workerDb, rerun.body.job.id);
    expect(rerunSnapshot).toMatchObject({
      relatedParameterId: fixture.bindingId,
      relatedParameterProjectId: fixture.projectId,
      relatedParameterSnapshot: {
        pin: {
          bindingId: fixture.bindingId,
          projectId: fixture.projectId,
          currentValueId: advanced.value.value.id,
          valueDigest: currentParameter.pin.valueDigest,
          definitionRevisionId: currentParameter.pin.definitionRevisionId,
          catalogRelease: currentParameter.pin.catalogRelease
        },
        revision: currentParameter.revision,
        sourcePin: {
          sourcePinId: currentParameter.sourcePin.sourcePinId,
          fileVersionId: currentParameter.sourcePin.fileVersionId
        }
      }
    });
    expect(rerunSnapshot?.relatedParameterSnapshot).not.toEqual(firstRunSnapshot);

    const rerunModel = createScriptedLogAnalysisModel([
      { content: { action: "tool", tool: "get_related_parameter_context", args: {} } },
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } } },
      {
        content: {
          action: "final",
          conclusion: "The fresh run uses the current canonical value.",
          impact: "The previous run remains a fixed historical report.",
          severity: "Info",
          confidence: 0.5,
          suggestedActions: ["Review the current value against device behavior."],
          evidence: [{ lineNumbers: [1], inference: "The worker read the uploaded line.", suggestedAction: "None." }]
        }
      }
    ]);
    const rerunAnalyzer = createAgentLoopLogAnalyzer({
      model: rerunModel,
      modelLabel: "log904-scripted-rerun",
      tokenBudget: 100_000,
      maxSteps: 4,
      bindToolBackends: (input) =>
        createWorkerLogAnalysisToolBackends({
          db: workerDb!,
          organizationId: input.organizationId ?? fixture.organizationId,
          relatedParameterId: input.relatedParameterId,
          relatedParameterSnapshot: input.relatedParameterSnapshot
        })
    });
    await expect(
      processLogAnalysisJobById({
        db: workerDb,
        objectStore,
        jobId: rerun.body.job.id,
        analyzer: rerunAnalyzer,
        workerId: "log904-repro-worker",
        webhooks
      })
    ).resolves.toMatchObject({ status: "processed" });
    const rerunMission = rerunModel.calls[0]?.find((message) => message.role === "user")?.content;
    expect(rerunMission).toContain(advanced.value.value.id);
    expect(rerunMission).toContain(currentParameter.pin.definitionRevisionId);
    expect(rerunMission).toContain(currentParameter.sourcePin.fileVersionId);
    expect(rerunMission).toContain(JSON.stringify(nextValue));
    const rerunToolResult = rerunModel.calls[1]?.find(
      (message) => message.role === "user" && message.content.startsWith("Tool result for get_related_parameter_context:")
    );
    expect(rerunToolResult?.content).toContain(advanced.value.value.id);
    expect(rerunToolResult?.content).toContain(currentParameter.sourcePin.fileVersionId);
    expect(rerunToolResult?.content).toContain(JSON.stringify(nextValue));
    expect(webhooks.notifyAnalysisTerminal).toHaveBeenCalledTimes(2);
    for (const [webhookInput] of webhooks.notifyAnalysisTerminal.mock.calls) {
      expect(webhookInput.conclusion).toBeUndefined();
      expect(buildLogResultWebhookPayload(webhookInput).conclusionSummary).toBeUndefined();
    }
    const oldReportAfterRerun = await db.query(
      `select id, conclusion, impact, severity, confidence, suggested_actions, raw_lines
         from log_analysis_reports where organization_id = $1 and run_id = $2`,
      [fixture.organizationId, frozenRun.runId]
    );
    expect(oldReportAfterRerun.rows).toEqual(oldReportBeforeRerun.rows);

    const legacyLogId = "log904-unscoped-legacy";
    await db.query(
      `insert into log_records (id, organization_id, file_object_id, file_name, source, status, related_parameter_id, submitted_by_user_id)
       values ($1, $2, $3, $4, 'upload', 'failed', $5, $6)`,
      [
        legacyLogId,
        fixture.organizationId,
        uploadBody.fileObject.id,
        "legacy-unscoped.log",
        "legacy-related-parameter-id",
        fixture.editorAuth.user.id
      ]
    );
    await db.query("update user_role_bindings set role_id = 'admin', project_id = null where id = $1", ["urb-905-editor"]);
    requestAuth = await getAuthContext(db, fixture.editorAuth.user.id);
    const legacyRerun = await requestJson<{ error?: { code: string; message: string } }>(
      createHttpServer(router),
      `/api/v1/logs/${legacyLogId}/rerun`,
      { method: "POST", body: "{}" }
    );
    expect(legacyRerun.status).toBe(404);
    expect(legacyRerun.body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Log record was not found."
    });
    expect(legacyRerun.bodyText).not.toContain(fixture.currentValueId);
    expect(legacyRerun.bodyText).not.toContain(fixture.bindingId);
    const missingRerun = await requestJson<{ error?: { code: string; message: string } }>(
      createHttpServer(router),
      "/api/v1/logs/log904-does-not-exist/rerun",
      { method: "POST", body: "{}" }
    );
    expect(missingRerun.status).toBe(legacyRerun.status);
    expect(missingRerun.body.error?.code).toBe(legacyRerun.body.error?.code);
    expect(missingRerun.body.error?.message).toBe(legacyRerun.body.error?.message);
    await db.query("update user_role_bindings set role_id = 'software-user', project_id = $2 where id = $1", [
      "urb-905-editor",
      fixture.projectId
    ]);
    requestAuth = authorizedAuth;

    // This same-organization software user keeps logs:view/feedback and
    // parameter:view but holds only an unrelated project role.
    await db.query("update user_role_bindings set project_id = $2 where id = $1", [
      "urb-905-editor",
      fixture.otherProjectId
    ]);
    const unrelatedProjectViewerAuth = await getAuthContext(db, fixture.editorAuth.user.id);
    expect(unrelatedProjectViewerAuth.permissions).toContain("logs:view");
    expect(unrelatedProjectViewerAuth.permissions).toContain("logs:feedback");
    expect(unrelatedProjectViewerAuth.permissions).toContain("parameter:view");
    expect(unrelatedProjectViewerAuth.roles).not.toContainEqual({ projectId: fixture.projectId, roleId: "software-user" });
    await expect(
      readProjectProtectedParameters(pool, {
        invocation: createUserInvocation(unrelatedProjectViewerAuth),
        projectId: fixture.projectId
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    requestAuth = unrelatedProjectViewerAuth;
    const putsBeforeUnauthorizedUpload = objectStorePutCalls;
    const unauthorizedUpload = await requestJson(createHttpServer(router), "/api/v1/log-files", {
      method: "POST",
      body: JSON.stringify({
        fileName: "cross-project.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("INFO must not persist\n").toString("base64"),
        relatedParameterPin: {
          kind: "canonical-pin",
          projectId: fixture.projectId,
          bindingId: fixture.bindingId
        }
      })
    });
    expect(unauthorizedUpload.status).toBe(403);
    expect(objectStorePutCalls).toBe(putsBeforeUnauthorizedUpload);

    const listResponse = await requestJson<{ items: unknown[] }>(createHttpServer(router), "/api/v1/logs");
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toEqual([]);

    const detailResponse = await requestJson(createHttpServer(router), `/api/v1/logs/${uploadBody.log.id}`);
    expect(detailResponse.status).toBe(404);

    const insightsResponse = await requestJson<{ items: unknown[] }>(
      createHttpServer(router),
      "/api/v1/logs/feedback-insights"
    );
    expect(insightsResponse.status).toBe(200);
    expect(insightsResponse.body.items).toEqual([]);

    const feedbackResponse = await requestJson<{ error: { code: string } }>(
      createHttpServer(router),
      `/api/v1/logs/${uploadBody.log.id}/feedback`,
      { method: "POST", body: JSON.stringify({ rating: "not_helpful" }) }
    );
    expect(feedbackResponse.status).toBe(404);

    await db.query("update user_role_bindings set project_id = $2 where id = $1", [
      "urb-905-editor",
      fixture.projectId
    ]);
    requestAuth = await getAuthContext(db, fixture.editorAuth.user.id);
    const restoredList = await requestJson<{ items: unknown[] }>(createHttpServer(router), "/api/v1/logs");
    expect(restoredList.body.items).toHaveLength(1);
    requestAuth = unrelatedProjectViewerAuth;

    const rerunResponse = await requestJson<{ error: { code: string; message: string } }>(
      createHttpServer(router),
      `/api/v1/logs/${uploadBody.log.id}/rerun`,
      { method: "POST", body: "{}" }
    );
    expect(rerunResponse.status).toBe(403);
    expect(rerunResponse.body.error.code).toBe("FORBIDDEN");

    // A real broken API connection must fail the authorized source read before
    // upload storage or log creation. Keep the admin connection for verification.
    requestAuth = authorizedAuth;
    const priorLogs = await listLogs(db, authorizedAuth, {});
    const putsBeforeQueryFailure = objectStorePutCalls;
    await apiDb.close();
    apiDb = undefined;
    const failedSourceRead = await requestJson(createHttpServer(router), "/api/v1/log-files", {
      method: "POST",
      body: JSON.stringify({
        fileName: "unreadable-source.log",
        contentType: "text/plain",
        contentBase64: Buffer.from("INFO source unavailable\n").toString("base64"),
        relatedParameterPin: { kind: "canonical-pin", projectId: fixture.projectId, bindingId: fixture.bindingId }
      })
    });
    expect(failedSourceRead.status).toBe(500);
    expect(objectStorePutCalls).toBe(putsBeforeQueryFailure);
    expect(await listLogs(db, authorizedAuth, {})).toEqual(priorLogs);
  }, 120_000);
});
