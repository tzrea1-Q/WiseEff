import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";
import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";
import * as installer from "../infrastructure/http/bridgeToolInstallLauncher";

const health: LocalBridgeHealthState = {
  ok: true,
  paired: true,
  connected: true,
  updatedAt: "2026-06-25T00:00:00.000Z",
  tools: {
    adb: { available: false, reason: "adb not found" },
    hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
  }
};

describe("LocalDeviceBridgeToolsPanel", () => {
  it("retains an installation failure locally and clears it when the user retries successfully", async () => {
    vi.spyOn(installer, "shouldConfirmBridgeToolInstall").mockReturnValue(false);
    vi.spyOn(installer, "launchBridgeToolInstall").mockImplementation(() => undefined);
    vi.spyOn(installer, "pollBridgeToolInstall").mockRejectedValueOnce(new Error("下载校验失败"))
      .mockResolvedValueOnce({ ...health, tools: { adb: { available: true }, hdc: { available: true } } });
    try {
      render(<LocalDeviceBridgeToolsPanel health={health} protocol="adb" panelStatus="tools_missing"
        onInstallError={vi.fn()} onInstallComplete={vi.fn(async () => undefined)} />);
      fireEvent.click(screen.getByRole("button", { name: "安装调试工具" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("下载校验失败");
      await waitFor(() => expect(screen.getByRole("button", { name: "安装调试工具" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "安装调试工具" }));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("shows install CTA when tools are missing", async () => {
    const user = userEvent.setup();
    const onInstallComplete = vi.fn(async () => undefined);
    render(
      <LocalDeviceBridgeToolsPanel
        health={health}
        protocol="adb"
        panelStatus="tools_missing"
        onInstallError={vi.fn()}
        onInstallComplete={onInstallComplete}
      />
    );
    expect(screen.getByRole("button", { name: /安装调试工具/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /安装调试工具/i }));
  });

  it("shows available device tools without exposing a protocol choice", () => {
    render(
      <LocalDeviceBridgeToolsPanel
        health={health}
        protocol="adb"
        panelStatus="tools_missing"
        onInstallError={vi.fn()}
        onInstallComplete={vi.fn(async () => undefined)}
      />
    );
    expect(screen.getByText("设备调试工具")).toBeInTheDocument();
    expect(screen.getByText("可用", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("ADB 工具")).not.toBeInTheDocument();
    expect(screen.getByText("技术信息").closest("details")).not.toHaveAttribute("open");
  });
});
