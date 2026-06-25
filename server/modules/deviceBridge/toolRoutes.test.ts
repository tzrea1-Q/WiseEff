import { describe, expect, it } from "vitest";

import type { BridgeToolReleaseManifest } from "./toolReleaseManifest";
import { registerDeviceBridgeToolRoutes } from "./toolRoutes";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";

function makeServer(loadToolReleaseManifest?: () => Promise<BridgeToolReleaseManifest>) {
  const router = createRouter();
  registerDeviceBridgeToolRoutes(router, { loadToolReleaseManifest });
  return createHttpServer(router);
}

describe("device bridge tool routes", () => {
  it("GET /api/v1/device-bridges/tool-releases returns the manifest without auth", async () => {
    const response = await requestJson<BridgeToolReleaseManifest>(
      makeServer(async () => ({
        recommendedVersion: "0.1.0",
        minCompatibleVersion: "0.1.0",
        items: [
          {
            platform: "windows",
            arch: "amd64",
            protocol: "adb",
            version: "0.1.0",
            sha256: "abc123",
            downloadUrl: "/downloads/device-bridge-tools/0.1.0/windows/amd64/adb-platform-tools.zip"
          }
        ]
      })),
      "/api/v1/device-bridges/tool-releases"
    );

    expect(response.status).toBe(200);
    expect(response.body.items[0]?.downloadUrl).toBe(
      "/downloads/device-bridge-tools/0.1.0/windows/amd64/adb-platform-tools.zip"
    );
  });
});
