import { createHash } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import { createDatabase } from "../../../shared/database/client";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  resolveWorkerDatabaseUrl
} from "../../../testing/testDatabase";
import { createDefaultKnowledgeTextExtractor } from "../extraction";
import { createKnowledgeEntry, publishKnowledgeEntry } from "../service";
import { createDeterministicEmbeddingClient } from "./embeddingClient";
import { detectKnowledgeVectorSupport } from "./repository";
import { ensureKnowledgeVectorColumn } from "./vectorEnsure";
import { processNextKnowledgeIndexJob } from "./worker";

const databaseAvailable = await isTestDatabaseAvailable();

/**
 * Whether this PostgreSQL server offers pgvector at all. The late-install
 * suites below need it; on FTS-only servers they skip with this reason and
 * the ensure's decision logic stays covered by vectorEnsure.test.ts.
 */
const extensionAvailable = databaseAvailable
  ? await (async () => {
      const probe = await createInMemoryTestDatabase();
      try {
        const result = await probe.query(
          `select 1 from pg_available_extensions where name = 'vector' limit 1`
        );
        return result.rows.length > 0;
      } finally {
        await probe.rollback();
      }
    })()
  : false;

const ORG_ID = "org-kb-vector-ensure";
const EDITOR = "user-kb-vector-ensure-editor";

const viewEdit: BackendPermission[] = ["knowledge:view", "knowledge:edit"];

function makeAuth(userId: string, permissions: BackendPermission[]): AuthContext {
  return {
    user: { id: userId, organizationId: ORG_ID, name: userId, title: "Engineer", isActive: true },
    organization: { id: ORG_ID, name: ORG_ID },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

function createFakeObjectStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      objects.set(storageKey, input.bytes);
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const bytes = objects.get(storageKey);
      if (!bytes) throw new Error(`Missing object: ${storageKey}`);
      return bytes;
    }
  };
}

describe.skipIf(!databaseAvailable)("knowledge vector ensure on the migrated schema", () => {
  it("no-ops honestly for the steady state of this server", async () => {
    const db = await createInMemoryTestDatabase();
    try {
      const columnPresent = await detectKnowledgeVectorSupport(db);
      const result = await ensureKnowledgeVectorColumn(db);
      if (extensionAvailable) {
        // Migration 0104 already created the column on pgvector-enabled servers.
        expect(columnPresent).toBe(true);
        expect(result).toEqual({ outcome: "already-present" });
      } else {
        // FTS-only server: the ensure must not invent a column it cannot type.
        expect(columnPresent).toBe(false);
        expect(result).toEqual({ outcome: "extension-unavailable" });
        expect(await detectKnowledgeVectorSupport(db)).toBe(false);
      }
    } finally {
      await db.rollback();
    }
  });
});

