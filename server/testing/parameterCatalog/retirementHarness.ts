import { expect } from "vitest";

import { createWiseEffServer, type WiseEffServerOptions } from "../../app";
import { catalogLegacyGoneResponseSchema } from "../../modules/contracts/dtoSchemas/parameterCatalog";
import type { Database } from "../../shared/database/client";
import type { HttpMethod } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";

export function createRetirementTestHarness(
  options: WiseEffServerOptions & { db: Database; legacyTables: readonly string[] },
) {
  const server = createWiseEffServer(options);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of options.legacyTables) {
      if (!/^[a-z_]+$/.test(table)) throw new Error(`Invalid legacy table: ${table}`);
      rows[table] = (await options.db.query(
        `select count(*)::text as count, coalesce(jsonb_agg(to_jsonb(legacy) order by to_jsonb(legacy)::text), '[]'::jsonb) as rows from ${table} legacy`,
      )).rows;
    }
    return rows;
  };
  return {
    server,
    async assertRetired(
      route: { method: HttpMethod; path: string },
      init: RequestInit = {},
    ) {
      const before = await snapshot();
      const response = await requestJson(server, route.path, { ...init, method: route.method });
      expect(response.status, `${route.method} ${route.path}`).toBe(410);
      const body = catalogLegacyGoneResponseSchema.parse(response.body);
      expect(body.error).toMatchObject({
        code: "GONE",
        details: { reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false },
        requestId: new Headers(init.headers).get("x-request-id") ?? "test-request",
      });
      expect(response.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
      expect(await snapshot()).toEqual(before);
      return response;
    },
  };
}
