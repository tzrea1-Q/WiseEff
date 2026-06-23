import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";
import {
  createPairingCode,
  listMyBridges,
  listReleases,
  probeLocalBridgeHealth
} from "./deviceBridgeClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createApi(fetchImpl: typeof fetch) {
  return createApiClient({ baseUrl: "", fetchImpl });
}

describe("deviceBridgeClient", () => {
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
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:18787/health");
  });

  it("returns null when local bridge health is unreachable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await expect(probeLocalBridgeHealth(fetchMock)).resolves.toBeNull();
  });
});
