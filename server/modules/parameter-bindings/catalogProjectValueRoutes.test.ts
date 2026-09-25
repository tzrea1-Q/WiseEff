import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/http/errors";

import { makeTestAuthContext } from "../../testing/authContext";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { parameterImportBatchResponseSchema } from "../contracts/dtoSchemas/parameters";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";
import * as catalogSync from "./catalogProjectValueSync";
import * as drafts from "./drafts";
import * as importBatchRepository from "../parameters/importBatchRepository";
import * as parameterService from "../parameters/service";
import * as auditedWrite from "../audit/auditedWrite";
import * as dbClient from "../../shared/database/client";
import * as sensitiveNode from "../parameter-kernel/sensitiveNode";
import * as governanceAudit from "../parameter-topology/governanceAudit";
import * as topologyService from "../parameter-topology/service";
import * as configSetService from "../parameter-files/configSetService";
import * as projects from "../projects/repository";
import * as importStaging from "./drafts/importService";
import * as reviewWorkflow from "../parameters/reviewWorkflowRepository";
import * as sourceDiff from "../parameter-files/canonicalSourceDiff";

vi.mock("./drafts/importService", () => ({ stageCanonicalImportBatch: vi.fn() }));
vi.mock("../parameter-files/canonicalSourceDiff", async (importOriginal) => ({
  ...await importOriginal<typeof import("../parameter-files/canonicalSourceDiff")>(),
  readCanonicalBatchSourceDiff: vi.fn()
}));
afterEach(() => vi.restoreAllMocks());

vi.mock("./catalogProjectValueSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalogProjectValueSync")>();
  return {
    ...actual,
    findCatalogBindingRow: vi.fn(),
    loadPublishedCatalog: vi.fn(),
    saveCanonicalProjectValue: vi.fn(),
    listCatalogBindingsForImport: vi.fn(),
    listCatalogBindingRowsForProject: vi.fn()
  };
});

vi.mock("../parameters/importBatchRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/importBatchRepository")>();
  return {
    ...actual,
    insertImportBatch: vi.fn(),
    markImportBatchApplied: vi.fn()
  };
});

vi.mock("../parameter-kernel/sensitiveNode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameter-kernel/sensitiveNode")>();
  return {
    ...actual,
    assertTrustedSensitiveNodeWriteAllowed: vi.fn()
  };
});

vi.mock("../parameter-topology/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameter-topology/service")>();
  return {
    ...actual,
    listProjectBindings: vi.fn()
  };
});

vi.mock("../parameter-files/configSetService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameter-files/configSetService")>();
  return {
    ...actual,
    listConfigSets: vi.fn()
  };
});

vi.mock("../parameters/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/service")>();
  return {
    ...actual,
    applyImportBatch: vi.fn(),
    createImportPreview: vi.fn(),
    listDrafts: vi.fn(),
    deleteDraft: vi.fn()
  };
});

vi.mock("./drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./drafts")>();
  return {
    ...actual,
    createCanonicalValueDraft: vi.fn(),
    listCanonicalValueDraftsForUser: vi.fn(),
    removeCanonicalValueDraft: vi.fn(),
    listCanonicalValueChangesForAuth: vi.fn(),
    approveCanonicalBatchValueChange: vi.fn(),
    getCanonicalBatchValueChangeForReviewer: vi.fn(),
    reviewCanonicalValueChange: vi.fn(),
    submitCanonicalValueChange: vi.fn(),
    withdrawCanonicalValueChange: vi.fn()
  };
});

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      organizationName: "ChargeLab",
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["parameter:view", "parameter:edit", "admin:access"]
    }),
    ...overrides
  };
}

function makeDb(): Database {
  const db: Database = {
    query: vi.fn(),
    transaction: vi.fn(async (fn) => fn(db))
  };
  return db;
}

