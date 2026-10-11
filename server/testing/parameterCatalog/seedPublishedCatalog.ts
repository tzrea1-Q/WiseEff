import type pg from "pg";

import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { readCurrentCatalogPointer } from "../../modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { firstReleaseBundle } from "./cutoverPopulatedFixture";
import { compileLocalizedVendorCatalogSuccessor } from "../../../scripts/compile-vendor-catalog-release";

export async function seedPublishedCatalog(pool: pg.Pool) {
  const localized = compileLocalizedVendorCatalogSuccessor();
  const vendor = localized.previous;
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind === "installed" && pointer.current.id === localized.compiled.release.id
    && pointer.current.digest === localized.compiled.release.digest) {
    return pointer.current;
  }
  if (pointer.kind === "empty") {
    const first = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: vendor.previous.predecessor.digest
    });
    if (!first.ok) throw new Error(`catalog-seed-${first.error.kind}`);
  }
  if (pointer.kind === "empty" || (pointer.kind === "installed" && pointer.current.id === vendor.previous.predecessor.id)) {
    const previous = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(vendor.previous.bundle),
      expectedTargetDigest: vendor.previous.compiled.aggregateDigest,
      expectedCurrent: vendor.previous.predecessor
    });
    if (!previous.ok) throw new Error(`catalog-seed-${previous.error.kind}`);
  }
  if (pointer.kind === "empty" || (pointer.kind === "installed" && pointer.current.id !== vendor.compiled.release.id)) {
    const installed = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(vendor.bundle),
      expectedTargetDigest: vendor.compiled.aggregateDigest,
      expectedCurrent: vendor.predecessor
    });
    if (!installed.ok) throw new Error(`catalog-seed-${installed.error.kind}`);
  }
  const installed = await installPublishedRelease(pool, {
    mode: "advance",
    source: jsonCatalogReleaseSource(localized.bundle),
    expectedTargetDigest: localized.compiled.aggregateDigest,
    expectedCurrent: localized.predecessor
  });
  if (!installed.ok) throw new Error(`catalog-seed-${installed.error.kind}`);
  return localized.compiled.release;
}
