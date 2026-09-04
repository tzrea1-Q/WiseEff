import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  CutoverPlan,
  CutoverResult,
  CutoverRunSnapshot,
  ExecuteCutoverInput,
  PlanCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
} from "../../../../server/modules/catalog-cutover/interface";
import type {
  PrepareVerificationInput,
  ReleaseVerificationService,
  VerificationAttemptSnapshot,
  VerificationPlan,
} from "../../../../server/modules/release-verification/core";
import {
  captureRecoveryPoint,
  createMemoryStorePort,
  createPostgresStorePort,
  isForbiddenComposeAppPostgres,
  postgresIdentityFromUrl,
  type CaptureRecoveryPointInput,
  type QuiescenceProof,
  type RecoveryPointResult,
  type StoreSnapshotPort,
} from "../../storage/recoveryPoint";
import type { CutoverPorts, VerificationPorts } from "./actions";
import { asPrepareVerificationCutover } from "./actions";
import { openCatalogUpgradeController } from "./controller";
import { journalBytes } from "./journal";
import { createDisposableParameterCatalogDatabase } from "../../../../server/testing/parameterCatalog";
import { applyUpgradeRecovery, inspectUpgradeRecovery, observeRestoreCheck, THREAT_MATRIX } from "./recovery";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_COMPOSE_URL = "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";

const ownedProductionFiles = (): string[] =>
  readdirSync(dir)
    .filter((name) => name === "recovery.ts" || name === "nextAction.ts")
    .map((name) => path.join(dir, name));

const cutoverPlan = (): CutoverPlan => ({
  planDigest: "sha256:plan-1",
  sourceSnapshotFingerprint: "sha256:source-1",
  targetArtifactSha: "a".repeat(40),
  targetCatalogReleaseDigest: "sha256:release-1",
  migrationContractVersion: "s7-orc-p0-p10-v1",
  phases: PRE_ACTIVATION_PHASES,
});

const planInput = (): PlanCutoverInput =>
  ({
    graph: { identities: [{ id: "legacy-1" }] },
    targetArtifactSha: "a".repeat(40),
    targetCatalogReleaseDigest: "sha256:release-1",
  }) as PlanCutoverInput;

const executeInput = (): ExecuteCutoverInput =>
  ({
    plan: cutoverPlan(),
  }) as ExecuteCutoverInput;

const checkpointsThrough = (phase: CutoverRunSnapshot["currentPhase"]): CutoverRunSnapshot["checkpoints"] => {
  const end = PRE_ACTIVATION_PHASES.indexOf(phase) + 1;
  return PRE_ACTIVATION_PHASES.slice(0, end).map((name) => ({
    phase: name,
    checkpointDigest: `sha256:${name.toLowerCase()}`,
    payload: {},
    committedAt: "2026-09-04T00:00:00.000Z",
  }));
};

const runningSnapshot = (): CutoverRunSnapshot => ({
  runId: "cutover_plan-1",
  planDigest: "sha256:plan-1",
  currentPhase: "P3",
  state: "running",
  resumed: false,
  liveRun: true,
  checkpoints: checkpointsThrough("P3"),
  runBoundToken: "token-1",
  recoveryPointDump: "dump-1",
});

const recoveredSnapshot = (): CutoverRunSnapshot => ({
  ...runningSnapshot(),
  currentPhase: "P3",
  state: "recovery-required",
  liveRun: false,
});

const completedSnapshot = (): CutoverRunSnapshot => ({
  ...runningSnapshot(),
  currentPhase: "P10",
  state: "completed",
  liveRun: false,
  checkpoints: checkpointsThrough("P10"),
});

const ok = <T>(value: T): CutoverResult<T> => ({ ok: true, value });

const prepareInput = (): PrepareVerificationInput => ({
  subject: {
    targetId: "target-lab-1",
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "populated",
  lineage: {
    phaseSnapshot: "P10",
    predecessorReportDigests: [],
    p12State: "not-started",
    p13State: "not-started",
    writerRetirementFingerprint: null,
    runtimePinGeneration: null,
    pointerRollbackStatus: "open",
    trafficIsolationState: "isolated",
  },
  pins: {
    artifact: {
      gitSha: "a".repeat(40),
      releaseTag: "v-s11-rec",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "crel-s11",
      releaseDigest: "sha256:catalog",
      compiledModelDigest: "sha256:compiled",
      materializationFingerprint: "sha256:material",
    },
    database: {
      targetIdentity: "pg-s11",
      schemaVersion: "0139",
      migrationInventoryDigest: "sha256:migrations",
    },
    cutover: asPrepareVerificationCutover(cutoverPlan()),
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
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-per",
      verifierRole: "catalog_verifier",
    },
  },
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:plan-1",
    acceptanceContractDigest: "sha256:accept",
  },
});