function makeServer(options: { db?: Database; auth?: AuthContext; withoutObjectStore?: boolean } = {}) {
  const router = createRouter();
  registerCatalogProjectValueConsumerRoutes(router, {
    db: options.db,
    objectStore: options.withoutObjectStore ? undefined : {
      put: async () => { throw new Error("Unexpected object write in route-only test"); },
      get: async () => { throw new Error("Unexpected object read in route-only test"); },
      delete: async () => undefined,
    },
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

const catalogBinding = {
  id: "pbind-1",
  organization_id: "org-1",
  catalog_release_id: "crel_acme_1",
  project_id: "project-b",
  logical_node_id: "node-1",
  registration_id: "reg-1",
  subject_id: "csub_acme_power",
  definition_id: "pdef_acme_power_iin_max",
  effective_revision_id: "rev-def-1",
  current_value_id: "val-1"
};

const draftBody = {
  baseRevisionId: "rev-1",
  reason: "raise published input current",
  targetValue: {
    kind: "cells" as const,
    bits: 32 as const,
    groups: [[{ kind: "integer" as const, raw: "2000", value: "2000" }]]
  }
};

const projectEditor = (projectId: string) =>
  makeAuth({
    roles: [{ projectId, roleId: "software-user" }],
    permissions: ["parameter:view", "parameter:edit"]
  });

const appliedBatch = {
  id: "batch-1",
  projectId: "project-1",
  sourceName: "pasted-import.txt",
  status: "applied" as const,
  createdAt: "2026-09-10T00:00:00.000Z",
  appliedAt: "2026-09-10T00:01:00.000Z",
  summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 },
  items: [
    {
      id: "item-1",
      name: "iin_max",
      module: "Driver",
      risk: "Low" as const,
      unit: "",
      range: "",
      currentValue: "3000",
      classification: "updated" as const
    }
  ]
};

describe("catalog published-value import apply route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbClient, "isRootDatabase").mockReturnValue(true);
    vi.spyOn(projects, "getProjectById").mockResolvedValue({ id: "project-1" } as never);
    vi.mocked(importBatchRepository.insertImportBatch).mockImplementation(async (_db, input) => ({
      ...input, status: "previewed", createdAt: "2026-09-10T00:00:00.000Z"
    }));
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
    vi.spyOn(auditedWrite, "withAuditedWrite").mockImplementation(async (db, _auth, _ctx, fn) => {
      const outcome = await fn(db as never);
      return outcome.result;
    });
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({ items: [] });
    vi.mocked(configSetService.listConfigSets).mockResolvedValue([]);
  });

  it("returns staged source drafts without invoking the direct-value import owner", async () => {
    const db = makeDb();
    const staged = { ...appliedBatch, status: "staged" as const, appliedAt: undefined,
      summary: { ...appliedBatch.summary, staged: 1 }, items: appliedBatch.items.map((item) => ({ ...item, riskFlag: false })) };
    vi.mocked(importStaging.stageCanonicalImportBatch).mockResolvedValue(staged);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameter-import-batches/batch-1/apply",
      {
        method: "POST",
        body: JSON.stringify({ selectedItemIds: ["item-1"] })
      }
    );

    expect(response.status).toBe(200);
    expect(parameterImportBatchResponseSchema.parse(response.body).item).toMatchObject({ status: "staged", summary: { staged: 1 } });
    expect(parameterService.applyImportBatch).not.toHaveBeenCalled();
    expect(importBatchRepository.markImportBatchApplied).not.toHaveBeenCalled();
    expect(catalogSync.saveCanonicalProjectValue).not.toHaveBeenCalled();
    expect(importStaging.stageCanonicalImportBatch).toHaveBeenCalledWith(db, expect.anything(), expect.anything(),
      expect.objectContaining({ batchId: "batch-1", selectedItemIds: ["item-1"] }),
      expect.objectContaining({ requestId: "test-request", invocation: expect.anything(), refusalSink: expect.anything() }));
  });

  it("rewrites a catalog import preview inside the audited write", async () => {
    const db = makeDb();
    const previewed = {
      id: "batch-preview-1",
      projectId: "project-1",
      sourceName: "pasted-import.txt",
      status: "previewed" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-1",
          name: "iin_max",
          module: "Driver",
          risk: "Low" as const,
          unit: "A",
          range: "0-10",
          currentValue: "3000",
          classification: "added" as const
        }
      ]
    };
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([
      {
        id: "pdef_acme_power_iin_max",
        name: "iin_max",
        description: "",
        explanation: "",
        configFormat: "DTS",
        module: "",
        range: "",
        unit: "",
        risk: "Low",
        projectParameterValueId: "pbind-1",
        currentValue: "2000"
      }
    ]);
    vi.mocked(parameterService.createImportPreview).mockResolvedValue(previewed);
    vi.mocked(db.query).mockResolvedValue({ rows: [] });

    const response = await requestJson(makeServer({ db }), "/api/v1/parameter-import-batches", {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        sourceName: "pasted-import.txt",
        items: [
          {
            name: "iin_max",
            module: "Driver",
            risk: "Low",
            unit: "A",
            range: "0-10",
            currentValue: "3000"
          }
        ]
      })
    });

    expect(response.status).toBe(201);
    const body = parameterImportBatchResponseSchema.parse(response.body);
    expect(body.item.summary).toEqual({ added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 });
    expect(body.item.items[0]?.classification).toBe("updated");
    expect(auditedWrite.withAuditedWrite).toHaveBeenCalled();
    expect(parameterService.createImportPreview).not.toHaveBeenCalled();
    expect(importBatchRepository.insertImportBatch).toHaveBeenCalledWith(db,
      expect.objectContaining({ projectId: "project-1", items: expect.arrayContaining([
        expect.objectContaining({ definitionId: "pdef_acme_power_iin_max", projectParameterValueId: "pbind-1" })
      ]) }));
  });

  it("keeps a precise catalog import identity when another same-name binding is listed first", async () => {
    const db = makeDb();
    const previewed = {
      id: "batch-preview-2",
      projectId: "project-1",
      sourceName: "pasted-import.txt",
      status: "previewed" as const,
      createdAt: "2026-09-10T00:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-1",
          name: "iin_max",
          module: "Driver",
          risk: "Low" as const,
          unit: "A",
          range: "0-10",
          currentValue: "3000",
          classification: "added" as const
        }
      ]
    };
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([
      {
        id: "pdef_acme_power_iin_max",
        name: "iin_max",
        description: "",
        explanation: "",
        configFormat: "DTS",
        module: "",
        range: "",
        unit: "",
        risk: "Low",
        projectParameterValueId: "pbind-b",
        currentValue: "1111"
      },
      {
        id: "pdef_acme_power_iin_max",
        name: "iin_max",
        description: "",
        explanation: "",
        configFormat: "DTS",
        module: "",
        range: "",
        unit: "",
        risk: "Low",
        projectParameterValueId: "pbind-a",
        currentValue: "2000"
      }
    ]);
    vi.mocked(parameterService.createImportPreview).mockResolvedValue(previewed);
    vi.mocked(db.query).mockResolvedValue({ rows: [] });

    const response = await requestJson(makeServer({ db }), "/api/v1/parameter-import-batches", {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        sourceName: "pasted-import.txt",
        items: [
          {
            id: "pbind-a",
            name: "iin_max",
            module: "Driver",
            risk: "Low",
            unit: "A",
            range: "0-10",
            currentValue: "3000"
          }
        ]
      })
    });

    expect(response.status).toBe(201);
    const body = parameterImportBatchResponseSchema.parse(response.body);
    expect(body.item.items[0]?.classification).toBe("updated");
    const persisted = vi.mocked(importBatchRepository.insertImportBatch).mock.calls[0]![1].items;
    expect(persisted[0]?.projectParameterValueId).toBe("pbind-a");
  });

  it("rejects a name-only catalog import when two published values share the name", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([
      {
        id: "pdef_acme_power_iin_max",
        name: "iin_max",
        description: "",
        explanation: "",
        configFormat: "DTS",
        module: "",
        range: "",
        unit: "",
        risk: "Low",
        projectParameterValueId: "pbind-a",
        currentValue: "2000"
      },
      {
        id: "pdef_acme_power_iin_max",
        name: "iin_max",
        description: "",
        explanation: "",
        configFormat: "DTS",
        module: "",
        range: "",
        unit: "",
        risk: "Low",
        projectParameterValueId: "pbind-b",
        currentValue: "1111"
      }
    ]);
    vi.mocked(parameterService.createImportPreview).mockResolvedValue({
      id: "batch-preview-3",
      projectId: "project-1",
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-09-10T00:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-1",
          name: "iin_max",
          module: "Driver",
          risk: "Low",
          unit: "A",
          range: "0-10",
          currentValue: "3000",
          classification: "added"
        }
      ]
    });

    const response = await requestJson(makeServer({ db }), "/api/v1/parameter-import-batches", {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        sourceName: "pasted-import.txt",
        items: [
          {
            name: "iin_max",
            module: "Driver",
            risk: "Low",
            unit: "A",
            range: "0-10",
            currentValue: "3000"
          }
        ]
      })
    });

    expect(response.status).toBe(409);
    expect(parameterService.applyImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a precise catalog identity when the target project has no catalog candidates", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([]);
    vi.mocked(parameterService.createImportPreview).mockResolvedValue({
      id: "batch-should-not-exist",
      projectId: "project-a",
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-09-10T00:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "pbind-from-project-b",
          name: "iin_max",
          module: "Driver",
          risk: "Low",
          unit: "A",
          range: "0-10",
          currentValue: "3000",
          classification: "added"
        }
      ]
    });

    const response = await requestJson<{ code?: string }>(
      makeServer({ db }),
      "/api/v1/parameter-import-batches",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-a",
          sourceName: "pasted-import.txt",
          items: [
            {
              id: "pbind-from-project-b",
              name: "iin_max",
              module: "Driver",
              risk: "Low",
              unit: "A",
              range: "0-10",
              currentValue: "3000"
            }
          ]
        })
      }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(parameterService.createImportPreview).not.toHaveBeenCalled();
    expect(auditedWrite.withAuditedWrite).not.toHaveBeenCalled();
  });

  it("rejects a published definition identity with no project value in the target project", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([]);

    const response = await requestJson<{ code?: string }>(
      makeServer({ db }),
      "/api/v1/parameter-import-batches",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-a",
          sourceName: "pasted-import.txt",
          items: [
            {
              id: "pdef_acme_power_iin_max",
              name: "iin_max",
              module: "Driver",
              risk: "Low",
              unit: "A",
              range: "0-10",
              currentValue: "3000"
            }
          ]
        })
      }
    );

    expect(response.status).toBe(404);
    expect(parameterService.createImportPreview).not.toHaveBeenCalled();
  });

  it("keeps an unbound row in the canonical preview without a legacy fallback", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([]);
    vi.mocked(parameterService.createImportPreview).mockResolvedValue({
      id: "batch-legacy-1",
      projectId: "project-a",
      sourceName: "pasted-import.txt",
      status: "previewed",
      createdAt: "2026-09-10T00:00:00.000Z",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-1",
          name: "iin_max",
          module: "Driver",
          risk: "Low",
          unit: "A",
          range: "0-10",
          currentValue: "3000",
          classification: "added"
        }
      ]
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameter-import-batches",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-a",
          sourceName: "pasted-import.txt",
          items: [
            {
              name: "iin_max",
              module: "Driver",
              risk: "Low",
              unit: "A",
              range: "0-10",
              currentValue: "3000"
            }
          ]
        })
      }
    );

    expect(response.status).toBe(201);
    expect(parameterService.createImportPreview).not.toHaveBeenCalled();
    expect(parameterImportBatchResponseSchema.parse(response.body).item.summary).toMatchObject({ added: 0, conflict: 1 });
  });

  it("classifies a unique topology property as updated when catalog candidates are empty", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.listCatalogBindingsForImport).mockResolvedValue([]);
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({
      items: [
        {
          id: "pbind-isolated",
          propertyKey: "charge_voltage_limit_mv",
          driverModule: "sc8562",
          rawValue: "<2300>",
          description: ""
        } as never
      ]
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameter-import-batches",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: "project-a",
          sourceName: "pasted-import.txt",
          items: [
            {
              name: "charge_voltage_limit_mv",
              module: "sc8562",
              risk: "High",
              unit: "mA",
              range: "4200 - 4500",
              currentValue: "<4350>",
              recommendedValue: "<4310>"
            }
          ]
        })
      }
    );

    expect(response.status).toBe(201);
    expect(parameterImportBatchResponseSchema.parse(response.body).item.summary).toMatchObject({
      added: 0,
      updated: 1,
      conflict: 0
    });
  });
});

