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
import { encodeCatalogCursor } from "./cursors";
import {
  A_PUBLISHED_AT,
  A_RELEASE_ID,
  B_PUBLISHED_AT,
  B_RELEASE_ID,
  C_PUBLISHED_AT,
  C_RELEASE_ID,
  SUBJECT_ID,
  X_DEFINITION_ID,
  X_REVISION_1,
  X_REVISION_2,
  Y_DEFINITION_ID,
  Y_REVISION_1,
  ZERO_FINGERPRINT,
  compileOrThrow,
  documentationOnlySuccessorBundle,
  extraDefinitionSuccessorBundle,
  firstReleaseBundle,
  installPublishedCatalogChain,
  installPublishedReleaseA,
} from "./catalogChain.fixture";
import { jsonCatalogReleaseSource } from "../interface";
import { createCatalogInstaller } from "../install/installer";

const definitionId = ParameterDefinitionId(X_DEFINITION_ID);
const yDefinitionId = ParameterDefinitionId(Y_DEFINITION_ID);
const subjectId = CatalogSubjectId(SUBJECT_ID);
const wrongDigest = CatalogReleaseDigest(`sha256:${"f".repeat(64)}`);

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { kind: string } },
  label: string,
): T => {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error.kind}`);
  }
  return result.value;
};

const listRevisions = (
  snapshot: {
    listDefinitionRevisions: (query: {
      definitionId: ParameterDefinitionId;
      page: {
        limit: ReturnType<typeof CatalogPageLimit>;
        after:
          | { kind: "present"; value: string }
          | { kind: "absent" };
      };
    }) => {
      status: string;
      page?: { items: readonly { id: string }[]; next: { kind: string; value?: string } };
    };
  },
  id: ParameterDefinitionId,
  limit = 50,
  after: { kind: "present"; value: string } | { kind: "absent" } = { kind: "absent" },
) =>
  snapshot.listDefinitionRevisions({
    definitionId: id,
    page: { limit: CatalogPageLimit(limit), after },
  });

describe("catalog snapshot lineage and metadata", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let kernel: ReturnType<typeof createCatalogKernel>;
  let chain: Awaited<ReturnType<typeof installPublishedCatalogChain>>;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("snapln");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    kernel = createCatalogKernel(pool);
    chain = await installPublishedCatalogChain(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("CATFIX-SNAP-01 A has X/r1; B does not change X so B selected revision remains X/r1", async () => {
    const pinnedB = unwrap(await kernel.loadPinnedCatalog(chain.pinB), "pinned B");
    const selected = pinnedB.getDefinitionById(definitionId);
    expect(selected.status).toBe("found");
    if (selected.status !== "found") return;
    expect(selected.definition.selectedRevision.id).toBe(X_REVISION_1);
    expect(selected.definition.selectedRevision.content.displayName).toBe("Input current limit");
    expect(pinnedB.getDefinition({ subjectId, propertyKey: PropertyKey("iin_max") }).status).toBe(
      "found",
    );
  });

  it("CATFIX-SNAP-02 B changes only Y: X is carried and Y switches to an exact head", async () => {
    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    const pinnedB = unwrap(await kernel.loadPinnedCatalog(chain.pinB), "pinned B");
    const aX = pinnedA.getDefinitionById(definitionId);
    const bX = pinnedB.getDefinitionById(definitionId);
    const aY = pinnedA.getDefinitionById(yDefinitionId);
    const bY = pinnedB.getDefinitionById(yDefinitionId);
    expect(aX.status).toBe("found");
    expect(bX.status).toBe("found");
    expect(aY.status).toBe("unknown");
    expect(bY.status).toBe("found");
    if (aX.status !== "found" || bX.status !== "found" || bY.status !== "found") return;
    expect(aX.definition.selectedRevision.id).toBe(X_REVISION_1);
    expect(bX.definition.selectedRevision.id).toBe(X_REVISION_1);
    expect(bY.definition.selectedRevision.id).toBe(Y_REVISION_1);
    expect(bY.definition.propertyKey).toBe("iin_min");
  });

  it("CATFIX-SNAP-03 documentation-only C selects the new X revision; Binding/Value pins are OP-06/08", async () => {
    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    const pinnedC = unwrap(await kernel.loadPinnedCatalog(chain.pinC), "pinned C");
    const aX = pinnedA.getDefinitionById(definitionId);
    const cX = pinnedC.getDefinitionById(definitionId);
    expect(aX.status).toBe("found");
    expect(cX.status).toBe("found");
    if (aX.status !== "found" || cX.status !== "found") return;
    expect(aX.definition.selectedRevision.id).toBe(X_REVISION_1);
    expect(cX.definition.selectedRevision.id).toBe(X_REVISION_2);
    expect(cX.definition.selectedRevision.content.documentation).toEqual({
      kind: "present",
      value: "Documented maximum accepted input current.",
    });
    const timeline = pinnedC.listDefinitionTimelineFacts({
      definitionId,
      page: { limit: CatalogPageLimit(10), after: { kind: "absent" } },
    });
    expect(timeline.status).toBe("found");
    if (timeline.status !== "found") return;
    const introduced = timeline.page.items.find((fact) => fact.revisionId === X_REVISION_1);
    const documented = timeline.page.items.find((fact) => fact.revisionId === X_REVISION_2);
    expect(introduced?.changes).toEqual(["introduced"]);
    expect(documented?.changes).toEqual(["documentation"]);
    const stored = await pool.query<{ n: string }>(
      `select count(*)::text as n
         from parameter_catalog.definition_revisions
        where definition_id = $1`,
      [X_DEFINITION_ID],
    );
    expect(stored.rows[0]?.n).toBe("2");
    const aHead = await pool.query<{ revision_id: string }>(
      `select revision_id
         from parameter_catalog.catalog_release_definition_heads
        where release_id = $1 and definition_id = $2`,
      [A_RELEASE_ID, X_DEFINITION_ID],
    );
    expect(aHead.rows[0]?.revision_id).toBe(X_REVISION_1);
    const bindingsBefore = await pool.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
    );
    const valuesBefore = await pool.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.project_parameter_values`,
    );
    unwrap(await kernel.loadCurrentCatalog(chain.pinC), "reload current C");
    unwrap(await kernel.loadPinnedCatalog(chain.pinA), "reload pinned A");
    const bindingsAfter = await pool.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
    );
    const valuesAfter = await pool.query<{ n: string }>(
      `select count(*)::text as n from parameter_catalog.project_parameter_values`,
    );
    expect(bindingsAfter.rows[0]?.n).toBe(bindingsBefore.rows[0]?.n);
    expect(valuesAfter.rows[0]?.n).toBe(valuesBefore.rows[0]?.n);
  });

  it("CATFIX-SNAP-04 current is C; pinned A/B contain no C content", async () => {
    const current = unwrap(await kernel.loadCurrentCatalog(chain.pinC), "current C");
    expect(current.release.id).toBe(C_RELEASE_ID);
    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    const pinnedB = unwrap(await kernel.loadPinnedCatalog(chain.pinB), "pinned B");
    expect(pinnedA.getDefinitionById(definitionId).status).toBe("found");
    expect(pinnedA.getDefinitionById(yDefinitionId).status).toBe("unknown");
    const aRevisions = listRevisions(pinnedA, definitionId);
    expect(aRevisions.status).toBe("found");
    if (aRevisions.status === "found") {
      expect(aRevisions.page?.items.map((item) => item.id)).toEqual([X_REVISION_1]);
    }
    const bY = listRevisions(pinnedB, yDefinitionId);
    expect(bY.status).toBe("found");
    if (bY.status === "found") {
      expect(bY.page?.items.map((item) => item.id)).toEqual([Y_REVISION_1]);
    }
    expect(listRevisions(pinnedA, definitionId).page?.items.some((item) => item.id === X_REVISION_2)).toBe(
      false,
    );
    expect(listRevisions(pinnedB, definitionId).page?.items.some((item) => item.id === X_REVISION_2)).toBe(
      false,
    );
  });

  it("CATFIX-SNAP-05 carried revisions are deduped with stable order", async () => {
    const pinnedB = unwrap(await kernel.loadPinnedCatalog(chain.pinB), "pinned B");
    const first = listRevisions(pinnedB, definitionId);
    const second = listRevisions(pinnedB, definitionId);
    expect(first.status).toBe("found");
    expect(second.status).toBe("found");
    if (first.status !== "found" || second.status !== "found") return;
    expect(first.page?.items.map((item) => item.id)).toEqual([X_REVISION_1]);
    expect(second.page?.items.map((item) => item.id)).toEqual(first.page?.items.map((item) => item.id));
  });

  it("CATFIX-SNAP-06 historical pagination reuses the same-query cursor and rejects cross-release or cross-query cursors", async () => {
    const pinnedC = unwrap(await kernel.loadPinnedCatalog(chain.pinC), "pinned C");
    const first = listRevisions(pinnedC, definitionId, 1);
    expect(first.status).toBe("found");
    if (first.status !== "found" || first.page?.next.kind !== "present") {
      throw new Error("expected a continuation cursor for X revisions");
    }
    const second = listRevisions(pinnedC, definitionId, 1, {
      kind: "present",
      value: first.page.next.value!,
    });
    expect(second.status).toBe("found");
    if (second.status !== "found") return;
    expect(first.page.items).toHaveLength(1);
    expect(second.page?.items).toHaveLength(1);
    expect(first.page.items[0]?.id).not.toBe(second.page?.items[0]?.id);
    expect(new Set([first.page.items[0]?.id, second.page?.items[0]?.id])).toEqual(
      new Set([X_REVISION_1, X_REVISION_2]),
    );

    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    expect(
      listRevisions(pinnedA, definitionId, 1, {
        kind: "present",
        value: first.page.next.value!,
      }).status,
    ).toBe("invalid-page");

    const timeline = pinnedC.listDefinitionTimelineFacts({
      definitionId,
      page: {
        limit: CatalogPageLimit(1),
        after: { kind: "present", value: first.page.next.value! },
      },
    });
    expect(timeline.status).toBe("invalid-page");

    const tampered = encodeCatalogCursor({
      releaseId: C_RELEASE_ID,
      digest: wrongDigest,
      queryFingerprint: "sha256:not-the-query",
      last: [0, X_REVISION_1],
    });
    expect(
      listRevisions(pinnedC, definitionId, 1, { kind: "present", value: tampered }).status,
    ).toBe("invalid-page");
  });

  it("CATFIX-SNAP-07 historical ID A while current is C resolves A's digest, not C's", async () => {
    const oracleA = chain.compiledA.release.digest;
    const oracleC = chain.compiledC.release.digest;
    expect(oracleA).not.toBe(oracleC);
    const resolved = unwrap(
      await kernel.resolveCatalogReleasePin(CatalogReleaseId(A_RELEASE_ID)),
      "resolve A",
    );
    expect(resolved.id).toBe(A_RELEASE_ID);
    expect(resolved.digest).toBe(oracleA);
    expect(resolved.digest).not.toBe(oracleC);
    const pinned = unwrap(await kernel.loadPinnedCatalog(resolved), "pinned resolved A");
    expect(pinned.release.digest).toBe(oracleA);
    expect(pinned.pin.digest).toBe(oracleA);
    expect(pinned.getDefinitionById(yDefinitionId).status).toBe("unknown");
  });

  it("CATFIX-SNAP-08 correct ID with the wrong expected digest is an explicit conflict", async () => {
    const conflict = await kernel.loadPinnedCatalog({
      id: chain.pinA.id,
      digest: wrongDigest,
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.kind).toBe("digest-conflict");
    if (conflict.error.kind === "digest-conflict") {
      expect(conflict.error.expected).toBe(wrongDigest);
      expect(conflict.error.actual).toBe(chain.pinA.digest);
    }
  });

  it("CATFIX-SNAP-09 missing release is unavailable; unmaterialized release is not filled", async () => {
    const missing = await kernel.loadPinnedCatalog({
      id: CatalogReleaseId("crel_missing_release"),
      digest: wrongDigest,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.kind).toBe("historical-release-unavailable");
    }

    const isolated = await createDisposableParameterCatalogDatabase("snapu");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 2 });
    try {
      const installed = await installPublishedReleaseA(isolatedPool);
      const unmaterializedDigest = CatalogReleaseDigest(`sha256:${"9".repeat(64)}`);
      // Damage injection: persist a successor release row without materialization.
      await isolatedPool.query("begin");
      await isolatedPool.query("set constraints all deferred");
      await isolatedPool.query(
        `insert into parameter_catalog.catalog_releases (
           id, release_sequence, release_version, release_digest,
           predecessor_release_id, compiled_model_digest, toolchain_digest, published_at
         ) values (
           'crel_unmaterialized', 2, '9.9.9', $1,
           $2, $3, $4, '2026-09-09T00:00:00Z'
         )`,
        [
          unmaterializedDigest,
          installed.pinA.id,
          `sha256:${"c".repeat(64)}`,
          `sha256:${"d".repeat(64)}`,
        ],
      );
      await isolatedPool.query("commit");
      const isolatedKernel = createCatalogKernel(isolatedPool);
      const unmaterialized = await isolatedKernel.loadPinnedCatalog({
        id: CatalogReleaseId("crel_unmaterialized"),
        digest: unmaterializedDigest,
      });
      expect(unmaterialized.ok).toBe(false);
      if (!unmaterialized.ok) {
        expect(unmaterialized.error.kind).toBe("drift");
        if (unmaterialized.error.kind === "drift") {
          expect(
            unmaterialized.error.violations.some(
              (item) => item.code === "materialization-fingerprint-mismatch",
            ),
          ).toBe(true);
        }
      }
    } finally {
      await isolatedPool.end();
      await isolated.close();
    }
  });

  it("CATFIX-SNAP-10 damage injection: exact head revision missing is drift, not undefined content", async () => {
    const isolated = await createDisposableParameterCatalogDatabase("snap10");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 2 });
    try {
      const installed = await installPublishedReleaseA(isolatedPool);
      const connect = isolatedPool.connect.bind(isolatedPool);
      isolatedPool.connect = (async () => {
        const client = await connect();
        const query = client.query.bind(client) as typeof client.query;
        const release = client.release.bind(client);
        const patched = ((text: unknown, values?: unknown) => {
          const sql = typeof text === "string" ? text : String((text as { text?: string })?.text ?? "");
          const result = query(text as never, values as never);
          if (
            sql.includes("catalog_release_definition_heads") &&
            sql.includes("definition_revisions") &&
            sql.includes("head.revision_id")
          ) {
            return Promise.resolve(result).then((rows) => ({
              ...rows,
              rows: (rows as { rows: Array<{ id: string; revision_number: string | null }> }).rows.map(
                (row) =>
                  row.id === X_DEFINITION_ID
                    ? { ...row, revision_number: null, content_digest: null, content: null }
                    : row,
              ),
            }));
          }
          return result;
        }) as typeof client.query;
        client.query = patched;
        client.release = ((destroy?: boolean | Error) => {
          client.query = query;
          return release(destroy);
        }) as typeof client.release;
        return client;
      }) as typeof isolatedPool.connect;
      const isolatedKernel = createCatalogKernel(isolatedPool);
      const loaded = await isolatedKernel.loadCurrentCatalog(installed.pinA);
      isolatedPool.connect = connect;
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) {
        expect(loaded.error.kind).toBe("drift");
      }
    } finally {
      await isolatedPool.end();
      await isolated.close();
    }
  });

  it("CATFIX-SNAP-11 future and non-ancestor revisions are outside pinned history; sequence is not lineage", async () => {
    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    const history = listRevisions(pinnedA, definitionId);
    expect(history.status).toBe("found");
    if (history.status === "found") {
      expect(history.page?.items.map((item) => item.id)).toEqual([X_REVISION_1]);
    }

    const isolated = await createDisposableParameterCatalogDatabase("snap11");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 2 });
    try {
      const installed = await installPublishedCatalogChain(isolatedPool);
      // Damage injection: a sequence-0 sibling revision must not enter C's predecessor closure.
      await isolatedPool.query("begin");
      await isolatedPool.query("set constraints all deferred");
      await isolatedPool.query(
        `insert into parameter_catalog.catalog_releases (
           id, release_sequence, release_version, release_digest,
           predecessor_release_id, compiled_model_digest, toolchain_digest, published_at
         ) values (
           'crel_injected_seq0', 0, '0.0.0', $1,
           null, $2, $3, '2020-01-01T00:00:00Z'
         )`,
        [
          `sha256:${"b".repeat(64)}`,
          `sha256:${"c".repeat(64)}`,
          `sha256:${"d".repeat(64)}`,
        ],
      );
      await isolatedPool.query(
        `insert into parameter_catalog.definition_revisions (
           id, definition_id, revision_number, catalog_release_id, content_digest, content
         ) values (
           'drev_injected_x_99', $1, 99, 'crel_injected_seq0', $2,
           '{"lifecycle":"active","displayName":"injected"}'::jsonb
         )`,
        [X_DEFINITION_ID, `sha256:${"e".repeat(64)}`],
      );
      await isolatedPool.query("commit");
      const isolatedKernel = createCatalogKernel(isolatedPool);
      const pinnedC = unwrap(
        await isolatedKernel.loadPinnedCatalog(installed.pinC),
        "pinned C after inject",
      );
      const cHistory = listRevisions(pinnedC, definitionId);
      expect(cHistory.status).toBe("found");
      if (cHistory.status === "found") {
        expect(cHistory.page?.items.map((item) => item.id).sort()).toEqual(
          [X_REVISION_1, X_REVISION_2].sort(),
        );
        expect(cHistory.page?.items.some((item) => item.id === "drev_injected_x_99")).toBe(false);
      }
    } finally {
      await isolatedPool.end();
      await isolated.close();
    }
  });

  it("CATFIX-SNAP-12 mutating nested returned objects does not corrupt later reads", async () => {
    const snapshot = unwrap(await kernel.loadCurrentCatalog(chain.pinC), "current C");
    const first = snapshot.getDefinitionById(definitionId);
    expect(first.status).toBe("found");
    if (first.status !== "found") return;
    const schema = first.definition.selectedRevision.content.valueShape.schema as Record<
      string,
      unknown
    >;
    expect(() => {
      schema.hacked = true;
    }).toThrow();
    expect(() => {
      (first.definition.selectedRevision.content.examples as unknown as unknown[]).push("mutated");
    }).toThrow();
    const second = snapshot.getDefinitionById(definitionId);
    expect(second.status).toBe("found");
    if (second.status !== "found") return;
    expect(second.definition.selectedRevision.content.valueShape.schema).not.toHaveProperty("hacked");
    expect(second.definition.selectedRevision.content.examples).toEqual(
      first.definition.selectedRevision.content.examples,
    );
  });

  it("CATFIX-SNAP-13 concurrent pointer advance does not mix two releases", async () => {
    const isolated = await createDisposableParameterCatalogDatabase("snapc");
    const readerPool = new pg.Pool({ connectionString: isolated.url, max: 2 });
    const writerPool = new pg.Pool({ connectionString: isolated.url, max: 2 });
    try {
      const installer = createCatalogInstaller(writerPool);
      const aBundle = firstReleaseBundle();
      const bBundle = extraDefinitionSuccessorBundle();
      const cBundle = documentationOnlySuccessorBundle();
      const compiledA = compileOrThrow(aBundle);
      const compiledB = compileOrThrow(bBundle);
      const compiledC = compileOrThrow(cBundle);
      const boot = await installer.installPublishedRelease({
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(aBundle),
        expectedTargetDigest: compiledA.aggregateDigest,
      });
      expect(boot.ok).toBe(true);
      const advanced = await installer.installPublishedRelease({
        mode: "advance",
        source: jsonCatalogReleaseSource(bBundle),
        expectedCurrent: { id: compiledA.release.id, digest: compiledA.release.digest },
        expectedTargetDigest: compiledB.aggregateDigest,
      });
      expect(advanced.ok).toBe(true);

      let resumeRead = () => undefined as void;
      const held = new Promise<void>((resolve) => {
        resumeRead = resolve;
      });
      let captured = () => undefined as void;
      const pointerCaptured = new Promise<void>((resolve) => {
        captured = resolve;
      });
      const connect = readerPool.connect.bind(readerPool);
      readerPool.connect = (async () => {
        const client = await connect();
        const query = client.query.bind(client) as typeof client.query;
        client.query = ((text: unknown, values?: unknown) => {
          const sql = typeof text === "string" ? text : String((text as { text?: string })?.text ?? "");
          const result = query(text as never, values as never);
          if (sql.includes("from parameter_catalog.catalog_state")) {
            return Promise.resolve(result).then(async (rows) => {
              captured();
              await held;
              return rows;
            });
          }
          return result;
        }) as typeof client.query;
        return client;
      }) as typeof readerPool.connect;

      const reader = createCatalogKernel(readerPool);
      const pending = reader.loadCurrentCatalog({
        id: compiledB.release.id,
        digest: compiledB.release.digest,
      });
      await pointerCaptured;
      const moved = await installer.installPublishedRelease({
        mode: "advance",
        source: jsonCatalogReleaseSource(cBundle),
        expectedCurrent: { id: compiledB.release.id, digest: compiledB.release.digest },
        expectedTargetDigest: compiledC.aggregateDigest,
      });
      expect(moved.ok).toBe(true);
      resumeRead();
      const loaded = await pending;
      if (loaded.ok) {
        expect(loaded.value.release.id).toBe(B_RELEASE_ID);
        const selected = loaded.value.getDefinitionById(definitionId);
        expect(selected.status).toBe("found");
        if (selected.status === "found") {
          expect(selected.definition.selectedRevision.id).toBe(X_REVISION_1);
        }
        expect(loaded.value.getDefinitionById(yDefinitionId).status).toBe("found");
      } else {
        expect(["release-mismatch", "digest-conflict", "drift"]).toContain(loaded.error.kind);
      }
    } finally {
      await readerPool.end();
      await writerPool.end();
      await isolated.close();
    }
  }, 60_000);

  it("returns real release metadata instead of zero hashes or epoch placeholders", async () => {
    const current = unwrap(await kernel.loadCurrentCatalog(chain.pinC), "current C");
    expect(current.sequence).toBe(3);
    expect(current.publishedAt).toBe(C_PUBLISHED_AT);
    expect(current.materializedAt).not.toBe("1970-01-01T00:00:00.000Z");
    expect(current.compiledFingerprint).toBe(chain.compiledC.materializationFingerprint);
    expect(current.compiledFingerprint).not.toBe(ZERO_FINGERPRINT);
    expect(current.databaseFingerprint).not.toBe(ZERO_FINGERPRINT);
    expect(current.materializationFingerprint).toBe(current.compiledFingerprint);
    expect(current.release.digest).not.toBe(current.compiledFingerprint);

    const pinnedA = unwrap(await kernel.loadPinnedCatalog(chain.pinA), "pinned A");
    expect(pinnedA.sequence).toBe(1);
    expect(pinnedA.publishedAt).toBe(A_PUBLISHED_AT);
    expect(pinnedA.compiledFingerprint).toBe(chain.compiledA.materializationFingerprint);
    const pinnedB = unwrap(await kernel.loadPinnedCatalog(chain.pinB), "pinned B");
    expect(pinnedB.sequence).toBe(2);
    expect(pinnedB.publishedAt).toBe(B_PUBLISHED_AT);
  });
});
