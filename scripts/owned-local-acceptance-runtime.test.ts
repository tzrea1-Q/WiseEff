import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
  assertOwnedRuntimeDescriptor,
  databaseIdentityFromUrl,
  verifyOwnedRuntimeOwnership,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  createOwnedAcceptanceAuthorization,
  buildOwnedChildProcessEnv,
  buildProvisionFailureRecord,
  buildOwnedRuntimeEnv,
  cleanupExactOrphanedOwnedRuntime,
  createCheckedAbsentDatabase,
  provisionOwnedLocalAcceptanceRuntime,
  readCleanSource,
} from "./owned-local-acceptance-runtime";

const children: ChildProcess[] = [];

function createCleanTestRepository(prefix: string) {
  const repo = mkdtempSync(path.join(tmpdir(), prefix));
  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "gate0@example.test"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Gate0 Test"], { cwd: repo });
  writeFileSync(path.join(repo, "tracked.txt"), "clean\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "clean"], { cwd: repo, stdio: "ignore" });
  return repo;
}

function readOnlyProvisionFailure(repo: string) {
  const runsRoot = path.join(repo, "runs");
  const runNames = readdirSync(runsRoot);
  expect(runNames).toHaveLength(1);
  const runRoot = realpathSync(path.join(runsRoot, runNames[0]!));
  return {
    runRoot,
    failure: JSON.parse(readFileSync(path.join(runRoot, "provision-failure.json"), "utf8")) as Record<string, unknown>,
  };
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
});

