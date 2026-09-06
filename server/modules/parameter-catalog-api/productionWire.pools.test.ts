import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";

const capture = vi.hoisted(() => ({ governance: undefined as any }));
const executeRegistration = vi.hoisted(() => vi.fn(async () => ({ ok: false, error: { kind: "catalog-drift" } })));
vi.mock("../parameter-governance/registration", () => ({ executeRegistration }));
vi.mock("./governance/routes", () => ({ registerCatalogGovernanceRoutes: (_router: unknown, ports: unknown) => { capture.governance = ports; } }));
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
      expect((await capture.governance.executeRegistration({})).ok).toBe(false);
      expect(executeRegistration).not.toHaveBeenCalled();
    } finally { await db.close(); }
  });
  it("binds authenticated domain command execution to the dedicated pool", async () => {
    const db = createPostgresDatabase("postgres://reader:unused@127.0.0.1:1/unused");
    const governanceDb = createPostgresDatabase("postgres://governance:unused@127.0.0.1:1/unused");
    try {
      registerParameterCatalogApi(createRouter(), { db, governanceDb, requireSeparateGovernancePool: true, resolveAuth: (() => undefined) as never });
      // Port binding delegates authorization/command validation to the owned domain seam.
      await capture.governance.executeRegistration({});
      expect(executeRegistration.mock.calls[0]?.[0]).toBe(getRootPostgresPool(governanceDb));
      expect(executeRegistration.mock.calls[0]?.[0]).not.toBe(getRootPostgresPool(db));
    } finally { await Promise.all([db.close(), governanceDb.close()]); }
  });
});
