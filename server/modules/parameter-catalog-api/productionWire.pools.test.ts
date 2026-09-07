import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import type pg from "pg";
import type { CatalogGovernancePorts } from "./governance/types";

const capture = vi.hoisted(() => ({ governance: undefined as CatalogGovernancePorts | undefined }));
const executeRegistration = vi.hoisted(() => vi.fn(async (_pool: pg.Pool, _command: unknown) => ({ ok: false, error: { kind: "catalog-drift" } })));
const review = vi.hoisted(() => ({
  list: vi.fn(async (_query: unknown) => ({ ok: false, error: { kind: "permission-denied" } })),
  get: vi.fn(async (_query: unknown) => ({ ok: false, error: { kind: "permission-denied" } })),
  persisted: vi.fn(),
  grouping: vi.fn(),
}));
vi.mock("../parameter-governance/review", () => ({
  createPersistedReviewQueueReader: (pool: pg.Pool) => {
    review.persisted(pool);
    return { list: review.list, get: review.get };
  },
  createReviewQueueReader: (pool: pg.Pool) => {
    review.grouping(pool);
    return { list: review.list, get: review.get };
  },
}));
vi.mock("../parameter-governance/registration", () => ({ executeRegistration }));
vi.mock("./governance/routes", () => ({ registerCatalogGovernanceRoutes: (_router: unknown, ports: CatalogGovernancePorts) => { capture.governance = ports; } }));
import { registerParameterCatalogApi } from "./productionWire";

afterEach(() => vi.clearAllMocks());
describe("production Catalog command pool isolation", () => {
  it("rejects one root reused as production reader and governance pool", async () => {
    const db = createPostgresDatabase("postgres://unused:unused@127.0.0.1:1/unused");
    try {
      expect(() => registerParameterCatalogApi(createRouter(), { db, governanceDb: db, requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never }))
        .toThrow("PCAT-RUNTIME-GOVERNANCE-POOL-MUST-BE-SEPARATE");
    } finally { await db.close(); }
  });
  it("does not fall back to reader credentials for a missing production command pool", async () => {
    const db = createPostgresDatabase("postgres://unused:unused@127.0.0.1:1/unused");
    try {
      registerParameterCatalogApi(createRouter(), { db, requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never });
      expect((await capture.governance!.executeRegistration({} as never)).ok).toBe(false);
      expect(executeRegistration).not.toHaveBeenCalled();
    } finally { await db.close(); }
  });
  it("uses only the persisted read projection without a governance command pool", async () => {
    const db = createPostgresDatabase("postgres://reader:unused@127.0.0.1:1/unused");
    try {
      registerParameterCatalogApi(createRouter(), { db, requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never });
      const query = { marker: "original-query" } as never;
      await capture.governance!.listReviewQueue(query);
      await capture.governance!.getReviewItem(query);
      expect(review.persisted).toHaveBeenCalledWith(getRootPostgresPool(db));
      expect(review.list).toHaveBeenCalledWith(query);
      expect(review.get).toHaveBeenCalledWith(query);
      expect(review.grouping).not.toHaveBeenCalled();
      expect(executeRegistration).not.toHaveBeenCalled();
    } finally { await db.close(); }
  });
  it("does not construct either Review reader when the application database is absent", async () => {
    registerParameterCatalogApi(createRouter(), { requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never });
    expect((await capture.governance!.listReviewQueue({} as never)).ok).toBe(false);
    expect(review.persisted).not.toHaveBeenCalled();
    expect(review.grouping).not.toHaveBeenCalled();
  });
  it("binds domain command execution to the dedicated pool", async () => {
    const db = createPostgresDatabase("postgres://reader:unused@127.0.0.1:1/unused");
    const governanceDb = createPostgresDatabase("postgres://governance:unused@127.0.0.1:1/unused");
    try {
      registerParameterCatalogApi(createRouter(), { db, governanceDb, requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never });
      // Port binding delegates authorization/command validation to the owned domain seam.
      await capture.governance!.executeRegistration({} as never);
      expect(executeRegistration.mock.calls[0]?.[0]).toBe(getRootPostgresPool(governanceDb));
      expect(executeRegistration.mock.calls[0]?.[0]).not.toBe(getRootPostgresPool(db));
    } finally { await Promise.all([db.close(), governanceDb.close()]); }
  });
});
