import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  buildOwnedRuntimeEnv,
  cleanupExactOrphanedOwnedRuntime,
  readCleanSource,
} from "./owned-local-acceptance-runtime";

const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
});

describe("owned local acceptance runtime", () => {
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
    const repo = mkdtempSync(path.join(tmpdir(), "wiseeff-owned-source-"));
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "gate0@example.test"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Gate0 Test"], { cwd: repo });
    writeFileSync(path.join(repo, "tracked.txt"), "clean\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "clean"], { cwd: repo, stdio: "ignore" });
    const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

    await expect(readCleanSource(repo)).resolves.toEqual({ commit: expectedCommit });
    writeFileSync(path.join(repo, "tracked.txt"), "dirty\n");
    await expect(readCleanSource(repo)).rejects.toThrow(/clean source worktree/i);
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
