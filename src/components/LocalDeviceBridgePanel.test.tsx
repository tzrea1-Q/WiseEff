import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalDeviceBridgePanel } from "./LocalDeviceBridgePanel";
import { listReleases } from "../infrastructure/http/deviceBridgeClient";
import * as bridgeLauncher from "../infrastructure/http/bridgeConnectLauncher";
import { FOREIGN_ACCOUNT_REBIND_HINT } from "./bridgePanelStatus";

vi.mock("../infrastructure/http/deviceBridgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infrastructure/http/deviceBridgeClient")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../infrastructure/http/bridgeConnectLauncher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infrastructure/http/bridgeConnectLauncher")>();
  return {
    ...actual,
    connectLocalBridge: vi.fn(async () => ({ reachable: true, ok: true, accepted: true })),
    pollLocalBridgeHealth: vi.fn(async () => null),
    launchBridgeSchemeForConnect: vi.fn()
  };
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

it("retains confirmed pairing when listing fails and allows retry", async () => {
  const bridge = { id: "br-local", machineLabel: "本机", platform: "windows", arch: "amd64", revokedAt: null };
  const probeHealth = async () => ({
    health: { ok: true as const, connected: true, paired: true, bridgeId: bridge.id, updatedAt: "2026-09-15T00:00:00Z" },
    reachability: "ok" as const
  });
  const listBridges = vi.fn().mockResolvedValue([bridge]);
  const createCode = vi.fn().mockResolvedValue({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" });
  const onState = vi.fn();
  const props = { detecting: false, protocol: "hdc" as const, onDetect: vi.fn(), listBridges,
    createPairingCode: createCode, onBridgeStateChange: onState };
  const view = render(<LocalDeviceBridgePanel {...props} probeHealth={probeHealth} />);
  await screen.findByDisplayValue("本机");
  createCode.mockClear();
  listBridges.mockRejectedValueOnce(new Error("代理列表暂时不可用"));
  view.rerender(<LocalDeviceBridgePanel {...props} probeHealth={async () => probeHealth()} />);

  expect(await screen.findByText(/代理列表暂时不可用/)).toBeInTheDocument();
  expect(screen.getByDisplayValue("本机")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重新配对", exact: true })).not.toBeInTheDocument();
  expect(createCode).not.toHaveBeenCalled();
  expect(onState.mock.lastCall?.[0].bridges).toEqual([bridge]);

  fireEvent.click(screen.getByRole("button", { name: "刷新代理状态" }));
  await waitFor(() => expect(listBridges).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(/代理列表暂时不可用/)).not.toBeInTheDocument();
});

it("asks the current user to rebind a live local bridge owned by another account", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const onDetect = vi.fn();
  let bridges: Array<{
    id: string;
    machineLabel: string;
    platform: "darwin";
    arch: "arm64";
    revokedAt: string | null;
  }> = [];
  let health = {
    ok: true as const,
    paired: true,
    connected: true,
    bridgeId: "br-A",
    updatedAt: "2026-09-16T00:00:00.000Z"
  };
  vi.mocked(bridgeLauncher.connectLocalBridge).mockImplementation(async () => {
    bridges = [{ id: "br-B", machineLabel: "本机", platform: "darwin", arch: "arm64", revokedAt: null }];
    health = { ...health, bridgeId: "br-B", updatedAt: "2026-09-16T00:01:00.000Z" };
    return { reachable: true, ok: true, accepted: true };
  });
  vi.mocked(bridgeLauncher.pollLocalBridgeHealth).mockImplementation(async (options) => {
    expect(options?.excludeBridgeId).toBe("br-A");
    return health;
  });

  render(
    <LocalDeviceBridgePanel
      detecting={false}
      protocol="hdc"
      onDetect={onDetect}
      listBridges={async () => bridges}
      probeHealth={async () => ({ health, reachability: "ok" })}
      createPairingCode={async () => ({ code: "654321", expiresAt: "2099-01-01T00:00:00Z" })}
    />
  );

  const rebindButton = await screen.findByRole("button", { name: "重新配对" });
  expect(screen.getByText(FOREIGN_ACCOUNT_REBIND_HINT)).toBeInTheDocument();
  expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
  await waitFor(() => expect(rebindButton).toBeEnabled());

  fireEvent.click(rebindButton);

  await waitFor(() => expect(onDetect).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Bridge 在线/)).toBeInTheDocument();
  expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
});

it("prompts to install the latest Bridge when local health is an older client", async () => {
  vi.mocked(listReleases).mockResolvedValue({
    recommendedVersion: "0.1.1",
    minCompatibleVersion: "0.1.0",
    items: [
      {
        platform: "darwin",
        arch: "arm64",
        artifactKind: "installer",
        version: "0.1.1",
        downloadUrl: "/downloads/device-bridge/0.1.1/darwin/arm64/WiseEffBridge_0.1.1_darwin_arm64.pkg"
      }
    ]
  } as never);

  render(
    <LocalDeviceBridgePanel
      detecting={false}
      protocol="hdc"
      onDetect={() => undefined}
      listBridges={async () => [
        {
          id: "br-A",
          machineLabel: "本机",
          platform: "darwin",
          arch: "arm64",
          clientVersion: "0.1.0",
          capabilities: {},
          createdAt: "2026-09-16T00:00:00.000Z",
          lastSeenAt: "2026-09-16T00:00:00.000Z",
          revokedAt: null
        }
      ]}
      probeHealth={async () => ({
        health: {
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z",
          tools: { adb: { available: true }, hdc: { available: true } }
        },
        reachability: "ok"
      })}
    />
  );

  expect(await screen.findByText("请升级本机 Bridge")).toBeInTheDocument();
  expect(screen.getByText(/推荐版本 0\.1\.1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
  expect(await screen.findByText("图形安装包（推荐）")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
});
