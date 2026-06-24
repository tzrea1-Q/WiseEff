import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

export type BridgeToolReleaseItem = {
  platform: "windows" | "darwin" | "linux";
  arch: string;
  protocol: "adb" | "hdc";
  version: string;
  sha256: string;
  downloadUrl: string;
};

export type BridgeToolReleaseManifest = {
  recommendedVersion: string;
  minCompatibleVersion: string;
  items: BridgeToolReleaseItem[];
};

export async function listToolReleases(apiClient: ApiClient = createDefaultApiClient()) {
  return apiClient.get<BridgeToolReleaseManifest>("/api/v1/device-bridges/tool-releases");
}
