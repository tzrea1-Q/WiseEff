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

vi.mock("./catalogProjectValueSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalogProjectValueSync")>();
  return {
    ...actual,
    findCatalogBindingRow: vi.fn(),
    saveCanonicalProjectValue: vi.fn()
  };
});

vi.mock("../parameters/importBatchRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/importBatchRepository")>();
  return {
    ...actual,
    markImportBatchApplied: vi.fn()
  };
});

vi.mock("../parameters/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parameters/service")>();
  return {
    ...actual,
    applyImportBatch: vi.fn()
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
});
