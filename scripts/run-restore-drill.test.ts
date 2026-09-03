import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrepareVerificationInput, ReadReportResult } from "../server/modules/release-verification/core";
import {
  asEvidenceRequirementRecoveryDigest,
  asPrepareVerificationRecovery,
  captureRecoveryPoint,
  createMemoryStorePort,
  createPostgresStorePort,
  evaluateRestoreTargets,
  isForbiddenComposeAppPostgres,
  parseRestoreDrillArgs,
  postgresIdentityFromUrl,
  restoreCheck,
  THREAT_MATRIX,
  verifyRecoveryPoint,
  type CaptureRecoveryPointInput,
  type QuiescenceProof,
  type RecoveryPointResult,
  type RestoreTargetInput,
  type StoreSnapshotPort,
} from "./run-restore-drill";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.resolve(scriptsDir, "../ops/self-hosted/storage");
const FORBIDDEN_COMPOSE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";

describe("M6.3 restore drill target safety", () => {
  it("allows explicitly isolated database and object-store restore targets", () => {
    expect(
      evaluateRestoreTargets({
        liveDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
        restoreDatabaseUrl: "postgres://wiseeff_restore@localhost:5432/wiseeff_restore",
        liveBucket: "wiseeff-prod",
        restoreBucket: "wiseeff-restore",
        restorePrefix: "m6-drill/2026-06-02/"
      })
    ).toEqual({
      status: "passed",
      unsafeFields: [],
      validationErrors: []
    });
  });

  it("rejects live production database and bucket restore targets before commands run", () => {
    const result = evaluateRestoreTargets({
      liveDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
      restoreDatabaseUrl: "postgres://wiseeff@localhost:5432/wiseeff",
      liveBucket: "wiseeff-prod",
      restoreBucket: "wiseeff-prod",
      restorePrefix: ""
    });

    expect(result.status).toBe("failed");
    expect(result.unsafeFields).toEqual(
      expect.arrayContaining(["restoreDatabaseUrl", "restoreBucket", "restorePrefix"])
    );
    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        "restoreDatabaseUrl must not match the live database URL.",
        "restoreBucket must not match the live object-store bucket.",
        "restorePrefix must be non-empty and end with '/'."
      ])
    );
  });

  it("loads dotenv restore targets without requiring shell source", () => {
    const env = parseRestoreDrillArgs(["--env-file", "target.env"], {
      fileSystem: {
        existsSync: (filePath) => filePath === "target.env",
        readFileSync: () =>
          [
            "DATABASE_URL=postgres://wiseeff:secret@postgres:5432/wiseeff",
            "RESTORE_DATABASE_URL=postgres://wiseeff_restore:secret@postgres:5432/wiseeff_restore",
            "OBJECT_STORAGE_BUCKET=wiseeff-prod",
            "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
            "RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/",
            "M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer token with spaces"
          ].join("\n")
      },
      processEnv: {}
    });

    expect(env).toMatchObject({
      DATABASE_URL: "postgres://wiseeff:secret@postgres:5432/wiseeff",
      RESTORE_DATABASE_URL: "postgres://wiseeff_restore:secret@postgres:5432/wiseeff_restore",
      OBJECT_STORAGE_BUCKET: "wiseeff-prod",
      RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore",
      RESTORE_OBJECT_STORAGE_PREFIX: "m6-drill/",
      M6_SELFHOSTED_SMOKE_AUTHORIZATION: "Bearer token with spaces"
    });
  });

  it("supports target-env-file aliases that do not conflict with Node flags", () => {
    const fileSystem = {
      existsSync: (filePath: string) => filePath === "target.env",
      readFileSync: () =>
        [
          "RESTORE_DATABASE_URL=postgres://wiseeff_restore@postgres:5432/wiseeff_restore",
          "RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore",
          "RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/"
        ].join("\n")
    };

    expect(
      parseRestoreDrillArgs(["--target-env-file=target.env"], {
        fileSystem,
        processEnv: {}
      })
    ).toMatchObject({
      RESTORE_DATABASE_URL: "postgres://wiseeff_restore@postgres:5432/wiseeff_restore"
    });
    expect(
      parseRestoreDrillArgs([], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "target.env" }
      })
    ).toMatchObject({
      RESTORE_OBJECT_STORAGE_BUCKET: "wiseeff-restore"
    });
    expect(
      parseRestoreDrillArgs(["target.env"], {
        fileSystem,
        processEnv: { npm_config_target_env_file: "true" }
      })
    ).toMatchObject({
      RESTORE_OBJECT_STORAGE_PREFIX: "m6-drill/"
    });
  });
});

