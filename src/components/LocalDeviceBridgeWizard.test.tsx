import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { selectControlOption } from "../test/selectControlOption";
import type { connectLocalBridge as ConnectLocalBridge, pollLocalBridgeHealth as PollLocalBridgeHealth } from "../infrastructure/http/bridgeConnectLauncher";
import { cloneElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  deriveWizardStep,
  LocalDeviceBridgeWizard,
  WINDOWS_BRIDGE_ADMIN_INSTALL_HINT,
  type BridgePanelStatus
} from "./LocalDeviceBridgeWizard";

const launchBridgeSchemeForConnect = vi.fn();
const connectLocalBridge = vi.fn<typeof ConnectLocalBridge>(async () => ({ reachable: false, ok: false }));
const pollLocalBridgeHealth = vi.fn<typeof PollLocalBridgeHealth>(async () => null);

vi.mock("../infrastructure/http/bridgeConnectLauncher", async () => {
  const actual = await vi.importActual<typeof import("../infrastructure/http/bridgeConnectLauncher")>(
    "../infrastructure/http/bridgeConnectLauncher"
  );
  return {
    ...actual,
    launchBridgeSchemeForConnect: (input: Parameters<typeof actual.launchBridgeSchemeForConnect>[0]) =>
      launchBridgeSchemeForConnect(input),
    connectLocalBridge: (input: Parameters<typeof actual.connectLocalBridge>[0]) => connectLocalBridge(input),
    pollLocalBridgeHealth: (input: Parameters<typeof actual.pollLocalBridgeHealth>[0]) => pollLocalBridgeHealth(input)
  };
});

describe("deriveWizardStep", () => {
  const cases: Array<{ status: BridgePanelStatus; step: ReturnType<typeof deriveWizardStep> }> = [
    { status: "missing_bridge", step: 1 },
    { status: "bridge_blocked", step: 2 },
    { status: "not_paired", step: 2 },
    { status: "not_running", step: 2 },
    { status: "not_connected", step: 2 },
    { status: "tools_missing", step: 3 },
    { status: "online_no_device", step: 3 },
    { status: "bridges_with_targets", step: "done" }
  ];

  for (const { status, step } of cases) {
    it(`maps ${status} to step ${step}`, () => {
      expect(deriveWizardStep(status)).toBe(step);
    });
  }
});

