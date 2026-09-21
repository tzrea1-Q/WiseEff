import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../../server/shared/database/client";
import type { AuthContext } from "../../server/modules/auth/types";
import type {
  PublicationCandidateRecord,
  PublicationJobRecord,
} from "../../server/modules/catalog-publication/persistence/types";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getCandidate: vi.fn(),
  enqueuePublicationJob: vi.fn(),
}));

vi.mock("../../server/modules/auth/repository", () => ({
  getAuthContext: mocks.getAuthContext,
}));
vi.mock("../../server/modules/catalog-publication/persistence/store", () => ({
  getArtifactByDigest: vi.fn(),
  getCandidate: mocks.getCandidate,
  getJob: vi.fn(),
  getReceiptByJobId: vi.fn(),
  persistCandidate: vi.fn(),
}));
vi.mock("../../server/modules/catalog-publication/enqueue", () => ({
  enqueuePublicationJob: mocks.enqueuePublicationJob,
}));

import {
  prepareSeedCatalog,
  publishSeedCatalog,
} from "./seedCatalogPublication";

const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;

const actor = (overrides: Partial<AuthContext["user"]> = {}, permissions: AuthContext["permissions"] = [
  "catalog:publish",
  "parameter:view",
]): AuthContext => ({
  user: {
    id: "reviewer",
    organizationId: "org-seed",
    name: "Seed reviewer",
    title: "Reviewer",
    isActive: true,
    ...overrides,
  },
  organization: { id: "org-seed", name: "Seed organization" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions,
});

const current = {
  id: "crel_acme_1",
  digest: digest("a"),
  version: "1.0.0",
} as const;

const candidate = {
  id: "ccand_seed_retry",
  artifactId: "cart_seed_retry",
  artifactDigest: digest("b"),
  expectedBaseReleaseId: current.id,
  expectedBaseReleaseDigest: current.digest,
  proposalId: null,
  proposalRevisionId: null,
  identityAllocation: {
    runId: "seed-run",
    stage: "vendor",
    organizationId: "org-seed",
    releaseId: "crel_seed_retry",
    releaseVersion: "2.0.0",
    authorPrincipalId: "author",
    authorOrganizationId: "org-seed",
    seedOperator: {
      runId: "seed-run",
      stage: "vendor",
      organizationId: "org-seed",
    },
  },
  impactReportDigest: digest("c"),
  capabilityContract: { revision: "catalog-capability/v4" },
  createdAt: "2026-09-21T00:00:00.000Z",
} as unknown as PublicationCandidateRecord;

const job = {
  id: "cjob_seed_retry",
  candidateId: candidate.id,
  authorizationId: "cauth_seed_retry",
  requestScope: "catalog-publication",
  idempotencyKey: "seed:retry",
  requestDigest: digest("d"),
  status: "queued",
  leaseOwner: null,
  leaseUntil: null,
  fencingToken: 0,
  attemptCount: 0,
  lastErrorClass: null,
  lastErrorReason: null,
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
} as unknown as PublicationJobRecord;

const database = (): Database => {
  const db = {} as Database;
  db.query = vi.fn(async (text: string) => {
    if (text.includes("from parameter_catalog.catalog_state")) {
      return { rows: [current], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  db.transaction = vi.fn(async (fn: (tx: Database) => Promise<unknown>) => fn(db));
  return db;
};

const publishInput = (db: Database, overrides: Record<string, unknown> = {}) => ({
  db,
  organizationId: "org-seed",
  actorUserId: "reviewer",
  runId: "seed-run",
  stage: "vendor" as const,
  candidateId: candidate.id,
  expectedArtifactDigest: candidate.artifactDigest,
  expectedCurrent: current,
  idempotencyKey: "seed:retry",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(actor());
  mocks.getCandidate.mockResolvedValue({ ok: true, value: candidate });
  mocks.enqueuePublicationJob.mockResolvedValue({
    ok: true,
    value: { candidate, job, replayed: false },
  });
});

describe("reviewed seed Catalog publication operator", () => {
  it("rejects a wrong-organization actor before reading or enqueueing", async () => {
    const db = database();
    mocks.getAuthContext.mockResolvedValue(actor({ organizationId: "other-org" }));

    const result = await publishSeedCatalog(publishInput(db));

    expect(result).toEqual({
      ok: false,
      error: { kind: "unauthorized", message: "actor organization or active state is invalid" },
    });
    expect(db.query).not.toHaveBeenCalled();
    expect(mocks.enqueuePublicationJob).not.toHaveBeenCalled();
  });

  it("rejects a stale current pin before invoking the native publication queue", async () => {
    const db = database();
    const stale = { ...current, digest: digest("e") };
    db.query = vi.fn(async (text: string) => {
      if (text.includes("from parameter_catalog.catalog_state")) {
        return { rows: [stale], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await publishSeedCatalog(publishInput(db));

    expect(result).toEqual({
      ok: false,
      error: { kind: "stale", message: "current Catalog pin drifted" },
    });
    expect(mocks.getCandidate).not.toHaveBeenCalled();
    expect(mocks.enqueuePublicationJob).not.toHaveBeenCalled();
  });

  it("keeps retries on the native enqueue path and returns the same job pointer", async () => {
    const db = database();
    let calls = 0;
    mocks.enqueuePublicationJob.mockImplementation(async () => ({
      ok: true,
      value: { candidate, job, replayed: calls++ > 0 },
    }));

    const first = await publishSeedCatalog(publishInput(db));
    const retry = await publishSeedCatalog(publishInput(db));

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(first.value.jobId).toBe(job.id);
      expect(retry.value.jobId).toBe(job.id);
      expect(first.value.candidateId).toBe(candidate.id);
    }
    expect(mocks.enqueuePublicationJob).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePublicationJob.mock.calls[0]?.[0]).toMatchObject({
      candidateId: candidate.id,
      idempotencyKey: "seed:retry",
    });
  });

  it("requires catalog:author for preparation, before any Catalog read", async () => {
    const db = database();
    mocks.getAuthContext.mockResolvedValue(actor({}, ["parameter:view"]));

    const result = await prepareSeedCatalog({
      db,
      organizationId: "org-seed",
      actorUserId: "reviewer",
      identity: {
        runId: "seed-run",
        stage: "configuration-schema",
        candidateId: candidate.id,
        artifactId: candidate.artifactId,
        releaseId: "crel_seed_prepare",
        releaseVersion: "2.0.0",
        publishedAt: "2026-09-21T00:00:00.000Z",
        toolchain: {
          compiler: "seed",
          jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
          sourceFormat: "typed-changeset",
        },
        definitions: [],
      },
      pins: {
        expectedCurrent: current,
        predecessorArtifactDigest: digest("f"),
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: "unauthorized", message: "catalog:author is required" },
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