describe("S11-RP threat matrix", () => {
  it("freezes the seven R3 observations before production capture is accepted", () => {
    expect(THREAT_MATRIX).toHaveLength(7);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "quiesced-exact-target-capture",
      "pre-quiesce-capture-refused",
      "partial-store-fail-closed",
      "stale-boundary-or-checksum-drift",
      "wrong-target-identity",
      "restore-check-token-failure",
      "consume-s10-per-types-without-reimplementing-gates",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.attack.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.evidenceOwner.length).toBeGreaterThan(0);
    }
  });
});

describe("S11-RP S10-PER type consumption", () => {
  it("does not reimplement S10-PER operations or emit forbidden production tokens", () => {
    const productionFiles = [
      path.join(scriptsDir, "run-restore-drill.ts"),
      ...readdirSync(storageDir)
        .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
        .map((name) => path.join(storageDir, name)),
    ];
    expect(productionFiles.length).toBeGreaterThan(1);

    const forbiddenLegacy = ["parameter", "definitions"].join("_");
    const combined = productionFiles.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
    expect(combined).not.toContain(forbiddenLegacy);
    expect(combined).not.toMatch(/function\s+prepareVerification\b/);
    expect(combined).not.toMatch(/function\s+readReport\b/);
    expect(combined).not.toMatch(/function\s+runVerification\b/);
    expect(combined).not.toMatch(/function\s+assembleReport\b/);
    expect(combined).not.toMatch(/function\s+approveReport\b/);
    expect(combined).not.toContain("createReleaseVerificationService");
    expect(combined).not.toMatch(/pg_restore\b/);
    expect(combined).not.toMatch(/DROP\s+DATABASE/i);
  });
});

