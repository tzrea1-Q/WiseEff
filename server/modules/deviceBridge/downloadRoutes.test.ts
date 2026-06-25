import { describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";

describe("device bridge download routes", () => {
  it("serves bridge and tool artifacts from configured roots", async () => {
    const server = createWiseEffServer({
      deviceBridge: {
        artifactRoot: "ops/self-hosted/bridge-artifacts",
        toolArtifactRoot: "ops/self-hosted/bridge-tool-artifacts"
      }
    });

    const toolResponse = await requestJson(
      server,
      "/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip"
    );
    expect(toolResponse.status).toBe(200);
    expect(toolResponse.headers.get("content-type")).toContain("application/zip");
    expect(toolResponse.bodyText.length).toBeGreaterThan(1000);

    const bridgeResponse = await requestJson(
      server,
      "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz"
    );
    expect(bridgeResponse.status).toBe(200);
    expect(bridgeResponse.headers.get("content-type")).toContain("application/gzip");
  });

  it("rejects path traversal in artifact names", async () => {
    const server = createWiseEffServer({
      deviceBridge: {
        toolArtifactRoot: "ops/self-hosted/bridge-tool-artifacts"
      }
    });

    const response = await requestJson(
      server,
      "/downloads/device-bridge-tools/0.1.0/darwin/arm64/..%2F..%2Fmanifest.json"
    );
    expect(response.status).toBe(404);
  });
});
