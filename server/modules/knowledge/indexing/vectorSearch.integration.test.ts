import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createDefaultKnowledgeTextExtractor } from "../extraction";
import { createKnowledgeEntry, publishKnowledgeEntry, searchKnowledge } from "../service";
import { createDeterministicEmbeddingClient } from "./embeddingClient";
import { detectKnowledgeVectorSupport } from "./repository";
import { processNextKnowledgeIndexJob } from "./worker";

const databaseAvailable = await isTestDatabaseAvailable();

/**
 * Real pgvector integration: runs only when the test PostgreSQL actually
 * offers the vector extension (migration 0104 then created the embedding
 * column). On FTS-only servers — including the local shared dev PostgreSQL
 * and the postgres:16 CI image, both without pgvector — this suite skips
 * with this reason and the vector-path logic stays covered by the scripted
 * tests in vectorPath.test.ts.
 */
const vectorSupportAvailable = databaseAvailable
  ? await (async () => {
      const probe = await createInMemoryTestDatabase();
      try {
        return await detectKnowledgeVectorSupport(probe);
      } finally {
        await probe.rollback();
      }
    })()
  : false;

const ORG_ID = "org-kb-vector";
const EDITOR = "user-kb-vector-editor";

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

describe.skipIf(!vectorSupportAvailable)(
  "knowledge vector retrieval (requires pgvector on the test PostgreSQL; skipped when absent)",
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
    });

    afterEach(async () => {
      await db.rollback();
    });

    it("embeds published chunks, fuses vector + FTS rankings, and reports semantic_fts honestly", async () => {
      const objectStore = createFakeObjectStore();
      const thermal = await createKnowledgeEntry(db, objectStore, extractor, editor, {
        contentForm: "markdown",
        title: "快充温控调参经验",
        tags: [],
        contentMarkdown: "当电池温度超过 45 度时,按 0.5A 步长下调快充电流。"
      });
      const wireless = await createKnowledgeEntry(db, objectStore, extractor, editor, {
        contentForm: "markdown",
        title: "无线充线圈对位指南",
        tags: [],
        contentMarkdown: "线圈偏移超过 3mm 时充电效率显著下降。"
      });
      await publishKnowledgeEntry(db, editor, thermal.id);
      await publishKnowledgeEntry(db, editor, wireless.id);

      for (let round = 0; round < 10; round += 1) {
        if ((await processNextKnowledgeIndexJob({ db, embeddingClient })) === "idle") break;
      }

      const embedded = await db.query<{ n: string }>(
        `select count(*)::text as n from knowledge_chunks where organization_id = $1 and embedding is not null`,
        [ORG_ID]
      );
      expect(Number(embedded.rows[0].n)).toBeGreaterThan(0);

      const response = await searchKnowledge(db, editor, { q: "快充温控 电池温度" }, { embeddingClient });
      expect(response.retrieval).toMatchObject({ mode: "semantic_fts", vectorAvailable: true, embeddingConfigured: true });
      expect(response.items[0]?.entryId).toBe(thermal.id);
      expect(response.items[0]?.revisionId).toBeTruthy();
    });
  }
);
