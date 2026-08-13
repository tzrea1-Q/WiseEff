import { describe, expect, it } from "vitest";

import type { Database } from "../../../shared/database/client";
import { hasKnowledgeVectorSupport } from "./repository";
import { ensureKnowledgeVectorColumn } from "./vectorEnsure";

type RecordedQuery = { text: string; values: unknown[] };

/**
 * Scripted Database double for the ensure's decision logic: extension
 * availability, per-call column detection (pre-check vs under-lock re-check),
 * and an optional CREATE EXTENSION failure. The real DDL loop lives in
 * vectorEnsure.integration.test.ts and needs a pgvector-enabled PostgreSQL.
 */
function createScriptedDb(options: {
  extensionAvailable: boolean;
  /** Consumed per information_schema.columns probe, in call order. */
  columnDetections: boolean[];
  createExtensionError?: Error;
  enqueuedRowCount?: number;
}): { db: Database; recorded: RecordedQuery[] } {
  const recorded: RecordedQuery[] = [];
  const detections = [...options.columnDetections];

  const query = async <Row>(text: string, values: unknown[] = []): Promise<{ rows: Row[]; rowCount: number | null }> => {
    recorded.push({ text, values });
    if (text.includes("pg_available_extensions")) {
      return { rows: (options.extensionAvailable ? [{ ok: 1 }] : []) as Row[], rowCount: null };
    }
    if (text.includes("information_schema.columns")) {
      const detected = detections.shift();
      if (detected === undefined) {
        throw new Error("Scripted db ran out of column detections.");
      }
      return { rows: (detected ? [{ ok: 1 }] : []) as Row[], rowCount: null };
    }
    if (text.includes("create extension") && options.createExtensionError) {
      throw options.createExtensionError;
    }
    if (text.includes("insert into knowledge_index_status")) {
      return { rows: [] as Row[], rowCount: options.enqueuedRowCount ?? 0 };
    }
    return { rows: [] as Row[], rowCount: 0 };
  };

  const db: Database = {
    query,
    transaction: async (fn) => fn(db)
  };
  return { db, recorded };
}

function texts(recorded: RecordedQuery[]) {
  return recorded.map((entry) => entry.text);
}

describe("ensureKnowledgeVectorColumn (scripted db)", () => {
  it("no-ops silently-honestly when the server does not offer pgvector", async () => {
    const { db, recorded } = createScriptedDb({ extensionAvailable: false, columnDetections: [] });

    const result = await ensureKnowledgeVectorColumn(db);

    expect(result).toEqual({ outcome: "extension-unavailable" });
    expect(texts(recorded).some((text) => text.includes("create extension"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("alter table"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("returns already-present without taking the lock when the column already exists", async () => {
    const { db, recorded } = createScriptedDb({ extensionAvailable: true, columnDetections: [true] });

    const result = await ensureKnowledgeVectorColumn(db);

    expect(result).toEqual({ outcome: "already-present" });
    expect(texts(recorded).some((text) => text.includes("pg_advisory_xact_lock"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("alter table"))).toBe(false);
  });

  it("installs under the advisory lock and enqueues the full rebuild", async () => {
    const { db, recorded } = createScriptedDb({
      extensionAvailable: true,
      columnDetections: [false, false],
      enqueuedRowCount: 3
    });

    const result = await ensureKnowledgeVectorColumn(db);

    expect(result).toEqual({ outcome: "installed", enqueued: 3 });
    const order = texts(recorded);
    const lockIndex = order.findIndex((text) => text.includes("pg_advisory_xact_lock"));
    const createIndex = order.findIndex((text) => text.includes("create extension if not exists vector"));
    const alterIndex = order.findIndex((text) => text.includes("add column if not exists embedding vector"));
    const enqueueIndex = order.findIndex((text) => text.includes("insert into knowledge_index_status"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(lockIndex);
    expect(alterIndex).toBeGreaterThan(createIndex);
    expect(enqueueIndex).toBeGreaterThan(alterIndex);
  });

  it("returns already-present when the under-lock re-check finds a concurrent replica won", async () => {
    const { db, recorded } = createScriptedDb({
      extensionAvailable: true,
      columnDetections: [false, true]
    });

    const result = await ensureKnowledgeVectorColumn(db);

    expect(result).toEqual({ outcome: "already-present" });
    expect(texts(recorded).some((text) => text.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(texts(recorded).some((text) => text.includes("create extension"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("alter table"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("insert into knowledge_index_status"))).toBe(false);
  });

  it("reports an honest install failure without touching the schema when CREATE EXTENSION is refused", async () => {
    const { db, recorded } = createScriptedDb({
      extensionAvailable: true,
      columnDetections: [false, false],
      createExtensionError: new Error("permission denied to create extension \"vector\"")
    });

    const result = await ensureKnowledgeVectorColumn(db);

    expect(result).toEqual({
      outcome: "extension-install-failed",
      reason: 'permission denied to create extension "vector"'
    });
    expect(texts(recorded).some((text) => text.includes("alter table"))).toBe(false);
    expect(texts(recorded).some((text) => text.includes("insert into knowledge_index_status"))).toBe(false);
  });

  it("drops this process's cached detection after installing", async () => {
    const { db } = createScriptedDb({
      extensionAvailable: true,
      // hasKnowledgeVectorSupport pre-install, ensure pre-check, under-lock
      // re-check, then the post-install hasKnowledgeVectorSupport re-detection.
      columnDetections: [false, false, false, true]
    });

    expect(await hasKnowledgeVectorSupport(db)).toBe(false);
    const result = await ensureKnowledgeVectorColumn(db);
    expect(result).toMatchObject({ outcome: "installed" });
    expect(await hasKnowledgeVectorSupport(db)).toBe(true);
  });
});