type Harness = {
  readonly calls: string[];
  readonly cutover: CutoverPorts;
  readonly verification: VerificationPorts;
};

const createHarness = (options?: {
  execute?: CutoverPorts["execute"];
  inspect?: CutoverPorts["inspect"];
  recover?: CutoverPorts["recover"];
}): Harness => {
  const calls: string[] = [];
  const plan = cutoverPlan();
  let latest: CutoverRunSnapshot = runningSnapshot();
  const cutover: CutoverPorts = {
    plan: async () => {
      calls.push("plan");
      return ok(plan);
    },
    execute: async (input) => {
      calls.push("execute");
      const executed = options?.execute
        ? await options.execute(input)
        : ok(completedSnapshot());
      if (executed.ok) {
        latest = executed.value;
      }
      return executed;
    },
    inspect: async (input) => {
      calls.push("inspect");
      if (options?.inspect) {
        return options.inspect(input);
      }
      return ok(latest);
    },
    recover: async (input) => {
      calls.push("recover");
      const recovered = options?.recover
        ? await options.recover(input)
        : ok(recoveredSnapshot());
      if (recovered.ok) {
        latest = recovered.value;
      }
      return recovered;
    },
  };
  const verification: VerificationPorts = {
    prepareVerification: (async () => {
      calls.push("prepareVerification");
      return {
        ok: true,
        value: { digest: "sha256:vplan" } as VerificationPlan,
      };
    }) as ReleaseVerificationService["prepareVerification"],
    runVerification: (async () => {
      calls.push("runVerification");
      return {
        ok: true,
        value: { digest: "sha256:vattempt" } as VerificationAttemptSnapshot,
      };
    }) as ReleaseVerificationService["runVerification"],
  };
  return { calls, cutover, verification };
};

const journalPathFor = (runId: string): string =>
  path.join(mkdtempSync(path.join(tmpdir(), `s11-rec-${runId}-`)), "journal.json");

describe("S11-REC threat matrix", () => {
  it("freezes the eight R3 observations before recovery production work", () => {
    expect(THREAT_MATRIX).toHaveLength(8);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "unknown-commit-cannot-auto-resume",
      "partial-cross-store-cannot-restore",
      "crash-inspect-then-resume",
      "recovery-required-whole-state-restore",
      "forward-recovery-when-restore-unsafe",
      "stale-token-or-wrong-target-manual-stop",
      "consume-frozen-inspect-recover-resume-ports",
      "verification-ran-activation-manual-stop",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.attack.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.evidenceOwner === "L" || row.evidenceOwner === "L+PG").toBe(true);
    }
  });
});

