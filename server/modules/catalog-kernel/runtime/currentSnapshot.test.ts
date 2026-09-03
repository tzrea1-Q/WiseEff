import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  PropertyKey,
  createCatalogKernel,
} from "../interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { seedCompiledCatalogProjection } from "./currentSnapshot";

describe("current catalog snapshot", () => {
  let database: ParameterCatalogDatabase;
  let pins: Awaited<ReturnType<typeof seedCompiledCatalogProjection>>;
  let kernel: ReturnType<typeof createCatalogKernel>;
  let pool: pg.Pool;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s3run");
    pins = await seedCompiledCatalogProjection(database.url);
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    kernel = createCatalogKernel(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("captures tagged reads and applies filters before paging", async () => {
    const loaded = await kernel.loadCurrentCatalog(pins.current);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const snapshot = loaded.value;
    expect(snapshot.snapshotKind).toBe("current");
    expect(snapshot.getSubject(CatalogSubjectId("missing"))).toEqual({
      status: "unknown",
      target: "subject",
    });
    const found = snapshot.getSubject(CatalogSubjectId("csub_acme_power"));
    expect(found.status).toBe("found");

    const filtered = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: [],
      propertyKey: { kind: "present", value: PropertyKey("iin_min") },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    expect(filtered.status).toBe("found");
    if (filtered.status === "found") {
      expect(filtered.page.items).toHaveLength(1);
      expect(filtered.page.items[0]?.propertyKey).toBe("iin_min");
    }

    const firstPage = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: [],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    expect(firstPage.status).toBe("found");
    if (firstPage.status !== "found" || firstPage.page.next.kind !== "present") {
      throw new Error("expected a continuation cursor");
    }
    const nextPage = snapshot.listDefinitions({
      selection: { kind: "all" },
      scope: { kind: "all" },
      lifecycles: [],
      propertyKey: { kind: "absent" },
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: firstPage.page.next },
    });
    expect(nextPage.status).toBe("found");
  });

  it("rejects a current cursor reused against a pinned snapshot", async () => {
    const current = await kernel.loadCurrentCatalog(pins.current);
    const pinned = await kernel.loadPinnedCatalog(pins.previous);
    expect(current.ok && pinned.ok).toBe(true);
    if (!current.ok || !pinned.ok) return;
    const page = current.value.listSubjects({
      selection: { kind: "all" },
      kinds: [],
      lifecycles: [],
      search: { kind: "absent" },
      page: { limit: CatalogPageLimit(1), after: { kind: "absent" } },
    });
    expect(page.status).toBe("found");
    if (page.status !== "found") return;
    const replay = pinned.value.listSubjects({
      selection: { kind: "all" },
      kinds: [],
      lifecycles: [],
      search: { kind: "absent" },
      page:
        page.page.next.kind === "present"
          ? { limit: CatalogPageLimit(1), after: page.page.next }
          : { limit: CatalogPageLimit(1), after: { kind: "present", value: "not-a-cursor" as never } },
    });
    expect(replay.status).toBe("invalid-page");
  });

  it("does not treat a missing current pointer as a null snapshot", async () => {
    const missing = await kernel.loadCurrentCatalog({
      id: CatalogReleaseId("crel_missing"),
      digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.kind).toBe("release-mismatch");
    }
  });
});
