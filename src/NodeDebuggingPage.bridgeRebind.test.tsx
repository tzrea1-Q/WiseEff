import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "./components/common/toast/ToastProvider";
import { TopBarActionsContext } from "./components/layout";
import { NodeDebuggingPage } from "./NodeDebuggingPage";
import { initialState } from "./mockData";
import * as bridgeLauncher from "./infrastructure/http/bridgeConnectLauncher";
import * as bridgeClient from "./infrastructure/http/deviceBridgeClient";
import { FOREIGN_ACCOUNT_REBIND_HINT } from "./components/bridgePanelStatus";

vi.mock("./infrastructure/http/bridgeConnectLauncher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./infrastructure/http/bridgeConnectLauncher")>();
  return {
    ...actual,
    connectLocalBridge: vi.fn(async () => ({ reachable: true, ok: true, accepted: true })),
    pollLocalBridgeHealth: vi.fn(async () => null),
    launchBridgeSchemeForConnect: vi.fn()
  };
});

vi.mock("./infrastructure/http/deviceBridgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./infrastructure/http/deviceBridgeClient")>();
  return {
    ...actual,
    listMyBridges: vi.fn(async () => []),
    listReleases: vi.fn(async () => ({ recommendedVersion: "0.1.1", minCompatibleVersion: "0.1.0", items: [] }))
  };
});

const userState = { ...initialState, activeRoleId: "user" };

describe("NodeDebuggingPage local bridge rebind", () => {
  it("rebinds a foreign-account local bridge and then detects with the new bridge id", async () => {
    let health = {
      ok: true as const,
      paired: true,
      connected: true,
      bridgeId: "br-A",
      updatedAt: "2026-09-16T00:00:00.000Z",
      tools: { adb: { available: true }, hdc: { available: true } }
    };
    let bridges: bridgeClient.DeviceBridgeRecord[] = [];
    const detectAndStartSession = vi.fn().mockResolvedValue({ session: null, target: null });
    vi.mocked(bridgeClient.listMyBridges).mockImplementation(async () => bridges);
    vi.mocked(bridgeLauncher.connectLocalBridge).mockImplementation(async () => {
      bridges = [
        {
          id: "br-B",
          machineLabel: "本机",
          platform: "darwin",
          arch: "arm64",
          clientVersion: "0.1.1",
          capabilities: {},
          createdAt: "2026-09-16T00:01:00.000Z",
          lastSeenAt: "2026-09-16T00:01:00.000Z",
          revokedAt: null
        }
      ];
      health = { ...health, bridgeId: "br-B", updatedAt: "2026-09-16T00:01:00.000Z" };
      return { reachable: true, ok: true, accepted: true };
    });
    vi.mocked(bridgeLauncher.pollLocalBridgeHealth).mockImplementation(async (options) => {
      expect(options?.excludeBridgeId).toBe("br-A");
      return health;
    });

    function Harness() {
      const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
      const context = useMemo(() => ({ setActions: setTopBarActions }), []);
      return (
        <ToastProvider>
          <TopBarActionsContext.Provider value={context}>
            <div className="topbar-page-actions">{topBarActions}</div>
            <NodeDebuggingPage
              state={userState}
              debuggingActions={{
                refresh: vi.fn().mockResolvedValue(undefined),
                detectAndStartSession,
                readNode: vi.fn(),
                writeNode: vi.fn(),
                pushValues: vi.fn(),
                rollbackSnapshot: vi.fn(),
                rollbackLastSnapshot: vi.fn(),
                connectDevice: vi.fn()
              }}
              runtimeStatus="ready"
              probeBridgeHealth={async () => ({ health, reachability: "ok" })}
              createBridgePairingCode={async () => ({ code: "654321", expiresAt: "2099-01-01T00:00:00Z" })}
            />
          </TopBarActionsContext.Provider>
        </ToastProvider>
      );
    }

    render(<Harness />);

    const repairButton = await screen.findByRole("button", { name: "重新配对" });
    expect(screen.getByText(FOREIGN_ACCOUNT_REBIND_HINT)).toBeInTheDocument();
    expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
    await waitFor(() => expect(repairButton).toBeEnabled());
    detectAndStartSession.mockClear();
    fireEvent.click(repairButton);

    await waitFor(() => expect(detectAndStartSession).toHaveBeenCalled());
    expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
  });
});
