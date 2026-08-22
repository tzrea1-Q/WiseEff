import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
  assertOwnedRuntimeDescriptor,
  verifyOwnedRuntimeOwnership,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  createOwnedAcceptanceAuthorization,
  provisionOwnedLocalAcceptanceRuntime,
} from "./owned-local-acceptance-runtime";

const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
});

describe("owned local acceptance runtime", () => {
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
  });

  it("refuses to provision from a dirty source worktree", async () => {
    await expect(
      provisionOwnedLocalAcceptanceRuntime({
        baseDatabaseUrl: "postgres://wiseeff:wiseeff@127.0.0.1:5432/postgres",
        worktreeRoot: process.cwd(),
      }),
    ).rejects.toThrow(/clean source worktree/i);
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
        connectionSha256: "a".repeat(64),
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
        secretSha256: "c".repeat(64),
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
      },
    };

    await expect(
      verifyOwnedRuntimeOwnership(descriptor, {
        DATABASE_URL: "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_acceptance_full_red",
        AUTH_TOKEN_HMAC_SECRET: "not-the-real-secret",
      }),
    ).rejects.toThrow(/api process|pid|owner/i);
  });
});
