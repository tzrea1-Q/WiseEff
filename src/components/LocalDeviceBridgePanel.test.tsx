import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalDeviceBridgePanel } from "./LocalDeviceBridgePanel";
import { listReleases } from "../infrastructure/http/deviceBridgeClient";

vi.mock("../infrastructure/http/deviceBridgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infrastructure/http/deviceBridgeClient")>();
  return { ...actual, listReleases: vi.fn() };
});

function renderPanel() {
  return render(
    <LocalDeviceBridgePanel
      detecting={false}
      protocol="hdc"
      onDetect={() => undefined}
      listBridges={async () => []}
      probeHealth={async () => ({ health: null, reachability: "offline" })}
      createPairingCode={async () => ({ code: "123456", expiresAt: new Date(Date.now() + 60_000).toISOString() })}
    />
  );
}

describe("LocalDeviceBridgePanel install manifest loading", () => {
  it("treats a resolving manifest without items as no manifest instead of crashing", async () => {
    // Regression guard: `listReleases().catch(() => null)` only covers rejections.
    // A client that *resolves* with a body missing `items` used to flow into
    // `pickBridgeReleaseForHost(undefined.filter)` and surface as an unhandled
    // rejection out of the mount effect (CI: 2 unhandled errors).
    vi.mocked(listReleases).mockResolvedValue({} as never);

    renderPanel();

    expect(await screen.findByText("暂时无法加载安装包列表，请稍后重试。")).toBeInTheDocument();
    expect(listReleases).toHaveBeenCalled();
  });

  it("still surfaces the install catalog when the manifest is well-formed", async () => {
    vi.mocked(listReleases).mockResolvedValue({
      items: [
        {
          platform: "darwin",
          arch: "arm64",
          artifactKind: "installer",
          version: "1.2.3",
          downloadUrl: "https://releases.example/bridge-darwin-arm64.dmg"
        }
      ]
    } as never);

    renderPanel();

    expect(await screen.findByRole("link", { name: /安装 Bridge/ })).toBeInTheDocument();
  });
});
