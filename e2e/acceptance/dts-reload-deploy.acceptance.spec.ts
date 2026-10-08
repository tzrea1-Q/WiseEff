/**
 * @acceptance DTS-RELOAD-DEPLOY-001
 * @operation DTS-RELOAD-DEPLOY-001
 * @acceptance DTS-RELOAD-KERNEL-001
 * @operation DTS-RELOAD-KERNEL-001
 * @acceptance DTS-RELOAD-VERIFY-001
 * @operation DTS-RELOAD-VERIFY-001
 * @acceptance DTS-RELOAD-RESIDUE-001
 * @operation DTS-RELOAD-RESIDUE-001
 *
 * Wiring proof for #285/#286/#287/#288: one fake bridge WebSocket client with
 * mountTarget/pushFile/writeNode/readKernelLog handlers proves the real RPC envelope,
 * connection-pool serialisation, and per-method timeouts are connected. Branch coverage
 * (including behavioural verify via debug.readNode and residue set/clear) lives in
 * server/modules/dts-reload/deploy.test.ts and residue.test.ts / restoreBaseline.test.ts.
 */
import { createHash } from "node:crypto";
import { expect, test, type Page } from "playwright/test";
import WebSocket from "ws";

import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";

import { authHeadersForRole } from "./helpers/bearerAuth";
import {
  startCanonicalReloadRun,
  startCanonicalReloadRuntime,
  type CanonicalReloadRuntime
} from "./helpers/canonicalReloadRuntime";
import { disposableRuntimeOutcomeFromTestInfo } from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

const databaseUrl = process.env.DATABASE_URL?.trim() || "";

// The disposable runtime applies its own API URL to the process environment.
function apiBase() {
  return process.env.VITE_WISEEFF_API_BASE_URL ?? process.env.WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
}

function apiRoute(path: string) {
  return new URL(path, apiBase()).toString();
}

/** Bearer + x-wiseeff-user so the spec works under both AUTH_MODE=production (hmac) and development. */
function authHeaders() {
  return authHeadersForRole("admin");
}

function bridgeWebSocketUrl() {
  const url = new URL(apiBase());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/device-bridges/ws";
  url.search = "";
  return url.toString();
}