describe("catalog published-value save authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
    vi.spyOn(dbClient, "isRootDatabase").mockReturnValue(true);
    vi.spyOn(auditedWrite, "withAuditedWrite").mockImplementation(async (db, _auth, _ctx, fn) => {
      const outcome = await fn(db as never);
      return outcome.result;
    });
    vi.spyOn(governanceAudit, "writeTrustedGovernanceAudit").mockResolvedValue(undefined as never);
  });

  it("refuses a cross-project canonical save after the catalog binding is found", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue({
      ...catalogBinding,
      project_id: "project-b"
    });

    const response = await requestJson(
      makeServer({ db, auth: projectEditor("project-a") }),
      "/api/v2/projects/project-b/parameter-bindings/pbind-1/drafts",
      { method: "POST", body: JSON.stringify(draftBody) }
    );

    expect(response.status).toBe(403);
    expect(catalogSync.findCatalogBindingRow).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      projectId: "project-b",
      bindingId: "pbind-1"
    });
    expect(catalogSync.saveCanonicalProjectValue).not.toHaveBeenCalled();
    expect(auditedWrite.withAuditedWrite).not.toHaveBeenCalled();
  });

  it("creates a pending draft and never writes the canonical current value", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ format: "dts", config_revision_id: "rev-1", property_occurrence_id: "property-1", node_locator: "/charger", compatible: "acme,power" }]
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue({
      ...catalogBinding,
      project_id: "project-a"
    });
    vi.mocked(drafts.createCanonicalValueDraft).mockResolvedValue({
      id: "pvdr-1",
      bindingId: "pbind-1",
      definitionId: "pdef_acme_power_iin_max",
      effectiveRevisionId: "rev-def-1",
      currentValueId: "val-1",
      targetValue: "<2000>"
    });
    vi.mocked(sensitiveNode.assertTrustedSensitiveNodeWriteAllowed).mockResolvedValue(undefined as never);

    const response = await requestJson<{ item: Record<string, unknown> }>(
      makeServer({ db, auth: projectEditor("project-a") }),
      "/api/v2/projects/project-a/parameter-bindings/pbind-1/drafts",
      { method: "POST", body: JSON.stringify(draftBody) }
    );

    expect(response.status).toBe(201);
    expect(drafts.createCanonicalValueDraft).toHaveBeenCalled();
    // The draft is pending work: the canonical value must not be written here.
    expect(catalogSync.saveCanonicalProjectValue).not.toHaveBeenCalled();
    // The returned draft id is the draft, not the current value id.
    expect(response.body.item.draftId).toBe("pvdr-1");
    expect(response.body.item.pending).toBe(true);
    expect(response.body.item.currentValueId).toBe("val-1");
  });

  it("allows an admin to create a pending draft on any project", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ format: "dts", config_revision_id: "rev-1", property_occurrence_id: "property-1", node_locator: "/charger", compatible: "acme,power" }]
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue(catalogBinding);
    vi.mocked(drafts.createCanonicalValueDraft).mockResolvedValue({
      id: "pvdr-2",
      bindingId: "pbind-1",
      definitionId: "pdef_acme_power_iin_max",
      effectiveRevisionId: "rev-def-1",
      currentValueId: "val-1",
      targetValue: "<2000>"
    });
    vi.mocked(sensitiveNode.assertTrustedSensitiveNodeWriteAllowed).mockResolvedValue(undefined as never);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-b/parameter-bindings/pbind-1/drafts",
      { method: "POST", body: JSON.stringify(draftBody) }
    );

    expect(response.status).toBe(201);
    expect(drafts.createCanonicalValueDraft).toHaveBeenCalled();
    expect(catalogSync.saveCanonicalProjectValue).not.toHaveBeenCalled();
  });
});

