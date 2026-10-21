import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./openapi";
import { schemaRegistry } from "./schemaRegistry";
import { dtoSchemaCatalog, dtoSchemaCoveredRouteIds } from "./dtoSchemas/catalog";
import { dashboardHotspotDtoSchema } from "./dtoSchemas/parameters";
import { projectBindingDtoSchema } from "../parameter-topology/schemas";

const leftoverSchemaNames = new Set(["GenericObjectResponse"]);

describe("DTO schema catalog coverage", () => {
  it("documents passwordless OIDC provisioning and optimistic identity binding", () => {
    const document = buildOpenApiDocument();
    expect(document.paths["/api/v1/users/{userId}/oidc-identity"]?.put).toMatchObject({
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/SetUserOidcIdentityRequest" } } } },
      responses: { "200": {}, "400": {}, "403": {}, "404": {}, "409": {} }
    });
    const identity = { issuer: "https://identity.example", subject: "external-member" };
    const member = { authentication: "oidc", name: "Member", ...identity, roles: [{ roleId: "software-user" }] };
    expect(dtoSchemaCatalog.CreateLocalAccountUserRequest.safeParse(member).success).toBe(true);
    expect(dtoSchemaCatalog.CreateLocalAccountUserRequest.safeParse({ ...member, subject: " " }).success).toBe(false);
    expect(dtoSchemaCatalog.SetUserOidcIdentityRequest.safeParse({ ...identity, expectedIdentity: null }).success).toBe(true);
    expect(dtoSchemaCatalog.SetUserOidcIdentityRequest.safeParse(identity).success).toBe(false);
    expect(dtoSchemaCatalog.UserGovernanceResponse.safeParse({ item: {
      id: "stable-id", organizationId: "org", name: "Member", email: null, username: null, title: "",
      isActive: true, createdAt: "2026-10-20T00:00:00.000Z", lastActiveAt: null,
      roles: [{ roleId: "software-user", projectId: null }], oidcIdentity: identity
    } }).success).toBe(true);
    expect(document.components.schemas.LocalAuthPublicConfigResponse).toMatchObject({
      properties: { oidcIssuer: { type: "string" } }
    });
  });
  it("documents complete Canonical restore proof without requiring a payload for legacy restores", () => {
    const document = buildOpenApiDocument();
    const paths = document.paths as Record<string, Record<string, { requestBody?: { required?: boolean } }>>;
    expect(paths["/api/v1/projects/{projectId}/baselines/{baselineId}/rollback"].post.requestBody?.required).toBe(false);
    const request = dtoSchemaCatalog.ReleaseBaselineRestoreRequest;
    expect(request.safeParse({}).success).toBe(true);
    expect(request.safeParse({ proofToken: "0".repeat(64) }).success).toBe(false);
    expect(request.safeParse({ proofToken: "0".repeat(64), confirmCompositionChanges: true,
      reason: "Restore the inspected complete source", clientMutationId: "restore-once" }).success).toBe(true);
  });
  it("documents skill ZIP import status and revision-selectable ZIP export", () => {
    const request = dtoSchemaCatalog.LogSkillPackageMultipartImport;
    expect(request.parse({ file: "package.zip" })).toEqual({ file: "package.zip", status: "draft" });
    expect(request.safeParse({ file: "package.zip", status: "published" }).success).toBe(true);
    expect(request.safeParse({ file: "package.zip", status: "superseded" }).success).toBe(false);
    expect(request.parse({ file: "package.zip", name: "  Reimported  " }).name).toBe("Reimported");
    expect(request.safeParse({ file: "package.zip", name: "   " }).success).toBe(true);
    expect(request.safeParse({ file: "package.zip", name: "x".repeat(121) }).success).toBe(false);
    const document = buildOpenApiDocument();
    expect(document.components.schemas.LogSkillPackageMultipartImport).toMatchObject({
      required: ["file"], properties: {
        file: { type: "string", format: "binary" },
        name: { type: "string", maxLength: 120 },
        status: { enum: ["draft", "published"], default: "draft" }
      }
    });
    const paths = document.paths as Record<string, Record<string, {
      requestBody?: { content: Record<string, unknown> }; responses: Record<string, { content: Record<string, unknown> }>
    }>>;
    expect(Object.keys(paths["/api/v1/log-skills/import"].post.requestBody!.content)).toEqual(["multipart/form-data"]);
    expect(paths["/api/v1/log-skills/import"].post.responses["201"].content).toHaveProperty("application/json");
    expect(paths["/api/v1/log-skills/{skillId}/package"].get.responses["200"].content).toHaveProperty("application/zip");
    expect(schemaRegistry["logs.exportSkillPackage"].requestParameters).toContainEqual(expect.objectContaining({
      name: "revision", in: "query", schema: { type: "string", enum: ["published", "draft"] }
    }));
    expect(dtoSchemaCoveredRouteIds).toContain("logs.importSkillPackage");
  });
  it("documents template creation, optional procedure and sample contracts", () => {
    const create = dtoSchemaCatalog.CreateLogSkillRequest;
    for (const startingPoint of [{ templateId: "generic-text" }, { copyFromSkillId: "source" }])
      expect(create.safeParse({ name: "Skill", startingPoint }).success).toBe(true);
    expect(create.safeParse({ name: "Skill" }).success).toBe(true);
    expect(create.safeParse({ name: "Skill", startingPoint: { templateId: "a", copyFromSkillId: "b" } }).success).toBe(false);
    expect(create.safeParse({ name: "   " }).success).toBe(false);
    expect(dtoSchemaCatalog.LogSkillDraftRequest.safeParse({ spec: { schemaVersion: "skill/v1", procedure: "## Steps" },
      baseDraftRevisionId: null, basePublishedRevisionId: "v1" }).success).toBe(true);
    const document = buildOpenApiDocument();
    expect(document.components.schemas.ReplaceLogSkillSampleRequest).toMatchObject({
      properties: { fileName: { type: "string" }, contentBase64: { type: "string" } }
    });
    const paths = document.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    expect(paths["/api/v1/log-skill-templates"].get.responses["200"]).toBeDefined();
    const sample = paths["/api/v1/log-skills/{skillId}/sample"];
    expect(sample.get.responses["200"]).toBeDefined();
    expect(sample.put.responses["200"]).toBeDefined();
    expect(sample.delete.responses["204"]).not.toHaveProperty("content");
    expect(paths["/api/v1/log-skills/{skillId}/files/preview"].post.responses["200"]).toBeDefined();
    expect(dtoSchemaCatalog.LogSkillFilePreviewResponse.safeParse({ valid: true, issues: [], files: [
      { path: "charger/device.log", skillMatched: true, role: "charging" },
      { path: "misc/notes.txt", skillMatched: false, role: null }
    ] }).success).toBe(true);
    for (const id of ["logs.listSkillTemplates", "logs.getSkillSample", "logs.replaceSkillSample", "logs.deleteSkillSample", "logs.filesPreview"])
      expect(dtoSchemaCoveredRouteIds).toContain(id);
  });
  it("documents parsing preview and preserves the versioned decoded evidence contract", () => {
    const document = buildOpenApiDocument();
    expect(document.paths).toHaveProperty("/api/v1/log-skills/{skillId}/parse-preview");
    expect(dtoSchemaCoveredRouteIds).toContain("logs.parsePreview");
    const event = { v: 1, source: "declarative", extractor: "current", file: "a.log", line: 2, fields: { current: { raw: "0x10", value: 16 } } };
    expect(dtoSchemaCatalog.LogParsePreviewResponse.safeParse({ valid: true, issues: [], events: [event], counts: { total: 1, byExtractor: { current: 1 }, errors: {} }, unmatchedLineCount: 0 }).success).toBe(true);
    expect(dtoSchemaCatalog.LogParsePreviewResponse.safeParse({ valid: true, issues: [], events: [{ ...event, source: "script" }], counts: { total: 1, byExtractor: {}, errors: {} }, unmatchedLineCount: 0 }).success).toBe(false);
    expect(dtoSchemaCatalog.LogSkillDraftRequest.safeParse({ spec: { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1", extractors: [] } }, baseDraftRevisionId: null, basePublishedRevisionId: "published" }).success).toBe(true);
  });
  it("documents signal preview and preserves typed condition alternatives through validation pipelines", () => {
    const document = buildOpenApiDocument();
    expect(document.paths).toHaveProperty("/api/v1/log-skills/{skillId}/signals-preview");
    expect(dtoSchemaCoveredRouteIds).toContain("logs.signalPreview");
    expect(document.components.schemas.LogSkillDraftRequest).toMatchObject({ properties: { spec: { properties: {
      signalRules: { properties: { rules: { items: { properties: { anyOf: { items: { anyOf: expect.arrayContaining([
        expect.objectContaining({ properties: expect.objectContaining({ type: { type: "string", enum: ["field"] } }) }),
        expect.objectContaining({ properties: expect.objectContaining({ type: { type: "string", enum: ["window"] } }) })
      ]) } } } } } } }
    } } } });
    expect(dtoSchemaCatalog.LogSignalPreviewResponse.safeParse({ valid: true, issues: [], hits: [{ ruleId: "custom", lineNumber: 2, excerpt: "alert" }], truncated: false }).success).toBe(true);
  });
  it("documents draft concurrency and bodyless discard without losing restore coverage", () => {
    const document = buildOpenApiDocument();
    const request = dtoSchemaCatalog.LogSkillDraftRequest;
    const spec = { schemaVersion: "skill/v1", description: "描述" };
    expect(request.safeParse({ spec }).success).toBe(false);
    expect(request.safeParse({ spec, baseDraftRevisionId: null }).success).toBe(false);
    expect(request.safeParse({ spec, baseDraftRevisionId: null, basePublishedRevisionId: "published" }).success).toBe(true);
    expect(request.safeParse({ spec, baseDraftRevisionId: "draft", basePublishedRevisionId: "published" }).success).toBe(true);
    const paths = document.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    const draft = paths["/api/v1/log-skills/{skillId}/draft"];
    expect(draft.put.responses["409"]).toBeDefined();
    expect(draft.delete.responses["204"]).toEqual({ description: "Successful response." });
    expect(draft.delete.responses["409"]).toBeDefined();
    expect(schemaRegistry["logs.discardSkillDraft"].requestParameters).toContainEqual(expect.objectContaining({ name: "draftRevisionId", in: "query", required: true }));
    expect(paths["/api/v1/log-skills/{skillId}/revisions/{revisionId}/restore"].post.responses["409"]).toBeDefined();
    expect(dtoSchemaCoveredRouteIds).toContain("logs.discardSkillDraft");
    expect(dtoSchemaCoveredRouteIds).toContain("logs.restoreSkillRevision");
  });
  it("retains the optional current head display name without replacing pinned copy", () => {
    const document = buildOpenApiDocument();
    const list = document.components.schemas.ProjectParameterBindingListResponse as {
      properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } }
    };
    expect(list.properties.items.items.properties.currentDisplayName).toEqual({ type: ["string", "null"] });
    expect(list.properties.items.items.required).not.toContain("currentDisplayName");
    const binding = {
      id: "binding", parameterSpecId: "definition", parameterSpecVersionId: "pinned",
      propertyKey: "iin_max", driverModule: null, logicalNodeId: null, instanceName: null,
      locator: null, effectiveValue: { kind: "boolean", present: true }, rawValue: "",
      schemaState: "valid", policyState: "not_applicable", moduleId: "module",
      displayName: "旧名称", currentDisplayName: "当前名称", description: null, documentation: null
    };
    expect(projectBindingDtoSchema.parse(binding)).toMatchObject({
      displayName: "旧名称", currentDisplayName: "当前名称", parameterSpecVersionId: "pinned"
    });
    expect(projectBindingDtoSchema.parse({ ...binding, currentDisplayName: null }).currentDisplayName).toBeNull();
    const { currentDisplayName: _name, ...legacy } = binding;
    expect(projectBindingDtoSchema.safeParse(legacy).success).toBe(true);
    expect(projectBindingDtoSchema.safeParse({ ...binding, currentDisplayName: 1137 }).success).toBe(false);
  });
  it("publishes the same canonical compatibility identity and unavailable metadata for list and detail", () => {
    const document = buildOpenApiDocument();
    const list = document.components.schemas.ParameterListResponse as {
      properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } }
    };
    const detail = document.components.schemas.ParameterResponse as {
      properties: { item: { properties: Record<string, unknown> } }
    };
    expect(list.properties.items.items.required).toEqual(expect.arrayContaining([
      "bindingId", "definitionId", "effectiveRevisionId", "currentValueId", "metadataAvailability"
    ]));
    for (const field of ["risk", "range", "unit", "recommendedValue", "updatedAt", "updatedAtTs", "history"]) {
      expect(list.properties.items.items.properties[field], field).toMatchObject({ type: "null" });
    }
    expect(detail.properties.item.properties).toEqual(list.properties.items.items.properties);
    for (const routeId of ["parameters.get", "parameters.history"]) {
      expect(schemaRegistry[routeId].additionalResponses).toMatchObject({
        "403": "ErrorResponse", "404": "ErrorResponse", "410": "CatalogLegacyGoneResponse"
      });
    }
  });

  it("realizes request/response schemas for every covered route", () => {
    for (const routeId of dtoSchemaCoveredRouteIds) {
      const entry = schemaRegistry[routeId];
      expect(entry, routeId).toBeDefined();
      if (entry.requestBody && dtoSchemaCatalog[entry.requestBody]) {
        expect(dtoSchemaCatalog[entry.requestBody], `${routeId} request ${entry.requestBody}`).toBeDefined();
      }
      if (!leftoverSchemaNames.has(entry.responseBody)) {
        expect(dtoSchemaCatalog[entry.responseBody], `${routeId} response ${entry.responseBody}`).toBeDefined();
      }
    }
  });

  it("publishes object properties for catalogued OpenAPI component schemas", () => {
    const document = buildOpenApiDocument();
    for (const name of Object.keys(dtoSchemaCatalog)) {
      const schema = document.components.schemas[name] as Record<string, unknown> | undefined;
      expect(schema, name).toBeDefined();
      expect(schema?.["x-wiseeff-schema"]).toBe(name);
      expect(schema?.type === "object" || Array.isArray(schema?.anyOf)).toBe(true);
      if (schema?.type === "object") {
        expect(schema.properties, name).toBeDefined();
      }
    }
  });

  it("keeps the existing ErrorEnvelope shape", () => {
    const envelope = buildOpenApiDocument().components.schemas.ErrorEnvelope as Record<string, unknown>;
    expect(envelope).toMatchObject({
      type: "object",
      required: ["error"]
    });
    const error = (envelope.properties as Record<string, Record<string, unknown>>).error;
    expect(error.required).toEqual(["code", "message", "details", "requestId"]);
  });

  it("names Xiaoze thread operations instead of GenericObjectResponse", () => {
    expect(schemaRegistry["xiaoze.listThreads"]?.responseBody).toBe("XiaozeThreadListResponse");
    expect(schemaRegistry["xiaoze.getThread"]?.responseBody).toBe("XiaozeThreadDetailResponse");
    expect(schemaRegistry["xiaoze.run"]?.requestBody).toBe("XiaozeAgUiRunRequest");
    expect(schemaRegistry["xiaoze.run"]?.responseBody).toBe("GenericObjectResponse");
  });

  it("publishes concrete Xiaoze suggest request and response schemas", () => {
    expect(schemaRegistry["xiaoze.suggest"]).toMatchObject({
      requestBody: "XiaozeSuggestRequest",
      responseBody: "XiaozeSuggestResponse"
    });
    expect(dtoSchemaCatalog.XiaozeSuggestRequest).toBeDefined();
    expect(dtoSchemaCatalog.XiaozeSuggestResponse).toBeDefined();
  });

  it("accepts only the four-dimension behavioral hotspot DTO", () => {
    const base = {
      id: "module:charging",
      kind: "module" as const,
      title: "Charging Policy",
      projectCode: "3 个项目",
      module: "Charging Policy",
      statusLabel: "偏高",
      statusLevel: "elevated" as const,
      score: 100,
      evidence: [],
      trendDelta: 0,
      trendDirection: "flat" as const,
      suggestedPath: "/parameters?module=Charging%20Policy"
    };

    expect(
      dashboardHotspotDtoSchema.safeParse({
        ...base,
        scoreBreakdown: { frequency: 25, scope: 25, workflow: 25, collaboration: 25 }
      }).success
    ).toBe(true);
    expect(
      dashboardHotspotDtoSchema.safeParse({
        ...base,
        scoreBreakdown: { frequency: 25, scope: 25, workflow: 25, collaboration: 25, risk: 20 }
      }).success
    ).toBe(false);
  });
});
