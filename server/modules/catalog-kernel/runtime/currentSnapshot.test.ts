import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  ParameterDefinitionId,
  PropertyKey,
  createCatalogKernel,
} from "../interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { seedCompiledCatalogProjection } from "./currentSnapshot";
import { catalogReadTransaction } from "./readTransaction";

const page = { limit: CatalogPageLimit(100), after: { kind: "absent" } } as const;

const queryLog = (pool: pg.Pool): string[] => {
  const queries: string[] = [];
  pool.on("connect", (client) => {
    const query = client.query.bind(client);
    client.query = ((sql: string, values?: unknown[]) => {
      queries.push(sql);
      return query(sql, values);
    }) as typeof client.query;
  });
  return queries;
};

const createCacheReader = (pool: pg.Pool) => {
  const queries = queryLog(pool);
  const projectionReads = () => queries.filter((sql) => sql.includes("from parameter_catalog.catalog_release_definition_heads"));
  const headerReads = () => queries.filter((sql) => sql.includes("as pointer_id"));
  return { queries, projectionReads, headerReads, kernel: createCatalogKernel(pool) };
};

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

  it("shares a single cold build and executes only the header on warm current and pinned reads", async () => {
    const reader = new pg.Pool({ connectionString: database.url, max: 4 });
    const { kernel, queries, projectionReads, headerReads } = createCacheReader(reader);
    try {
      const [first, concurrent] = await Promise.all([
        kernel.loadCurrentCatalog(pins.current),
        kernel.loadCurrentCatalog(pins.current),
      ]);
      if (!first.ok || !concurrent.ok) throw new Error("expected concurrent current snapshots");
      expect(concurrent.value).toBe(first.value);
      expect(headerReads()).toHaveLength(2);
      expect(projectionReads()).toHaveLength(1);

      const pin = { ...pins.current };
      const pinned = await kernel.loadPinnedCatalog(pin);
      if (!pinned.ok) throw new Error("expected a pinned snapshot");
      expect(pinned.value).not.toBe(first.value);
      expect(pinned.value.pin).not.toBe(pin);
      expect(Object.isFrozen(pinned.value.pin)).toBe(true);
      expect(projectionReads()).toHaveLength(2);

      queries.length = 0;
      await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toEqual(first);
      const again = await kernel.loadPinnedCatalog(pin);
      expect(again.ok && again.value).toBe(pinned.value);
      expect(headerReads()).toHaveLength(2);
      expect(queries.filter((sql) => !/^(begin|commit)\b/i.test(sql))).toHaveLength(2);

      const client = await reader.connect();
      try {
        await client.query("begin isolation level repeatable read read only");
        const read = createCatalogKernel(catalogReadTransaction(client, reader));
        const within = await read.loadCurrentCatalog(pins.current);
        expect(within.ok && within.value).toBe(first.value);
        await client.query("commit");
      } finally {
        client.release();
      }
      expect(projectionReads()).toHaveLength(0);

      const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
      const subject = first.value.getSubject(CatalogSubjectId("csub_acme_power"));
      const definition = first.value.getDefinitionById(definitionId);
      const revisions = first.value.listDefinitionRevisions({ definitionId, page });
      const timeline = first.value.listDefinitionTimelineFacts({ definitionId, page });
      expect(subject).toMatchObject({
        status: "found",
        subject: { definitionCounts: { active: 2, deprecated: 0, retired: 0 }, aliases: [expect.any(Object)] },
      });
      expect(definition).toMatchObject({ status: "found", definition: { propertyKey: "iin_max" } });
      expect(revisions).toMatchObject({
        status: "found", page: { items: [{ id: "drev_acme_power_iin_max_1", publishedIn: pins.previous }] },
      });
      expect(timeline).toMatchObject({
        status: "found",
        page: {
          items: [{
            revisionId: "drev_acme_power_iin_max_1",
            release: pins.previous,
            previousRevisionId: { kind: "absent" },
            changes: ["introduced"],
          }],
        },
      });
      if (subject.status !== "found" || definition.status !== "found" || timeline.status !== "found") {
        throw new Error("expected immutable fixture entries");
      }
      expect(Object.isFrozen(first.value)).toBe(true);
      expect(Object.isFrozen(subject.subject.aliases[0]?.membership)).toBe(true);
      expect(Object.isFrozen(definition.definition.selectedRevision.content.valueShape)).toBe(true);
      expect(Object.isFrozen(timeline.page.items[0]?.changes)).toBe(true);
      expect(first.value.listSubjects({
        selection: { kind: "only", ids: [], fingerprint: "empty-test-selection" }, kinds: [], lifecycles: [],
        search: { kind: "absent" }, page,
      })).toMatchObject({ status: "found", page: { items: [] } });
      expect(first.value.getSubject(CatalogSubjectId("csub_acme_power"))).toEqual(subject);
    } finally {
      await reader.end();
    }
  });

  it("selects the new cache key after pointer, fingerprint, and owner-epoch changes", async () => {
    const reader = new pg.Pool({ connectionString: database.url });
    const { kernel, projectionReads } = createCacheReader(reader);
    const editor = await pool.connect();
    const switchTo = (id: CatalogReleaseId) => editor.query(
      "update parameter_catalog.catalog_state set current_catalog_release_id = $1", [id],
    );
    const setFingerprints = (compiled: string, stored: string) => editor.query(
      `update parameter_catalog.catalog_materializations
          set compiled_fingerprint = $2, database_fingerprint = $3 where release_id = $1`,
      [pins.current.id, compiled, stored],
    );
    try {
      const original = await kernel.loadCurrentCatalog(pins.current);
      const pinned = await kernel.loadPinnedCatalog(pins.current);
      if (!original.ok || !pinned.ok) throw new Error("expected initial snapshots");
      await switchTo(pins.previous.id);
      await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({
        ok: false, error: { kind: "release-mismatch", actual: pins.previous },
      });
      await expect(kernel.loadCurrentCatalog(pins.previous)).resolves.toMatchObject({
        ok: true, value: { release: pins.previous },
      });
      expect(projectionReads()).toHaveLength(3);

      // The disposable fixture deliberately simulates a changed materialization.
      await editor.query("set session_replication_role = replica");
      const compiled = original.value.compiledFingerprint;
      const stored = original.value.databaseFingerprint;
      try {
        const nextStored = `sha256:${"a".repeat(64)}`;
        const nextCompiled = `sha256:${"b".repeat(64)}`;
        await setFingerprints(compiled, nextStored);
        await switchTo(pins.current.id);
        await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({
          ok: true, value: { release: pins.current, databaseFingerprint: nextStored },
        });
        await setFingerprints(nextCompiled, nextStored);
        await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({
          ok: true, value: { compiledFingerprint: nextCompiled, databaseFingerprint: nextStored },
        });
        await expect(kernel.loadPinnedCatalog(pins.current)).resolves.toMatchObject({
          ok: true, value: { compiledFingerprint: nextCompiled, databaseFingerprint: nextStored },
        });
        expect(projectionReads()).toHaveLength(6);
        await editor.query("update parameter_catalog.catalog_state set subject_owner_epoch = subject_owner_epoch + 1");
        await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({ ok: true });
        await expect(kernel.loadPinnedCatalog(pins.current)).resolves.toMatchObject({ ok: true });
        expect(projectionReads()).toHaveLength(8);
      } finally {
        await setFingerprints(compiled, stored);
      }
    } finally {
      await switchTo(pins.current.id);
      await editor.query("reset session_replication_role");
      editor.release();
      await reader.end();
    }
  });

  it("honors row-level security enabled after warming a role's snapshot cache", async () => {
    const reader = new pg.Pool({ connectionString: database.url });
    const { projectionReads } = createCacheReader(reader);
    const definitionId = ParameterDefinitionId("pdef_acme_power_iin_min");
    const readPinnedAsSynchronizer = async () => {
      const client = await reader.connect();
      try {
        await client.query("begin isolation level repeatable read read only");
        await client.query("set local role catalog_synchronizer_role");
        const read = createCatalogKernel(catalogReadTransaction(client, reader));
        const loaded = await read.loadPinnedCatalog(pins.current);
        if (!loaded.ok) throw new Error(`expected restricted snapshot: ${loaded.error.kind}`);
        return loaded.value;
      } finally {
        await client.query("rollback");
        client.release();
      }
    };
    try {
      const warm = await readPinnedAsSynchronizer();
      expect(warm.getDefinitionById(definitionId).status).toBe("found");
      expect(await readPinnedAsSynchronizer()).toBe(warm);
      expect(projectionReads()).toHaveLength(1);

      await pool.query(`
        alter table parameter_catalog.catalog_release_definition_heads enable row level security;
        create policy perf1_limit_heads on parameter_catalog.catalog_release_definition_heads
          for select to catalog_synchronizer_role using (definition_id <> 'pdef_acme_power_iin_min')
      `);
      const restricted = await readPinnedAsSynchronizer();
      expect(restricted.getDefinitionById(definitionId).status).toBe("unknown");
      expect(projectionReads()).toHaveLength(2);
    } finally {
      await reader.end();
      await pool.query(`
        drop policy if exists perf1_limit_heads on parameter_catalog.catalog_release_definition_heads;
        alter table parameter_catalog.catalog_release_definition_heads disable row level security
      `);
    }
  });

  it("retries projection drift with the same header after the damaged rows are restored", async () => {
    const reader = new pg.Pool({ connectionString: database.url });
    const { kernel, projectionReads } = createCacheReader(reader);
    const editor = await pool.connect();
    const setHead = (id: string) => editor.query(
      `update parameter_catalog.catalog_release_definition_heads set revision_id = $2
        where release_id = $1 and definition_id = 'pdef_acme_power_iin_min'`,
      [pins.current.id, id],
    );
    try {
      await editor.query("set session_replication_role = replica");
      await setHead("drev_acme_power_iin_max_1");
      await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({
        ok: false, error: { kind: "drift", violations: [{ code: "definition-head-mismatch" }] },
      });
      await setHead("drev_acme_power_iin_min_1");
      await expect(kernel.loadCurrentCatalog(pins.current)).resolves.toMatchObject({
        ok: true, value: { release: pins.current },
      });
      expect(projectionReads()).toHaveLength(2);
    } finally {
      await setHead("drev_acme_power_iin_min_1");
      await editor.query("reset session_replication_role");
      editor.release();
      await reader.end();
    }
  });
});