describe("canonical project binding reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
  });

  it("returns an honest empty collection when the Catalog is unpublished", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ id: "project-1", name: "Project One", code: "P1" }]
    } as never);
    vi.mocked(catalogSync.listCatalogBindingRowsForProject).mockResolvedValue([]);
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue(null as never);
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({
      items: [{ id: "legacy-1", parameterSpecId: "pspec-legacy" }]
    } as never);

    const response = await requestJson<{ items: Array<{ id: string }> }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });

  it("preserves project scope refusal even when the Catalog is unpublished", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ id: "project-1", name: "Project One", code: "P1" }]
    } as never);
    vi.mocked(catalogSync.listCatalogBindingRowsForProject).mockRejectedValue(
      new ApiError("FORBIDDEN", "Project parameter scope is required.")
    );
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue(null as never);
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({
      items: [{ id: "legacy-1", parameterSpecId: "pspec-legacy" }]
    } as never);

    const response = await requestJson<{ items: Array<{ id: string }> }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(403);
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });

  it("keeps catalog FORBIDDEN when a Catalog is published", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ id: "project-1", name: "Project One", code: "P1" }]
    } as never);
    vi.mocked(catalogSync.listCatalogBindingRowsForProject).mockRejectedValue(
      new ApiError("FORBIDDEN", "Project parameter scope is required.")
    );
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue({ id: "crel-1" } as never);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(403);
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });

  it("returns canonical rows only once a Catalog has bindings", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ id: "project-1", name: "Project One", code: "P1" }]
    } as never);
    vi.mocked(catalogSync.listCatalogBindingRowsForProject).mockResolvedValue([
      {
        id: "canonical-1",
        parameterSpecId: "pspec-canonical",
        parameterSpecVersionId: "psver-canonical",
        definitionId: "def-canonical",
        effectiveRevisionId: "drev-canonical",
        currentValueId: "pval-canonical",
        projectId: "project-1",
        propertyKey: "iin_max",
        driverModule: null,
        logicalNodeId: "node-canonical",
        instanceName: null,
        locator: "/soc/i2c@1",
        typedValue: { kind: "strings", values: ["2000"] },
        rawValue: "2000",
        schemaState: "valid",
        policyState: "pass",
        moduleId: "mod-canonical",
        displayName: "iin_max",
        description: null,
        documentation: null
      }
    ] as never);
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({
      items: [
        { id: "canonical-1", parameterSpecId: "pspec-other" },
        { id: "legacy-same-definition", parameterSpecId: "def-canonical" },
        { id: "legacy-only", parameterSpecId: "pspec-legacy" }
      ]
    } as never);

    const response = await requestJson<{ items: Array<{ id: string }> }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.id)).toEqual(["canonical-1"]);
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });

  it("returns an honest empty collection when a published Catalog has no project rows", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ id: "project-1", name: "Project One", code: "P1" }]
    } as never);
    vi.mocked(catalogSync.listCatalogBindingRowsForProject).mockResolvedValue([]);
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue({ id: "crel-1" } as never);
    vi.mocked(topologyService.listProjectBindings).mockResolvedValue({
      items: [{ id: "legacy-1", parameterSpecId: "pspec-legacy" }]
    } as never);

    const response = await requestJson<{ items: Array<{ id: string }> }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-bindings"
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });

  it("still hides an unknown or foreign project behind 404", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-missing/parameter-bindings"
    );

    expect(response.status).toBe(404);
    expect(catalogSync.listCatalogBindingRowsForProject).not.toHaveBeenCalled();
    expect(topologyService.listProjectBindings).not.toHaveBeenCalled();
  });
});

