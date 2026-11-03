import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../server/shared/database/client";
import { CatalogReleaseDigest, CatalogReleaseId, CatalogReleaseVersion } from "../server/modules/parameter-catalog-contract";
import { seedCurrentDemoCatalog } from "../server/testing/parameterCatalog/seedCurrentDemoCatalog";
import { VENDOR_OWNED_AGGREGATE_DIGEST, VENDOR_OWNED_RELEASE_ID } from "./compile-owned-vendor-catalog-release";
import { seedQualityCanonicalBindings } from "./seed-quality-visual-review";

vi.mock("../server/testing/parameterCatalog/seedCurrentDemoCatalog", () => ({ seedCurrentDemoCatalog: vi.fn() }));

describe("quality canonical Catalog pointer", () => {
  const db: Database = { query: vi.fn(), transaction: vi.fn() };
  const current = {
    id: CatalogReleaseId(VENDOR_OWNED_RELEASE_ID), digest: CatalogReleaseDigest(VENDOR_OWNED_AGGREGATE_DIGEST),
    version: CatalogReleaseVersion("1.3.0"),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "true");
    vi.stubEnv("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME", "quality_fixture");
    vi.mocked(seedCurrentDemoCatalog).mockResolvedValue(current);
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ database_name: "quality_fixture" }], rowCount: 1 })
      .mockResolvedValue({ rows: ["atlas", "aurora", "nebula"].map((project_id) => ({ project_id, count: 1, unpinned: 0 })), rowCount: 3 });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("reuses the current owned demo Catalog and current source pins on repeated runs", async () => {
    const expected = { catalogReleaseId: VENDOR_OWNED_RELEASE_ID, written: { atlas: 1, aurora: 1, nebula: 1 }, skipped: [] };
    expect(await seedQualityCanonicalBindings(db)).toEqual(expected);
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ database_name: "quality_fixture" }], rowCount: 1 });
    expect(await seedQualityCanonicalBindings(db)).toEqual(expected);
    expect(seedCurrentDemoCatalog).toHaveBeenCalledWith(db);
  });

  it.each(["crel_vendor_catalog_3", "crel_unrelated"])("refuses preserved %s instead of seeding against another Catalog", async (id) => {
    vi.mocked(seedCurrentDemoCatalog).mockResolvedValue({ ...current, id: CatalogReleaseId(id) });
    await expect(seedQualityCanonicalBindings(db)).rejects.toThrow("requires the exact vendor Catalog pointer");
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("refuses a matching release id with a different digest", async () => {
    vi.mocked(seedCurrentDemoCatalog).mockResolvedValue({ ...current, digest: CatalogReleaseDigest("sha256:" + "0".repeat(64)) });
    await expect(seedQualityCanonicalBindings(db)).rejects.toThrow("requires the exact vendor Catalog pointer");
  });

  it("rejects stale source pins", async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ project_id: "aurora", count: 1, unpinned: 1 }], rowCount: 1 });
    await expect(seedQualityCanonicalBindings(db)).rejects.toThrow("without current source-file pins");
  });

  it("checks isolated-fixture authorization before any Catalog work", async () => {
    vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "false");
    await expect(seedQualityCanonicalBindings(db)).rejects.toThrow();
    expect(seedCurrentDemoCatalog).not.toHaveBeenCalled();
  });
});
