import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pg from "pg";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
} from "../../../../server/modules/catalog-cutover/interface";
import {
  captureRecoveryPoint,
  createMemoryStorePort,
  createPostgresStorePort,
  isForbiddenComposeAppPostgres,
  postgresIdentityFromUrl,
  type CaptureRecoveryPointInput,
  type QuiescenceProof,
  type RecoveryPointCapture,
  type RecoveryPointResult,
  type StoreSnapshotPort,
} from "../../storage/recoveryPoint";
import { CONTROLLER_STATES } from "./stateMachine";
import {
  CONTROLLER_STATE_MATRIX,
  FAILURE_MATRIX,
  PHASE_FAILURE_KINDS,
  classifyUpgradeRecovery,
  observationForPhaseFailure,
  observationFromRecordedState,
} from "./nextAction";
import { inspectUpgradeRecovery, observeRestoreCheck, THREAT_MATRIX } from "./recovery";
import type { CutoverPorts, VerificationPorts } from "./actions";
import type {
  CutoverPlan,
  CutoverResult,
  CutoverRunSnapshot,
} from "../../../../server/modules/catalog-cutover/interface";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const FORBIDDEN_COMPOSE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";

const ok = <T>(value: T): CutoverResult<T> => ({ ok: true, value });

const cutoverPlan = (): CutoverPlan => ({
  planDigest: "sha256:plan-723",
  sourceSnapshotFingerprint: "sha256:source-723",
  targetArtifactSha: "b".repeat(40),
  targetCatalogReleaseDigest: "sha256:release-723",
  migrationContractVersion: "s7-orc-p0-p10-v1",
  phases: PRE_ACTIVATION_PHASES,
});

const snapshotFor = (state: CutoverRunSnapshot["state"], phase: CutoverRunSnapshot["currentPhase"]): CutoverRunSnapshot => ({
  runId: "cutover_plan-723",
  planDigest: "sha256:plan-723",
  currentPhase: phase,
  state,
  resumed: false,
  liveRun: state === "running",
  checkpoints: PRE_ACTIVATION_PHASES.slice(0, PRE_ACTIVATION_PHASES.indexOf(phase) + 1).map((name) => ({
    phase: name,
    checkpointDigest: `sha256:${name.toLowerCase()}`,
    payload: {},
    committedAt: "2026-09-04T00:00:00.000Z",
  })),
  runBoundToken: "token-723",
  recoveryPointDump: "dump-723",
});