describe("canonical import apply boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbClient, "isRootDatabase").mockReturnValue(true);
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
    vi.spyOn(auditedWrite, "withAuditedWrite").mockImplementation(async (db, _auth, _ctx, fn) => {
      const outcome = await fn(db as never);
      return outcome.result;
    });
  });

  it("refuses rows with no canonical binding instead of a legacy apply fallback", async () => {
    const db = makeDb();
    vi.mocked(importStaging.stageCanonicalImportBatch).mockRejectedValue(new ApiError("CONFLICT", "Import rows require distinct exact canonical source mappings."));
    vi.mocked(db.query).mockImplementation(async (sql: unknown) => {
      if (typeof sql === "string" && sql.includes("from parameter_import_batches")) {
        return {
          rows: [
            {
              items: [
                {
                  id: "item-1",
                  name: "iin_max",
                  classification: "added",
                  projectParameterValueId: "pbind-legacy"
                }
              ],
              project_id: "project-1"
            }
          ]
        } as never;
      }
      return { rows: [] } as never;
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue(null);

    const response = await requestJson<{ error?: { code?: string; details?: unknown } }>(
      makeServer({ db }),
      "/api/v1/parameter-import-batches/batch-1/apply",
      { method: "POST", body: JSON.stringify({ selectedItemIds: ["item-1"] }) }
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: { code: "CONFLICT" }
    });
    // The legacy whole-batch apply service is never used as a fallback.
    expect(parameterService.applyImportBatch).not.toHaveBeenCalled();
    expect(importBatchRepository.markImportBatchApplied).not.toHaveBeenCalled();
  });
});