async function postJson<T>(page: Page, path: string, data: Record<string, unknown>) {
  const response = await page.request.post(apiRoute(path), {
    data,
    headers: authHeaders()
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  expect(response.ok(), `${path} failed: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function pairBridge(page: Page) {
  const pairing = await postJson<{ code: string }>(page, "/api/v1/device-bridges/pairing-codes", {});
  const paired = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), {
    data: {
      code: pairing.code,
      machineLabel: "E2E-Reload-Fake-Bridge",
      platform: "windows",
      arch: "amd64",
      clientVersion: "0.1.0-test"
    },
    headers: authHeaders()
  });
  expect(paired.ok()).toBe(true);
  return (await paired.json()) as { bridgeId: string; bridgeToken: string };
}

async function connectFakeBridge(
  bridgeToken: string,
  observed: { methods: string[]; timeouts: string[] }
) {
  const socket = new WebSocket(bridgeWebSocketUrl(), {
    headers: { Authorization: `Bridge ${bridgeToken}` }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  const artifactSha = createHash("sha256").update("dtbo-e2e").digest("hex");

  socket.on("message", (raw) => {
    const payload = typeof raw === "string" ? raw : raw.toString("utf8");
    let message: {
      type?: string;
      id?: string;
      method?: string;
      params?: Record<string, unknown>;
      deadlineAt?: string;
    } | null = null;
    try {
      message = JSON.parse(payload) as typeof message;
    } catch {
      return;
    }
    if (!message || message.type !== "rpc.request" || typeof message.id !== "string") {
      return;
    }

    observed.methods.push(message.method ?? "");
    if (typeof message.deadlineAt === "string") {
      observed.timeouts.push(message.deadlineAt);
    }

    const respond = (result: Record<string, unknown>) => {
      socket.send(JSON.stringify({ type: "rpc.response", id: message!.id, ok: true, result }));
    };

    if (message.method === "bridge.getCapabilities") {
      respond({
        methods: [
          "bridge.getCapabilities",
          "debug.detectTargets",
          "debug.readNode",
          ...DTS_RELOAD_BRIDGE_RPC_METHODS
        ]
      });
      return;
    }

    if (message.method === "debug.mountTarget") {
      respond({ ok: true, durationMs: 1 });
      return;
    }

    if (message.method === "debug.pushFile") {
      const contentSha256 =
        typeof message.params?.contentSha256 === "string" ? message.params.contentSha256 : artifactSha;
      respond({
        ok: true,
        localDigest: contentSha256,
        remoteDigest: contentSha256,
        integrityCheck: "sha256",
        durationMs: 2
      });
      return;
    }

    if (message.method === "debug.writeNode") {
      respond({
        ok: true,
        verified: true,
        writeResult: { ok: true, durationMs: 1 }
      });
      return;
    }

    if (message.method === "debug.readKernelLog") {
      respond({
        ok: true,
        text: "kernel: overlay applied\n",
        truncated: false,
        byteLength: 24,
        maxBytes: 256 * 1024,
        durationMs: 3
      });
      return;
    }

    socket.send(
      JSON.stringify({
        type: "rpc.response",
        id: message.id,
        ok: false,
        error: { code: "METHOD_NOT_FOUND", message: `Unhandled ${message.method}` }
      })
    );
  });

  return { socket, artifactSha };
}

test.describe("DTS reload deploy fake-bridge wiring", () => {
  test.skip(!databaseUrl, "DATABASE_URL required");

  let canonical: CanonicalReloadRuntime;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    canonical = await startCanonicalReloadRuntime(request, "dts_reload_deploy");
  });

  test.afterAll(async ({}, info) => {
    test.setTimeout(60_000);
    try {
      await canonical?.runtime.dispose(disposableRuntimeOutcomeFromTestInfo(info));
    } finally {
      canonical?.restoreProcessEnv();
    }
  });

  test("DTS-RELOAD-DEPLOY-001 mounts, pushes, and triggers through the real bridge RPC envelope", async ({
    page
  }, testInfo) => {
    test.setTimeout(120_000);

    const pair = await pairBridge(page);
    const observed = { methods: [] as string[], timeouts: [] as string[] };
    const fake = await connectFakeBridge(pair.bridgeToken, observed);

    try {
      const projectId = canonical.projectId;
      const started = await startCanonicalReloadRun(page.request, canonical, "<1200>");
      expect(started.status).toBe("validated");
      const runId = started.id;

      const deploy = await page.request.post(apiRoute(`/api/v1/dts-reload/runs/${runId}/deploy`), {
        headers: authHeaders(),
        data: {
          deviceId: `bridge:${pair.bridgeId}`,
          bridgeId: pair.bridgeId,
          targetRef: "AURORA-E2E",
          protocol: "hdc",
          confirmationTokens: ["confirm-dts-reload"]
        }
      });
      const deployBody = await deploy.json().catch(() => null);
      expect(deploy.ok(), `deploy failed: ${JSON.stringify(deployBody)}`).toBe(true);
      expect(deployBody).toMatchObject({
        item: {
          status: "unverifiable",
          integrityCheck: "sha256",
          reloadSnapshot: {
            kernelSignal: {
              command: "dmesg",
              captureStatus: "obtained",
              rawText: "kernel: overlay applied\n"
            },
            behaviouralVerification: {
              outcomes: [
                expect.objectContaining({
                  outcome: "unbound"
                })
              ]
            }
          }
        }
      });

      const residueResponse = await page.request.get(
        apiRoute(`/api/v1/dts-reload/residue?deviceId=${encodeURIComponent(`bridge:${pair.bridgeId}`)}`),
        { headers: authHeaders() }
      );
      const residueBody = await residueResponse.json().catch(() => null);
      expect(residueResponse.ok(), `residue failed: ${JSON.stringify(residueBody)}`).toBe(true);
      expect(residueBody).toMatchObject({
        item: {
          deviceId: `bridge:${pair.bridgeId}`,
          projectId,
          sourceRunId: runId
        }
      });

      expect(observed.methods).toEqual([
        "bridge.getCapabilities",
        "debug.mountTarget",
        "debug.pushFile",
        "debug.writeNode",
        "debug.readKernelLog"
      ]);
      // No binding → no debug.readNode; never invent a new verification RPC.
      expect(observed.methods).not.toContain("debug.readNode");
      expect(observed.timeouts.length).toBe(5);

      const deployApi = summarizeApiResponse(deploy, {
        method: "POST",
        path: `/api/v1/dts-reload/runs/${runId}/deploy`,
        responseSummary: `status=unverifiable methods=${observed.methods.join(",")}`
      });
      const residueApi = summarizeApiResponse(residueResponse, {
        method: "GET",
        path: "/api/v1/dts-reload/residue",
        responseSummary: `sourceRunId=${runId}`
      });
      const shared = {
        status: "passed" as const,
        page,
        testInfo,
        route: "/dts-reload",
        role: "Admin",
        api: [deployApi, residueApi],
        notes:
          "Fake bridge proves mount/push/trigger/kernel-log envelope; unbound behavioural verify and residue bookkeeping share this deploy."
      };
      await recordOperationEvidence({
        ...shared,
        operationId: "DTS-RELOAD-DEPLOY-001",
        title: "dts reload deploy mount push trigger"
      });
      await recordOperationEvidence({
        ...shared,
        operationId: "DTS-RELOAD-KERNEL-001",
        title: "dts reload kernel log evidence"
      });
      await recordOperationEvidence({
        ...shared,
        operationId: "DTS-RELOAD-VERIFY-001",
        title: "dts reload behavioural verify unbound"
      });
      await recordOperationEvidence({
        ...shared,
        operationId: "DTS-RELOAD-RESIDUE-001",
        title: "dts reload residue recorded after deploy"
      });
    } finally {
      await new Promise<void>((resolve) => {
        if (fake.socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        fake.socket.once("close", () => resolve());
        fake.socket.close();
      });
    }
  });
});
