import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectControlOption } from "../test/selectControlOption";

import { LocalDeviceBridgePanel } from "./LocalDeviceBridgePanel";
import { listReleases, type DeviceBridgeRecord } from "../infrastructure/http/deviceBridgeClient";
import * as bridgeLauncher from "../infrastructure/http/bridgeConnectLauncher";
import { resolveWiseEffApiBaseUrl } from "../infrastructure/http/runtimeMode";
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

let unexpectedNetwork: string[];
beforeEach(() => {
  unexpectedNetwork = [];
  vi.mocked(listReleases).mockReset();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    unexpectedNetwork.push(request);
    throw new Error(`Unexpected network request: ${request}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(unexpectedNetwork).toEqual([]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function pairingResponse() {
  return new Response(JSON.stringify({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" }), { status: 200 });
}

function stubPairingPost(result: () => Promise<Response>) {
  const pairingFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = `${init?.method ?? "GET"} ${String(input)}`;
    if (String(input) !== `${resolveWiseEffApiBaseUrl()}/api/v1/device-bridges/pairing-codes` ||
        init?.method !== "POST" || init.body !== "{}") {
      unexpectedNetwork.push(request);
      throw new Error(`Unexpected network request: ${request}`);
    }
    return result();
  });
  vi.stubGlobal("fetch", pairingFetch);
  return pairingFetch;
}

function renderPanel(compact = false) {
  return render(
    <LocalDeviceBridgePanel
      compact={compact}
      detecting={false}
      protocol="hdc"
      onDetect={() => undefined}
      listBridges={async () => []}
      probeHealth={async () => ({ health: null, reachability: "offline" })}
      createPairingCode={async () => ({ code: "123456", expiresAt: new Date(Date.now() + 60_000).toISOString() })}
    />
  );
}

it("releases the shared refresh lock after an aborted server list request and recovers on retry", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const controllers: AbortController[] = [];
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
    if (!String(input).endsWith("/api/v1/device-bridges/mine")) {
      unexpectedNetwork.push(String(input));
      throw new Error("Unexpected request");
    }
    if (fetchMock.mock.calls.length === 1) return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<LocalDeviceBridgePanel compact detecting={false} protocol="hdc" onDetect={vi.fn()}
      probeHealth={async () => ({ health: null, reachability: "offline" })}
      createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("正在检查 Bridge…")).toBeInTheDocument();
    await act(async () => controllers[0]!.abort(new DOMException("Request timed out", "TimeoutError")));
    const retry = await screen.findByRole("button", { name: "刷新代理状态" });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "连接本机" })).toBeEnabled();
    expect(timeout.mock.calls).toEqual([[5000], [5000]]);
  } finally {
    timeout.mockRestore();
  }
});

it("keeps first-time workbench setup in the install dialog, not the context bar", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  renderPanel(true);
  expect(await screen.findByText("未检测到本地 Bridge")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
  expect(screen.queryByText("123456", { selector: "code" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "连接本机" })).toBeEnabled();
  const trigger = screen.getByRole("button", { name: "安装指南" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "安装与连接本地 Bridge" });
  expect(within(dialog).getByRole("list", { name: "Bridge 连接步骤" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "查看连接本机步骤" }));
  expect(await within(dialog).findByText("123456", { selector: "code" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("keeps returning users on a compact readiness bar using any unrevoked server record", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const records = deferred<Awaited<ReturnType<typeof import("../infrastructure/http/deviceBridgeClient").listMyBridges>>>();
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={() => records.promise}
    probeHealth={async () => ({ health: null, reachability: "offline" })}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
  await act(async () => records.resolve([{ id: "br-returning", machineLabel: "工程机", platform: "linux", arch: "amd64", revokedAt: null }] as never));
  expect(await screen.findByText("未检测到本地 Bridge")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "连接本机" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "安装指南" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
  expect(screen.queryByText("暂时无法加载安装包列表，请稍后重试。")).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "我的设备代理列表" })).not.toBeInTheDocument();
  const management = screen.getByRole("button", { name: "管理设备代理" });
  management.focus();
  fireEvent.click(management);
  const dialog = screen.getByRole("dialog", { name: "管理设备代理" });
  expect(within(dialog).getByDisplayValue("工程机")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(management).toHaveFocus();
});

it("shows first-time setup once and opens the same guide in a keyboard-accessible drawer", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  renderPanel();
  expect(await screen.findByRole("list", { name: "Bridge 连接步骤" })).toBeInTheDocument();
  expect(screen.queryByRole("tablist", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "连接本机" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "查看连接本机步骤" }));
  expect(await screen.findByText("123456", { selector: "code" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "收起安装指南" }));
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "安装指南" });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = screen.getByRole("dialog", { name: "安装与连接本地 Bridge" });
  expect(drawer.contains(document.activeElement)).toBe(true);
  expect(within(drawer).getByRole("list", { name: "Bridge 连接步骤" })).toBeInTheDocument();
  const copy = within(drawer).getByRole("button", { name: "复制配对码" });
  const clipboard = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: clipboard } });
  fireEvent.click(copy);
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith("123456"));
  const lastAction = within(drawer).getByRole("button", { name: "连接本机" });
  lastAction.focus();
  fireEvent.keyDown(lastAction, { key: "Tab" });
  expect(within(drawer).getByRole("button", { name: "关闭安装指南" })).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
});

it("announces a busy readiness bar throughout the existing launch-and-pair flow", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const connection = deferred<Awaited<ReturnType<typeof bridgeLauncher.connectLocalBridge>>>();
  vi.mocked(bridgeLauncher.connectLocalBridge).mockImplementationOnce(() => connection.promise);
  renderPanel();
  const connect = screen.getByRole("button", { name: "连接本机" });
  await waitFor(() => expect(connect).toBeEnabled());
  fireEvent.click(connect);
  expect(screen.getByText("正在连接…")).toBeInTheDocument();
  expect(connect).toBeDisabled();
  expect(connect.closest('[aria-busy="true"]')).toBeInTheDocument();
  await act(async () => connection.resolve({ reachable: false, ok: false }));
  await waitFor(() => expect(connect).toBeEnabled());
});

it.each([undefined, "device-1"])("shows a quiet connected chip with target %s", async (target) => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  render(<LocalDeviceBridgePanel target={target} detecting={false} protocol="hdc" onDetect={vi.fn()}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })}
    listBridges={async () => [{ id: "br-online", machineLabel: "工程机", platform: "darwin", arch: "arm64", revokedAt: null }] as never}
    probeHealth={async () => ({ reachability: "ok", health: {
      ok: true, paired: true, connected: true, bridgeId: "br-online", updatedAt: "2026-10-11T00:00:00Z",
      tools: { adb: { available: true }, hdc: { available: true, source: "system", version: "1" } }
    } })} />);
  expect(await screen.findByText("已连接 · 工程机")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "连接本机" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "设备连接与排查" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Bridge 连接步骤" })).not.toBeInTheDocument();
});

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

    await screen.findByLabelText("安装环境");
    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
    expect(screen.getByRole("link", { name: /安装 Bridge/ })).toBeInTheDocument();
  });
});

it("explains an ordinary offline health probe without raising a panel alert", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const listBridges = vi.fn(async () => []);
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={listBridges}
    probeHealth={async () => ({ health: null, reachability: "offline", error: new TypeError("Failed to fetch") })}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
  await waitFor(() => expect(listBridges).toHaveBeenCalled());
  expect(screen.getByText("安装 Bridge")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows server network copy, not local Bridge advice, when the server list call fails", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  render(
    <LocalDeviceBridgePanel
      detecting={false}
      protocol="hdc"
      onDetect={vi.fn()}
      probeHealth={async () => ({ health: null, reachability: "offline" })}
      listBridges={async () => { throw new TypeError("Failed to fetch"); }}
      createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })}
    />
  );

  const message = await screen.findByText("网络连接失败，请稍后重试。");
  expect(message).not.toHaveTextContent(/Bridge|桥接/);
  const alert = message.closest('[role="alert"]') as HTMLElement;
  const disclosure = within(alert).getByText("Failed to fetch").closest("details") as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  fireEvent.click(within(alert).getByText("技术详情"));
  expect(disclosure.open).toBe(true);
});

it("shows local Bridge advice with technical details after a failed connection attempt", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={async () => []}
    probeHealth={async () => ({ health: null, reachability: "offline", error: new TypeError("Failed to fetch") })}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
  const connect = await screen.findByRole("button", { name: "连接本机" });
  await waitFor(() => expect(connect).toBeEnabled());
  fireEvent.click(connect);
  const alert = await screen.findByRole("alert");
  expect(alert.closest(".local-device-bridge-panel__readiness")).toBeInTheDocument();
  expect(alert).toHaveTextContent(/本机.*Bridge/);
  expect(within(alert).getByText("技术详情")).toBeInTheDocument();
  expect(within(alert).getByText("Failed to fetch")).toBeInTheDocument();
  fireEvent.click(within(alert).getByRole("button", { name: "刷新代理状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新代理状态" })).toBeEnabled());
  expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch");
});

it.each(["silent", "manual"] as const)("clears a recovered local error on a %s health probe", async (mode) => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const interval = vi.spyOn(window, "setInterval");
  let recovered = false;
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={async () => []}
    probeHealth={async () => recovered
      ? { health: { ok: true, paired: false, connected: false, updatedAt: "2026-10-15T00:00:00Z" }, reachability: "ok" }
      : { health: null, reachability: "offline", error: new TypeError("Failed to fetch") }}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
  const connect = await screen.findByRole("button", { name: "连接本机" });
  await waitFor(() => expect(connect).toBeEnabled());
  fireEvent.click(connect);
  await screen.findByRole("alert");
  recovered = true;
  if (mode === "silent") {
    const poll = interval.mock.calls.filter(([, delay]) => delay === 3000).at(-1)?.[0];
    expect(poll).toBeTypeOf("function");
    await act(async () => { if (typeof poll === "function") poll(); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } else {
    fireEvent.click(screen.getByRole("button", { name: "刷新代理状态" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  }
  interval.mockRestore();
});

it("does not erase a server error when only the local health probe recovers silently", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const interval = vi.spyOn(window, "setInterval");
  const listBridges = vi.fn().mockRejectedValueOnce(new Error("代理列表暂时不可用")).mockResolvedValue([]);
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={listBridges}
    probeHealth={async () => ({ health: null, reachability: "ok" })}
    createPairingCode={async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" })} />);
  const message = await screen.findByText("代理列表暂时不可用");
  const poll = interval.mock.calls.filter(([, delay]) => delay === 3000).at(-1)?.[0];
  expect(poll).toBeTypeOf("function");
  await act(async () => { if (typeof poll === "function") poll(); });
  expect(message).toBeInTheDocument();
  interval.mockRestore();
});

it("retains confirmed pairing when listing fails and allows retry", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const bridge: DeviceBridgeRecord = { id: "br-local", machineLabel: "本机", platform: "windows", arch: "amd64", revokedAt: null,
    clientVersion: "0.1.1", capabilities: {}, createdAt: "2026-09-15T00:00:00Z", lastSeenAt: null };
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
  fireEvent.click(await screen.findByRole("button", { name: "管理设备代理" }));
  await screen.findByDisplayValue("本机");
  createCode.mockClear();
  listBridges.mockRejectedValueOnce(new Error("代理列表暂时不可用"));
  view.rerender(<LocalDeviceBridgePanel {...props} probeHealth={async () => probeHealth()} />);

  expect(await screen.findByText(/代理列表暂时不可用/)).toBeInTheDocument();
  expect(screen.getByDisplayValue("本机")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "连接本机" })).not.toBeInTheDocument();
  expect(createCode).not.toHaveBeenCalled();
  expect(onState.mock.lastCall?.[0].bridges).toEqual([bridge]);

  fireEvent.click(screen.getByRole("button", { name: "刷新代理状态" }));
  await waitFor(() => expect(listBridges).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(/代理列表暂时不可用/)).not.toBeInTheDocument();
});

it("asks the current user to rebind a live local bridge owned by another account", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const onDetect = vi.fn();
  let bridges: DeviceBridgeRecord[] = [];
  let health = {
    ok: true as const,
    paired: true,
    connected: true,
    bridgeId: "br-A",
    updatedAt: "2026-09-16T00:00:00.000Z"
  };
  vi.mocked(bridgeLauncher.connectLocalBridge).mockImplementation(async () => {
    bridges = [{ id: "br-B", machineLabel: "本机", platform: "darwin", arch: "arm64", revokedAt: null,
      clientVersion: "0.1.1", capabilities: {}, createdAt: "2026-09-16T00:01:00Z", lastSeenAt: null }];
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

  const rebindButton = await screen.findByRole("button", { name: "连接本机" });
  expect(await screen.findByText(FOREIGN_ACCOUNT_REBIND_HINT)).toBeInTheDocument();
  expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
  await waitFor(() => expect(rebindButton).toBeEnabled());

  fireEvent.click(rebindButton);

  await waitFor(() => expect(onDetect).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("已连接 · 本机")).toBeInTheDocument();
  expect(screen.queryByText(/配对已失效/)).not.toBeInTheDocument();
});

it.each([true, false])("refreshes online tool changes without overlapping probes or replacing a rename draft (adbAvailable=%s)", async (adbAvailable) => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const bridge = { id: "br-local", machineLabel: "工程机", platform: "linux", arch: "amd64", revokedAt: null };
  const health = { ok: true as const, paired: true, connected: true, bridgeId: bridge.id,
    updatedAt: "2026-10-15T00:00:00Z", tools: { adb: { available: true }, hdc: { available: true } } };
  const pending = deferred<{ health: typeof health; reachability: "ok" }>();
  const probeHealth = vi.fn().mockResolvedValueOnce({ health, reachability: "ok" }).mockReturnValue(pending.promise);
  const createCode = vi.fn(async () => ({ code: "123456", expiresAt: "2099-01-01T00:00:00Z" }));
  render(<LocalDeviceBridgePanel detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={async () => [bridge] as never} probeHealth={probeHealth} createPairingCode={createCode} />);
  fireEvent.click(await screen.findByRole("button", { name: "管理设备代理" }));
  const input = await screen.findByDisplayValue("工程机");
  await waitFor(() => expect(screen.queryByText("正在检查 Bridge…")).not.toBeInTheDocument());
  fireEvent.change(input, { target: { value: "正在编辑的名称" } });
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(probeHealth).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve({ health: { ...health, tools: { adb: { available: adbAvailable }, hdc: { available: false } } }, reachability: "ok" }));
  expect(screen.getByDisplayValue("正在编辑的名称")).toBeInTheDocument();
  if (adbAvailable) {
    expect(screen.queryByRole("button", { name: "安装调试工具" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName("Bridge 在线，请插入 USB 设备并授权调试。");
  } else {
    expect(screen.getByRole("button", { name: "安装调试工具" })).toBeInTheDocument();
  }
  expect(createCode).toHaveBeenCalledTimes(1);
});

it("shows pairing failure in the open guide and clears only that error after a successful retry", async () => {
  vi.mocked(listReleases).mockResolvedValue({ items: [] } as never);
  const createCode = vi.fn().mockRejectedValueOnce(new Error("配对码服务暂不可用"))
    .mockResolvedValue({ code: "654321", expiresAt: "2099-01-01T00:00:00Z" });
  render(<LocalDeviceBridgePanel compact detecting={false} protocol="hdc" onDetect={vi.fn()}
    listBridges={async () => { throw new Error("代理列表暂不可用"); }}
    probeHealth={async () => ({ health: null, reachability: "offline" })} createPairingCode={createCode} />);
  await screen.findByText("代理列表暂不可用");
  fireEvent.click(screen.getByRole("button", { name: "安装指南" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByText("配对码服务暂不可用")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "重试生成配对码" }));
  await waitFor(() => expect(within(dialog).queryByText("配对码服务暂不可用")).not.toBeInTheDocument());
  fireEvent.click(within(dialog).getByRole("button", { name: "查看连接本机步骤" }));
  expect(await within(dialog).findByText("654321", { selector: "code" })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭安装指南" }));
  expect(screen.getByText("代理列表暂不可用")).toBeInTheDocument();
});

const olderBridge = {
  id: "br-A", machineLabel: "本机", platform: "darwin" as const, arch: "arm64" as const,
  clientVersion: "0.1.0", capabilities: {}, createdAt: "2026-09-16T00:00:00.000Z",
  lastSeenAt: "2026-09-16T00:00:00.000Z", revokedAt: null
};
const olderHealth = {
  ok: true as const, paired: true, connected: true, bridgeId: "br-A",
  updatedAt: "2026-09-16T00:00:00.000Z",
  tools: { adb: { available: true }, hdc: { available: true } }
};
const olderManifest = {
  recommendedVersion: "0.1.1", minCompatibleVersion: "0.1.0",
  items: [{
    platform: "darwin", arch: "arm64", artifactKind: "installer", version: "0.1.1",
    downloadUrl: "/downloads/device-bridge/0.1.1/darwin/arm64/WiseEffBridge_0.1.1_darwin_arm64.pkg"
  }]
};
const olderBridgeProps = {
  detecting: false, protocol: "hdc" as const, onDetect: () => undefined,
  listBridges: async () => [olderBridge]
};

it("prompts to install the latest Bridge when local health is an older client", async () => {
  const pairingFetch = stubPairingPost(async () => pairingResponse());
  vi.mocked(listReleases).mockResolvedValue(olderManifest as never);

  render(
    <LocalDeviceBridgePanel
      {...olderBridgeProps}
      probeHealth={async () => ({
        health: olderHealth, reachability: "ok"
      })}
    />
  );

  expect(await screen.findByText("请升级本机 Bridge")).toBeInTheDocument();
  expect(screen.getByText(/推荐版本 0\.1\.1/)).toBeInTheDocument();
  expect(screen.getByText("已连接 · 本机")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
  expect(await screen.findByText("图形安装包（推荐）")).toBeInTheDocument();
  await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
  expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
  expect(pairingFetch).toHaveBeenCalledTimes(1);
  expect(pairingFetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/device-bridges\/pairing-codes$/),
    expect.objectContaining({ method: "POST", body: "{}" }));
});

it.each(["success", "failure"] as const)(
  "keeps the install step after a pending pairing request finishes with %s",
  async (outcome) => {
    const reconnectingOldHealth = { ...olderHealth, connected: false, serverUrl: "https://old.example" };
    const health = deferred<{ health: typeof reconnectingOldHealth; reachability: "ok" }>();
    const manifest = deferred<typeof olderManifest>();
    const pairing = deferred<void>();
    const pairingFetch = stubPairingPost(async () => { await pairing.promise; return pairingResponse(); });
    vi.mocked(listReleases).mockReturnValue(manifest.promise as never);
    render(<LocalDeviceBridgePanel {...olderBridgeProps} probeHealth={() => health.promise} />);

    await waitFor(() => expect(pairingFetch).toHaveBeenCalledTimes(1));
    expect(listReleases).not.toHaveBeenCalled();
    await act(async () => health.resolve({ health: reconnectingOldHealth, reachability: "ok" }));
    await waitFor(() => expect(pairingFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listReleases).toHaveBeenCalledTimes(1));
    await act(async () => manifest.resolve(olderManifest));
    expect(await screen.findByText("请升级本机 Bridge")).toBeInTheDocument();
    expect(screen.getByText(/推荐版本 0\.1\.1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
    await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    await act(async () => {
      if (outcome === "success") pairing.resolve(undefined);
      else pairing.reject(new Error("pairing unavailable"));
    });
    if (outcome === "failure") expect(screen.getByText("pairing unavailable")).toBeInTheDocument();
    else expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByText(/推荐版本 0\.1\.1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
    expect(pairingFetch).toHaveBeenCalledTimes(1);
  }
);

it("keeps the install step when an old-client health refresh completes after the manifest", async () => {
  const pairingFetch = stubPairingPost(async () => pairingResponse());
  vi.mocked(listReleases).mockResolvedValue(olderManifest as never);
  const firstProbe = async () => ({ health: olderHealth, reachability: "ok" as const });
  const lateHealth = deferred<{ health: typeof olderHealth; reachability: "ok" }>();
  const secondProbe = vi.fn(() => lateHealth.promise);
  const view = render(<LocalDeviceBridgePanel {...olderBridgeProps} probeHealth={firstProbe} />);

  expect(await screen.findByText("请升级本机 Bridge")).toBeInTheDocument();
  expect(listReleases).toHaveBeenCalledTimes(1);
  view.rerender(<LocalDeviceBridgePanel {...olderBridgeProps} probeHealth={secondProbe} />);
  await waitFor(() => expect(secondProbe).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "下载安装包" }));
  await selectControlOption(screen.getByRole("combobox", { name: "安装环境" }), "darwin/arm64");
  expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();

  await act(async () => lateHealth.resolve({
    health: { ...olderHealth, updatedAt: "2026-09-16T00:01:00.000Z" }, reachability: "ok"
  }));
  expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
  expect(screen.getByText(/推荐版本 0\.1\.1/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toBeInTheDocument();
  expect(listReleases).toHaveBeenCalledTimes(1);
  expect(pairingFetch).toHaveBeenCalledTimes(1);
});
