import { describe, expect, it } from "vitest";

import { buildWiseEffRouter } from "../../app";
import type { Database } from "../../shared/database/client";
import { routeManifest } from "./routeManifest";
import { schemaRegistry } from "./schemaRegistry";

/**
 * Contract parity: the hand-maintained route manifest must equal the real runtime
 * registration. `contract:check` already guards "generator output == committed
 * openapi.json artifact"; this test closes the other half — "manifest == what the
 * server actually registers" — so a new route cannot ship unpublished and the
 * manifest cannot carry ghost entries.
 */

/**
 * Routes that are deliberately not part of the API contract.
 * Every entry needs a reason.
 */
const CONTRACT_EXEMPT = new Set<string>([
  // Internal operations scrape surface; served only over a private network
  // (ARCHITECTURE.md), never part of the client-facing API contract.
  "GET /metrics"
]);

const isCatalogContractAheadOfRuntime = (key: string): boolean =>
  key.includes(" /api/v2/catalog");

function routeKey(method: string, pattern: string) {
  return `${method.toUpperCase()} ${pattern}`;
}

/**
 * Registration-only stub: some modules (xiaoze) skip registration entirely without a
 * db handle, and the contract must cover the full production surface. No query runs
 * during registration.
 */
const stubDb: Database = {
  query: async () => ({ rows: [], rowCount: 0 }),
  transaction: async (fn) => fn(stubDb)
};

function registeredKeys(): Set<string> {
  const { router } = buildWiseEffRouter({ db: stubDb });
  return new Set(router.listRoutes().map((route) => routeKey(route.method, route.pattern)));
}

function manifestKeys(): Set<string> {
  return new Set(routeManifest.map((route) => routeKey(route.method, route.path)));
}

describe("route manifest parity", () => {
  it("every registered route is published in the manifest", () => {
    const manifest = manifestKeys();
    const unpublished = [...registeredKeys()]
      .filter((key) => !manifest.has(key) && !CONTRACT_EXEMPT.has(key))
      .sort();

    expect(unpublished, "registered but missing from routeManifest — add manifest + schema entries").toEqual([]);
  });

  it("every manifest route is actually registered", () => {
    const registered = registeredKeys();
    const ghosts = [...manifestKeys()]
      .filter((key) => !registered.has(key) && !isCatalogContractAheadOfRuntime(key))
      .sort();

    expect(ghosts, "in routeManifest but not registered — remove or fix the entry").toEqual([]);
  });

  it("exempt routes are registered and never also in the manifest", () => {
    const registered = registeredKeys();
    const manifest = manifestKeys();
    for (const key of CONTRACT_EXEMPT) {
      expect(registered.has(key), `${key} is exempt but not registered — drop the stale exemption`).toBe(true);
      expect(manifest.has(key), `${key} is both exempt and in the manifest — pick one`).toBe(false);
    }
  });

  it("every manifest route has a schema registry entry", () => {
    const missing = routeManifest
      .filter((route) => !schemaRegistry[route.id])
      .map((route) => route.id)
      .sort();

    expect(missing, "manifest entries without schemaRegistry entries").toEqual([]);
  });
});
