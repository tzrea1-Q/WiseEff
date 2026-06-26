import "dotenv/config";
import { expect, test, type APIRequestContext } from "playwright/test";
import { WebSocket } from "ws";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse, type OperationEvidenceApiSummary } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

type DebugTargetDto = {
  id: string;
  deviceId: string;
  targetRef: string;
};

type DebugSessionDto = {
  id: string;
  executionMode?: "server" | "bridge";
  bridgeId?: string | null;
};

type NodeOperationDto = {
  status: string;
  verified: boolean;
  snapshotId: string | null;
  failureReason: string | null;
};

type PairingCodeDto = {
  code: string;
  expiresAt: string;
};

type PairResultDto = {
  bridgeId: string;
  bridgeToken: string;
};

type ReleaseManifestDto = {
  recommendedVersion: string;
  items: Array<{ platform: string; arch: string; downloadUrl: string }>;
};

const projectId = "aurora";
const userId = process.env.DEVICE_BRIDGE_LAB_USER_ID?.trim() || "u-xu-yun";
const parameterId = process.env.DEVICE_BRIDGE_LAB_PARAMETER_ID?.trim() || "dbg-fast-charge-current";
const readNodePath =
  process.env.DEVICE_BRIDGE_LAB_NODE_PATH?.trim() || "/sys/class/power_supply/battery/constant_charge_current";
const fakeTargetRef = process.env.DEVICE_BRIDGE_LAB_TARGET_REF?.trim() || "bridge-lab-target-001";