describe("owned local acceptance runtime", () => {
  it("records an unmarked retained database when CREATE commits but its response is lost", async () => {
    const databaseName = "wiseeff_acceptance_full_response_lost";
    const evidence: Array<Record<string, unknown>> = [];
    let committed = false;

    await expect(createCheckedAbsentDatabase({
      databaseName,
      recordEvidence: (entry) => evidence.push({ ...entry }),
      operations: {
        databaseExistsBeforeCreate: async () => false,
        createDatabase: async () => {
          committed = true;
          throw new Error("CREATE response lost after commit");
        },
        databaseExistsAfterCreateFailure: async () => committed,
      },
    })).rejects.toThrow(/response lost/i);

    expect(evidence.at(-1)).toEqual({
      intendedDatabaseName: databaseName,
      state: "create-failed-database-present",
      absentBeforeCreate: true,
      createAttempted: true,
      createAcknowledged: false,
      presenceAfterCreateFailure: "present",
      ownership: "unverified-no-marker",
      retainedDatabaseName: databaseName,
    });
  });

  it("distinguishes an absent database from an unknown database after CREATE fails", async () => {
    const databaseName = "wiseeff_acceptance_full_create_failed";
    const absentEvidence: Array<Record<string, unknown>> = [];
    await expect(createCheckedAbsentDatabase({
      databaseName,
      recordEvidence: (entry) => absentEvidence.push({ ...entry }),
      operations: {
        databaseExistsBeforeCreate: async () => false,
        createDatabase: async () => { throw new Error("CREATE rejected before commit"); },
        databaseExistsAfterCreateFailure: async () => false,
      },
    })).rejects.toThrow(/rejected before commit/i);
    expect(absentEvidence.at(-1)).toMatchObject({
      state: "create-failed-database-absent",
      presenceAfterCreateFailure: "absent",
      ownership: "not-owned",
    });
    expect(absentEvidence.at(-1)?.retainedDatabaseName).toBeUndefined();

    const unknownEvidence: Array<Record<string, unknown>> = [];
    await expect(createCheckedAbsentDatabase({
      databaseName,
      recordEvidence: (entry) => unknownEvidence.push({ ...entry }),
      operations: {
        databaseExistsBeforeCreate: async () => false,
        createDatabase: async () => { throw new Error("CREATE response lost"); },
        databaseExistsAfterCreateFailure: async () => { throw new Error("reconnect deadline elapsed"); },
      },
    })).rejects.toThrow(/reconciliation did not settle/i);
    expect(unknownEvidence.at(-1)).toMatchObject({
      state: "create-failed-presence-unknown",
      presenceAfterCreateFailure: "unknown",
      ownership: "unverified-no-marker",
      retainedDatabaseName: databaseName,
    });
  });

  it("records exact process takeover facts when provisioning fails before the root descriptor exists", () => {
    const record = buildProvisionFailureRecord({
      runId: "full-provision-failure",
      sourceCommit: "0".repeat(40),
      databaseName: "wiseeff_acceptance_full_provision_failure",
      objectRoot: "/tmp/owned/object-store",
      processes: [{
        label: "api",
        pid: 321,
        port: 18_800,
        command: "node server/index.ts",
        log: "/tmp/owned/api.log",
        cleanup: { status: "failed", reason: "process group identity could not be verified" },
      }],
      errors: [new Error("API readiness failed")],
    });

    expect(record).toMatchObject({
      kind: "wiseeff-owned-local-acceptance-provision-failure",
      processes: [{
        label: "api",
        pid: 321,
        port: 18_800,
        command: "node server/index.ts",
        cleanup: { status: "failed", reason: "process group identity could not be verified" },
      }],
    });
  });

  it("drops unrelated inherited credentials before applying the exact owned runtime environment", () => {
    const childEnv = buildOwnedChildProcessEnv(
      {
        DATABASE_URL: "postgres://owned:owned-password@127.0.0.1:5432/owned",
        AUTH_TOKEN_HMAC_SECRET: "owned-hmac-secret",
        M5_SMOKE_AUTHORIZATION: "Bearer owned-authorization",
      },
      {
        PATH: "/usr/local/bin:/usr/bin",
        LANG: "en_US.UTF-8",
        XIAOZE_LLM_API_KEY: "host-xiaoze-secret",
        LOG_ANALYSIS_API_KEY: "host-log-secret",
        EMBEDDING_API_KEY: "host-embedding-secret",
        OBJECT_STORAGE_ACCESS_KEY_ID: "host-object-access-key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "host-object-secret-key",
        AWS_SESSION_TOKEN: "host-cloud-session",
        SSH_AUTH_SOCK: "/tmp/host-ssh-agent.sock",
        DATABASE_URL: "postgres://host:host-password@127.0.0.1:5432/host",
        AUTH_TOKEN_HMAC_SECRET: "host-hmac-secret",
      },
    );

    expect(childEnv).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      DATABASE_URL: "postgres://owned:owned-password@127.0.0.1:5432/owned",
      AUTH_TOKEN_HMAC_SECRET: "owned-hmac-secret",
      M5_SMOKE_AUTHORIZATION: "Bearer owned-authorization",
    });
    expect(childEnv).not.toHaveProperty("XIAOZE_LLM_API_KEY");
    expect(childEnv).not.toHaveProperty("LOG_ANALYSIS_API_KEY");
    expect(childEnv).not.toHaveProperty("EMBEDDING_API_KEY");
    expect(childEnv).not.toHaveProperty("OBJECT_STORAGE_ACCESS_KEY_ID");
    expect(childEnv).not.toHaveProperty("OBJECT_STORAGE_SECRET_ACCESS_KEY");
    expect(childEnv).not.toHaveProperty("AWS_SESSION_TOKEN");
    expect(childEnv).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  it("keeps the visual frontend profile non-proactive while retaining backend suggest coverage", () => {
    const env = buildOwnedRuntimeEnv({
      databaseUrl: "postgres://wiseeff:secret@127.0.0.1:5432/wiseeff_acceptance_full_visual",
      objectRoot: "/tmp/owned/object-store",
      apiUrl: "http://127.0.0.1:18800",
      frontendUrl: "http://127.0.0.1:5180",
      apiPort: 18_800,
      authIssuer: "wiseeff-owned-visual",
      authSecret: "test-secret",
      descriptorPath: "/tmp/owned/runtime.json",
      runId: "full-visual",
      sourceCommit: "1".repeat(40),
      runRoot: "/tmp/owned",
      nestedRuntimeManifest: "/tmp/owned/nested-runtime-manifest.json",
    });

    expect(env.XIAOZE_PROACTIVE_ENABLED).toBe("true");
    expect(env.VITE_XIAOZE_PROACTIVE_ENABLED).toBe("false");
  });

  it("records database ownership identity without deriving a verifier from the password", () => {
    expect(
      databaseIdentityFromUrl(
        "postgres://owned-user:first-password@127.0.0.1:5432/wiseeff_acceptance_full_red",
      ),
    ).toEqual({
      host: "127.0.0.1",
      port: 5432,
      user: "owned-user",
      database: "wiseeff_acceptance_full_red",
    });
    expect(
      databaseIdentityFromUrl(
        "postgres://owned-user:different-password@127.0.0.1:5432/wiseeff_acceptance_full_red",
      ),
    ).toEqual({
      host: "127.0.0.1",
      port: 5432,
      user: "owned-user",
      database: "wiseeff_acceptance_full_red",
    });
  });

  it("mints the production HMAC bearer consumed by smoke and browser preflight", () => {
    const authorization = createOwnedAcceptanceAuthorization("wiseeff-owned", "test-secret");
    const [payload, signature] = authorization.replace(/^Bearer\s+/u, "").split(".");

    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toMatchObject({
      iss: "wiseeff-owned",
      sub: "u-xu-yun",
      org: "org-chargelab",
      exp: 9_999_999_999,
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("rejects descriptor extensions that expose a secret field or credential value", () => {
    expect(() =>
      assertOwnedRuntimeDescriptor({
        version: 1,
        kind: "wiseeff-owned-local-acceptance",
        notes: { apiKey: "plaintext" },
      }),
    ).toThrow(/secret field/i);
    expect(() =>
      assertOwnedRuntimeDescriptor({
        version: 1,
        kind: "wiseeff-owned-local-acceptance",
        notes: "postgresql://owner:plaintext@example.test/runtime",
      }),
    ).toThrow(/secret value/i);
    expect(() =>
      assertOwnedRuntimeDescriptor({
        version: 1,
        kind: "wiseeff-owned-local-acceptance",
        database: { connectionSha256: "a".repeat(64) },
      }),
    ).toThrow(/secret-derived verifier/i);
  });

  it("reads an exact clean HEAD and refuses an isolated dirty repository without provisioning", async () => {
    const repo = createCleanTestRepository("wiseeff-owned-source-");
    const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    await expect(readCleanSource(repo)).resolves.toEqual({ commit: expectedCommit });
    writeFileSync(path.join(repo, "tracked.txt"), "dirty\n");
    await expect(readCleanSource(repo)).rejects.toThrow(/clean source worktree/i);
  });

  it("records exact partial-root evidence when the shared owner signal aborts during real port allocation", async () => {
    const repo = createCleanTestRepository("wiseeff-owned-signal-provision-");
    const controller = new AbortController();

    await expect(provisionOwnedLocalAcceptanceRuntime({
      baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
      worktreeRoot: repo,
      runsRoot: "runs",
      ownerDeadline: {
        signal: controller.signal,
        deadlineAt: Date.now() + 10_000,
        remainingMs(stage) {
          if (stage === "loopback port allocation") {
            const error = new Error("shared Gate0 owner signal aborted port allocation");
            controller.abort(error);
            throw error;
          }
          return 10_000;
        },
      },
    })).rejects.toThrow(/provisioning failed/i);

    const { runRoot, failure } = readOnlyProvisionFailure(repo);
    expect(failure).toMatchObject({
      kind: "wiseeff-owned-local-acceptance-provision-failure",
      retainedObjectRoot: path.join(runRoot, "object-store"),
      processes: [],
      failures: [expect.objectContaining({ message: expect.stringMatching(/owner signal/i) })],
    });
    expect(failure).not.toHaveProperty("retainedDatabaseName");
  });

  it("records exact partial-root evidence when the production port seam fails before database creation", async () => {
    const repo = createCleanTestRepository("wiseeff-owned-port-provision-");

    await expect(provisionOwnedLocalAcceptanceRuntime({
      baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
      worktreeRoot: repo,
      runsRoot: "runs",
    }, {
      allocateLoopbackPort: async () => {
        throw new Error("No owned loopback port is available in the configured range.");
      },
    })).rejects.toThrow(/provisioning failed/i);

    const { runRoot, failure } = readOnlyProvisionFailure(repo);
    expect(failure).toMatchObject({
      kind: "wiseeff-owned-local-acceptance-provision-failure",
      retainedObjectRoot: path.join(runRoot, "object-store"),
      failures: [expect.objectContaining({ message: expect.stringMatching(/loopback port/i) })],
    });
    expect(failure).not.toHaveProperty("retainedDatabaseName");
  });

  it("persists exact database uncertainty when a post-commit CREATE response is lost before the descriptor", async () => {
    const repo = createCleanTestRepository("wiseeff-owned-create-response-loss-");
    let committed = false;

    await expect(provisionOwnedLocalAcceptanceRuntime({
      baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
      worktreeRoot: repo,
      runsRoot: "runs",
    }, {
      allocateLoopbackPort: async (range) => range.min,
      databaseCreationOperations: () => ({
        databaseExistsBeforeCreate: async () => false,
        createDatabase: async () => {
          committed = true;
          throw new Error("CREATE response lost after commit");
        },
        databaseExistsAfterCreateFailure: async () => committed,
      }),
    })).rejects.toThrow(/provisioning failed/i);

    const { runRoot, failure } = readOnlyProvisionFailure(repo);
    expect(failure).toMatchObject({
      intendedDatabaseName: expect.stringMatching(/^wiseeff_acceptance_full_/),
      retainedDatabaseName: expect.stringMatching(/^wiseeff_acceptance_full_/),
      databaseOwnership: {
        state: "create-failed-database-present",
        presenceAfterCreateFailure: "present",
        markerStatus: "unverified-no-marker",
        uncertainty: expect.stringMatching(/destructive cleanup is refused/i),
      },
    });
    const journal = JSON.parse(readFileSync(path.join(runRoot, "database-creation.json"), "utf8"));
    expect(journal).toMatchObject({
      kind: "wiseeff-owned-local-acceptance-database-creation",
      state: "create-failed-database-present",
      presenceAfterCreateFailure: "present",
      ownership: "unverified-no-marker",
      retainedDatabaseName: failure.retainedDatabaseName,
    });
  });

  it("rejects a healthy listener whose PID does not match the owned descriptor", async () => {
    const listener = spawn(
      process.execPath,
      [
        "-e",
        "require('node:http').createServer((_q,r)=>{r.writeHead(200);r.end('ok')}).listen(18850,'127.0.0.1')",
      ],
      { stdio: "ignore" },
    );
    children.push(listener);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await fetch("http://127.0.0.1:18850").then((response) => response.ok).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-owned-runtime-red-"));
    const objectRoot = path.join(runRoot, "object-store");
    mkdirSync(objectRoot);
    const objectMarker = path.join(objectRoot, ".wiseeff-acceptance-owner.json");
    writeFileSync(objectMarker, '{"runId":"full-red","sourceCommit":"0123456789012345678901234567890123456789"}\n');

    const descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1 = {
      version: 1,
      kind: "wiseeff-owned-local-acceptance",
      run: {
        id: "full-red",
        sourceCommit: "0123456789012345678901234567890123456789",
        worktreeRoot: process.cwd(),
        sourceDirtyBefore: false,
        ownerPid: process.pid,
        createdAt: "2026-08-23T00:00:00.000Z",
        state: "ready",
      },
      database: {
        name: "wiseeff_acceptance_full_red",
        connection: {
          host: "127.0.0.1",
          port: 5432,
          user: "wiseeff",
          database: "wiseeff_acceptance_full_red",
        },
        absentBeforeCreate: true,
        marker: {
          table: "wiseeff_acceptance_runtime_markers",
          purpose: "td-122-gate0",
          runId: "full-red",
          sourceCommit: "0123456789012345678901234567890123456789",
        },
        migration: {
          command: "npm run db:migrate",
          appliedCount: 1,
          latest: "0115_log_webhook_delivery_retention_order.sql",
          completedAt: "2026-08-23T00:00:00.000Z",
        },
        seed: {
          command: "npm run db:seed:all",
          completedAt: "2026-08-23T00:00:00.000Z",
          sentinels: { organizations: 1 },
        },
      },
      objectStore: {
        mode: "local",
        root: objectRoot,
        absentBeforeCreate: true,
        markerFile: objectMarker,
        markerSha256: "b".repeat(64),
      },
      endpoints: {
        api: {
          host: "127.0.0.1",
          port: 18_850,
          url: "http://127.0.0.1:18850",
          healthUrl: "http://127.0.0.1:18850/health/live",
        },
        frontend: {
          host: "127.0.0.1",
          port: 5_250,
          url: "http://127.0.0.1:5250",
        },
      },
      processes: {
        api: {
          pid: process.pid,
          startedAt: "2026-08-23T00:00:00.000Z",
          command: "server/index.ts",
          log: path.join(runRoot, "api.log"),
        },
        frontend: {
          pid: process.pid,
          startedAt: "2026-08-23T00:00:00.000Z",
          command: "vite --strictPort",
          log: path.join(runRoot, "frontend.log"),
        },
      },
      auth: {
        mode: "production",
        provider: "hmac",
        issuer: "wiseeff-owned-full-red",
        smokeSubject: "u-xu-yun",
      },
      runtime: {
        frontendMode: "api",
        xiaozeDeterministic: true,
        logAnalysisDeterministic: true,
        localWebhookAllowed: true,
        gatewayMode: "simulator",
        hdcAvailable: false,
      },
      phases: {
        visual: { status: "pending" },
        browser: { status: "pending" },
      },
      artifacts: {
        runRoot,
        descriptor: path.join(runRoot, "runtime.json"),
        operationEvidenceRuntimeSnapshot: path.join(runRoot, "runtime-operation-evidence-snapshot.json"),
        failureInventory: path.join(runRoot, "failure-inventory.json"),
        sourceWorktreeOutputManifest: path.join(runRoot, "source-worktree-output-manifest.json"),
        nestedRuntimeManifest: path.join(runRoot, "nested-runtime-manifest.json"),
        runtimeLogs: [path.join(runRoot, "api.log"), path.join(runRoot, "frontend.log")],
      },
      cleanup: {
        policy: "success-only",
        status: "pending",
        exactDatabaseName: "wiseeff_acceptance_full_red",
        exactObjectStoreRoot: objectRoot,
        resources: {
          apiProcess: { status: "pending" },
          frontendProcess: { status: "pending" },
          database: { status: "pending" },
          objectStore: { status: "pending" },
          descriptor: { status: "pending" },
          artifacts: { status: "pending" },
        },
      },
    };

    await expect(
      verifyOwnedRuntimeOwnership(descriptor, {
        DATABASE_URL: "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_acceptance_full_red",
        AUTH_TOKEN_HMAC_SECRET: "not-the-real-secret",
      }),
    ).rejects.toThrow(/api process|pid|owner/i);
  });

  it("refuses orphan cleanup before destructive callbacks when the object marker mismatches", async () => {
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-owned-orphan-"));
    const runId = "full-20260822t221325228z-022e85fec8a7-27bb4a93";
    const runRoot = path.join(worktreeRoot, "test-results", "acceptance-runtime-runs", runId);
    const objectRoot = path.join(runRoot, "object-store");
    mkdirSync(objectRoot, { recursive: true });
    writeFileSync(path.join(objectRoot, ".wiseeff-acceptance-owner.json"), JSON.stringify({
      kind: "wiseeff-owned-local-acceptance-object-store",
      purpose: "td-122-gate0",
      runId: "wrong-run",
      sourceCommit: "0".repeat(40),
    }));
    let destructiveCalls = 0;

    await expect(cleanupExactOrphanedOwnedRuntime({
      baseDatabaseUrl: "postgres://owner:secret@127.0.0.1:5432/postgres",
      worktreeRoot,
      runRoot,
      databaseName: "wiseeff_acceptance_full_20260822t22132522_022e85fe_27bb4a93",
      runId,
      sourceCommit: "022e85fec8a7bf696bdf8466f48cd7cee9f991e1",
      ports: [18_800, 5_180],
    }, {
      verifyDatabaseMarker: async () => undefined,
      assertPortsUnused: async () => undefined,
      dropDatabase: async () => { destructiveCalls += 1; },
      assertDatabaseAbsent: async () => undefined,
    })).rejects.toThrow(/object marker.*mismatch/i);
    expect(destructiveCalls).toBe(0);
  });
});
