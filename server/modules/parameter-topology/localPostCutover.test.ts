import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database, QueryResult } from "../../shared/database/client";

const isParameterIdentityCutoverComplete = vi.fn();
const resetParameterIdentityCutoverCache = vi.fn();
const migrateParameterIdentities = vi.fn();
const applyParameterIdentityCutover = vi.fn();

vi.mock("../parameters/cutoverAwareIdentity", () => ({
  isParameterIdentityCutoverComplete: (...args: unknown[]) =>
    isParameterIdentityCutoverComplete(...args),
  resetParameterIdentityCutoverCache: (...args: unknown[]) =>
    resetParameterIdentityCutoverCache(...args)
}));

vi.mock("./migration", () => ({
  migrateParameterIdentities: (...args: unknown[]) => migrateParameterIdentities(...args),
  applyParameterIdentityCutover: (...args: unknown[]) => applyParameterIdentityCutover(...args)
}));

import {
  LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN,
  ensureLocalPostCutoverIdentity,
  shouldEnsureLocalPostCutoverOnApiBoot
} from "./localPostCutover";

function createDb(handlers: Array<(text: string) => QueryResult<Record<string, string>> | null>): Database {
  return {
    query: async <Row,>(text: string): Promise<QueryResult<Row>> => {
      for (const handler of handlers) {
        const result = handler(text);
        if (result) return result as QueryResult<Row>;
      }
      return { rows: [], rowCount: 0 };
    },
    transaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never)
  };
}

describe("ensureLocalPostCutoverIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isParameterIdentityCutoverComplete.mockResolvedValue(false);
    migrateParameterIdentities.mockResolvedValue({
      migrationRunId: "run-local-1",
      blockers: []
    });
    applyParameterIdentityCutover.mockResolvedValue(undefined);
  });

  it("is idempotent when cutover is already complete", async () => {
    isParameterIdentityCutoverComplete.mockResolvedValue(true);
    const db = createDb([]);

    const result = await ensureLocalPostCutoverIdentity(db);

    expect(result).toEqual({ status: "already-complete" });
    expect(migrateParameterIdentities).not.toHaveBeenCalled();
    expect(applyParameterIdentityCutover).not.toHaveBeenCalled();
  });

  it("fail-closes when legacy flat identity rows are present", async () => {
    const db = createDb([
      (text) =>
        text.includes("from parameter_definitions")
          ? { rows: [{ c: "12" }], rowCount: 1 }
          : null
    ]);

    await expect(ensureLocalPostCutoverIdentity(db)).rejects.toThrow(
      /legacy flat identity|wipe|docker compose down -v/i
    );
    expect(migrateParameterIdentities).not.toHaveBeenCalled();
  });

  it("fail-closes when history rows lack binding ids", async () => {
    const db = createDb([
      (text) => {
        if (text.includes("from parameter_definitions")) return { rows: [{ c: "0" }], rowCount: 1 };
        if (text.includes("from project_parameter_values")) return { rows: [{ c: "0" }], rowCount: 1 };
        if (text.includes("from parameter_history_entries")) return { rows: [{ c: "3" }], rowCount: 1 };
        return null;
      }
    ]);

    await expect(ensureLocalPostCutoverIdentity(db)).rejects.toThrow(
      /legacy flat identity|wipe|docker compose down -v/i
    );
  });

  it("applies migrate+cutover on a clean empty legacy database", async () => {
    const db = createDb([
      (text) => {
        if (
          text.includes("from parameter_definitions") ||
          text.includes("from project_parameter_values") ||
          text.includes("from parameter_history_entries") ||
          text.includes("from parameter_drafts") ||
          text.includes("from parameter_change_requests")
        ) {
          return { rows: [{ c: "0" }], rowCount: 1 };
        }
        return null;
      }
    ]);

    const result = await ensureLocalPostCutoverIdentity(db);

    expect(result).toEqual({ status: "applied", migrationRunId: "run-local-1" });
    expect(migrateParameterIdentities).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: "apply",
        maintenanceToken: LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN,
        expectedMaintenanceToken: LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN,
        writeLockConfirmed: true,
        dbSnapshotId: "local-dev-db",
        objectSnapshotId: "local-dev-object-store"
      })
    );
    expect(applyParameterIdentityCutover).toHaveBeenCalledWith(db, {
      migrationRunId: "run-local-1"
    });
    expect(resetParameterIdentityCutoverCache).toHaveBeenCalled();
  });

  it("fails when migrate reports blockers on an otherwise empty legacy graph", async () => {
    migrateParameterIdentities.mockResolvedValue({
      migrationRunId: "run-blocked",
      blockers: ["unexpected blocker"]
    });
    const db = createDb([
      () => ({ rows: [{ c: "0" }], rowCount: 1 })
    ]);

    await expect(ensureLocalPostCutoverIdentity(db)).rejects.toThrow(/unexpected blocker/);
    expect(applyParameterIdentityCutover).not.toHaveBeenCalled();
  });
});

describe("shouldEnsureLocalPostCutoverOnApiBoot", () => {
  it("runs by default in development", () => {
    expect(shouldEnsureLocalPostCutoverOnApiBoot({ NODE_ENV: "development" })).toBe(true);
  });

  it("never runs in production or test by default", () => {
    expect(shouldEnsureLocalPostCutoverOnApiBoot({ NODE_ENV: "production" })).toBe(false);
    expect(shouldEnsureLocalPostCutoverOnApiBoot({ NODE_ENV: "test" })).toBe(false);
  });

  it("honors explicit opt-out and legacy dual-track seed flag", () => {
    expect(
      shouldEnsureLocalPostCutoverOnApiBoot({
        NODE_ENV: "development",
        WISEEFF_LOCAL_POST_CUTOVER: "0"
      })
    ).toBe(false);
    expect(
      shouldEnsureLocalPostCutoverOnApiBoot({
        NODE_ENV: "development",
        WISEEFF_SEED_LEGACY_FLAT_IDENTITY: "1"
      })
    ).toBe(false);
  });

  it("allows explicit opt-in under test when WISEEFF_LOCAL_POST_CUTOVER=1", () => {
    expect(
      shouldEnsureLocalPostCutoverOnApiBoot({
        NODE_ENV: "test",
        WISEEFF_LOCAL_POST_CUTOVER: "1"
      })
    ).toBe(true);
  });
});