describe.sequential("S11-REC failure matrix integration", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  const databaseUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  const objectRecords: Record<string, string> = {};
  const redisRecords: Record<string, string> = {};
  let nowMs = Date.parse("2026-09-04T12:00:00.000Z");
  const clock = { now: () => new Date(nowMs) };
  let capture: RecoveryPointCapture;

  const expectOk = <T>(result: RecoveryPointResult<T>): T => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.error.kind}: ${result.error.detail}`);
    }
    return result.value;
  };

  const quiescedProof = (): QuiescenceProof => ({
    status: "quiesced",
    writersFenced: true,
    queueDrained: true,
    proxyStopped: true,
    observedAt: clock.now().toISOString(),
  });

  const testPostgresPort = (): StoreSnapshotPort =>
    createPostgresStorePort(databaseUrl, {
      allowComposeApp: isForbiddenComposeAppPostgres(databaseUrl),
    });

  const threeStores = (): StoreSnapshotPort[] => [
    testPostgresPort(),
    createMemoryStorePort("object-store", "s3://wiseeff-lane-723/", objectRecords),
    createMemoryStorePort("redis", "redis://s11-rec-lane-723/0", redisRecords),
  ];

  const captureInput = (
    overrides: Partial<CaptureRecoveryPointInput> = {},
  ): CaptureRecoveryPointInput => ({
    runId: "run723matrix",
    target: {
      deploymentId: "s11-rec-lane-723",
      hostFingerprint: "sha256:s11-rec-host",
      postgresIdentity: postgresIdentityFromUrl(databaseUrl),
      objectStoreIdentity: "s3://wiseeff-lane-723/",
      redisIdentity: "redis://s11-rec-lane-723/0",
    },
    quiescence: quiescedProof(),
    stores: threeStores(),
    maximumAgeMs: 60 * 60 * 1000,
    now: clock.now,
    ...overrides,
  });

  const isolatedRestoreTargets = () => ({
    liveDatabaseUrl: databaseUrl,
    restoreDatabaseUrl: "postgres://wiseeff_restore@127.0.0.1:55438/wiseeff_restore_723",
    liveBucket: "wiseeff-lane-723",
    restoreBucket: "wiseeff-restore-723",
    restorePrefix: "s11-rec/",
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

  const withStoreLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
    });
    await client.connect();
    try {
      await client.query("select pg_catalog.pg_advisory_lock($1)", [723_001]);
      return await fn();
    } finally {
      await client.query("select pg_catalog.pg_advisory_unlock($1)", [723_001]).catch(() => undefined);
      await client.end();
    }
  };

  const idlePorts = (): { cutover: CutoverPorts; verification: VerificationPorts } => {
    const cutover: CutoverPorts = {
      plan: async () => ok(cutoverPlan()),
      execute: async () => ok(snapshotFor("completed", "P10")),
      inspect: async () => ok(snapshotFor("running", "P3")),
      recover: async () => ok(snapshotFor("recovery-required", "P3")),
    };
    const verification: VerificationPorts = {
      prepareVerification: (async () => ({
        ok: true,
        value: { digest: "sha256:vplan" },
      })) as VerificationPorts["prepareVerification"],
      runVerification: (async () => ({
        ok: true,
        value: { digest: "sha256:vattempt" },
      })) as VerificationPorts["runVerification"],
    };
    return { cutover, verification };
  };

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error(
        "S11-REC failure-matrix tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
      );
    }
    expect(isForbiddenComposeAppPostgres(databaseUrl)).toBe(false);
    expect(isForbiddenComposeAppPostgres(FORBIDDEN_COMPOSE_URL)).toBe(true);
    const parsed = new URL(databaseUrl);
    expect(Number(parsed.port || "5432")).not.toBe(5432);
    expect(parsed.pathname.replace(/^\//, "")).not.toBe("wiseeff");

    await withLane(async (client) => {
      const vector = await client.query<{ extversion: string }>(
        `select extversion from pg_catalog.pg_extension where extname = 'vector'`,
      );
      if (!vector.rows[0]?.extversion) {
        throw new Error(
          "S11-REC failure-matrix tests require pgvector; skipping is forbidden",
        );
      }
      await client.query(`create schema if not exists s11_rp_drill`);
      await client.query(
        `create table if not exists s11_rp_drill.sentinel (k text primary key, v text)`,
      );
    });
  });

  beforeEach(async () => {
    nowMs = Date.parse("2026-09-04T12:00:00.000Z");
    for (const key of Object.keys(objectRecords)) {
      delete objectRecords[key];
    }
    for (const key of Object.keys(redisRecords)) {
      delete redisRecords[key];
    }
    objectRecords["logs/probe.bin"] = "object-v1";
    redisRecords["queue:lease"] = "redis-v1";
  });

  it("keeps the frozen threat matrix aligned with the exhaustive failure matrix", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(FAILURE_MATRIX).toHaveLength(PRE_ACTIVATION_PHASES.length * PHASE_FAILURE_KINDS.length);
    expect(new Set(CONTROLLER_STATE_MATRIX.map((row) => row.controllerState))).toEqual(
      new Set(CONTROLLER_STATES),
    );
    for (const phase of UNAVAILABLE_PHASES) {
      expect(FAILURE_MATRIX.some((row) => (row.phase as string) === phase)).toBe(false);
    }
  });

  it("classifies known, unknown, partial, and cross-store outcomes after every P0-P10 phase", async () => {
    await withStoreLock(async () => {
      await withLane(async (client) => {
        await client.query(
          `insert into s11_rp_drill.sentinel(k, v) values ('s11-rec-matrix', 'v1')
           on conflict (k) do update set v = excluded.v`,
        );
      });
      capture = expectOk(await captureRecoveryPoint(captureInput()));
      const authorized = await observeRestoreCheck({
        capture,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      });
      expect(authorized).toEqual({ stores: "complete", restore: "authorized" });

      const partial = await observeRestoreCheck({
        capture,
        restoreTargets: isolatedRestoreTargets(),
        stores: [testPostgresPort()],
        now: clock.now,
      });
      expect(partial.stores).toBe("partial");

      for (const row of FAILURE_MATRIX) {
        const observation = observationForPhaseFailure(row.phase, row.kind);
        if (row.kind === "authorized-whole-state-restore" || row.kind === "forward-recover") {
          expect(observation.restore).toBe("authorized");
          expect(observation.stores).toBe(authorized.stores);
        }
        if (row.kind === "partial-store") {
          expect(observation.stores).toBe(partial.stores);
        }
        const decision = classifyUpgradeRecovery(observation);
        expect(decision.action, `${row.phase}:${row.kind}`).toBe(row.expected);
        expect(decision.autoResume).toBe(decision.action === "resume");
        if (
          row.kind === "unknown-commit" ||
          row.kind === "partial-store" ||
          row.kind === "token-failure"
        ) {
          expect(decision.autoResume).toBe(false);
          expect(decision.action).toBe("manual-stop");
        }
      }
    });
  });

  it("fails closed on checksum drift, stale token, and compose 5432/wiseeff restore targets", async () => {
    await withStoreLock(async () => {
      await withLane(async (client) => {
        await client.query(
          `insert into s11_rp_drill.sentinel(k, v) values ('s11-rec-matrix', 'v1')
           on conflict (k) do update set v = excluded.v`,
        );
      });
      capture = expectOk(await captureRecoveryPoint(captureInput()));
      objectRecords["logs/probe.bin"] = "object-v2";
      const drifted = await observeRestoreCheck({
        capture,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      });
      expect(drifted.restore).toBe("checksum-drift");
      expect(
        classifyUpgradeRecovery(
          observationFromRecordedState({
            controllerState: "recovery-required",
            commitOutcome: "committed",
            stores: drifted.stores,
            restore: drifted.restore,
            recordedAction: "whole-state-restore",
            cutoverInspect: snapshotFor("recovery-required", "P5"),
          }),
        ).action,
      ).toBe("manual-stop");

      objectRecords["logs/probe.bin"] = "object-v1";
      const compose = await observeRestoreCheck({
        capture,
        restoreTargets: {
          ...isolatedRestoreTargets(),
          restoreDatabaseUrl: FORBIDDEN_COMPOSE_URL,
        },
        stores: threeStores(),
        now: clock.now,
      });
      expect(compose.restore).toBe("wrong-target");

      const other = expectOk(await captureRecoveryPoint(captureInput({ runId: "run723other" })));
      const wrongToken = await observeRestoreCheck({
        capture: { ...capture, restoreToken: other.restoreToken },
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      });
      expect(wrongToken.restore).toBe("token-failure");
      expect(objectRecords["logs/probe.bin"]).toBe("object-v1");
      expect(redisRecords["queue:lease"]).toBe("redis-v1");
    });
  });

  it("inspects a recorded journal without auto-resuming unknown or activation outcomes", async () => {
    const ports = idlePorts();
    const journalPath = path.join(mkdtempSync(path.join(tmpdir(), "s11-rec-matrix-")), "journal.json");
    const classified = await inspectUpgradeRecovery(
      {
        journalPath,
        runId: "run-matrix-idle",
        cutover: ports.cutover,
        verification: ports.verification,
      },
      { stores: "complete", restore: "authorized" },
    );
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.snapshot.state).toBe("idle");
    expect(classified.value.decision.action).toBe("manual-stop");
    expect(classified.value.decision.autoResume).toBe(false);
  });
});
