import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./openapi";
import { schemaRegistry } from "./schemaRegistry";
import { dtoSchemaCatalog, dtoSchemaCoveredRouteIds } from "./dtoSchemas/catalog";
import { dashboardHotspotDtoSchema } from "./dtoSchemas/parameters";
import { projectBindingDtoSchema } from "../parameter-topology/schemas";

const leftoverSchemaNames = new Set(["GenericObjectResponse"]);

describe("DTO schema catalog coverage", () => {
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
    for (const id of ["logs.listSkillTemplates", "logs.getSkillSample", "logs.replaceSkillSample", "logs.deleteSkillSample"])
      expect(dtoSchemaCoveredRouteIds).toContain(id);
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