describe("canonical value change request routes", () => {
  const changeRequest = {
    id: "pvcr-1",
    projectId: "project-1",
    draftId: "pvdr-1",
    bindingId: "pbind-1",
    definitionId: "pdef_acme_power_iin_max",
    effectiveRevisionId: "rev-def-1",
    status: "pending" as const,
    targetValue: "<2000>",
    reason: "raise input current",
    submitterUserId: "user-1",
    assignedToUserId: null,
    reviewerUserId: null,
    reviewerNote: null,
    appliedValueId: null,
    applyOutcome: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
    vi.spyOn(dbClient, "isRootDatabase").mockReturnValue(true);
    vi.spyOn(auditedWrite, "withAuditedWrite").mockImplementation(async (db, _auth, _ctx, fn) => {
      const outcome = await fn(db as never);
      return outcome.result;
    });
    vi.spyOn(governanceAudit, "writeTrustedGovernanceAudit").mockResolvedValue(undefined as never);
  });

  it("submits a pending draft inside the audited write", async () => {
    const db = makeDb();
    vi.mocked(drafts.submitCanonicalValueChange).mockResolvedValue(changeRequest);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-value-drafts/pvdr-1/submit",
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(response.status).toBe(201);
    expect(drafts.submitCanonicalValueChange).toHaveBeenCalled();
  });

  it("routes approval authorization to the shared audited owner", async () => {
    const db = makeDb();
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue({} as never);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ request_kind: "single" }] } as never)
      .mockResolvedValue({ rows: [{ format: "json", config_revision_id: "revision-1" }] });
    const viewer = makeAuth({ permissions: ["parameter:view", "parameter:review"] });
    vi.mocked(drafts.reviewCanonicalValueChange).mockRejectedValueOnce(new ApiError("FORBIDDEN", "Parameter edit permission is required."));

    const response = await requestJson(
      makeServer({ db, auth: viewer }),
      "/api/v2/projects/project-1/parameter-value-change-requests/pvcr-1/review",
      { method: "POST", body: JSON.stringify({ decision: "approve" }) }
    );

    expect(response.status).toBe(403);
    expect(drafts.reviewCanonicalValueChange).toHaveBeenCalled();
  });

  it("lets an editor reject a pending request without a sensitive-node check", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ request_kind: "single" }] } as never)
      .mockResolvedValueOnce({ rows: [{ request_kind: "single", has_conflict_decision: false }] } as never);
    vi.mocked(drafts.reviewCanonicalValueChange).mockResolvedValue({
      ...changeRequest,
      status: "rejected",
      reviewerUserId: "user-1",
      reviewerNote: "not now"
    });

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-value-change-requests/pvcr-1/review",
      { method: "POST", body: JSON.stringify({ decision: "reject", note: "not now" }) }
    );

    expect(response.status).toBe(200);
    expect(drafts.reviewCanonicalValueChange).toHaveBeenCalled();
    expect(sensitiveNode.assertTrustedSensitiveNodeWriteAllowed).not.toHaveBeenCalled();
  });

  it("routes one frozen batch proof to the whole-cohort reviewer transaction", async () => {
    const db = makeDb();
    const proof = "a".repeat(64);
    const batch = { id: "pvcr-batch", status: "approved", batchProofDigest: proof,
      targets: [{ ordinal: 0, bindingId: "binding-a" }, { ordinal: 1, bindingId: "binding-b" }] };
    vi.mocked(db.query).mockResolvedValue({ rows: [{ request_kind: "batch" }] } as never);
    vi.mocked(catalogSync.loadPublishedCatalog).mockResolvedValue({} as never);
    vi.mocked(drafts.approveCanonicalBatchValueChange).mockResolvedValue(batch as never);
    vi.mocked(drafts.getCanonicalBatchValueChangeForReviewer).mockResolvedValue(batch as never);

    const response = await requestJson<{ item: typeof batch }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-value-change-requests/pvcr-batch/review",
      { method: "POST", body: JSON.stringify({ decision: "approve", batchProofDigest: proof }) }
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(batch);
    expect(drafts.approveCanonicalBatchValueChange).toHaveBeenCalledWith(
      db, expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ requestId: "pvcr-batch", batchProofDigest: proof })
    );
    expect(drafts.reviewCanonicalValueChange).not.toHaveBeenCalled();
  });

  it("returns the complete ordered batch only through the reviewer-scoped read", async () => {
    const db = makeDb();
    const batch = { id: "pvcr-batch", batchProofDigest: "a".repeat(64), status: "pending",
      targets: [{ ordinal: 0, bindingId: "binding-a" }, { ordinal: 1, bindingId: "binding-b" }] };
    vi.mocked(drafts.getCanonicalBatchValueChangeForReviewer).mockResolvedValue(batch as never);

    const response = await requestJson<{ item: typeof batch }>(
      makeServer({ db }), "/api/v2/projects/project-1/parameter-value-change-requests/pvcr-batch/batch"
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(batch);
    expect(drafts.getCanonicalBatchValueChangeForReviewer).toHaveBeenCalledWith(
      db, expect.anything(), { projectId: "project-1", requestId: "pvcr-batch" }
    );
  });

  it("reads the same frozen batch proof and ordered source targets for review", async () => {
    const db = makeDb();
    const proof = "a".repeat(64);
    const diff = { requestId: "pvcr-batch", candidateId: "candidate-batch", kind: "batch", batchProofDigest: proof,
      targets: [
        { ordinal: 0, bindingId: "binding-a", sourcePinId: "pin-a", action: "set" },
        { ordinal: 1, bindingId: "binding-b", sourcePinId: "pin-b", action: "set" }
      ] };
    vi.mocked(db.query).mockResolvedValue({ rows: [{ request_kind: "batch" }] } as never);
    vi.mocked(drafts.getCanonicalBatchValueChangeForReviewer).mockResolvedValue({
      id: "pvcr-batch", candidateId: "candidate-batch", batchProofDigest: proof, targets: diff.targets
    } as never);
    vi.mocked(sourceDiff.readCanonicalBatchSourceDiff).mockResolvedValue(diff as never);

    const response = await requestJson<{ item: typeof diff }>(
      makeServer({ db }),
      "/api/v2/projects/project-1/parameter-value-change-requests/pvcr-batch/source-diff"
    );

    expect(response.status).toBe(200);
    expect(response.body.item).toEqual(diff);
    expect(sourceDiff.readCanonicalBatchSourceDiff).toHaveBeenCalledWith(
      db, expect.anything(), expect.anything(), { projectId: "project-1", requestId: "pvcr-batch" }
    );
  });
});

