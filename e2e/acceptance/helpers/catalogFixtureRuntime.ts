import { test as base } from "playwright/test";

import { catalogLaneConnectionString } from "./catalogAcceptanceEnvironment";
import { installCatalogAcceptanceFixtureOn, type CatalogAcceptanceFixture } from "./catalogEvidence";
import { startDisposablePostCutoverRuntime, type DisposablePostCutoverRuntime } from "./disposablePostCutoverRuntime";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  restoreProcessEnvFromDisposableRuntime,
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
  catalogAcceptanceRuntime: { runtime: DisposablePostCutoverRuntime; fixture: CatalogAcceptanceFixture };
};

let parentLaneUrl: string | undefined;
let frontendOrigin: string | undefined;

/** The shared lane URL captured before the disposable runtime replaces DATABASE_URL. */
export function catalogParentLaneUrl(): string {
  if (!parentLaneUrl) throw new Error("Catalog fixture runtime has not started in this worker.");
  return parentLaneUrl;
}

/** Absolute URL of a catalog app route in the fixture runtime, or the path when no runtime is active. */
export function catalogAppUrl(route: string): string {
  return frontendOrigin ? new URL(route, frontendOrigin).toString() : route;
}

export const test = base.extend<{}, CatalogFixtureRuntimeWorker>({
  catalogAcceptanceRuntime: [async ({}, use) => {
    const lane = await catalogLaneConnectionString();
    const snapshot = captureProcessEnvForDisposableRuntime();
    const runtime = await startDisposablePostCutoverRuntime(lane, {
      label: "catalog-acceptance",
      markerPurpose: "catalog-acceptance",
      catalog: "fixture-owned",
    });
    try {
      applyDisposableRuntimeEnv(runtime);
      parentLaneUrl = lane;
      frontendOrigin = runtime.frontendUrl;
      const fixture = await installCatalogAcceptanceFixtureOn(runtime.databaseUrl);
      try {
        await use({ runtime, fixture });
      } finally {
        await fixture.pool.end();
      }
    } finally {
      frontendOrigin = undefined;
      parentLaneUrl = undefined;
      restoreProcessEnvFromDisposableRuntime(snapshot);
      await runtime.dispose("success");
    }
  }, { scope: "worker" }],
});
