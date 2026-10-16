import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";
import {
  createPairingCode,
  listMyBridges,
  listReleases,
  probeLocalBridgeHealth,
  renameBridge,
  revokeBridge
} from "./deviceBridgeClient";
import { resolveLocalBridgeHealthUrl } from "./localBridgeHttpUrl";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createApi(fetchImpl: typeof fetch) {
  return createApiClient({ baseUrl: "", fetchImpl });
}

describe("deviceBridgeClient", () => {
  it.each([
    { request: createPairingCode, response: { code: "123456", expiresAt: "2099-01-01T00:00:00Z" }, endpoint: "pairing-codes" },
    { request: listMyBridges, response: { items: [] }, endpoint: "mine" },
    { request: listReleases, response: { items: [] }, endpoint: "releases" }
  ])("cancels a hung $endpoint request after its timeout and allows a fresh retry", async ({ request, response, endpoint }) => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal)
      .mockReturnValueOnce(new AbortController().signal);
    try {
      const fetchMock = vi.fn<typeof fetch>()
        .mockImplementationOnce(async (_url, options) => new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        }))
        .mockResolvedValueOnce(jsonResponse(response));
      const apiClient = createApi(fetchMock);
      const pending = request(apiClient);
      const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      controller.abort(new DOMException("Bridge request timed out", "TimeoutError"));
      await rejected;
      await expect(request(apiClient)).resolves.toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain(endpoint);
      expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
      expect(timeout.mock.calls).toEqual([[5000], [5000]]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("creates a pairing code from the API endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ code: "123456", expiresAt: "2026-06-23T00:05:00.000Z" }));
    const apiClient = createApi(fetchMock);

    await expect(createPairingCode(apiClient)).resolves.toEqual({
      code: "123456",
      expiresAt: "2026-06-23T00:05:00.000Z"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/device-bridges/pairing-codes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({})
      })
    );
  });

  it("lists bridges owned by the current user", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          {
            id: "br-1",
            machineLabel: "WIN-PC",
            platform: "windows",
            arch: "amd64",
            clientVersion: "0.1.0",
            capabilities: {},
            createdAt: "2026-06-23T00:00:00.000Z",
            lastSeenAt: null,
            revokedAt: null
          }
        ]
      })
    );
    const apiClient = createApi(fetchMock);

    await expect(listMyBridges(apiClient)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/device-bridges/mine", expect.objectContaining({ method: "GET" }));
  });

  it("loads release manifest for download links", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        recommendedVersion: "0.1.0",
        minCompatibleVersion: "0.1.0",
        items: [
          {
            platform: "windows",
            arch: "amd64",
            version: "0.1.0",
            downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
          }
        ]
      })
    );
    const apiClient = createApi(fetchMock);

    await expect(listReleases(apiClient)).resolves.toMatchObject({
      recommendedVersion: "0.1.0",
      items: [expect.objectContaining({ platform: "windows" })]
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/device-bridges/releases", expect.objectContaining({ method: "GET" }));
  });

  it("renames a bridge by id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          id: "br-1",
          machineLabel: "Office-PC",
          platform: "windows",
          arch: "amd64",
          clientVersion: "0.1.0",
          capabilities: {},
          createdAt: "2026-06-23T00:00:00.000Z",
          lastSeenAt: "2026-06-23T00:05:00.000Z",
          revokedAt: null
        }
      })
    );
    const apiClient = createApi(fetchMock);

    await expect(renameBridge("br-1", "Office-PC", apiClient)).resolves.toMatchObject({
      id: "br-1",
      machineLabel: "Office-PC"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/device-bridges/br-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ machineLabel: "Office-PC" })
      })
    );
  });

  it("revokes a bridge by id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        item: {
          id: "br-1",
          machineLabel: "Office-PC",
          platform: "windows",
          arch: "amd64",
          clientVersion: "0.1.0",
          capabilities: {},
          createdAt: "2026-06-23T00:00:00.000Z",
          lastSeenAt: "2026-06-23T00:05:00.000Z",
          revokedAt: "2026-06-23T00:10:00.000Z"
        }
      })
    );
    const apiClient = createApi(fetchMock);

    await expect(revokeBridge("br-1", apiClient)).resolves.toMatchObject({
      id: "br-1",
      revokedAt: "2026-06-23T00:10:00.000Z"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/device-bridges/br-1/revoke",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({})
      })
    );
  });

  it("probes local bridge health successfully", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ok: true,
        paired: true,
        connected: false,
        bridgeId: "br-1",
        serverUrl: "https://wiseeff.example.com",
        updatedAt: "2026-06-23T00:00:00.000Z"
      })
    );

    await expect(probeLocalBridgeHealth(fetchMock)).resolves.toEqual({
      ok: true,
      paired: true,
      connected: false,
      bridgeId: "br-1",
      serverUrl: "https://wiseeff.example.com",
      lastError: undefined,
      updatedAt: "2026-06-23T00:00:00.000Z"
    });
    expect(fetchMock).toHaveBeenCalledWith(resolveLocalBridgeHealthUrl());
  });

  it("returns null when local bridge health is unreachable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await expect(probeLocalBridgeHealth(fetchMock)).resolves.toBeNull();
  });
});