describe("catalog pending-draft tray routes", () => {
  const topologyDraft = {
    id: "topo-draft-1",
    projectId: "project-1",
    parameterId: "pbind-1",
    targetValue: "<&gpio13 31 0>",
    action: "set" as const,
    reason: "PARAM-DRAFT-REMOVE acceptance draft",
    updatedAt: "2026-09-17T09:16:04.447Z",
    projectParameterBindingId: "pbind-1",
    candidateConfigRevisionId: "rev-candidate-1",
    parameterSpecId: "pspec:vendor/sc8562:gpio_int",
    bindingId: "pbind-1",
    effectiveRevisionId: "rev-binding-1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(drafts.listCanonicalValueDraftsForUser).mockResolvedValue([]);
    vi.mocked(parameterService.listDrafts).mockResolvedValue([]);
    vi.mocked(parameterService.deleteDraft).mockResolvedValue(undefined as never);
  });

  it("lists topology binding drafts on the canonical tray route when catalog C4 is empty", async () => {
    vi.mocked(parameterService.listDrafts).mockResolvedValue([topologyDraft]);

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/parameter-value-drafts"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        {
          id: "topo-draft-1",
          bindingId: "pbind-1",
          definitionId: "pspec:vendor/sc8562:gpio_int",
          effectiveRevisionId: "rev-binding-1",
          currentValueId: null,
          action: "set",
          targetValue: "<&gpio13 31 0>",
          sourceFormat: "dts",
          baseRevisionId: "rev-candidate-1",
          sourcePinId: null,
          candidateId: null,
          reason: "PARAM-DRAFT-REMOVE acceptance draft",
          updatedAt: "2026-09-17T09:16:04.447Z"
        }
      ]
    });
  });

  it("deletes a topology draft through the canonical tray route when C4 has no row", async () => {
    vi.mocked(drafts.removeCanonicalValueDraft).mockRejectedValue(
      new ApiError("NOT_FOUND", "Pending value draft was not found.")
    );

    const response = await requestJson(
      makeServer({ db: makeDb() }),
      "/api/v2/projects/project-1/parameter-value-drafts/topo-draft-1",
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: { id: "topo-draft-1" } });
    expect(parameterService.deleteDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "topo-draft-1",
      expect.objectContaining({
        invocation: expect.anything(),
        projectId: "project-1",
        requestId: expect.any(String)
      })
    );
  });
});