describe("LocalDeviceBridgeWizard", () => {
  const baseProps = {
    protocol: "hdc" as const, health: null, hostRelease: null,
    installerAlternates: [], portableReleases: [], pairingCode: null,
    pairingCodeLoading: false, checking: false, detecting: false, connectError: "",
    onConnectError: vi.fn(), onRefresh: async () => ({ connected: false }), onDetect: vi.fn()
  };

  it("keeps connection instructions primary and manual pairing collapsed", () => {
    render(<LocalDeviceBridgeWizard {...baseProps} compact panelStatus="missing_bridge"
      pairingCode={{ code: "123456", expiresAt: "2099-01-01T00:00:00Z" }} />);
    fireEvent.click(screen.getByRole("button", { name: "安装指南" }));
    fireEvent.click(screen.getByRole("button", { name: "查看连接本机步骤" }));
    const dialog = screen.getByRole("dialog", { name: "安装与连接本地 Bridge" });
    expect(within(dialog).getByRole("heading", { name: "连接这台电脑" })).toBeInTheDocument();
    expect(within(within(dialog).getByRole("list", { name: "本机连接操作" })).getAllByRole("listitem")).toHaveLength(2);
    expect(within(dialog).getByText("手动配对码").closest("details")).not.toHaveAttribute("open");
    expect(within(dialog).getAllByRole("button", { name: "连接本机" })).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "查看插入 USB 设备步骤" }));
    expect(within(within(dialog).getByRole("list", { name: "USB 设备连接操作" })).getAllByRole("listitem")).toHaveLength(3);
    expect(within(dialog).getByText("请先完成「连接本机」，再检测 USB 设备。")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "检测 USB 设备" })).not.toBeInTheDocument();
  });

  it("continues from connected-computer guidance to USB detection without reconnecting", () => {
    const onDetect = vi.fn();
    render(<LocalDeviceBridgeWizard {...baseProps} compact panelStatus="online_no_device" onDetect={onDetect} />);
    fireEvent.click(screen.getByRole("button", { name: "安装指南" }));
    fireEvent.click(screen.getByRole("button", { name: "查看连接本机步骤" }));
    fireEvent.click(screen.getByRole("button", { name: "继续连接 USB 设备" }));
    fireEvent.click(screen.getByRole("button", { name: "检测 USB 设备" }));
    expect(onDetect).toHaveBeenCalledOnce();
  });

  it.each([
    ["not_paired", "Bridge 等待配对"],
    ["not_connected", "Bridge 尚未连接服务器"],
    ["bridge_blocked", "本机访问受阻"]
  ] as const)("describes %s accurately", (panelStatus, label) => {
    render(<LocalDeviceBridgeWizard {...baseProps} panelStatus={panelStatus} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("本地 Bridge 未运行")).not.toBeInTheDocument();
  });

  it("keeps a failed connection dialog open on the terminal recovery step", async () => {
    connectLocalBridge.mockResolvedValueOnce({ reachable: false, ok: false });
    pollLocalBridgeHealth.mockResolvedValueOnce(null);
    render(<LocalDeviceBridgeWizard {...baseProps} compact panelStatus="missing_bridge"
      pairingCode={{ code: "123456", expiresAt: "2099-01-01T00:00:00Z" }} />);
    fireEvent.click(screen.getByRole("button", { name: "安装指南" }));
    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "连接本机" })).toBeEnabled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/若网页未能自动打开 Bridge/)).toBeInTheDocument();
  });

  it("refreshes an expired pairing code without launching a stale custom protocol URL", async () => {
    launchBridgeSchemeForConnect.mockClear();
    const onRefreshPairingCode = vi.fn(async () => undefined);
    render(<LocalDeviceBridgeWizard {...baseProps} panelStatus="missing_bridge"
      pairingCode={{ code: "expired", expiresAt: "2000-01-01T00:00:00Z" }} onRefreshPairingCode={onRefreshPairingCode} />);
    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));
    await waitFor(() => expect(onRefreshPairingCode).toHaveBeenCalledTimes(1));
    expect(launchBridgeSchemeForConnect).not.toHaveBeenCalled();
    expect(screen.queryByText("expired", { selector: "code" })).not.toBeInTheDocument();
  });

  it("keeps device authorization, protocol, tool and retry guidance reachable while online", () => {
    const onDetect = vi.fn();
    render(<LocalDeviceBridgeWizard {...baseProps} panelStatus="online_no_device" onDetect={onDetect}
      health={{ ok: true, paired: true, connected: true, updatedAt: "2026-10-15T00:00:00Z",
        tools: { adb: { available: true }, hdc: { available: true } } }} />);
    fireEvent.click(screen.getByRole("button", { name: "设备连接与排查" }));
    expect(screen.getByText(/在设备开启开发者模式/)).toBeInTheDocument();
    expect(screen.getByText("HDC 工具")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检测 USB 设备" }));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it("labels an older Windows installer and exposes the current portable release", async () => {
    render(<LocalDeviceBridgeWizard {...baseProps} panelStatus="missing_bridge" recommendedVersion="0.1.1"
      health={{ ok: true, paired: true, connected: false, updatedAt: "2026-10-15T00:00:00Z", launcherPath: "C:\\Old\\wiseeff-bridge.cmd" }}
      pairingCode={{ code: "123456", expiresAt: "2099-01-01T00:00:00Z" }}
      hostRelease={{ platform: "windows", arch: "amd64", version: "0.1.0", artifactKind: "installer", downloadUrl: "/old.exe" }}
      portableReleases={[{ platform: "windows", arch: "amd64", version: "0.1.1", artifactKind: "portable", downloadUrl: "/current.zip" }]} />);
    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "windows/amd64");
    expect(screen.getByText("较早版本 · v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("本机推荐 · v0.1.0")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载 Windows Bridge（x64）" })).toHaveAttribute("href", expect.stringContaining("/current.zip"));
    const portable = screen.getByText("便携压缩包（zip / tar.gz）").closest("details")!;
    expect(within(portable).getByText(/node \.\/cli.js connect/, { selector: "code" })).toHaveTextContent("--code 123456");
    expect(portable).not.toHaveTextContent("C:\\Old");
    expect(within(portable).getByRole("button", { name: "复制便携版连接命令" })).toBeInTheDocument();
  });

  it("shows Windows admin install hint on step 1 for Windows hosts", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    });

    render(
      <LocalDeviceBridgeWizard
        panelStatus="missing_bridge"
        protocol="adb"
        health={null}
        hostRelease={{
          platform: "windows",
          arch: "amd64",
          version: "0.1.0",
          downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe",
          artifactKind: "installer"
        }}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByRole("note")).toHaveTextContent("Windows 安装提示：");
    expect(screen.getByRole("note")).toHaveTextContent(WINDOWS_BRIDGE_ADMIN_INSTALL_HINT);

    vi.unstubAllGlobals();
  });

  it("groups install options into installer and portable sections", async () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="missing_bridge"
        protocol="adb"
        health={null}
        hostRelease={{
          platform: "darwin",
          arch: "arm64",
          version: "0.1.0",
          downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg",
          artifactKind: "installer"
        }}
        installerAlternates={[
          {
            platform: "windows",
            arch: "amd64",
            version: "0.1.0",
            downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe",
            artifactKind: "installer"
          }
        ]}
        portableReleases={[
          {
            platform: "darwin",
            arch: "arm64",
            version: "0.1.0",
            downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/wiseeff-bridge_0.1.0_darwin_arm64.tar.gz",
            artifactKind: "portable"
          }
        ]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
    expect(screen.getByText("本机推荐 · v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("高级 · 命令行方式")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toHaveAttribute(
      "href",
      expect.stringContaining("/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg")
    );

    expect(screen.getAllByRole("button", { name: "连接本机" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toHaveClass("button", "primary");
    for (const action of screen.getAllByRole("button", { name: "连接本机" })) {
      expect(action).toHaveClass("button", "primary");
    }

    fireEvent.click(screen.getByText("便携压缩包（zip / tar.gz）"));
    expect(screen.getByRole("link", { name: "下载 macOS Bridge（Apple Silicon）" })).toBeInTheDocument();
  });

  it("shows launch entry for not_running on step 2", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        hasRegisteredBridge
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "连接本机" })).toBeInTheDocument();
    expect(screen.getByText(/若网页未能自动打开 Bridge/)).toBeInTheDocument();
  });

  it("keeps the launch button enabled while a pairing code loads for not_running", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        hasRegisteredBridge
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "连接本机" })).toBeEnabled();
  });

  it("disables the connect button while a required pairing code loads for not_paired", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_paired"
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "连接本机" })).toBeDisabled();
  });

  it("launches directly from the sole connect action on missing_bridge", async () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="missing_bridge"
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "123456", expiresAt: "2099-06-27T00:00:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    const entry = screen.getAllByRole("button", { name: "连接本机" })[0]!;
    fireEvent.click(entry);

    await waitFor(() => expect(screen.getByRole("button", { name: "连接本机" })).toBeEnabled());
    expect(screen.getByRole("list", { name: "Bridge 连接步骤" })).toBeInTheDocument();
    expect(screen.getByText(/若网页未能自动打开 Bridge/)).toBeInTheDocument();
  });

  it("renders a compact ready view when bridge targets are connected", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="bridges_with_targets"
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-26T00:00:00.000Z",
          tools: {
            adb: { available: true, version: "adb", source: "system" },
            hdc: { available: true, version: "hdc", source: "system" }
          }
        }}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: true })}
        onDetect={() => undefined}
      />
    );

    expect(screen.getByText("已连接 · 本机")).toHaveAttribute("title", "Bridge 在线，已连接可调试目标。");
    expect(screen.queryByRole("button", { name: "重新检测设备" })).not.toBeInTheDocument();
    expect(screen.queryByText("安装 Bridge")).not.toBeInTheDocument();
    expect(screen.queryByText(/设置登录时自动启动/)).not.toBeInTheDocument();
    expect(screen.queryByText("HDC 工具")).not.toBeInTheDocument();
  });

  it("shows an upgrade notice with a download action when the running Bridge is behind", async () => {
    const wizard = (
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          clientVersion: "0.1.0",
          updatedAt: "2026-09-16T00:00:00.000Z",
          tools: {
            adb: { available: true, version: "adb", source: "system" },
            hdc: { available: true, version: "hdc", source: "system" }
          }
        }}
        bridges={[{ id: "br-A", machineLabel: "本机", platform: "darwin", arch: "arm64", clientVersion: "0.1.0", capabilities: {}, createdAt: "2026-09-16T00:00:00.000Z", lastSeenAt: null, revokedAt: null }]}
        recommendedVersion="0.1.1"
        hostRelease={{
          platform: "darwin",
          arch: "arm64",
          version: "0.1.1",
          downloadUrl: "/downloads/device-bridge/0.1.1/darwin/arm64/WiseEffBridge_0.1.1_darwin_arm64.pkg",
          artifactKind: "installer"
        }}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: true })}
        onDetect={() => undefined}
      />
    );
    const { rerender } = render(wizard);

    expect(screen.getByText("请升级本机 Bridge")).toBeInTheDocument();
    expect(screen.getByText(/当前本机版本 0\.1\.0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
    rerender(cloneElement(wizard, { panelStatus: "online_no_device" }));
    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toHaveAttribute(
      "href",
      expect.stringContaining("/downloads/device-bridge/0.1.1/")
    );
    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
  });

  it("lets users return to step 1 from later wizard steps", async () => {
    const loadInstallReleases = vi.fn(async () => undefined);

    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        hasRegisteredBridge
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
        onLoadInstallReleases={loadInstallReleases}
      />
    );

    expect(screen.queryByText("图形安装包（推荐）")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看安装 Bridge步骤" }));

    expect(loadInstallReleases).toHaveBeenCalledTimes(1);
  });

  it("shows cached install downloads when returning to step 1", async () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        hasRegisteredBridge
        protocol="hdc"
        health={null}
        hostRelease={{
          platform: "darwin",
          arch: "arm64",
          version: "0.1.0",
          downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg",
          artifactKind: "installer"
        }}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={null}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
        onLoadInstallReleases={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看安装 Bridge步骤" }));

    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
  });

  it("launches the bridge URL scheme synchronously before awaiting local HTTP connect", async () => {
    launchBridgeSchemeForConnect.mockClear();
    connectLocalBridge.mockClear();
    pollLocalBridgeHealth.mockClear();
    let launchOrder = 0;
    launchBridgeSchemeForConnect.mockImplementation(() => {
      launchOrder = launchOrder === 0 ? 1 : launchOrder;
    });
    connectLocalBridge.mockImplementation(async () => {
      launchOrder = launchOrder === 1 ? 2 : launchOrder;
      return { reachable: false, ok: false };
    });

    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_running"
        hasRegisteredBridge
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "123456", expiresAt: "2099-06-27T00:00:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));

    await waitFor(() => {
      expect(connectLocalBridge).toHaveBeenCalled();
    });

    expect(launchBridgeSchemeForConnect).toHaveBeenCalledWith({
      server: expect.any(String),
      webOrigin: expect.any(String),
      code: "123456"
    });
    expect(launchOrder).toBe(2);
    expect(connectLocalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        launchSchemeFallback: false
      })
    );
    expect(pollLocalBridgeHealth).toHaveBeenCalledWith({ timeoutMs: 45_000 });
  });

  it("rebinding a foreign-account bridge waits for the replacement and auto-detects", async () => {
    connectLocalBridge.mockResolvedValue({ reachable: true, ok: true, accepted: true });
    pollLocalBridgeHealth.mockResolvedValue({
      ok: true,
      paired: true,
      connected: true,
      bridgeId: "br-B",
      updatedAt: "2026-09-16T00:01:00.000Z"
    });
    const onDetect = vi.fn();
    const onConnectError = vi.fn();

    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_paired"
        pairingStale
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        }}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "654321", expiresAt: "2099-09-16T00:30:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={onConnectError}
        onRefresh={async () => ({
          connected: true,
          health: {
            ok: true,
            paired: true,
            connected: true,
            bridgeId: "br-B",
            updatedAt: "2026-09-16T00:01:00.000Z"
          },
          registeredBridgeIds: ["br-B"]
        })}
        onDetect={onDetect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));

    await waitFor(() => expect(onDetect).toHaveBeenCalledTimes(1));
    expect(connectLocalBridge).toHaveBeenCalledWith(expect.objectContaining({ code: "654321" }));
    expect(pollLocalBridgeHealth).toHaveBeenCalledWith(expect.objectContaining({ excludeBridgeId: "br-A" }));
    expect(onConnectError).toHaveBeenCalledWith("");
    expect(onConnectError.mock.calls.flat().join("\n")).not.toContain("配对已失效");
  });

  it("reports restart failure instead of pairing expiry when health stays on the old bridge", async () => {
    connectLocalBridge.mockResolvedValue({ reachable: true, ok: true, accepted: true });
    pollLocalBridgeHealth.mockResolvedValue({
      ok: true,
      paired: true,
      connected: true,
      bridgeId: "br-A",
      updatedAt: "2026-09-16T00:00:00.000Z"
    });
    const onConnectError = vi.fn();
    const onDetect = vi.fn();

    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_paired"
        pairingStale
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        }}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "654321", expiresAt: "2099-09-16T00:30:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={onConnectError}
        onRefresh={async () => ({
          connected: false,
          health: {
            ok: true,
            paired: true,
            connected: true,
            bridgeId: "br-A",
            updatedAt: "2026-09-16T00:00:00.000Z"
          },
          registeredBridgeIds: ["br-B"]
        })}
        onDetect={onDetect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));

    await waitFor(() => expect(onConnectError).toHaveBeenCalled());
    const messages = onConnectError.mock.calls.map((call) => String(call[0])).filter(Boolean);
    expect(messages.some((message) => message.includes("旧账号") || message.includes("不支持安全重新绑定"))).toBe(true);
    expect(messages.join("\n")).not.toContain("配对已失效");
    expect(onDetect).not.toHaveBeenCalled();
  });

  it("reports listing refresh failure after a rebind attempt", async () => {
    connectLocalBridge.mockResolvedValue({ reachable: true, ok: true, accepted: true });
    pollLocalBridgeHealth.mockResolvedValue({
      ok: true,
      paired: true,
      connected: true,
      bridgeId: "br-B",
      updatedAt: "2026-09-16T00:01:00.000Z"
    });
    const onConnectError = vi.fn();

    render(
      <LocalDeviceBridgeWizard
        panelStatus="not_paired"
        pairingStale
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-A",
          updatedAt: "2026-09-16T00:00:00.000Z"
        }}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "654321", expiresAt: "2099-09-16T00:30:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={onConnectError}
        onRefresh={async () => ({
          connected: false,
          listingFailed: true,
          listingError: "代理列表暂时不可用"
        })}
        onDetect={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "连接本机" }));

    await waitFor(() => expect(onConnectError).toHaveBeenCalled());
    expect(onConnectError.mock.calls.map((call) => String(call[0])).join("\n")).toContain("刷新当前账号的设备代理列表失败");
    expect(onConnectError.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("配对已失效");
  });
});
