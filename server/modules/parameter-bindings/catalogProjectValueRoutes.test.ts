import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestAuthContext } from "../../testing/authContext";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { parameterImportBatchResponseSchema } from "../contracts/dtoSchemas/parameters";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";
import * as catalogSync from "./catalogProjectValueSync";
import * as importBatchRepository from "../parameters/importBatchRepository";
import * as parameterService from "../parameters/service";
import * as auditedWrite from "../audit/auditedWrite";
import * as dbClient from "../../shared/database/client";
import * as sensitiveNode from "../parameter-kernel/sensitiveNode";
import * as governanceAudit from "../parameter-topology/governanceAudit";

vi.mock("./catalogProjectValueSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalogProjectValueSync")>();
  return {
    ...actual,
    findCatalogBindingRow: vi.fn(),
    saveCanonicalProjectValue: vi.fn(),
    listCatalogBindingsForImport: vi.fn()
  };
});

vi.mock("../parameters/importBatchRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/importBatchRepository")>();
  return {
    ...actual,
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

vi.mock("../parameters/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/service")>();
  return {
    ...actual,
    applyImportBatch: vi.fn(),
    createImportPreview: vi.fn()
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
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeServer(options: { db?: Database; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerCatalogProjectValueConsumerRoutes(router, {
    db: options.db,
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
    vi.spyOn(dbClient, "getRootPostgresPool").mockReturnValue({ query: vi.fn() } as never);
    vi.spyOn(auditedWrite, "withAuditedWrite").mockImplementation(async (db, _auth, _ctx, fn) => {
      const outcome = await fn(db as never);
      return outcome.result;
    });
  });

  it("returns the contract import-batch DTO after a catalog-owned apply", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (sql.includes("from parameter_import_batches")) {
        return {
          rows: [
            {
              items: [
                {
                  id: "item-1",
                  name: "iin_max",
                  classification: "updated",
                  projectParameterValueId: "pbind-1",
                  currentValue: "3000"
                }
              ],
              project_id: "project-1"
            }
          ]
        };
      }
      if (sql.includes("config_revision_id")) {
        return { rows: [{ config_revision_id: "rev-1" }] };
      }
      return { rows: [] };
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue({
      id: "pbind-1",
      organization_id: "org-1",
      catalog_release_id: "crel_acme_1",
      project_id: "project-1",
      logical_node_id: "node-1",
      registration_id: "reg-1",
      subject_id: "csub_acme_power",
      definition_id: "pdef_acme_power_iin_max",
      effective_revision_id: "rev-def-1",
      current_value_id: "val-1"
    });
    vi.mocked(catalogSync.saveCanonicalProjectValue).mockResolvedValue({
      bindingId: "pbind-1",
      currentValueId: "val-2",
      definitionId: "pdef_acme_power_iin_max",
      propertyKey: "iin_max",
      rawText: "<3000>"
    } as never);
    vi.mocked(importBatchRepository.markImportBatchApplied).mockResolvedValue(appliedBatch);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v1/parameter-import-batches/batch-1/apply",
      {
        method: "POST",
        body: JSON.stringify({ selectedItemIds: ["item-1"] })
      }
    );

    expect(response.status).toBe(200);
    expect(parameterImportBatchResponseSchema.parse(response.body)).toEqual({ item: appliedBatch });
    expect(parameterService.applyImportBatch).not.toHaveBeenCalled();
    expect(importBatchRepository.markImportBatchApplied).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      batchId: "batch-1"
    });
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
    expect(parameterService.createImportPreview).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({ projectId: "project-1" }),
      { requestId: "test-request" }
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("update parameter_import_batches"),
      expect.arrayContaining(["batch-preview-1"])
    );
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
    const persisted = JSON.parse(vi.mocked(db.query).mock.calls[0]?.[1]?.[1] as string) as Array<{
      projectParameterValueId?: string;
    }>;
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

  it("saves a canonical value when the editor is bound to the target project", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ node_locator: "/charger", compatible: "acme,power" }]
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue({
      ...catalogBinding,
      project_id: "project-a"
    });
    vi.mocked(catalogSync.saveCanonicalProjectValue).mockResolvedValue({
      bindingId: "pbind-1",
      currentValueId: "val-2",
      definitionId: "pdef_acme_power_iin_max",
      propertyKey: "iin_max",
      rawText: "<2000>"
    });
    vi.mocked(sensitiveNode.assertTrustedSensitiveNodeWriteAllowed).mockResolvedValue(undefined as never);

    const response = await requestJson(
      makeServer({ db, auth: projectEditor("project-a") }),
      "/api/v2/projects/project-a/parameter-bindings/pbind-1/drafts",
      { method: "POST", body: JSON.stringify(draftBody) }
    );

    expect(response.status).toBe(201);
    expect(catalogSync.saveCanonicalProjectValue).toHaveBeenCalled();
  });

  it("still allows an admin to save a canonical value on any project", async () => {
    const db = makeDb();
    vi.mocked(db.query).mockResolvedValue({
      rows: [{ node_locator: "/charger", compatible: "acme,power" }]
    });
    vi.mocked(catalogSync.findCatalogBindingRow).mockResolvedValue(catalogBinding);
    vi.mocked(catalogSync.saveCanonicalProjectValue).mockResolvedValue({
      bindingId: "pbind-1",
      currentValueId: "val-2",
      definitionId: "pdef_acme_power_iin_max",
      propertyKey: "iin_max",
      rawText: "<2000>"
    });
    vi.mocked(sensitiveNode.assertTrustedSensitiveNodeWriteAllowed).mockResolvedValue(undefined as never);

    const response = await requestJson(
      makeServer({ db }),
      "/api/v2/projects/project-b/parameter-bindings/pbind-1/drafts",
      { method: "POST", body: JSON.stringify(draftBody) }
    );

    expect(response.status).toBe(201);
    expect(catalogSync.saveCanonicalProjectValue).toHaveBeenCalled();
  });
});
