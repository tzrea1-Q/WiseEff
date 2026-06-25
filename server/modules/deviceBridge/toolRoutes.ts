import type { WiseEffRouter } from "../../shared/http/router";
import { ApiError } from "../../shared/http/errors";
import type { BridgeToolReleaseManifest } from "./toolReleaseManifest";

export function registerDeviceBridgeToolRoutes(
  router: WiseEffRouter,
  options: {
    loadToolReleaseManifest?: () => Promise<BridgeToolReleaseManifest>;
  }
) {
  router.get("/api/v1/device-bridges/tool-releases", async () => {
    if (!options.loadToolReleaseManifest) {
      throw new ApiError("INTERNAL_ERROR", "Device bridge tool release manifest loader is required.", 500);
    }

    const manifest = await options.loadToolReleaseManifest();
    return { status: 200, body: manifest };
  });
}