describe.skipIf(!extensionAvailable)(
  "knowledge vector late install (requires pgvector on the test PostgreSQL; skipped when absent)",
  () => {
    let db: InMemoryTestDatabase;
    const editor = makeAuth(EDITOR, viewEdit);
    const extractor = createDefaultKnowledgeTextExtractor();
    const embeddingClient = createDeterministicEmbeddingClient();

    beforeEach(async () => {
      db = await createInMemoryTestDatabase();
      await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [ORG_ID]);
      await db.query(
        `insert into users (id, organization_id, name, title, is_active) values ($1, $2, $1, 'Engineer', true)
         on conflict (id) do update set organization_id = excluded.organization_id`,
        [EDITOR, ORG_ID]
      );
      // Simulate a deployment that migrated before pgvector existed on the
      // server: no embedding column, no installed extension. Transactional
      // DDL keeps this confined to the fixture's rollback.
      await db.query(`alter table knowledge_chunks drop column embedding`);
      await db.query(`drop extension if exists vector`);
    });

    afterEach(async () => {
      await db.rollback();
    });

    async function drainIndexQueue() {
      for (let round = 0; round < 10; round += 1) {
        if ((await processNextKnowledgeIndexJob({ db, embeddingClient })) === "idle") break;
      }
    }

    it("installs the column, re-enqueues published entries, and stays idempotent", async () => {
      const objectStore = createFakeObjectStore();
      const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
        contentForm: "markdown",
        title: "快充温控调参经验",
        tags: [],
        contentMarkdown: "当电池温度超过 45 度时,按 0.5A 步长下调快充电流。"
      });
      await publishKnowledgeEntry(db, editor, entry.id);
      // FTS-only pass first: chunks exist, nothing is embedded, and this
      // process caches the pre-install "no vector support" detection.
      await drainIndexQueue();
      const before = await db.query<{ status: string; embedded_chunk_count: string }>(
        `select status, embedded_chunk_count::text from knowledge_index_status where entry_id = $1`,
        [entry.id]
      );
      expect(before.rows[0]).toMatchObject({ status: "succeeded", embedded_chunk_count: "0" });

      const result = await ensureKnowledgeVectorColumn(db);
      expect(result).toMatchObject({ outcome: "installed" });
      if (result.outcome !== "installed") throw new Error("expected installed outcome");
      expect(result.enqueued).toBeGreaterThanOrEqual(1);
      expect(await detectKnowledgeVectorSupport(db)).toBe(true);

      const enqueued = await db.query<{ status: string }>(
        `select status from knowledge_index_status where entry_id = $1`,
        [entry.id]
      );
      expect(enqueued.rows[0].status).toBe("pending");

      // The rebuild embeds for real: the ensure invalidated the cached
      // pre-install detection, so no restart is needed.
      await drainIndexQueue();
      const embedded = await db.query<{ n: string }>(
        `select count(*)::text as n from knowledge_chunks where entry_id = $1 and embedding is not null`,
        [entry.id]
      );
      expect(Number(embedded.rows[0].n)).toBeGreaterThan(0);

      // Idempotent: a second startup finds the column and enqueues nothing.
      expect(await ensureKnowledgeVectorColumn(db)).toEqual({ outcome: "already-present" });
      const settled = await db.query<{ status: string }>(
        `select status from knowledge_index_status where entry_id = $1`,
        [entry.id]
      );
      expect(settled.rows[0].status).toBe("succeeded");
    });
  }
);

describe.skipIf(!extensionAvailable)(
  "knowledge vector ensure across replicas (requires pgvector on the test PostgreSQL; skipped when absent)",
  () => {
    it("adds the column exactly once when two replicas boot concurrently", async () => {
      // Real cross-session concurrency needs committed state: two clients on
      // the per-worker database, outside the rollback fixture.
      const connectionString = await resolveWorkerDatabaseUrl();
      const clientA = new pg.Client({ connectionString });
      const clientB = new pg.Client({ connectionString });
      await clientA.connect();
      await clientB.connect();
      const wrap = (client: pg.Client) =>
        createDatabase({
          query: async (text, values = []) => {
            const result = await client.query(text, values);
            return { rows: result.rows, rowCount: result.rowCount };
          }
        });
      const replicaA = wrap(clientA);
      const replicaB = wrap(clientB);

      try {
        // Committed late-install starting point; the template has no knowledge
        // entries, so the ensure's rebuild enqueue writes no residue rows.
        await clientA.query(`alter table knowledge_chunks drop column if exists embedding`);

        const [resultA, resultB] = await Promise.all([
          ensureKnowledgeVectorColumn(replicaA),
          ensureKnowledgeVectorColumn(replicaB)
        ]);

        // The advisory lock serializes them: exactly one installs, the loser's
        // under-lock re-check reports already-present.
        expect([resultA.outcome, resultB.outcome].sort()).toEqual(["already-present", "installed"]);

        const columns = await clientA.query(
          `select count(*)::int as n from information_schema.columns
           where table_name = 'knowledge_chunks' and column_name = 'embedding'`
        );
        expect(columns.rows[0].n).toBe(1);
      } finally {
        // The winning ensure restored the template's column; this is a
        // belt-and-braces restore in case the assertion above ever fails.
        await clientA
          .query(`alter table knowledge_chunks add column if not exists embedding vector`)
          .catch(() => undefined);
        await clientA.end().catch(() => undefined);
        await clientB.end().catch(() => undefined);
      }
    });
  }
);
