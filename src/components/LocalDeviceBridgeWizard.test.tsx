import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { deriveWizardStep, LocalDeviceBridgeWizard, type BridgePanelStatus } from "./LocalDeviceBridgeWizard";

describe("deriveWizardStep", () => {
  const cases: Array<{ status: BridgePanelStatus; step: ReturnType<typeof deriveWizardStep> }> = [
    { status: "missing_bridge", step: 1 },
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
  it("groups install options into installer and portable sections", () => {
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
    expect(screen.getByText("本机推荐")).toBeInTheDocument();
    expect(screen.getByText(/已识别当前环境/)).toBeInTheDocument();
    expect(screen.queryByText("高级 · 命令行方式")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:8787/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg"
    );

    expect(screen.getByRole("button", { name: /已安装 Bridge/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText("便携压缩包（zip / tar.gz）"));
    expect(screen.getByRole("link", { name: "下载 macOS Bridge（Apple Silicon）" })).toBeInTheDocument();
  });

  it("advances to step 2 when clicking the already-installed entry on missing_bridge", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="missing_bridge"
        protocol="hdc"
        health={null}
        hostRelease={null}
        installerAlternates={[]}
        portableReleases={[]}
        pairingCode={{ code: "123456", expiresAt: "2026-06-27T00:00:00.000Z" }}
        pairingCodeLoading={false}
        checking={false}
        detecting={false}
        connectError=""
        onConnectError={() => undefined}
        onRefresh={async () => ({ connected: false })}
        onDetect={() => undefined}
      />
    );

    const entry = screen.getByRole("button", { name: /已安装 Bridge/ });
    fireEvent.click(entry);

    expect(screen.getByText("连接本机")).toBeInTheDocument();
  });

  it("lets users return to step 1 from later wizard steps", async () => {
    const loadInstallReleases = vi.fn(async () => undefined);

    render(
      <LocalDeviceBridgeWizard
        panelStatus="online_no_device"
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
        onLoadInstallReleases={loadInstallReleases}
      />
    );

    expect(screen.queryByText("图形安装包（推荐）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载安装包" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "安装 Bridge" }));

    expect(loadInstallReleases).toHaveBeenCalledTimes(1);
  });

  it("shows cached install downloads when returning to step 1", () => {
    render(
      <LocalDeviceBridgeWizard
        panelStatus="tools_missing"
        protocol="hdc"
        health={{
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-26T00:00:00.000Z",
          tools: {
            adb: { available: true, version: "adb", source: "system" },
            hdc: { available: false, reason: "missing" }
          }
        }}
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
        onRefresh={async () => ({ connected: true })}
        onDetect={() => undefined}
        onLoadInstallReleases={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "安装 Bridge" }));

    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /安装调试工具/i })).not.toBeInTheDocument();
  });
});