describe("S11-REC recovery controller seam", () => {
  it("T3 crash inspect then resume continues the same journal run", async () => {
    let executeCalls = 0;
    const crashingExecute: CutoverPorts["execute"] = async () => {
      executeCalls += 1;
      if (executeCalls === 1) {
        return {
          ok: false,
          error: { code: "PCAT-ORC-CRASH", detail: "injected crash before P4" },
        };
      }
      return ok({ ...completedSnapshot(), resumed: true });
    };
    const harness = createHarness({ execute: crashingExecute });
    const journalPath = journalPathFor("crash");
    const deps = {
      journalPath,
      runId: "run-crash",
      cutover: harness.cutover,
      verification: harness.verification,
    };
    const opened = openCatalogUpgradeController(deps);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await opened.value.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    const crashed = await opened.value.dispatch({ action: "execute", input: executeInput() });
    expect(crashed.ok).toBe(true);
    if (!crashed.ok) return;
    expect(crashed.value.state).toBe("executing");

    const classified = await inspectUpgradeRecovery(deps, { stores: "complete", restore: "none" });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.decision.action).toBe("resume");
    expect(classified.value.decision.autoResume).toBe(true);
    expect(classified.value.snapshot.runId).toBe("run-crash");

    const applied = await applyUpgradeRecovery(deps, {
      stores: "complete",
      restore: "none",
      executeInput: executeInput(),
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.decision.action).toBe("resume");
    expect(applied.value.dispatched).toBe(true);
    expect(applied.value.snapshot.runId).toBe("run-crash");
    expect(applied.value.snapshot.state).toBe("cutover-completed");
    expect(executeCalls).toBe(2);
  });

  it("T1 unknown recovery-required cannot auto-resume", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("unknown");
    const deps = {
      journalPath,
      runId: "run-unknown",
      cutover: harness.cutover,
      verification: harness.verification,
    };
    const opened = openCatalogUpgradeController(deps);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await opened.value.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect((await opened.value.dispatch({ action: "execute", input: executeInput() })).ok).toBe(true);
    const recovered = await opened.value.dispatch({
      action: "recover",
      input: {
        runId: "cutover_plan-1",
        recordedAction: "whole-state-restore",
        runBoundToken: "token-1",
      },
    });
    expect(recovered.ok).toBe(true);
    const before = journalBytes(journalPath);
    const inspectCalls = harness.calls.filter((name) => name === "inspect").length;
    const recoverCalls = harness.calls.filter((name) => name === "recover").length;
    const executeCalls = harness.calls.filter((name) => name === "execute").length;

    const classified = await inspectUpgradeRecovery(deps, {
      stores: "missing",
      restore: "none",
      guessedOutcome: false,
    });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.decision.action).toBe("manual-stop");
    expect(classified.value.decision.autoResume).toBe(false);

    const forced = await applyUpgradeRecovery(deps, {
      stores: "missing",
      restore: "none",
      requested: "resume",
      executeInput: executeInput(),
    });
    expect(forced.ok).toBe(false);
    if (forced.ok) return;
    expect(forced.error.code).toBe("PCAT-REC-ILLEGAL-RESUME");
    expect(journalBytes(journalPath).equals(before)).toBe(true);
    expect(harness.calls.filter((name) => name === "inspect").length).toBeGreaterThan(inspectCalls);
    expect(harness.calls.filter((name) => name === "recover")).toHaveLength(recoverCalls);
    expect(harness.calls.filter((name) => name === "execute")).toHaveLength(executeCalls);
  });

  it("T5 recovery-required with authorized token selects whole-state-restore and does not resume", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("restore");
    const deps = {
      journalPath,
      runId: "run-restore",
      cutover: harness.cutover,
      verification: harness.verification,
    };
    const opened = openCatalogUpgradeController(deps);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await opened.value.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect((await opened.value.dispatch({ action: "execute", input: executeInput() })).ok).toBe(true);
    expect(
      (
        await opened.value.dispatch({
          action: "recover",
          input: {
            runId: "cutover_plan-1",
            recordedAction: "whole-state-restore",
            runBoundToken: "token-1",
          },
        })
      ).ok,
    ).toBe(true);

    const classified = await inspectUpgradeRecovery(deps, {
      stores: "complete",
      restore: "authorized",
      recordedAction: "whole-state-restore",
      recoverInput: {
        runId: "cutover_plan-1",
        recordedAction: "whole-state-restore",
        runBoundToken: "token-1",
      },
    });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.decision.action).toBe("whole-state-restore");
    expect(classified.value.decision.autoResume).toBe(false);

    const executeCalls = harness.calls.filter((name) => name === "execute").length;
    const applied = await applyUpgradeRecovery(deps, {
      stores: "complete",
      restore: "authorized",
      recordedAction: "whole-state-restore",
      recoverInput: {
        runId: "cutover_plan-1",
        recordedAction: "whole-state-restore",
        runBoundToken: "token-1",
      },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.decision.action).toBe("whole-state-restore");
    expect(applied.value.dispatched).toBe(true);
    expect(harness.calls.filter((name) => name === "execute")).toHaveLength(executeCalls);
  });

  it("T5 forward-recover is selected instead of resume when recorded", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("forward");
    const deps = {
      journalPath,
      runId: "run-forward",
      cutover: harness.cutover,
      verification: harness.verification,
    };
    const opened = openCatalogUpgradeController(deps);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await opened.value.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect((await opened.value.dispatch({ action: "execute", input: executeInput() })).ok).toBe(true);

    const classified = await inspectUpgradeRecovery(deps, {
      stores: "complete",
      restore: "authorized",
      recordedAction: "forward-recover",
    });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.snapshot.state).toBe("cutover-completed");
    expect(classified.value.decision.action).toBe("manual-stop");

    expect(
      (
        await opened.value.dispatch({
          action: "recover",
          input: {
            runId: "cutover_plan-1",
            recordedAction: "forward-recover",
            runBoundToken: "token-1",
          },
        })
      ).ok,
    ).toBe(true);
    const afterRecover = await inspectUpgradeRecovery(deps, {
      stores: "complete",
      restore: "authorized",
      recordedAction: "forward-recover",
    });
    expect(afterRecover.ok).toBe(true);
    if (!afterRecover.ok) return;
    expect(afterRecover.value.decision.action).toBe("forward-recovery");
    expect(afterRecover.value.decision.autoResume).toBe(false);
  });

  it("T8 verification-ran stays on manual-stop and does not dispatch activation", async () => {
    const harness = createHarness();
    const journalPath = journalPathFor("verified");
    const deps = {
      journalPath,
      runId: "run-verified",
      cutover: harness.cutover,
      verification: harness.verification,
    };
    const opened = openCatalogUpgradeController(deps);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const controller = opened.value;
    expect((await controller.dispatch({ action: "plan", input: planInput() })).ok).toBe(true);
    expect((await controller.dispatch({ action: "execute", input: executeInput() })).ok).toBe(true);
    expect(
      (await controller.dispatch({ action: "prepareVerification", input: prepareInput() })).ok,
    ).toBe(true);
    expect(
      (await controller.dispatch({ action: "runVerification", input: { planDigest: "sha256:vplan" } }))
        .ok,
    ).toBe(true);

    const classified = await inspectUpgradeRecovery(deps, { stores: "complete", restore: "none" });
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.snapshot.state).toBe("verification-ran");
    expect(classified.value.decision.action).toBe("manual-stop");
    expect(classified.value.decision.autoResume).toBe(false);

    const applied = await applyUpgradeRecovery(deps, { stores: "complete", restore: "none" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.dispatched).toBe(false);
    for (const phase of UNAVAILABLE_PHASES) {
      expect(harness.calls).not.toContain(phase);
    }
  });

  it("T7 consumes inspect/recover/resume, S7-ORC inspect/recover types, and S11-RP restoreCheck", () => {
    const files = ownedProductionFiles();
    expect(files).toHaveLength(2);
    const combined = files.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
    expect(combined).toContain("InspectCutoverInput");
    expect(combined).toContain("RecoverCutoverInput");
    expect(combined).toContain("restoreCheck");
    expect(combined).toContain('action: "inspect"');
    expect(combined).toContain('action: "resume"');
    expect(combined).toContain('action: "recover"');
    expect(combined).not.toMatch(/function\s+planCutover\b/);
    expect(combined).not.toMatch(/function\s+executeCutover\b/);
    expect(combined).not.toMatch(/function\s+inspectCutover\b/);
    expect(combined).not.toMatch(/function\s+recoverCutover\b/);
    expect(combined).not.toMatch(/function\s+prepareVerification\b/);
    expect(combined).not.toMatch(/function\s+runVerification\b/);
    expect(combined).not.toContain("createReleaseVerificationService");
    expect(combined).not.toMatch(/pg_restore\b/);
    expect(combined).not.toMatch(/DROP\s+DATABASE/i);
    const bannedDefinitions = ["parameter", "definitions"].join("_");
    const bannedValues = ["project_parameter", "values"].join("_");
    expect(combined).not.toContain(bannedDefinitions);
    expect(combined).not.toContain(bannedValues);
  });
});

