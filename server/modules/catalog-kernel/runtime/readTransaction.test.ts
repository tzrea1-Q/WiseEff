import { describe, expect, it, vi } from "vitest";

import {
  catalogReadTransaction,
  CatalogSnapshotReadFailure,
  withCatalogReadTransaction,
  type CatalogSnapshotClient,
} from "./readTransaction";

describe("caller-owned Catalog read transaction", () => {
  it("uses the supplied snapshot session without beginning, committing or releasing it", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "same-session" }], rowCount: 1 });
    const client: CatalogSnapshotClient = { query };
    const result = await withCatalogReadTransaction(catalogReadTransaction(client), "loadPinnedCatalog", async (session) => {
      const rows = await session.query<{ id: string }>("select id from snapshot_fixture");
      return { ok: true, value: rows.rows[0]?.id };
    });
    expect(result).toEqual({ ok: true, value: "same-session" });
    expect(query.mock.calls).toEqual([["select id from snapshot_fixture"]]);
  });

  it("leaves transaction cleanup to the owner while preserving typed kernel failures", async () => {
    const query = vi.fn();
    const client: CatalogSnapshotClient = { query };
    const error = { kind: "storage-failure" as const, operation: "loadPinnedCatalog" as const, retryable: false };
    expect(await withCatalogReadTransaction(catalogReadTransaction(client), "loadPinnedCatalog", async () => {
      throw new CatalogSnapshotReadFailure(error);
    })).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });
});
