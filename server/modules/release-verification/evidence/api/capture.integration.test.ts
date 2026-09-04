import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeTestAuthContext } from "../../../../testing/authContext";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../../testing/parameterCatalog";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../../../testing/testDatabase";
import { seedCompiledCatalogProjection } from "../../../catalog-kernel/runtime/currentSnapshot";
import { createPostgresDatabase } from "../../../../shared/database/client";
import { createHttpServer } from "../../../../shared/http/server";
import { digestOf } from "../../core/digest";
import { apiVerificationGateIds, purposeProfile } from "../../core/gateRegistry";
import type { VerificationPlan } from "../../core/types";
import { captureCatalogApiEvidence, evaluateCatalogApiGate } from "./capture";
import { createCatalogApiEvidenceHarness, createCatalogApiHttpDriver } from "./driver";
import { databaseIdentityDigest, readDatabaseIdentity, readLiveCatalogPin } from "./identity";
import { CATALOG_API_PROBE_CONTEXT } from "./probes";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-API evidence tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-API evidence tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s10-api";
const ATTR_ID = "attr-s10-api";
const MODULE_ID = "pmod-s10-api-driver";
const USER_ID = "user-org-admin";

const listen = async (
  server: Server,
): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};

describe("S10-API HTTP evidence against real PostgreSQL", () => {
  let catalogDb: ParameterCatalogDatabase;
  let rootDb: ReturnType<typeof createPostgresDatabase>;
  let pool: pg.Pool;
  let closeServer: () => Promise<void> = async () => undefined;
  let plan: VerificationPlan;
  let bundle: Awaited<ReturnType<typeof captureCatalogApiEvidence>> extends infer R
    ? R extends { ok: true; value: infer V }
      ? V
      : never
    : never;

  beforeAll(async () => {
    catalogDb = await createDisposableParameterCatalogDatabase("s10api");
    const seeded = await seedCompiledCatalogProjection(catalogDb.url);
    pool = new pg.Pool({ connectionString: catalogDb.url, max: 4 });
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S10 API')`, [ORG_ID]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S10 API driver', 'compatible:acme,power')`,
      [ATTR_ID, ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR_ID],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE_ID, ORG_ID, ATTR_ID],
    );

    rootDb = createPostgresDatabase(catalogDb.url);
    const authorizedAuth = makeTestAuthContext({
      userId: USER_ID,
      organizationId: ORG_ID,
      roleId: "admin",
    });
    const agentAuth = makeTestAuthContext({
      userId: "agent-s10-api",
      organizationId: ORG_ID,
      roleId: "software-user",
      permissions: ["parameter:view"],
    });
    const forbiddenAuth = makeTestAuthContext({
      userId: "guest-s10-api",
      organizationId: ORG_ID,
      roleId: "guest",
      permissions: [],
    });
    const harness = createCatalogApiEvidenceHarness({
      db: rootDb,
      organizationId: ORG_ID,
      principalId: USER_ID,
      authorizedAuth,
      agentAuth,
      forbiddenAuth,
    });
    const http = await listen(createHttpServer(harness.router));
    closeServer = http.close;
    const identity = await readDatabaseIdentity((text, values) => rootDb.query(text, values));
    const liveCatalog = await readLiveCatalogPin((text, values) => rootDb.query(text, values));
    if (!liveCatalog) {
      throw new Error("seeded catalog pointer must be installed");
    }
    expect(liveCatalog.releaseId).toBe(seeded.current.id);
    const capturePins = {
      artifact: {
        gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        releaseTag: "v-s10-api",
        packageManifestDigest: "sha256:pkg",
        apiImageDigest: "sha256:api",
        workerImageDigest: "sha256:worker",
        webImageDigest: "sha256:web",
      },
      catalog: {
        releaseId: liveCatalog.releaseId,
        releaseDigest: liveCatalog.releaseDigest,
        compiledModelDigest: "sha256:compiled",
        materializationFingerprint: "sha256:material",
      },
      database: {
        targetIdentity: databaseIdentityDigest(identity),
        schemaVersion: catalogDb.schemaFingerprint ?? "0139",
        migrationInventoryDigest: "sha256:migrations",
      },
      cutover: {
        planDigest: "sha256:cutover",
        contractVersion: "v1",
        sourceSnapshotFingerprint: "sha256:source",
      },
      mappingArchive: {
        mappingEpoch: "epoch-1",
        mappingHeadDigest: "sha256:map",
        archiveManifestDigest: "sha256:archive",
      },
      recovery: {
        recoveryPointId: "rp-1",
        recoveryPointDigest: "sha256:rp",
      },
      acceptance: {
        openApiDigest: "sha256:openapi",
        browserBundleSha: "sha256:browser",
      },
      target: {
        deploymentId: "deploy-s10-api",
        hostFingerprint: "sha256:host",
      },
      verification: {
        contractVersion: "s10-api",
        verifierRole: "catalog_verifier",
      },
    };
    plan = {
      id: "vplan_s10_api" as VerificationPlan["id"],
      digest: "sha256:plan" as VerificationPlan["digest"],
      canonicalBytes: "{}",
      purpose: "isolated-candidate-acceptance",
      mode: "populated",
      subject: {
        targetId: "target-s10-api",
        deploymentClass: "self-hosted",
        environmentId: "env-isolated",
      },
      lineage: {
        phaseSnapshot: "P14a",
        predecessorReportDigests: [],
        p12State: "retired",
        p13State: "retired",
        writerRetirementFingerprint: "sha256:writers",
        runtimePinGeneration: "pin-1",
        pointerRollbackStatus: "closed",
        trafficIsolationState: "isolated",
      },
      pins: capturePins,
      evidenceRequirements: {
        recoveryPointDigest: "sha256:rp",
        mappingEpoch: "epoch-1",
        cutoverPlanDigest: "sha256:cutover",
        acceptanceContractDigest: "sha256:accept",
      },
      registryDigest: "sha256:registry" as VerificationPlan["registryDigest"],
      gateSelectionSource: "registry",
      applicabilityProfile: purposeProfile("isolated-candidate-acceptance", "populated"),
      createdAt: new Date().toISOString(),
    };

    const captured = await captureCatalogApiEvidence({
      plan,
      runtime: { kind: "candidate", candidateId: "sha256:api" },
      driver: createCatalogApiHttpDriver({
        baseUrl: http.baseUrl,
        setPrincipal: harness.setPrincipal,
      }),
      database: (text, values) => rootDb.query(text, values),
      principal: {
        principalId: USER_ID,
        organizationId: ORG_ID,
        actorKind: "org-admin",
      },
      probeContext: CATALOG_API_PROBE_CONTEXT,
    });
    expect(captured.ok, JSON.stringify(captured)).toBe(true);
    if (!captured.ok) {
      throw new Error("capture must succeed for S10-API HTTP evidence");
    }
    bundle = captured.value;
  }, 120_000);

  afterAll(async () => {
    await closeServer();
    await rootDb?.close();
    await pool?.end();
    await catalogDb?.close();
  });

  it("binds PCAT-API-01..12 to one candidate HTTP/PG identity", () => {
    expect(bundle.records.map((record) => record.gateId)).toEqual([...apiVerificationGateIds]);
    expect(bundle.evidenceRefs).toHaveLength(12);
    const pinDigest = digestOf(plan.pins);
    for (const record of bundle.records) {
      expect(record.exchanges.every((exchange) => exchange.requestId.startsWith("s10api_"))).toBe(true);
      expect(digestOf(record.pins)).toBe(pinDigest);
      expect(record.databaseIdentity).toBe(bundle.databaseIdentity);
      expect(record.principalId).toBe(USER_ID);
    }
    const byId = new Map(bundle.records.map((record) => [record.gateId, record]));
    for (const gateId of apiVerificationGateIds) {
      if (gateId === "PCAT-API-12") {
        continue;
      }
      const record = byId.get(gateId);
      expect(record, gateId).toBeDefined();
      expect(evaluateCatalogApiGate(record!).passed, `${gateId} ${JSON.stringify(record?.observations)}`).toBe(
        true,
      );
    }
    expect(byId.get("PCAT-API-01")?.exchanges.some((exchange) => exchange.catalogReleaseId === plan.pins.catalog.releaseId)).toBe(
      true,
    );
    expect(byId.get("PCAT-API-08")?.exchanges.some((exchange) => exchange.status === 410)).toBe(true);
    expect(
      byId.get("PCAT-API-09")?.exchanges.some((exchange) => exchange.principal === "agent" && exchange.status === 403),
    ).toBe(true);
    const api12 = byId.get("PCAT-API-12");
    expect(api12?.exchanges.length).toBeGreaterThan(0);
    expect(evaluateCatalogApiGate(api12!).passed).toBe(false);
  });

  it("stores digest-verified evidence refs for every API gate", () => {
    for (const ref of bundle.evidenceRefs) {
      expect(ref.digest.startsWith("sha256:")).toBe(true);
      expect(ref.producer).toBe("s10-api");
      expect(digestOf(ref.pins)).toBe(digestOf(plan.pins));
    }
  });
});
