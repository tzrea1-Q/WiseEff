import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogPageLimit, createCatalogKernel } from "../interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { seedCompiledCatalogProjection } from "./currentSnapshot";

describe("pinned catalog snapshot", () => {
  let database: ParameterCatalogDatabase;
  let pins: Awaited<ReturnType<typeof seedCompiledCatalogProjection>>;
  let pool: pg.Pool;
  let kernel: ReturnType<typeof createCatalogKernel>;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s3pin");
    pins = await seedCompiledCatalogProjection(database.url);
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    kernel = createCatalogKernel(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("loads an exact pin and does not consult the current pointer", async () => {
    const pinned = await kernel.loadPinnedCatalog(pins.previous);
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(pinned.value.snapshotKind).toBe("pinned");
    expect(pinned.value.pin).toEqual(pins.previous);
    expect(pinned.value.release.id).toBe(pins.previous.id);
    const extra = pinned.value.getDefinition({
      subjectId: "csub_acme_power" as never,
      propertyKey: "iin_min" as never,
    });
    expect(extra.status).toBe("unknown");
  });

  it("does not accept a current-release cursor on the pinned snapshot", async () => {
    const current = await kernel.loadCurrentCatalog(pins.current);
    const pinned = await kernel.loadPinnedCatalog(pins.previous);
    if (!current.ok || !pinned.ok) throw new Error("failed to load snapshots");
    const page = current.value.listSubjects({
      selection: { kind: "all" },
      kinds: [],
      lifecycles: [],
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    if (page.status !== "found") {
      throw new Error("expected current subject page");
    }
    const after =
      page.page.next.kind === "present"
        ? page.page.next
        : ({ kind: "present", value: "not-a-cursor" as never } as const);
    expect(
      pinned.value.listSubjects({
        selection: { kind: "all" },
        kinds: [],
        lifecycles: [],
        search: { kind: "absent" },
        page: { limit: CatalogPageLimit(1), after },
      }).status,
    ).toBe("invalid-page");
  });
});