function wsUrlFromServerUrl(serverUrl: string) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/device-bridges/ws";
  url.search = "";
  return url.toString();
}

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  responseSummary: (body: T) => string
) {
  const response = await request.post(apiRoute(path), {
    data,
    headers: { ...smokeHeaders(), "x-wiseeff-user": userId }
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { code?: string; message?: string } } | null;
  expect(response.ok(), `${path} failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);

  return {
    body: body as T,
    summary: summarizeApiResponse(response, {
      method: "POST",
      path,
      responseSummary: responseSummary(body as T)
    })
  };
}

async function connectFakeBridge(bridgeToken: string, serverUrl: string) {
  const socket = new WebSocket(wsUrlFromServerUrl(serverUrl), {
    headers: {
      Authorization: `Bridge ${bridgeToken}`
    }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    socket.once("open", () => finish());
    socket.once("error", (error) => finish(error as Error));
    socket.once("close", (code, reason) => finish(new Error(`bridge ws closed before ready (${code}): ${reason.toString()}`)));
  });

  socket.on("message", (raw) => {
    const payload = typeof raw === "string" ? raw : raw.toString("utf8");
    let message: { type?: string; id?: string; method?: string; params?: Record<string, unknown> } | null = null;
    try {
      message = JSON.parse(payload) as { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
    } catch {
      return;
    }
    if (!message || message.type !== "rpc.request" || typeof message.id !== "string") {
      return;
    }

    if (message.method === "debug.detectTargets") {
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            targets: [
              {
                targetRef: fakeTargetRef,
                online: true,
                label: "Bridge Lab Target"
              }
            ]
          }
        })
      );
      return;
    }

    if (message.method === "debug.readNode") {
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            ok: true,
            value: "3000",
            stdout: "3000",
            durationMs: 3
          }
        })
      );
      return;
    }

    if (message.method === "debug.writeNode") {
      const value = typeof message.params?.value === "string" ? message.params.value : "";
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            ok: true,
            verified: true,
            value,
            writeResult: { ok: true, value, durationMs: 4 },
            readResult: { ok: true, value, stdout: value, durationMs: 4 }
          }
        })
      );
    }
  });

  return socket;
}

test.describe("local device bridge conditional acceptance", () => {
  test.setTimeout(120_000);

  test("pairs bridge and runs bridge-backed detect/read/(optional) write", async ({ page, request }, testInfo) => {
    // @acceptance BRIDGE-WIN-001
    // @operation BRIDGE-WIN-001
    test.skip(
      process.env.DEVICE_BRIDGE_LAB_AVAILABLE !== "true",
      "Local device bridge acceptance runs only when DEVICE_BRIDGE_LAB_AVAILABLE=true."
    );
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is required for local device bridge acceptance.");

    const serverUrl = process.env.DEVICE_BRIDGE_SERVER_URL?.trim();
    if (!serverUrl) {
      throw new Error("DEVICE_BRIDGE_SERVER_URL is required when DEVICE_BRIDGE_LAB_AVAILABLE=true.");
    }

    const apiSummaries: OperationEvidenceApiSummary[] = [];
    await page.goto(`/node-debugging?project=${projectId}`);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("安装 Bridge", { exact: false })).toBeVisible();
    await expect(page.getByText("图形安装包（推荐）")).toBeVisible();
    await expect(page.getByText("便携压缩包（zip / tar.gz）")).toBeVisible();

    const manifestResponse = await request.get(apiRoute("/api/v1/device-bridges/releases"), { headers: smokeHeaders() });
    expect(manifestResponse.ok()).toBe(true);
    const manifest = (await manifestResponse.json()) as ReleaseManifestDto;
    apiSummaries.push(
      summarizeApiResponse(manifestResponse, {
        method: "GET",
        path: "/api/v1/device-bridges/releases",
        responseSummary: `items=${manifest.items.length}; recommended=${manifest.recommendedVersion}`
      })
    );
    const windowsDownload = manifest.items.find((item) => item.platform === "windows" && item.arch === "amd64");
    expect(windowsDownload, "Expected a Windows AMD64 bridge artifact in release manifest.").toBeTruthy();
    expect(windowsDownload!.downloadUrl.startsWith("/downloads/device-bridge/")).toBe(true);

    const pairingCode = await postJson<PairingCodeDto>(
      request,
      "/api/v1/device-bridges/pairing-codes",
      {},
      (body) => `pairingCodeLength=${body.code.length}`
    );
    apiSummaries.push(pairingCode.summary);

    const pairResult = await request.post(apiRoute("/api/v1/device-bridges/pair"), {
      headers: smokeHeaders(),
      data: {
        code: pairingCode.body.code,
        machineLabel: "E2E Bridge Lab",
        platform: "windows",
        arch: "amd64",
        clientVersion: "0.1.0-test"
      }
    });
    expect(pairResult.ok()).toBe(true);
    const paired = (await pairResult.json()) as PairResultDto;
    apiSummaries.push(
      summarizeApiResponse(pairResult, {
        method: "POST",
        path: "/api/v1/device-bridges/pair",
        responseSummary: `bridgeIdLength=${paired.bridgeId.length}`
      })
    );

    const bridgeSocket = await connectFakeBridge(paired.bridgeToken, serverUrl);
    try {
      const detectResponse = await postJson<{ items: DebugTargetDto[] }>(
        request,
        "/api/v1/debugging/targets/detect",
        { projectId, protocol: "hdc" },
        (body) => `targets=${body.items.length}`
      );
      apiSummaries.push(detectResponse.summary);

      const bridgeTarget = detectResponse.body.items.find((item) => item.id.startsWith("bridge:"));
      expect(bridgeTarget).toBeTruthy();

      const sessionResponse = await postJson<{ item: DebugSessionDto }>(
        request,
        "/api/v1/debugging/sessions",
        {
          projectId,
          deviceId: `bridge:${paired.bridgeId}`,
          targetId: bridgeTarget!.id,
          bridgeId: paired.bridgeId,
          protocol: "hdc"
        },
        (body) => `sessionIdLength=${body.item.id.length}; executionMode=${body.item.executionMode ?? "unset"}`
      );
      apiSummaries.push(sessionResponse.summary);
      expect(sessionResponse.body.item.executionMode).toBe("bridge");
      expect(sessionResponse.body.item.bridgeId).toBe(paired.bridgeId);

      const readResponse = await postJson<{ operation: NodeOperationDto }>(
        request,
        "/api/v1/debugging/nodes/read",
        {
          sessionId: sessionResponse.body.item.id,
          parameterId,
          nodePath: readNodePath
        },
        (body) => `readStatus=${body.operation.status}`
      );
      apiSummaries.push(readResponse.summary);
      expect(readResponse.body.operation.status).toBe("succeeded");

      if (process.env.DEVICE_BRIDGE_LAB_ENABLE_WRITE === "true") {
        const writeResponse = await postJson<{ operation: NodeOperationDto }>(
          request,
          "/api/v1/debugging/nodes/write",
          {
            sessionId: sessionResponse.body.item.id,
            parameterId,
            value: process.env.DEVICE_BRIDGE_LAB_WRITE_VALUE?.trim() || "3150",
            readBack: true,
            confirmationToken: process.env.DEVICE_BRIDGE_LAB_CONFIRM_WRITE?.trim() || "confirm-high-risk-write"
          },
          (body) => `writeStatus=${body.operation.status}; verified=${body.operation.verified}`
        );
        apiSummaries.push(writeResponse.summary);
        expect(writeResponse.body.operation.status).toBe("succeeded");
      }
    } finally {
      await new Promise<void>((resolve) => {
        if (bridgeSocket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        bridgeSocket.once("close", () => resolve());
        bridgeSocket.close();
      });
    }

    await recordOperationEvidence({
      operationId: "BRIDGE-WIN-001",
      title: "local bridge pair detect read write",
      status: "passed",
      page,
      testInfo,
      route: "/node-debugging",
      api: apiSummaries,
      runtime: {
        mode: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "api",
        apiBaseUrl: process.env.VITE_WISEEFF_API_BASE_URL?.trim() || process.env.WISEEFF_API_BASE_URL?.trim() || "http://127.0.0.1:8787",
        envSummary: {
          DEVICE_BRIDGE_LAB_AVAILABLE: process.env.DEVICE_BRIDGE_LAB_AVAILABLE ?? "unset",
          DEVICE_BRIDGE_SERVER_URL: process.env.DEVICE_BRIDGE_SERVER_URL ? "set" : "unset",
          DEVICE_BRIDGE_LAB_ENABLE_WRITE: process.env.DEVICE_BRIDGE_LAB_ENABLE_WRITE ?? "false"
        }
      },
      notes: "This conditional acceptance uses an in-process fake bridge websocket after pairing to verify bridge-backed detect/session/read and optional governed write paths."
    });
  });

  test("real bridge HDC path (device lab stub)", async ({ page, request }, testInfo) => {
    // @acceptance BRIDGE-HDC-001
    // Manual device-lab evidence only: requires a pre-paired bridge process, hdc on PATH,
    // and a USB-connected device. CI keeps this skipped unless DEVICE_BRIDGE_HDC_AVAILABLE=true.
    test.skip(
      process.env.DEVICE_BRIDGE_HDC_AVAILABLE !== "true",
      "HDC bridge acceptance runs only when DEVICE_BRIDGE_HDC_AVAILABLE=true and a real paired bridge with HDC is available."
    );
    test.skip(
      process.env.DEVICE_BRIDGE_LAB_AVAILABLE !== "true",
      "HDC bridge acceptance also requires DEVICE_BRIDGE_LAB_AVAILABLE=true."
    );
    test.skip(!process.env.DATABASE_URL, "DATABASE_URL is required for HDC bridge acceptance.");

    const serverUrl = process.env.DEVICE_BRIDGE_SERVER_URL?.trim();
    if (!serverUrl) {
      throw new Error("DEVICE_BRIDGE_SERVER_URL is required when DEVICE_BRIDGE_HDC_AVAILABLE=true.");
    }

    await page.goto(`/node-debugging?project=${projectId}`);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("安装 Bridge", { exact: false })).toBeVisible();
    await expect(page.getByText("图形安装包（推荐）")).toBeVisible();
    await expect(page.getByText("便携压缩包（zip / tar.gz）")).toBeVisible();

    const detectResponse = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId, protocol: "hdc" },
      (body) => `targets=${body.items.length}`
    );
    const bridgeTarget = detectResponse.body.items.find((item) => item.id.startsWith("bridge:"));
    expect(
      bridgeTarget,
      "Expected a real online bridge to return at least one HDC target. Pair/start the bridge and confirm hdc list targets on the bridge host."
    ).toBeTruthy();

    await recordOperationEvidence({
      operationId: "BRIDGE-HDC-001",
      title: "real bridge hdc detect stub",
      status: "passed",
      page,
      testInfo,
      route: "/node-debugging",
      api: [detectResponse.summary],
      runtime: {
        mode: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "api",
        apiBaseUrl: process.env.VITE_WISEEFF_API_BASE_URL?.trim() || process.env.WISEEFF_API_BASE_URL?.trim() || "http://127.0.0.1:8787",
        envSummary: {
          DEVICE_BRIDGE_HDC_AVAILABLE: process.env.DEVICE_BRIDGE_HDC_AVAILABLE ?? "unset",
          DEVICE_BRIDGE_LAB_AVAILABLE: process.env.DEVICE_BRIDGE_LAB_AVAILABLE ?? "unset",
          DEVICE_BRIDGE_SERVER_URL: process.env.DEVICE_BRIDGE_SERVER_URL ? "set" : "unset"
        }
      },
      notes:
        "Stub for manual HDC device-lab acceptance against a real paired bridge. Extend with session/read/write once lab automation is stable."
    });
  });
});
