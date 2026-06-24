import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LocalDeviceBridgeToolsPanel } from "./LocalDeviceBridgeToolsPanel";
import type { LocalBridgeHealthState } from "../infrastructure/http/deviceBridgeClient";

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

  it("emphasizes the selected protocol tool state", () => {
    render(
      <LocalDeviceBridgeToolsPanel
        health={health}
        protocol="adb"
        panelStatus="tools_missing"
        onInstallError={vi.fn()}
        onInstallComplete={vi.fn(async () => undefined)}
      />
    );
    expect(screen.getByText("ADB 工具")).toBeInTheDocument();
    expect(screen.getByText(/不可用/)).toBeInTheDocument();
    expect(screen.getByText("adb not found")).toBeInTheDocument();
  });
});
