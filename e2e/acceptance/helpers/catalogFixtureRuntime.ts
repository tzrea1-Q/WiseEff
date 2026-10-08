import { test as base } from "playwright/test";

import { catalogLaneConnectionString } from "./catalogAcceptanceEnvironment";
import { installCatalogAcceptanceFixtureOn, type CatalogAcceptanceFixture } from "./catalogEvidence";
import { startDisposablePostCutoverRuntime, type DisposablePostCutoverRuntime } from "./disposablePostCutoverRuntime";
import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "./ownedRuntimeDescriptor";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  restoreProcessEnvFromDisposableRuntime,
  type DisposableEnvSnapshot,
} from "./semanticBindingFixture";

/**
 * The shared lane already carries the seeded Catalog (`crel_acme_1` plus
 * `crel_vendor_catalog_1`), and the installer refuses a second bootstrap there.
 * Catalog specs that assert the A-to-F fixture chain therefore run in one
 * fixture-owned disposable runtime per Playwright worker: a fresh database with
 * no seeded Catalog, and a dedicated API and frontend. Playwright's static
 * `baseURL` cannot follow a runtime started at worker time, so catalog helpers
 * build absolute URLs with `catalogAppUrl`.
 */
type CatalogFixtureRuntimeWorker = {
  catalogRuntimeDatabaseUrl: string | undefined;
  catalogRuntime: DisposablePostCutoverRuntime;
};

type CatalogAcceptanceFixtureWorker = {
  catalogAcceptanceRuntime: { runtime: DisposablePostCutoverRuntime; fixture: CatalogAcceptanceFixture };
};

let parentLaneUrl: string | undefined;
let parentEnvSnapshot: DisposableEnvSnapshot | undefined;
let frontendOrigin: string | undefined;

/** The shared lane URL captured before the disposable runtime replaces DATABASE_URL. */
export function catalogParentLaneUrl(): string {
  if (!parentLaneUrl) throw new Error("Catalog fixture runtime has not started in this worker.");
  return parentLaneUrl;
}

/** The environment the shared lane was verified with, before the fixture runtime replaced its auth and descriptor. */
export function catalogParentLaneEnv(): Record<string, string | undefined> {
  if (!parentLaneUrl || !parentEnvSnapshot) throw new Error("Catalog fixture runtime has not started in this worker.");
  return {
    ...process.env,
    DATABASE_URL: parentLaneUrl,
    AUTH_TOKEN_ISSUER: parentEnvSnapshot.authIssuer,
    AUTH_TOKEN_HMAC_SECRET: parentEnvSnapshot.authSecret,
    [OWNED_ACCEPTANCE_DESCRIPTOR_ENV]: parentEnvSnapshot.ownedDescriptor,
  };
}

/** Absolute URL of a catalog app route in the fixture runtime, or the path when no runtime is active. */
export function catalogAppUrl(route: string): string {
  return frontendOrigin ? new URL(route, frontendOrigin).toString() : route;
}

export const catalogRuntimeTest = base.extend<{}, CatalogFixtureRuntimeWorker>({
  catalogRuntimeDatabaseUrl: [undefined, { scope: "worker", option: true }],
  catalogRuntime: [async ({ catalogRuntimeDatabaseUrl }, use) => {
    const lane = catalogRuntimeDatabaseUrl ?? await catalogLaneConnectionString();
    const snapshot = captureProcessEnvForDisposableRuntime();
    const runtime = await startDisposablePostCutoverRuntime(lane, {
      label: "catalog-acceptance",
      markerPurpose: "catalog-acceptance",
      catalog: "fixture-owned",
    });
    try {
      applyDisposableRuntimeEnv(runtime);
      parentLaneUrl = lane;
      parentEnvSnapshot = snapshot;
      frontendOrigin = runtime.frontendUrl;
      await use(runtime);
    } finally {
      frontendOrigin = undefined;
      parentLaneUrl = undefined;
      parentEnvSnapshot = undefined;
      restoreProcessEnvFromDisposableRuntime(snapshot);
      await runtime.dispose("success");
    }
  }, { scope: "worker" }],
});

export const test = catalogRuntimeTest.extend<{}, CatalogAcceptanceFixtureWorker>({
  catalogAcceptanceRuntime: [async ({ catalogRuntime }, use) => {
    const fixture = await installCatalogAcceptanceFixtureOn(catalogRuntime.databaseUrl);
    try {
      await use({ runtime: catalogRuntime, fixture });
    } finally {
      await fixture.pool.end();
    }
  }, { scope: "worker" }],
});