describe.sequential("S11-RP recovery point", () => {
  const databaseUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  const objectRecords: Record<string, string> = {};
  const redisRecords: Record<string, string> = {};
  let nowMs = Date.parse("2026-09-03T00:00:00.000Z");

  const clock = {
    now: () => new Date(nowMs),
  };

  const expectOk = <T>(result: RecoveryPointResult<T>): T => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.error.kind}: ${result.error.detail}`);
    }
    return result.value;
  };

  const expectRefused = async (
    resultPromise: Promise<RecoveryPointResult<unknown>>,
    kind: string,
  ) => {
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refusal");
    }
    expect(result.error.kind).toBe(kind);
    expect(result).not.toHaveProperty("restoreToken");
    return result.error;
  };

  const quiescedProof = (): QuiescenceProof => ({
    status: "quiesced",
    writersFenced: true,
    queueDrained: true,
    proxyStopped: true,
    observedAt: clock.now().toISOString(),
  });

  const isolatedRestoreTargets = (): RestoreTargetInput => ({
    liveDatabaseUrl: databaseUrl,
    restoreDatabaseUrl: "postgres://wiseeff_restore@127.0.0.1:55438/wiseeff_restore_721",
    liveBucket: "wiseeff-lane-721",
    restoreBucket: "wiseeff-restore-721",
    restorePrefix: "s11-rp/",
  });

  const testPostgresPort = (): StoreSnapshotPort =>
    createPostgresStorePort(databaseUrl, {
      allowComposeApp: isForbiddenComposeAppPostgres(databaseUrl),
    });

  const threeStores = (): StoreSnapshotPort[] => [
    testPostgresPort(),
    createMemoryStorePort("object-store", "s3://wiseeff-lane-721/", objectRecords),
    createMemoryStorePort("redis", "redis://s11-rp-lane-721/0", redisRecords),
  ];

  const captureInput = (
    overrides: Partial<CaptureRecoveryPointInput> = {},
  ): CaptureRecoveryPointInput => ({
    runId: "run721a",
    target: {
      deploymentId: "s11-rp-lane-721",
      hostFingerprint: "sha256:s11-rp-host",
      postgresIdentity: postgresIdentityFromUrl(databaseUrl),
      objectStoreIdentity: "s3://wiseeff-lane-721/",
      redisIdentity: "redis://s11-rp-lane-721/0",
    },
    quiescence: quiescedProof(),
    stores: threeStores(),
    maximumAgeMs: 60 * 60 * 1000,
    now: clock.now,
    ...overrides,
  });

  const withLane = async (fn: (client: pg.Client) => Promise<void>) => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    await client.connect();
    try {
      await fn(client);
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error(
        "S11-RP tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
      );
    }
    const parsed = new URL(databaseUrl);
    expect(parsed.protocol).toMatch(/^postgres(ql)?:$/);
    expect(parsed.hostname.length).toBeGreaterThan(0);

    await withLane(async (client) => {
      const vector = await client.query<{ extversion: string }>(
        `select extversion from pg_catalog.pg_extension where extname = 'vector'`,
      );
      if (!vector.rows[0]?.extversion) {
        throw new Error(
          "S11-RP tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
        );
      }
      await client.query(`create schema if not exists s11_rp_drill`);
      await client.query(
        `create table if not exists s11_rp_drill.sentinel (k text primary key, v text)`,
      );
    });
  });

  beforeEach(async () => {
    nowMs = Date.parse("2026-09-03T00:00:00.000Z");
    for (const key of Object.keys(objectRecords)) {
      delete objectRecords[key];
    }
    for (const key of Object.keys(redisRecords)) {
      delete redisRecords[key];
    }
    objectRecords["logs/probe.bin"] = "object-v1";
    redisRecords["queue:lease"] = "redis-v1";
    await withLane(async (client) => {
      await client.query(`truncate s11_rp_drill.sentinel`);
      await client.query(`insert into s11_rp_drill.sentinel(k, v) values ('probe', 'v1')`);
    });
  });

  it("captures a quiesced exact target into manifest checksums, verification, and a run-bound token", async () => {
    const capture = expectOk(await captureRecoveryPoint(captureInput()));
    expect(capture.verification.status).toBe("verified");
    expect(capture.manifest.schemaVersion).toBe("s11-rp-v1");
    expect(capture.manifest.runId).toBe("run721a");
    expect(capture.manifest.stores.postgres.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(capture.manifest.stores.objectStore.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(capture.manifest.stores.redis.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(capture.manifest.stores.postgres.checksum).not.toBe(
      capture.manifest.stores.objectStore.checksum,
    );
    expect(capture.manifest.recoveryPointDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(capture.restoreToken.startsWith("restore-run721a.")).toBe(true);
    expect(capture.manifest).not.toHaveProperty("restoreToken");

    const verified = expectOk(
      await verifyRecoveryPoint({
        manifest: capture.manifest,
        stores: threeStores(),
        now: clock.now,
      }),
    );
    expect(verified.status).toBe("verified");
    expect(verified.recoveryPointDigest).toBe(capture.manifest.recoveryPointDigest);

    const authorized = expectOk(
      await restoreCheck({
        manifest: capture.manifest,
        restoreToken: capture.restoreToken,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      }),
    );
    expect(authorized.status).toBe("restore-authorized");
    expect(authorized.recoveryPointDigest).toBe(capture.manifest.recoveryPointDigest);
    expect(objectRecords["logs/probe.bin"]).toBe("object-v1");
    expect(redisRecords["queue:lease"]).toBe("redis-v1");
  });

  it("refuses capture before quiescence and does not mint a token", async () => {
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          quiescence: {
            status: "not-quiesced",
            writersFenced: false,
            queueDrained: false,
            proxyStopped: false,
            observedAt: clock.now().toISOString(),
          },
        }),
      ),
      "pre-quiesce",
    );
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          quiescence: {
            status: "quiesced",
            writersFenced: true,
            queueDrained: false,
            proxyStopped: true,
            observedAt: clock.now().toISOString(),
          },
        }),
      ),
      "pre-quiesce",
    );
  });

  it("fails closed on a partial store set and never mints a token", async () => {
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          stores: [
            testPostgresPort(),
            createMemoryStorePort("object-store", "s3://wiseeff-lane-721/", objectRecords),
          ],
        }),
      ),
      "partial-store",
    );
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          stores: [
            createMemoryStorePort("object-store", "s3://wiseeff-lane-721/", objectRecords),
            createMemoryStorePort("redis", "redis://s11-rp-lane-721/0", redisRecords),
          ],
        }),
      ),
      "partial-store",
    );
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          stores: [
            testPostgresPort(),
            createMemoryStorePort("object-store", "s3://wiseeff-lane-721/", objectRecords),
            createMemoryStorePort("redis", "redis://s11-rp-lane-721/0", redisRecords),
            createMemoryStorePort("redis", "redis://s11-rp-lane-721/duplicate", redisRecords),
          ],
        }),
      ),
      "partial-store",
    );
  });

  it("rejects a stale boundary and checksum drift with typed failures", async () => {
    const capture = expectOk(await captureRecoveryPoint(captureInput({ maximumAgeMs: 1_000 })));

    nowMs += 5_000;
    await expectRefused(
      verifyRecoveryPoint({
        manifest: capture.manifest,
        stores: threeStores(),
        now: clock.now,
      }),
      "stale-boundary",
    );

    nowMs = Date.parse("2026-09-03T00:00:00.000Z");
    objectRecords["logs/probe.bin"] = "object-v2";
    await expectRefused(
      verifyRecoveryPoint({
        manifest: capture.manifest,
        stores: threeStores(),
        now: clock.now,
      }),
      "checksum-drift",
    );

    objectRecords["logs/probe.bin"] = "object-v1";
    await withLane(async (client) => {
      await client.query(`update s11_rp_drill.sentinel set v = 'v2' where k = 'probe'`);
    });
    await expectRefused(
      restoreCheck({
        manifest: capture.manifest,
        restoreToken: capture.restoreToken,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      }),
      "checksum-drift",
    );
  });

  it("rejects the default compose app target and a mismatched restore identity", async () => {
    expect(isForbiddenComposeAppPostgres(FORBIDDEN_COMPOSE_URL)).toBe(true);
    await expect(
      createPostgresStorePort(FORBIDDEN_COMPOSE_URL).snapshot(new Date()),
    ).rejects.toThrow(/Forbidden compose app PostgreSQL target/);
    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          stores: [
            createPostgresStorePort(FORBIDDEN_COMPOSE_URL),
            createMemoryStorePort("object-store", "s3://wiseeff-lane-721/", objectRecords),
            createMemoryStorePort("redis", "redis://s11-rp-lane-721/0", redisRecords),
          ],
        }),
      ),
      "wrong-target",
    );

    await expectRefused(
      captureRecoveryPoint(
        captureInput({
          target: {
            deploymentId: "s11-rp-lane-721",
            hostFingerprint: "sha256:s11-rp-host",
            postgresIdentity: postgresIdentityFromUrl(databaseUrl),
            objectStoreIdentity: "s3://someone-else/",
            redisIdentity: "redis://s11-rp-lane-721/0",
          },
        }),
      ),
      "wrong-target",
    );

    const capture = expectOk(await captureRecoveryPoint(captureInput()));
    await expectRefused(
      restoreCheck({
        manifest: capture.manifest,
        restoreToken: capture.restoreToken,
        restoreTargets: {
          liveDatabaseUrl: databaseUrl,
          restoreDatabaseUrl: FORBIDDEN_COMPOSE_URL,
          liveBucket: "wiseeff-lane-721",
          restoreBucket: "wiseeff-restore-721",
          restorePrefix: "s11-rp/",
        },
        stores: threeStores(),
        now: clock.now,
      }),
      "wrong-target",
    );
    await expectRefused(
      restoreCheck({
        manifest: capture.manifest,
        restoreToken: capture.restoreToken,
        restoreTargets: {
          liveDatabaseUrl: databaseUrl,
          restoreDatabaseUrl: databaseUrl,
          liveBucket: "wiseeff-lane-721",
          restoreBucket: "wiseeff-lane-721",
          restorePrefix: "s11-rp/",
        },
        stores: threeStores(),
        now: clock.now,
      }),
      "wrong-target",
    );
  });

  it("refuses restore-check without a token or with another run's token", async () => {
    const capture = expectOk(await captureRecoveryPoint(captureInput()));
    const other = expectOk(await captureRecoveryPoint(captureInput({ runId: "run721b" })));

    await expectRefused(
      restoreCheck({
        manifest: capture.manifest,
        restoreToken: "",
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      }),
      "token-failure",
    );
    await expectRefused(
      restoreCheck({
        manifest: capture.manifest,
        restoreToken: other.restoreToken,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      }),
      "token-failure",
    );
    expect(objectRecords["logs/probe.bin"]).toBe("object-v1");
    expect(redisRecords["queue:lease"]).toBe("redis-v1");
  });

  it("pins capture output onto S10-PER prepareVerification recovery fields", async () => {
    const capture = expectOk(await captureRecoveryPoint(captureInput()));
    const recoveryPins: PrepareVerificationInput["pins"]["recovery"] =
      asPrepareVerificationRecovery(capture);
    const recoveryDigest: PrepareVerificationInput["evidenceRequirements"]["recoveryPointDigest"] =
      asEvidenceRequirementRecoveryDigest(capture);
    expect(recoveryPins).toEqual({
      recoveryPointId: capture.manifest.recoveryPointId,
      recoveryPointDigest: capture.manifest.recoveryPointDigest,
    });
    expect(recoveryDigest).toBe(capture.manifest.recoveryPointDigest);

    const unusedReport: ReadReportResult | undefined = undefined;
    expect(unusedReport).toBeUndefined();
    expect(capture).not.toHaveProperty("kind");
  });
});
