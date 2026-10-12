import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCurrentCatalogPointer, type CatalogPointerState } from "../server/modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../server/modules/catalog-kernel/install/installer";
import type { Database } from "../server/shared/database/client";
import {
  CatalogReleaseDigest, CatalogReleaseId, CatalogReleaseVersion,
} from "../server/modules/parameter-catalog-contract";
import {
  FIRST_ACME_RELEASE_DIGEST, FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST, VENDOR_SUCCESSOR_RELEASE_ID,
  VENDOR_CONSTRAINED_AGGREGATE_DIGEST, VENDOR_CONSTRAINED_RELEASE_ID,
  VENDOR_LOCALIZED_AGGREGATE_DIGEST, VENDOR_LOCALIZED_RELEASE_ID,
} from "./compile-vendor-catalog-release";
import { seedQualityCanonicalBindings } from "./seed-quality-visual-review";

vi.mock("../server/modules/catalog-kernel/install/currentPointer", () => ({
  readCurrentCatalogPointer: vi.fn(),
}));
vi.mock("../server/modules/catalog-kernel/install/installer", () => ({
  installPublishedRelease: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../server/shared/database/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/shared/database/client")>(),
  getRootPostgresPool: vi.fn(() => ({})),
}));

const installed = (id: string, digest: string): CatalogPointerState => ({
  kind: "installed",
  current: { id: CatalogReleaseId(id), digest: CatalogReleaseDigest(digest), version: CatalogReleaseVersion("1.0.0") },
  predecessorReleaseId: null,
});
const acme = installed(FIRST_ACME_RELEASE_ID, FIRST_ACME_RELEASE_DIGEST);
const vendor = installed(VENDOR_SUCCESSOR_RELEASE_ID, VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
const constrained = installed(VENDOR_CONSTRAINED_RELEASE_ID, VENDOR_CONSTRAINED_AGGREGATE_DIGEST);
const localized = installed(VENDOR_LOCALIZED_RELEASE_ID, VENDOR_LOCALIZED_AGGREGATE_DIGEST);

describe("quality canonical Catalog pointer", () => {
  const db: Database = { query: vi.fn(), transaction: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE", "true");
    vi.stubEnv("WISEEFF_QUALITY_FIXTURE_DATABASE_NAME", "quality_fixture");
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ database_name: "quality_fixture" }], rowCount: 1 })
      .mockResolvedValue({ rows: ["atlas", "aurora", "nebula"].map((project_id) => ({ project_id, count: 1, unpinned: 0 })), rowCount: 3 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    { name: "empty", pointers: [{ kind: "empty" } as CatalogPointerState, acme, vendor, constrained, localized], releases: [FIRST_ACME_RELEASE_ID, VENDOR_SUCCESSOR_RELEASE_ID, VENDOR_CONSTRAINED_RELEASE_ID, VENDOR_LOCALIZED_RELEASE_ID] },
    { name: "Acme", pointers: [acme, vendor, constrained, localized], releases: [VENDOR_SUCCESSOR_RELEASE_ID, VENDOR_CONSTRAINED_RELEASE_ID, VENDOR_LOCALIZED_RELEASE_ID] },
    { name: "vendor release 1", pointers: [vendor, constrained, localized], releases: [VENDOR_CONSTRAINED_RELEASE_ID, VENDOR_LOCALIZED_RELEASE_ID] },
    { name: "constrained release", pointers: [constrained, localized], releases: [VENDOR_LOCALIZED_RELEASE_ID] },
    { name: "localized release", pointers: [localized], releases: [] },
  ])("advances $name only through the reviewed lineage to release 3", async ({ pointers, releases }) => {
    const readPointer = vi.mocked(readCurrentCatalogPointer);
    for (const pointer of pointers) readPointer.mockResolvedValueOnce(pointer);
    readPointer.mockResolvedValue(localized);

    const expected = { catalogReleaseId: VENDOR_LOCALIZED_RELEASE_ID, written: { atlas: 1, aurora: 1, nebula: 1 }, skipped: [] };
    expect(await seedQualityCanonicalBindings(db)).toEqual(expected);
    const installs = vi.mocked(installPublishedRelease).mock.calls;
    expect(await Promise.all(installs.map(async ([, command]) => {
      if (command.mode !== "bootstrap" && command.mode !== "advance") throw new Error("Unexpected fixture install mode");
      const bundle = JSON.parse(Buffer.from(await command.source.readManifest()).toString("utf8"));
      return bundle.releases.at(-1).manifest.release.id;
    }))).toEqual(releases);
    if (releases.length) {
      expect(installs.at(-1)?.[1]).toMatchObject({
        mode: "advance", expectedTargetDigest: VENDOR_LOCALIZED_AGGREGATE_DIGEST,
        expectedCurrent: { id: VENDOR_CONSTRAINED_RELEASE_ID, digest: VENDOR_CONSTRAINED_AGGREGATE_DIGEST },
      });
    }
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ database_name: "quality_fixture" }], rowCount: 1 });
    expect(await seedQualityCanonicalBindings(db)).toEqual(expected);
    expect(installPublishedRelease).toHaveBeenCalledTimes(releases.length);
  });

  it.each([VENDOR_SUCCESSOR_RELEASE_ID, VENDOR_CONSTRAINED_RELEASE_ID, VENDOR_LOCALIZED_RELEASE_ID, "crel_unrelated"])(
    "refuses %s with a non-reviewed digest instead of replacing its pointer", async (id) => {
      vi.mocked(readCurrentCatalogPointer).mockResolvedValue(installed(id, FIRST_ACME_RELEASE_DIGEST));
      await expect(seedQualityCanonicalBindings(db)).rejects.toThrow("requires the exact vendor Catalog pointer");
      expect(installPublishedRelease).not.toHaveBeenCalled();
    },
  );
});