describe("canonical request tracking access", () => {
  const own = { id: "own-request", submitterUserId: "user-1" };
  const other = { id: "other-request", submitterUserId: "user-2" };
  beforeEach(() => {
    vi.mocked(drafts.listCanonicalValueChangesForAuth).mockResolvedValue(
      [own, other] as Awaited<ReturnType<typeof drafts.listCanonicalValueChangesForAuth>>
    );
  });

  it("returns only the authenticated submitter and denies another person's source diff", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    const server = makeServer({ db, withoutObjectStore: true });
    const response = await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests?mine=true");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [own] });
    const diff = await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests/other-request/source-diff");
    expect(diff.status).toBe(404);
  });

  it("keeps own pending work out of the reviewer queue while preserving personal and history views", async () => {
    vi.spyOn(reviewWorkflow, "hasCurrentCanonicalReviewRole").mockResolvedValue(true);
    const auth = makeAuth({ roles: [{ projectId: "project-1", roleId: "software-committer" }], permissions: ["parameter:view", "parameter:review"] });
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    const server = makeServer({ db, auth });
    expect((await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests")).body).toEqual({ items: [own, other] });
    expect((await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests?status=pending")).body).toEqual({ items: [other] });
    expect((await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests?mine=true")).body).toEqual({ items: [own] });
    vi.mocked(reviewWorkflow.hasCurrentCanonicalReviewRole).mockResolvedValue(false);
    expect((await requestJson(server, "/api/v2/projects/project-1/parameter-value-change-requests")).body).toEqual({ items: [own] });
  });

  it("rejects an unrelated project role, inactive account, and malformed mine filter", async () => {
    const auth = makeAuth({ roles: [{ projectId: "another-project", roleId: "software-user" }] });
    const unauthorized = await requestJson(makeServer({ db: makeDb(), auth }), "/api/v2/projects/project-1/parameter-value-change-requests");
    expect(unauthorized.status).toBe(403);
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    const hidden = await requestJson(makeServer({ db, auth, withoutObjectStore: true }), "/api/v2/projects/project-1/parameter-value-change-requests/own-request/source-diff");
    expect(hidden.status).toBe(404);
    const inactive = makeAuth();
    inactive.user = { ...inactive.user, isActive: false };
    expect((await requestJson(makeServer({ db: makeDb(), auth: inactive }), "/api/v2/projects/project-1/parameter-value-change-requests")).status).toBe(403);
    expect((await requestJson(makeServer({ db: makeDb() }), "/api/v2/projects/project-1/parameter-value-change-requests?mine=user-2")).status).toBe(400);
  });

  it("reports missing source storage only after confirming the submitter can see a single request", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never);
    const response = await requestJson(
      makeServer({ db, withoutObjectStore: true }),
      "/api/v2/projects/project-1/parameter-value-change-requests/own-request/source-diff"
    );
    expect(response.status).toBe(500);
    expect(drafts.listCanonicalValueChangesForAuth).toHaveBeenCalledWith(db, expect.anything(), { projectId: "project-1" });
  });

  it("checks batch reviewer visibility before reporting missing source storage", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({ rows: [{ request_kind: "batch" }] } as never);
    vi.mocked(drafts.getCanonicalBatchValueChangeForReviewer).mockResolvedValue(null);
    const path = "/api/v2/projects/project-1/parameter-value-change-requests/batch-request/source-diff";
    expect((await requestJson(makeServer({ db, withoutObjectStore: true }), path)).status).toBe(404);
    expect(drafts.getCanonicalBatchValueChangeForReviewer).toHaveBeenCalledWith(
      db, expect.anything(), { projectId: "project-1", requestId: "batch-request" }
    );

    vi.mocked(drafts.getCanonicalBatchValueChangeForReviewer).mockResolvedValue({ id: "batch-request" } as never);
    expect((await requestJson(makeServer({ db, withoutObjectStore: true }), path)).status).toBe(500);
  });
});
