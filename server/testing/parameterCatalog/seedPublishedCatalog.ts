import type pg from "pg";

import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../../modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { firstReleaseBundle } from "./cutoverPopulatedFixture";
import { compileVendorCatalogSuccessor } from "../../../scripts/compile-vendor-catalog-release";

export async function seedPublishedCatalog(pool: pg.Pool) {
  const vendor = compileVendorCatalogSuccessor();
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind === "installed" && pointer.current.id === vendor.compiled.release.id
    && pointer.current.digest === vendor.compiled.release.digest) {
    return pointer.current;
  }
  if (pointer.kind === "empty") {
    const first = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: vendor.predecessor.digest
    });
    if (!first.ok) throw new Error(`catalog-seed-${first.error.kind}`);
  }
  const installed = await installPublishedRelease(pool, {
    mode: "advance",
    source: jsonCatalogReleaseSource(vendor.bundle),
    expectedTargetDigest: vendor.compiled.aggregateDigest,
    expectedCurrent: vendor.predecessor
  });
  if (!installed.ok) throw new Error(`catalog-seed-${installed.error.kind}`);
  return vendor.compiled.release;
}