describe.sequential("S11-REC three-store recovery point", { timeout: 180_000 }, () => {
  const envDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
  let databaseUrl = envDatabaseUrl;
  let disposable: Awaited<ReturnType<typeof createDisposableParameterCatalogDatabase>> | undefined;
  const objectRecords: Record<string, string> = {};
  const redisRecords: Record<string, string> = {};
  let nowMs = Date.parse("2026-09-04T00:00:00.000Z");
  const clock = { now: () => new Date(nowMs) };

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
      allowComposeApp: false,
    });

  const threeStores = (): StoreSnapshotPort[] => [
    testPostgresPort(),
    createMemoryStorePort("object-store", "s3://wiseeff-lane-723/", objectRecords),
    createMemoryStorePort("redis", "redis://s11-rec-lane-723/0", redisRecords),
  ];

  const captureInput = (
    overrides: Partial<CaptureRecoveryPointInput> = {},
  ): CaptureRecoveryPointInput => ({
    runId: "run723a",
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

  afterAll(async () => {
    await disposable?.close();
  });

  beforeAll(async () => {
    if (!envDatabaseUrl) {
      throw new Error(
        "S11-REC tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
      );
    }
    if (isForbiddenComposeAppPostgres(envDatabaseUrl)) {
      disposable = await createDisposableParameterCatalogDatabase("s11rec");
      databaseUrl = disposable.url;
    }
    expect(isForbiddenComposeAppPostgres(databaseUrl)).toBe(false);
    expect(isForbiddenComposeAppPostgres(FORBIDDEN_COMPOSE_URL)).toBe(true);
    expect(
      isForbiddenComposeAppPostgres("postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_test_wk_1"),
    ).toBe(false);
    const parsed = new URL(databaseUrl);
    expect(parsed.protocol).toMatch(/^postgres(ql)?:$/);
    expect(parsed.pathname.replace(/^\//, "").split("/")[0]).not.toBe("wiseeff");

    await withLane(async (client) => {
      const vector = await client.query<{ extversion: string }>(
        `select extversion from pg_catalog.pg_extension where extname = 'vector'`,
      );
      if (!vector.rows[0]?.extversion) {
        throw new Error(
          "S11-REC tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
        );
      }
      await client.query(`create schema if not exists s11_rp_drill`);
      await client.query(
        `create table if not exists s11_rp_drill.sentinel (k text primary key, v text)`,
      );
    });
  });

  beforeEach(async () => {
    nowMs = Date.parse("2026-09-04T00:00:00.000Z");
    for (const key of Object.keys(objectRecords)) {
      delete objectRecords[key];
    }
    for (const key of Object.keys(redisRecords)) {
      delete redisRecords[key];
    }
    objectRecords["logs/probe.bin"] = "object-v1";
    redisRecords["queue:lease"] = "redis-v1";
    await withLane(async (client) => {
      await client.query(
        `insert into s11_rp_drill.sentinel(k, v) values ('s11-rec', 'v1')
         on conflict (k) do update set v = excluded.v`,
      );
    });
  });

  it("T2 partial stores classify as manual-stop and never auto-resume", async () => {
    await withStoreLock(async () => {
      const capture = expectOk(await captureRecoveryPoint(captureInput()));
      const partial = await observeRestoreCheck({
        capture,
        restoreTargets: isolatedRestoreTargets(),
        stores: [
          testPostgresPort(),
          createMemoryStorePort("object-store", "s3://wiseeff-lane-723/", objectRecords),
        ],
        now: clock.now,
      });
      expect(partial).toEqual({ stores: "partial", restore: "partial-store" });

      const harness = createHarness();
      const journalPath = journalPathFor("partial");
      const deps = {
        journalPath,
        runId: "run-partial",
        cutover: harness.cutover,
        verification: harness.verification,
      };
      const classified = await inspectUpgradeRecovery(deps, {
        stores: partial.stores,
        restore: partial.restore,
      });
      expect(classified.ok).toBe(true);
      if (!classified.ok) return;
      expect(classified.value.decision.action).toBe("manual-stop");
      expect(classified.value.decision.autoResume).toBe(false);
      expect(classified.value.decision.refusalCode).toBe("PCAT-REC-PARTIAL-STORE");
    });
  });

  it("T4/T6 authorized three-store token can whole-state-restore; wrong token or compose target cannot", async () => {
    await withStoreLock(async () => {
      const capture = expectOk(await captureRecoveryPoint(captureInput()));
      const authorized = await observeRestoreCheck({
        capture,
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      });
      expect(authorized).toEqual({ stores: "complete", restore: "authorized" });

      const other = expectOk(await captureRecoveryPoint(captureInput({ runId: "run723b" })));
      const wrongToken = await observeRestoreCheck({
        capture: { ...capture, restoreToken: other.restoreToken },
        restoreTargets: isolatedRestoreTargets(),
        stores: threeStores(),
        now: clock.now,
      });
      expect(wrongToken.restore).toBe("token-failure");

      const composeTarget = await observeRestoreCheck({
        capture,
        restoreTargets: {
          ...isolatedRestoreTargets(),
          restoreDatabaseUrl: FORBIDDEN_COMPOSE_URL,
        },
        stores: threeStores(),
        now: clock.now,
      });
      expect(composeTarget.restore).toBe("wrong-target");
      expect(isForbiddenComposeAppPostgres(FORBIDDEN_COMPOSE_URL)).toBe(true);
      expect(objectRecords["logs/probe.bin"]).toBe("object-v1");
      expect(redisRecords["queue:lease"]).toBe("redis-v1");
    });
  });
});
