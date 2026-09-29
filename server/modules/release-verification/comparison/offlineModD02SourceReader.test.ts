import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { assertTrustedInvocationContext } from "../../auth/trustedInvocation";
import type { ComparisonCaseBatchV2 } from "./corpusContributionSchema";

const mocks = vi.hoisted(() => ({
  resolveOfflineLocalSession: vi.fn(),
  provideBatch: vi.fn(),
  readManifest: vi.fn(),
  assertBatch: vi.fn(),
}));

vi.mock("../../auth/offlineLocalSession", () => ({
  resolveOfflineLocalSession: mocks.resolveOfflineLocalSession,
}));
vi.mock("../../parameter-modules/parameterCatalogComparisonContribution", () => ({
  provideModParameterCatalogComparisonCaseBatchV2: mocks.provideBatch,
}));
vi.mock("../../parameter-catalog-api/productionWire", () => ({
  readCompletedModComparisonManifestForComparison: mocks.readManifest,
}));
vi.mock("./caseResultV2Writer", () => ({
  assertModD02CapturableBatch: mocks.assertBatch,
}));

import { createOfflineModD02SourceReader } from "./offlineModD02SourceReader";

const token = "we_local_12345678901234567890123456789012";
const auth: AuthContext = {
  user: { id: "user-1", organizationId: "org-1", name: "Admin", title: "admin", isActive: true },
  organization: { id: "org-1", name: "Org One" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["admin:access", "users:manage"],
};
const batch = {
  contractVersion: "pcat-comparison-case-batch/v2",
  family: "MOD",
  comparisonId: "PCAT-CMP-D02-SUBJECT-IDENTITY",
  phase: "pre-activation",
  organizationId: "org-1",
  selectionRunId: "run-1",
  selectionProjectionDigest: "sha256:projection",
  selectionProjectionCount: 0,
  modSelectionIdentityIds: [],
  inventory: [],
  sourceInventoryCount: 0,
  sourceInventoryChecksum: "sha256:inventory",
  cases: [],
  blockers: [],
} as unknown as ComparisonCaseBatchV2;

let database: RootDatabase;
let pool: NonNullable<ReturnType<typeof getRootPostgresPool>>;

beforeEach(() => {
  database = createPostgresDatabase("postgres://reader:reader@127.0.0.1:1/test");
  pool = getRootPostgresPool(database)!;
  mocks.resolveOfflineLocalSession.mockReset();
  mocks.provideBatch.mockReset().mockResolvedValue(batch);
  mocks.readManifest.mockReset().mockResolvedValue({ manifest: { selectionRunId: "run-1" } });
  mocks.assertBatch.mockReset();
  vi.stubEnv("AUTH_PROVIDER", "local");
  vi.stubEnv("MOD_D02_CAPTURE_ENABLED", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await database?.close();
});

describe("createOfflineModD02SourceReader", () => {
  it("is disabled when the maintenance flag is unset", async () => {
    const read = createOfflineModD02SourceReader({ database, pool });

    await expect(read({ token, runId: "run-1" })).rejects.toThrow("MOD D02 offline capture is disabled.");

    expect(mocks.resolveOfflineLocalSession).not.toHaveBeenCalled();
    expect(mocks.provideBatch).not.toHaveBeenCalled();
  });

  it("requires local auth and the source reader's matching root database and pool", async () => {
    vi.stubEnv("MOD_D02_CAPTURE_ENABLED", "true");
    vi.stubEnv("AUTH_PROVIDER", "oidc");
    const unsupportedAuth = createOfflineModD02SourceReader({ database, pool });
    await expect(unsupportedAuth({ token, runId: "run-1" })).rejects.toThrow("AUTH_PROVIDER=local");
    expect(mocks.resolveOfflineLocalSession).not.toHaveBeenCalled();

    vi.stubEnv("AUTH_PROVIDER", "local");
    const otherDatabase = createPostgresDatabase("postgres://reader:reader@127.0.0.1:1/other");
    try {
      const wrongPool = createOfflineModD02SourceReader({
        database,
        pool: getRootPostgresPool(otherDatabase)!,
        enabled: true,
        authProvider: "local",
      });
      await expect(wrongPool({ token, runId: "run-1" })).rejects.toThrow("same configured root");
      expect(mocks.resolveOfflineLocalSession).not.toHaveBeenCalled();
    } finally {
      await otherDatabase.close();
    }
  });

  it("builds a trusted provider invocation from the resolved session and returns capture identity", async () => {
    vi.stubEnv("MOD_D02_CAPTURE_ENABLED", "true");
    mocks.resolveOfflineLocalSession.mockResolvedValue({ sessionId: "session-1", auth });
    const read = createOfflineModD02SourceReader({ database, pool });

    const result = await read({ token, runId: "run-1" });

    expect(mocks.resolveOfflineLocalSession).toHaveBeenCalledWith(database, token, undefined);
    const providerInput = mocks.provideBatch.mock.calls[0]?.[0] as {
      database: RootDatabase;
      pool: typeof pool;
      runId: string;
      invocation: unknown;
    };
    expect(providerInput).toMatchObject({ database, pool, runId: "run-1" });
    expect(assertTrustedInvocationContext(providerInput.invocation)).toMatchObject({
      initiator: "user",
      principal: { user: { id: "user-1" }, organization: { id: "org-1" } },
    });
    expect(mocks.readManifest).toHaveBeenCalledWith(providerInput);
    expect(mocks.assertBatch).toHaveBeenCalledWith(batch, { selectionRunId: "run-1" });
    expect(result).toEqual({
      sessionId: "session-1",
      principalId: "user-1",
      organizationId: "org-1",
      batch,
    });
    expect(result).not.toHaveProperty("token");
  });
});
