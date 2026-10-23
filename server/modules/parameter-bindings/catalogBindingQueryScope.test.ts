import { describe, expect, it, vi } from "vitest";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";

describe("canonical binding read project scope", () => {
  it.each(["change-history", "export"])("rejects a foreign organization's project before reading %s", async (operation) => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const get = vi.fn();
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db: { query, transaction: vi.fn() },
      objectStore: { get, put: vi.fn() },
      getCurrentAuthContext: () => makeTestAuthContext({
        roles: [{ roleId: "software-user", projectId: "project-a" }],
        permissions: ["parameter:view"]
      })
    });
    const response = await requestJson(createHttpServer(router), `/api/v2/projects/project-b/parameter-bindings/binding-b/${operation}`);
    expect(response.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("from projects");
    expect(query.mock.calls[0]?.[1]).toEqual(["org-test", "project-b"]);
    expect(get).not.toHaveBeenCalled();
  });
});
