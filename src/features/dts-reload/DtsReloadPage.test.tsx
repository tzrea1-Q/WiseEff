import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { DTS_RELOAD_CONFIRMATION_TOKEN } from "@/domain/dtsReload/types";
import { DtsReloadPage } from "./DtsReloadPage";
import { getRequiredRoleForPage } from "@/app/permissions";

vi.mock("@/infrastructure/http/bridgeConnectLauncher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/http/bridgeConnectLauncher")>();
  return {
    ...actual,
    probeLocalBridgeHealth: vi.fn(async () => null),
    probeLocalBridgeHealthDetailed: vi.fn(async () => ({
      health: null,
      reachability: "offline" as const
    }))
  };
});

vi.mock("@/infrastructure/http/deviceBridgeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/http/deviceBridgeClient")>();
  return {
    ...actual,
    listMyBridges: vi.fn(async () => []),
    listReleases: vi.fn(async () => ({
      recommendedVersion: "0.0.0",
      minCompatibleVersion: "0.0.0",
      items: []
    })),
    createPairingCode: vi.fn(async () => ({
      code: "123456",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })),
    renameBridge: vi.fn(async (id: string, machineLabel: string) => ({
      id,
      machineLabel,
      platform: "darwin" as const,
      arch: "arm64",
      clientVersion: null,
      capabilities: {},
      createdAt: "1970-01-01T00:00:00.000Z",
      lastSeenAt: null,
      revokedAt: null
    })),
    revokeBridge: vi.fn(async (id: string) => ({
      id,
      machineLabel: "revoked",
      platform: "darwin" as const,
      arch: "arm64",
      clientVersion: null,
      capabilities: {},
      createdAt: "1970-01-01T00:00:00.000Z",
      lastSeenAt: null,
      revokedAt: new Date().toISOString()
    }))
  };
});

const testBridges = [{ id: "bridge-1", machineLabel: "Lab Mac" }];

function candidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return {
    bindingId: "binding-1",
    projectId: "project-1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "charger",
    nodePath: "/amba/i2c@1/dev@6E",
    baselineValue: "<6000>",
    description: "Watchdog timeout for charger safety.",
    valueShapeKind: "cells",
    resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: { min: 0, max: 20000, cells: 1 },
    debuggable: true,
    ...overrides
  };
}

function run(overrides: Partial<DtsReloadRun> = {}): DtsReloadRun {
  return {
    id: "run-1",
    projectId: "project-1",
    configRevisionId: null,
    status: "validated",
    purpose: "ordinary",
    restoresSourceRunId: null,
    failureCode: null,
    targets: [
      {
        bindingId: "binding-1",
        nodePath: "/amba/i2c@1/dev@6E",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      }
    ],
    steps: [
      { step: "compile-base", outcome: "passed" },
      { step: "compile-overlay", outcome: "passed" },
      { step: "dry-run-merge", outcome: "passed" },
      { step: "assert-effect", outcome: "passed" }
    ],
    diagnostics: [],
    toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlaySource:
      '/dts-v1/;\n/plugin/;\n\n/ {\n\tfragment@0 {\n\t\ttarget-path = "/amba/i2c@1/dev@6E";\n\t};\n};\n',
    overlaySourceSha256: "sha",
    artifact: { fileName: "debug-overlay-run-1.dtbo", sha256: "sha-art", sizeBytes: 32 },
    createdAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:00:01.000Z",
    ...overrides
  };
}

function createRepository(overrides: Partial<DtsReloadRepository> = {}): DtsReloadRepository {
  return {
    listCandidates: vi.fn(async () => ({ items: [candidate()] })),
    listRuns: vi.fn(async () => ({ items: [], nextCursor: null })),
    startRun: vi.fn(async () => run()),
    restoreBaseline: vi.fn(async () =>
      run({
        id: "run-restore",
        purpose: "restore-baseline",
        targets: [
          {
            bindingId: "binding-1",
            nodePath: "/amba/i2c@1/dev@6E",
            propertyKey: "watchdog_time",
            baselineValue: "<6000>",
            debugValue: "<6000>"
          }
        ]
      })
    ),
    getResidue: vi.fn(async () => null),
    deployRun: vi.fn(async () =>
      run({
        status: "unverifiable",
        purpose: "ordinary",
        steps: [
          { step: "compile-base", outcome: "passed" },
          { step: "compile-overlay", outcome: "passed" },
          { step: "dry-run-merge", outcome: "passed" },
          { step: "assert-effect", outcome: "passed" },
          { step: "mount-target", outcome: "passed" },
          { step: "transfer-artifact", outcome: "passed" },
          { step: "trigger-reload", outcome: "passed" }
        ],
        deviceId: "bridge:bridge-1",
        bridgeId: "bridge-1",
        bridgeMachineLabel: "Lab Mac",
        targetRef: "device-serial-1",
        protocol: "hdc",
        integrityCheck: "byte-length",
        reloadSnapshot: {
          libraryBaselines: [
            {
              bindingId: "binding-1",
              propertyKey: "watchdog_time",
              nodePath: "/amba/i2c@1/dev@6E",
              baselineValue: "<6000>"
            }
          ],
          artifactDigest: {
            sha256: "sha-art",
            onDeviceDigest: "32",
            integrityCheck: "byte-length"
          },
          kernelSignal: {
            command: "dmesg",
            captureStatus: "obtained",
            captureError: null,
            rawText: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
            truncated: false,
            matchedByParameter: [
              {
                parameterName: "watchdog_time",
                bindingId: "binding-1",
                lines: ["kernel: watchdog_time applied"]
              }
            ],
            excerpt: null
          },
          behaviouralVerification: {
            outcomes: [
              {
                bindingId: "binding-1",
                propertyKey: "watchdog_time",
                outcome: "unbound",
                debugNodeId: null,
                nodePath: null,
                expectedValue: "<7000>",
                readValue: null,
                reason: "No readable debug-node binding for this parameter and protocol."
              }
            ]
          }
        }
      })
    ),
    getRun: vi.fn(async () => run()),
    downloadArtifact: vi.fn(async () => new Blob([Uint8Array.from([1, 2, 3])])),
    promoteToDrafts: vi.fn(async () => ({
      runId: "run-1",
      status: "verified" as const,
      drafts: [{ bindingId: "binding-1", draftId: "draft-1", outcome: "created" as const }],
      workbenchHref: "/parameters?project=project-1"
    })),
    getReloadConfiguration: vi.fn(),
    updateOrganisationReloadConfiguration: vi.fn(),
    ...overrides
  };
}

function renderPage(repository: DtsReloadRepository, overrides: Partial<ComponentProps<typeof DtsReloadPage>> = {}) {
  return render(
    <DtsReloadPage
      projects={[{ id: "project-1", name: "Demo" }]}
      repository={repository}
      canStartRun
      bridges={testBridges}
      probeBridgeHealth={async () => ({ connected: true, bridgeId: "bridge-1" })}
      initialTargetRef="device-serial-1"
      moduleRegistryRepository={null}
      {...overrides}
    />
  );
}

async function fillDeployFields(_user: ReturnType<typeof userEvent.setup>) {
  // Deploy target comes from Bridge detect / initialTargetRef — no manual field.
}

async function setDebugValueInTray(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string
) {
  const input = await screen.findByLabelText(label);
  await user.clear(input);
  await user.type(input, value);
}

async function setWatchdogDebugValue(
  user: ReturnType<typeof userEvent.setup>,
  value = "<7000>"
) {
  await setDebugValueInTray(user, "Watchdog 调试值", value);
}

afterEach(() => {
  vi.restoreAllMocks();
  const url = new URL(window.location.href);
  url.searchParams.delete("run");
  url.searchParams.delete("uiPreview");
  url.searchParams.delete("bindingIds");
  url.searchParams.delete("project");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
});

describe("DtsReloadPage", () => {
  it("requires committer role for the page", () => {
    expect(getRequiredRoleForPage("dts-reload")).toBe("hardware-committer");
  });

  it("exposes workbench landmarks for protocol, candidates, start bar, and collapsed history", async () => {
    const repository = createRepository();
    renderPage(repository);
    expect(await screen.findByRole("group", { name: "连接协议" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本地设备连接" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "部署目标" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "可调试参数" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "模块导航" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /模块/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选模块" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /编辑 Watchdog/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本轮重载" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下发参数/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("DTS 重载启动操作栏")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "已选调试值" })).not.toBeInTheDocument();
    const history = screen.getByLabelText("运行历史");
    expect(history.tagName.toLowerCase()).toBe("details");
    expect(history).not.toHaveAttribute("open");
  });

  it("opens a side sheet to edit a debuggable candidate into the reload batch", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    renderPage(repository);

    await user.click(await screen.findByRole("button", { name: /编辑 Watchdog/ }));
    const sheet = await screen.findByRole("dialog", { name: "Watchdog" });
    expect(within(sheet).getByRole("heading", { name: "参数含义" })).toBeInTheDocument();
    expect(within(sheet).getByText("Watchdog timeout for charger safety.")).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: "上次重载" })).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Watchdog 调试值")).toHaveValue("<6000>");
    expect(within(sheet).getByRole("button", { name: "更新本轮" })).toBeDisabled();

    const valueInput = within(sheet).getByLabelText("Watchdog 调试值");
    await user.clear(valueInput);
    expect(within(sheet).getByRole("button", { name: "更新本轮" })).toBeDisabled();
    await user.type(valueInput, "<7000>");
    expect(within(sheet).getByRole("button", { name: "更新本轮" })).toBeEnabled();
    await user.click(within(sheet).getByRole("button", { name: "更新本轮" }));

    expect(screen.queryByRole("dialog", { name: "Watchdog" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本轮重载" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("<7000>")).toBeInTheDocument();
  });

  it("keeps dispatch disabled while the reload batch has no meaningful debug changes", async () => {
    renderPage(createRepository());
    expect(await screen.findByRole("region", { name: "本轮重载" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下发参数/ })).toBeDisabled();
  });

  it("edits the reload batch in a workbench-style tray with remove and reset actions", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate(),
          candidate({
            bindingId: "binding-2",
            propertyKey: "compatible",
            displayName: "Compatible",
            module: "uart",
            nodePath: "/amba/uart@2",
            baselineValue: '"sc8562"',
            valueShapeKind: "string-list",
            resolvedValueShape: { kind: "string-list" },
            constraints: {}
          })
        ]
      }))
    });
    renderPage(repository);

    expect(await screen.findByRole("region", { name: "本轮重载" })).toBeInTheDocument();
    expect(screen.getByText(/本轮 1 项/)).toBeInTheDocument();
    const watchdogDiff = screen.getByLabelText("Watchdog 值变更");
    expect(watchdogDiff.querySelector(".submission-preview-diff--scalar")).toHaveAttribute("data-kind", "equal");
    expect(watchdogDiff.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent("<6000>");
    expect(watchdogDiff.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent("<6000>");

    await user.click(screen.getByRole("checkbox", { name: "选择 Compatible" }));
    expect(screen.getByText(/本轮 2 项/)).toBeInTheDocument();

    const compatibleInput = screen.getByLabelText("Compatible 调试值");
    await user.clear(compatibleInput);
    await user.type(compatibleInput, '"debug"');
    expect(compatibleInput).toHaveValue('"debug"');
    const compatibleDiff = screen.getByLabelText("Compatible 值变更");
    expect(compatibleDiff.querySelector(".submission-preview-diff--scalar")).toHaveAttribute("data-kind", "changed");
    expect(compatibleDiff.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent('"sc8562"');
    expect(compatibleDiff.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent('"debug"');

    await user.click(screen.getByRole("button", { name: "重置为基线" }));
    expect(compatibleInput).toHaveValue('"sc8562"');

    await user.click(screen.getByRole("button", { name: "移出本轮重载 Compatible" }));
    expect(screen.getByText(/本轮 1 项/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Compatible 调试值")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空本轮" }));
    expect(screen.queryByRole("region", { name: "本轮重载" })).not.toBeInTheDocument();
  });

  it("keeps block reasons in the operations column for not-debuggable rows", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate({
            bindingId: "binding-blocked",
            displayName: "Blocked",
            debuggable: false,
            blockReason: "unsupported-value-shape"
          })
        ]
      }))
    });

    renderPage(repository);

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑 Blocked/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/u32\/u8\/u16 cell 数组/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/GPIO 风格 phandle 数组/)).toBeInTheDocument();
    await user.click(screen.getByText("Blocked"));
    expect(screen.queryByRole("region", { name: "本轮重载" })).not.toBeInTheDocument();
  });

  it("filters the candidate table to workbench hand-off ids and does not auto-fill the tray", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate({ bindingId: "binding-1", displayName: "Watchdog" }),
          candidate({
            bindingId: "binding-2",
            displayName: "Keep Power",
            propertyKey: "keep-power",
            baselineValue: "",
            resolvedValueShape: { kind: "boolean" },
            valueShapeKind: "boolean"
          })
        ]
      }))
    });
    renderPage(repository, { initialBindingIds: ["binding-2"] });
    expect(await screen.findByText("Keep Power")).toBeInTheDocument();
    expect(screen.queryByText("Watchdog")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "工作台带入的参数" })).toHaveTextContent("已从参数工作台带入 1 个参数");
    expect(screen.queryByRole("region", { name: "本轮重载" })).not.toBeInTheDocument();
    expect(screen.getByText("显示 1 / 1 项")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示全部" }));
    expect(await screen.findByText("Watchdog")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "工作台带入的参数" })).not.toBeInTheDocument();
  });

  it("filters candidates with the 模块 ColumnFilter multi-select", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate(),
          candidate({
            bindingId: "binding-2",
            propertyKey: "compatible",
            displayName: "Compatible",
            module: "uart",
            nodePath: "/amba/uart@2",
            baselineValue: '"sc8562"',
            valueShapeKind: "string-list",
            resolvedValueShape: { kind: "string-list" },
            constraints: {}
          })
        ]
      }))
    });
    renderPage(repository);

    expect(await screen.findByRole("checkbox", { name: "选择 Watchdog" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 Compatible" })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "筛选模块" });
    await user.click(trigger);
    const menu = screen.getByRole("group", { name: "模块筛选" });
    await user.click(within(menu).getByRole("checkbox", { name: "uart" }));

    expect(screen.queryByRole("checkbox", { name: "选择 Watchdog" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 Compatible" })).toBeInTheDocument();
    expect(screen.getByText("显示 1 / 2 项")).toBeInTheDocument();
    expect(trigger).toHaveClass("active");
    expect(trigger).toHaveTextContent("1");

    await user.click(within(menu).getByRole("button", { name: "清除" }));
    expect(screen.getByRole("checkbox", { name: "选择 Watchdog" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 Compatible" })).toBeInTheDocument();
    expect(screen.getByText("显示 2 / 2 项")).toBeInTheDocument();
  });

  it("lists candidates, starts a batch run, shows overlay source, and downloads the artifact", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate(),
          candidate({
            bindingId: "binding-2",
            propertyKey: "compatible",
            displayName: "Compatible",
            module: "uart",
            nodePath: "/amba/uart@2",
            baselineValue: '"sc8562"',
            valueShapeKind: "string-list",
            resolvedValueShape: { kind: "string-list" },
            constraints: {}
          }),
          candidate({
            bindingId: "binding-blocked",
            displayName: "Blocked",
            nodePath: "/amba",
            debuggable: false,
            blockReason: "no-baseline-value"
          })
        ]
      }))
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:overlay");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    renderPage(repository);

    expect((await screen.findAllByText("Watchdog")).length).toBeGreaterThan(0);
    expect(screen.getByText(/缺少库基线值/)).toBeInTheDocument();

    const moduleTree = screen.getByRole("tree", { name: "业务模块树" });
    const uartModule = within(moduleTree).getByRole("treeitem", {
      name: (_name, element) =>
        element.getAttribute("aria-level") === "1" &&
        Boolean(element.querySelector(".dts-topology-navigator__label")?.textContent?.match(/^uart$/i))
    });
    await user.click(uartModule);
    expect(screen.queryByRole("checkbox", { name: "选择 Watchdog" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 Compatible" })).toBeInTheDocument();
    await user.click(uartModule);
    expect(screen.getByRole("checkbox", { name: "选择 Watchdog" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("按名称搜索参数"), "Watch");
    expect(screen.getByRole("checkbox", { name: "选择 Watchdog" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "选择 Compatible" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("按名称搜索参数"));

    await user.click(screen.getByLabelText("选择 Compatible"));
    expect(screen.getByText(/本轮 2 项/)).toBeInTheDocument();

    const watchdogInput = screen.getByLabelText("Watchdog 调试值");
    await user.clear(watchdogInput);
    await user.type(watchdogInput, "<99999>");
    await fillDeployFields(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/最大值/);
    expect(repository.startRun).not.toHaveBeenCalled();

    await user.clear(watchdogInput);
    await user.type(watchdogInput, "<7000>");
    const compatibleInput = screen.getByLabelText("Compatible 调试值");
    await user.clear(compatibleInput);
    await user.type(compatibleInput, '"sc8562", "sc8562-v2"');
    await user.click(screen.getByRole("button", { name: /下发参数/ }));

    await waitFor(() =>
      expect(repository.startRun).toHaveBeenCalledWith({
        projectId: "project-1",
        targets: [
          { bindingId: "binding-1", debugValue: "<7000>" },
          { bindingId: "binding-2", debugValue: '"sc8562", "sc8562-v2"' }
        ]
      })
    );
    expect(repository.deployRun).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("部署确认 Overlay 源码") as HTMLTextAreaElement).value).toContain(
      "target-path"
    );
    expect(within(dialog).getByText(/<6000>/)).toBeInTheDocument();
    expect(within(dialog).getByText(/<7000>/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    const overlay = await screen.findByLabelText("Overlay 源码");
    expect((overlay as HTMLTextAreaElement).value).toContain("target-path");
    expect(screen.getByText(/本运行包含 1 个参数目标/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /下载编译产物/ }));
    await waitFor(() => expect(repository.downloadArtifact).toHaveBeenCalledWith("run-1"));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("does not allow selecting a not-debuggable parameter", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate({
            bindingId: "binding-blocked",
            displayName: "Blocked",
            debuggable: false,
            blockReason: "unsupported-value-shape"
          })
        ]
      }))
    });

    renderPage(repository);

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    const checkbox = screen.getByLabelText("选择 Blocked");
    expect(checkbox).toBeDisabled();
    await user.click(screen.getByText("Blocked"));
    expect(screen.queryByRole("region", { name: "本轮重载" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/u32\/u8\/u16 cell 数组/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/GPIO 风格 phandle 数组/)).toBeInTheDocument();
  });

  it("marks sensitive candidates before start and requires critical confirmation token", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate({
            displayName: "Safety Watchdog",
            sensitiveMatch: {
              riskTier: "critical",
              requiredCapability: "parameter:edit-critical",
              ruleId: "rule-1",
              matchType: "path",
              pattern: "/amba/i2c@1/dev@6E",
              requiresElevatedCapability: true,
              requiresConfirmation: true
            }
          }),
          candidate({
            bindingId: "binding-high",
            displayName: "High Param",
            propertyKey: "high_param",
            nodePath: "/amba/uart@2",
            sensitiveMatch: {
              riskTier: "high",
              requiredCapability: "parameter:edit-critical",
              ruleId: "rule-2",
              matchType: "path",
              pattern: "/amba/uart@2",
              requiresElevatedCapability: true,
              requiresConfirmation: false
            }
          })
        ]
      }))
    });

    renderPage(repository);

    expect(await screen.findByRole("checkbox", { name: "选择 Safety Watchdog" })).toBeChecked();
    expect(screen.getAllByText("敏感 · critical").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("checkbox", { name: "选择 High Param" }));
    expect(screen.getAllByText("敏感 · high").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/parameter:edit-critical/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("checkbox", { name: "选择 High Param" }));

    const startButton = screen.getByRole("button", { name: /下发参数/ });
    expect(startButton).toBeDisabled();

    await fillDeployFields(user);
    await setDebugValueInTray(user, "Safety Watchdog 调试值", "<7000>");
    await user.click(screen.getByLabelText("确认 critical 敏感节点重载"));
    expect(startButton).toBeEnabled();
    await user.click(startButton);

    await waitFor(() =>
      expect(repository.startRun).toHaveBeenCalledWith({
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<7000>" }],
        confirmationToken: "confirm-sensitive-reload"
      })
    );
    expect(repository.deployRun).not.toHaveBeenCalled();
  });

  it("opens deploy confirm after validated start and only calls deployRun with confirm-dts-reload on confirm", async () => {
    const user = userEvent.setup();
    const repository = createRepository();

    renderPage(repository);
    await screen.findAllByText("Watchdog");
    await fillDeployFields(user);
    await setWatchdogDebugValue(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));

    await waitFor(() => expect(repository.startRun).toHaveBeenCalled());
    expect(repository.deployRun).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("确认部署到设备")).toBeInTheDocument();
    expect(within(dialog).getByText(/Lab Mac/)).toBeInTheDocument();
    expect(within(dialog).getByText(/bridge:bridge-1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/device-serial-1/)).toBeInTheDocument();
    expect((within(dialog).getByLabelText("部署确认 Overlay 源码") as HTMLTextAreaElement).value).toContain(
      "target-path"
    );
    expect(within(dialog).getByText(/<6000>/)).toBeInTheDocument();
    expect(within(dialog).getByText(/<7000>/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "确认部署" }));

    await waitFor(() =>
      expect(repository.deployRun).toHaveBeenCalledWith({
        runId: "run-1",
        deviceId: "bridge:bridge-1",
        bridgeId: "bridge-1",
        targetRef: "device-serial-1",
        protocol: "hdc",
        confirmationTokens: [DTS_RELOAD_CONFIRMATION_TOKEN]
      })
    );
    await waitFor(() => expect(repository.deployRun).toHaveBeenCalledTimes(1));
    expect(screen.getByText("不可验证的重载")).toBeInTheDocument();
    expect(screen.getAllByText(/仅长度校验/).length).toBeGreaterThan(0);
    expect(screen.getByText(/重载快照/)).toBeInTheDocument();
    expect(screen.getByText(/挂载目标/)).toBeInTheDocument();
    expect(screen.getByLabelText("行为验证结果")).toBeInTheDocument();
    expect(screen.getByLabelText("行为验证结果")).toHaveTextContent("缺少调试节点绑定");
    expect(screen.getByLabelText("行为验证结果")).toHaveTextContent(/不是读取失败/);
    expect(screen.getByLabelText("内核日志证据")).toBeInTheDocument();
    expect(screen.getByText(/内核日志证据（未判定）/)).toBeInTheDocument();
    expect(screen.getByLabelText("内核日志证据")).toHaveTextContent(/没有/);
    expect(screen.getByLabelText("内核日志证据")).toHaveTextContent(/推断重载成功或失败/);
    expect(screen.getByLabelText("按参数名分组的匹配行")).toHaveTextContent("watchdog_time");
    expect(screen.getByLabelText("按参数名分组的匹配行")).toHaveTextContent("kernel: watchdog_time applied");
    await user.click(screen.getByText("查看未过滤的完整采集"));
    expect(screen.getByLabelText("未过滤的内核日志采集")).toHaveTextContent("overlay reload ok");
  });

  it("shows per-parameter behavioural verification outcomes including missing bindings", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      deployRun: vi.fn(async () =>
        run({
          status: "verified",
          steps: [
            { step: "compile-base", outcome: "passed" },
            { step: "compile-overlay", outcome: "passed" },
            { step: "dry-run-merge", outcome: "passed" },
            { step: "assert-effect", outcome: "passed" },
            { step: "mount-target", outcome: "passed" },
            { step: "transfer-artifact", outcome: "passed" },
            { step: "trigger-reload", outcome: "passed" }
          ],
          reloadSnapshot: {
            libraryBaselines: [
              {
                bindingId: "binding-1",
                propertyKey: "watchdog_time",
                nodePath: "/amba/i2c@1/dev@6E",
                baselineValue: "<6000>"
              }
            ],
            artifactDigest: {
              sha256: "sha-art",
              onDeviceDigest: "sha-art",
              integrityCheck: "sha256"
            },
            kernelSignal: null,
            behaviouralVerification: {
              outcomes: [
                {
                  bindingId: "binding-1",
                  propertyKey: "watchdog_time",
                  outcome: "verified",
                  debugNodeId: "dbg-1",
                  nodePath: "/sys/class/power_supply/battery/watchdog_time",
                  expectedValue: "<7000>",
                  readValue: "7000",
                  reason: null
                }
              ]
            }
          }
        })
      )
    });

    renderPage(repository);
    await screen.findAllByText("Watchdog");
    await fillDeployFields(user);
    await setWatchdogDebugValue(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认部署" }));

    await waitFor(() => expect(screen.getByText("行为已验证")).toBeInTheDocument());
    expect(screen.getByLabelText("行为验证结果")).toHaveTextContent("已验证");
    expect(screen.getByLabelText("行为验证结果")).toHaveTextContent("读回：7000");
  });

  it("distinguishes capture failure from obtained-with-no-matches in the evidence panel", async () => {
    const user = userEvent.setup();
    const failedRepo = createRepository({
      deployRun: vi.fn(async () =>
        run({
          status: "unverifiable",
          steps: [
            { step: "compile-base", outcome: "passed" },
            { step: "compile-overlay", outcome: "passed" },
            { step: "dry-run-merge", outcome: "passed" },
            { step: "assert-effect", outcome: "passed" },
            { step: "mount-target", outcome: "passed" },
            { step: "transfer-artifact", outcome: "passed" },
            { step: "trigger-reload", outcome: "passed" }
          ],
          reloadSnapshot: {
            libraryBaselines: [
              {
                bindingId: "binding-1",
                propertyKey: "watchdog_time",
                nodePath: "/amba/i2c@1/dev@6E",
                baselineValue: "<6000>"
              }
            ],
            artifactDigest: {
              sha256: "sha-art",
              onDeviceDigest: "32",
              integrityCheck: "byte-length"
            },
            kernelSignal: {
              command: "dmesg",
              captureStatus: "not-obtained",
              captureError: "HDC exited with 1.",
              rawText: null,
              truncated: false,
              matchedByParameter: [],
              excerpt: null
            },
            behaviouralVerification: null
          }
        })
      )
    });

    renderPage(failedRepo);
    await screen.findAllByText("Watchdog");
    await fillDeployFields(user);
    await setWatchdogDebugValue(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认部署" }));
    await waitFor(() => expect(screen.getByText(/未获得内核日志信号/)).toBeInTheDocument());
    expect(screen.getByText(/HDC exited with 1/)).toBeInTheDocument();
    expect(screen.getByText("不可验证的重载")).toBeInTheDocument();
  });

  it("shows residue bookkeeping copy and opens compensating restore confirmation", async () => {
    const user = userEvent.setup();
    const residue = {
      deviceId: "bridge:bridge-1",
      projectId: "project-1",
      sourceRunId: "run-residue",
      parameters: [
        {
          bindingId: "binding-1",
          propertyKey: "watchdog_time",
          nodePath: "/amba/i2c@1/dev@6E",
          baselineValue: "<6000>",
          debugValue: "<7000>"
        }
      ],
      recordedAt: "2026-08-10T00:00:00.000Z"
    };
    const repository = createRepository({
      getResidue: vi.fn(async () => residue)
    });

    renderPage(repository);
    await screen.findByLabelText("重载残留指示");
    expect(screen.getByLabelText("重载残留指示")).toHaveTextContent(/平台根据运行历史做的记账/);
    expect(screen.getByLabelText("重载残留指示")).toHaveTextContent(/无法从设备侧确认/);
    expect(screen.getByLabelText("重载残留指示")).toHaveTextContent(/重启、重新刷机/);
    expect(screen.getByLabelText("重载残留指示")).toHaveTextContent(/run-residue/);
    expect(screen.getByLabelText("重载残留指示")).toHaveTextContent(/watchdog_time/);

    await user.click(screen.getByRole("button", { name: /恢复基线（补偿性重载）/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/补偿性重载/);
    expect(dialog).toHaveTextContent(/不是撤销/);
    expect(dialog).toHaveTextContent(/无法卸载/);

    await user.click(within(dialog).getByRole("button", { name: "启动补偿性恢复" }));
    await waitFor(() => expect(repository.restoreBaseline).toHaveBeenCalledWith({
      projectId: "project-1",
      deviceId: "bridge:bridge-1"
    }));
    const deployDialog = await screen.findByRole("dialog");
    expect(deployDialog).toHaveTextContent(/补偿性恢复基线部署|补偿性重载/);
    expect(deployDialog).toHaveTextContent(/不是撤销/);
    expect(deployDialog).toHaveTextContent(/平台根据运行历史做的记账/);
  });

  it("shows run history and last-reload state; view-only users can open details but not start", async () => {
    const user = userEvent.setup();
    const historyRun = run({
      id: "run-history",
      status: "failed",
      purpose: "ordinary",
      failureCode: "transfer-failed"
    });
    const restoreHistory = run({
      id: "run-restore-history",
      status: "verified",
      purpose: "restore-baseline",
      restoresSourceRunId: "run-history"
    });
    const repository = createRepository({
      listCandidates: vi.fn(async () => ({
        items: [
          candidate({
            lastReload: {
              runId: "run-history",
              debugValue: "<7000>",
              attemptedAt: "2026-08-10T11:00:00.000Z",
              outcome: "failed",
              purpose: "ordinary"
            }
          })
        ]
      })),
      listRuns: vi.fn(async () => ({
        items: [
          {
            id: "run-restore-history",
            projectId: "project-1",
            deviceId: "bridge:bridge-1",
            status: "verified" as const,
            purpose: "restore-baseline" as const,
            failureCode: null,
            targetCount: 1,
            propertyKeys: ["watchdog_time"],
            artifact: { fileName: "debug-overlay-run-restore-history.dtbo", sha256: "sha", sizeBytes: 32 },
            integrityCheck: "sha256" as const,
            createdAt: "2026-08-10T12:00:00.000Z",
            completedAt: "2026-08-10T12:00:03.000Z"
          },
          {
            id: "run-history",
            projectId: "project-1",
            deviceId: "bridge:bridge-1",
            status: "failed" as const,
            purpose: "ordinary" as const,
            failureCode: "transfer-failed",
            targetCount: 1,
            propertyKeys: ["watchdog_time"],
            artifact: null,
            integrityCheck: null,
            createdAt: "2026-08-10T11:00:00.000Z",
            completedAt: "2026-08-10T11:00:02.000Z"
          },
          {
            id: "run-blocked",
            projectId: "project-1",
            deviceId: null,
            status: "blocked" as const,
            purpose: "ordinary" as const,
            failureCode: "preflight-failed",
            targetCount: 1,
            propertyKeys: ["watchdog_time"],
            artifact: null,
            integrityCheck: null,
            createdAt: "2026-08-10T10:00:00.000Z",
            completedAt: "2026-08-10T10:00:01.000Z"
          }
        ],
        nextCursor: null
      })),
      getRun: vi.fn(async (runId: string) => (runId === "run-restore-history" ? restoreHistory : historyRun))
    });

    renderPage(repository, { canStartRun: false });
    await screen.findByText("运行历史");
    expect(screen.getByText(/仅有调试查看权限/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下发参数/ })).toBeDisabled();
    expect(screen.queryByRole("columnheader", { name: "上次重载" })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /编辑 Watchdog/ }));
    const sheet = await screen.findByRole("dialog", { name: "Watchdog" });
    expect(within(sheet).getByRole("heading", { name: "上次重载" })).toBeInTheDocument();
    expect(within(sheet).getByText("<7000>")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "查看该次运行详情" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "取消" }));

    expect(screen.getAllByText(/恢复基线/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已阻断|部署失败/).length).toBeGreaterThan(0);

    const historyRegion = screen.getByLabelText("运行历史");
    const deviceFilter = within(historyRegion).getByRole("checkbox", { name: /仅显示当前设备的运行/ });
    await waitFor(() => expect(deviceFilter).toBeEnabled());
    expect(within(historyRegion).getByText(/仅当前设备（bridge:bridge-1）/)).toBeInTheDocument();

    vi.mocked(repository.listRuns).mockClear();
    await user.click(deviceFilter);
    await waitFor(() =>
      expect(repository.listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1", deviceId: "bridge:bridge-1", limit: 10 })
      )
    );

    await user.click(within(historyRegion).getByRole("button", { name: /恢复基线/ }));
    await waitFor(() => expect(repository.getRun).toHaveBeenCalledWith("run-restore-history"));
    const summary = await screen.findByLabelText("运行摘要");
    expect(within(summary).getByText("目的")).toBeInTheDocument();
    expect(within(summary).getByText(/恢复基线/)).toBeInTheDocument();
  });

  it("disables the device-only history filter until a device id is available", async () => {
    const repository = createRepository({
      listRuns: vi.fn(async () => ({ items: [], nextCursor: null }))
    });
    renderPage(repository, { bridges: [], canStartRun: true });
    await screen.findByText("运行历史");
    const historyRegion = screen.getByLabelText("运行历史");
    expect(within(historyRegion).getByRole("checkbox", { name: /仅显示当前设备的运行/ })).toBeDisabled();
    expect(within(historyRegion).getByText(/先填写设备 ID/)).toBeInTheDocument();
  });

  it("reuses LocalDeviceBridgePanel readiness states for unpaired, paired-offline, and connected", async () => {
    const repository = createRepository();
    const { rerender } = renderPage(repository, {
      bridges: [],
      probeBridgeHealth: async () => null,
      initialTargetRef: ""
    });
    expect(await screen.findByRole("region", { name: "本地设备连接" })).toBeInTheDocument();
    expect(await screen.findByText(/未检测到本地 Bridge/)).toBeInTheDocument();

    rerender(
      <DtsReloadPage
        projects={[{ id: "project-1", name: "Demo" }]}
        repository={repository}
        canStartRun
        bridges={[{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: null }]}
        probeBridgeHealth={async () => ({ connected: false, bridgeId: undefined })}
        initialTargetRef=""
        moduleRegistryRepository={null}
      />
    );
    expect(await screen.findByText(/Bridge 已配对，但尚未连接到服务器/)).toBeInTheDocument();

    rerender(
      <DtsReloadPage
        projects={[{ id: "project-1", name: "Demo" }]}
        repository={repository}
        canStartRun
        bridges={[{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: new Date().toISOString() }]}
        probeBridgeHealth={async () => ({ connected: true, bridgeId: "bridge-1" })}
        initialTargetRef=""
        moduleRegistryRepository={null}
      />
    );
    expect(await screen.findByText(/Bridge 在线，请插入 USB 设备/)).toBeInTheDocument();
  });

  it("does not treat recent lastSeen as connected when health probe reports offline", async () => {
    const repository = createRepository();
    renderPage(repository, {
      bridges: [{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: new Date().toISOString() }],
      probeBridgeHealth: async () => ({ connected: false, bridgeId: undefined }),
      initialTargetRef: ""
    });
    expect(await screen.findByText(/Bridge 已配对，但尚未连接到服务器/)).toBeInTheDocument();
    expect(screen.queryByText(/Bridge 在线/)).not.toBeInTheDocument();
  });

  it("does not mark a different bridge connected when health is bound to another id", async () => {
    const repository = createRepository();
    renderPage(repository, {
      bridges: [{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: new Date().toISOString() }],
      probeBridgeHealth: async () => ({ connected: true, bridgeId: "bridge-other" }),
      initialTargetRef: ""
    });
    // Pairing is stale relative to registered bridges → treat as not paired / reconnect.
    expect(await screen.findByText(/配对已失效|尚未配对|连接本机/)).toBeInTheDocument();
  });

  it("lists reachable targets from detectTargets for selection context", async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    renderPage(repository, {
      bridges: [{ id: "bridge-1", machineLabel: "Lab Mac", lastSeenAt: new Date().toISOString() }],
      probeBridgeHealth: async () => ({ connected: true, bridgeId: "bridge-1" }),
      initialTargetRef: "",
      detectTargets: async () => [
        { targetRef: "AURORA-001", label: "Lab Mac · AURORA-001", bridgeId: "bridge-1" },
        { targetRef: "AURORA-002", label: "Lab Mac · AURORA-002", bridgeId: "bridge-1" }
      ]
    });

    const targetList = await screen.findByLabelText("设备代理目标选择");
    expect(within(targetList).getByRole("button", { name: /AURORA-001/ })).toBeInTheDocument();
    await user.click(within(targetList).getByRole("button", { name: /AURORA-002/ }));
    expect(within(targetList).getByRole("button", { name: /AURORA-002/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("offers 沉淀为知识 on a terminal history run for knowledge editors and hands off to /knowledge", async () => {
    const user = userEvent.setup();
    const terminalRun = run({
      id: "run-terminal",
      status: "unverifiable",
      deviceId: "bridge:bridge-1",
      targetRef: "device-serial-1"
    });
    const repository = createRepository({
      getRun: vi.fn(async () => terminalRun)
    });
    const draftEntry = { id: "kb-entry-1" } as KnowledgeEntry;
    const knowledgeRepository = {
      distillFromReloadRun: vi.fn(async () => draftEntry)
    } as unknown as KnowledgeRepository;
    const capability: KnowledgeCapability = { userId: "u-1", canView: true, canEdit: true, canManage: false };
    const onNavigate = vi.fn();

    renderPage(repository, {
      knowledgeRepository,
      knowledgeCapability: capability,
      onNavigate,
      initialRunId: "run-terminal"
    });

    // The deep link opens the run detail, where the terminal run offers the affordance.
    await waitFor(() => expect(repository.getRun).toHaveBeenCalledWith("run-terminal"));
    const distilButton = await screen.findByRole("button", { name: "沉淀为知识" });
    await user.click(distilButton);

    await waitFor(() => expect(knowledgeRepository.distillFromReloadRun).toHaveBeenCalledWith("run-terminal"));
    expect(onNavigate).toHaveBeenCalledWith("/knowledge?entryId=kb-entry-1");
  });

  it("hides 沉淀为知识 for non-terminal runs and for users without knowledge:edit", async () => {
    const user = userEvent.setup();
    const knowledgeRepository = {
      distillFromReloadRun: vi.fn()
    } as unknown as KnowledgeRepository;
    const editorCapability: KnowledgeCapability = { userId: "u-1", canView: true, canEdit: true, canManage: false };
    const viewerCapability: KnowledgeCapability = { userId: "u-2", canView: true, canEdit: false, canManage: false };

    // Non-terminal (validated) run: no affordance even for editors.
    const { unmount } = renderPage(createRepository(), {
      knowledgeRepository,
      knowledgeCapability: editorCapability,
      onNavigate: vi.fn()
    });
    await screen.findAllByText("Watchdog");
    await setWatchdogDebugValue(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await screen.findByLabelText("产物与操作");
    expect(screen.queryByRole("button", { name: "沉淀为知识" })).not.toBeInTheDocument();
    unmount();

    // Terminal run but without knowledge:edit: no affordance.
    const terminalRepo = createRepository({
      getRun: vi.fn(async () => run({ id: "run-terminal", status: "failed", failureCode: "transfer-failed" }))
    });
    renderPage(terminalRepo, {
      knowledgeRepository,
      knowledgeCapability: viewerCapability,
      onNavigate: vi.fn(),
      initialRunId: "run-terminal"
    });
    await waitFor(() => expect(terminalRepo.getRun).toHaveBeenCalledWith("run-terminal"));
    await screen.findByLabelText("运行摘要");
    expect(screen.queryByRole("button", { name: "沉淀为知识" })).not.toBeInTheDocument();
  });

  it("offers 晋升为草稿 on a verified ordinary run and hands off to the workbench", async () => {
    const user = userEvent.setup();
    const verifiedRun = run({
      id: "run-verified",
      status: "verified",
      deviceId: "bridge:bridge-1",
      targetRef: "device-serial-1"
    });
    const repository = createRepository({
      getRun: vi.fn(async () => verifiedRun),
      promoteToDrafts: vi.fn(async () => ({
        runId: "run-verified",
        status: "verified" as const,
        drafts: [{ bindingId: "binding-1", draftId: "draft-1", outcome: "created" as const }],
        workbenchHref: "/parameters?project=project-1"
      }))
    });
    const onNavigate = vi.fn();

    renderPage(repository, {
      canPromoteToDrafts: true,
      onNavigate,
      initialRunId: "run-verified"
    });

    await waitFor(() => expect(repository.getRun).toHaveBeenCalledWith("run-verified"));
    await user.click(await screen.findByRole("button", { name: "晋升为草稿" }));

    await waitFor(() =>
      expect(repository.promoteToDrafts).toHaveBeenCalledWith({
        runId: "run-verified",
        bindingIds: ["binding-1"]
      })
    );
    expect(onNavigate).toHaveBeenCalledWith("/parameters?project=project-1");
  });

  it("asks for acknowledgement before promoting an unverifiable run", async () => {
    const user = userEvent.setup();
    const unverifiableRun = run({
      id: "run-unverifiable",
      status: "unverifiable"
    });
    const repository = createRepository({
      getRun: vi.fn(async () => unverifiableRun),
      promoteToDrafts: vi.fn(async () => ({
        runId: "run-unverifiable",
        status: "unverifiable" as const,
        drafts: [{ bindingId: "binding-1", draftId: "draft-1", outcome: "created" as const }],
        workbenchHref: "/parameters?project=project-1"
      }))
    });
    const onNavigate = vi.fn();

    renderPage(repository, {
      canPromoteToDrafts: true,
      onNavigate,
      initialRunId: "run-unverifiable"
    });

    await user.click(await screen.findByRole("button", { name: "晋升为草稿" }));
    const dialog = await screen.findByRole("dialog");
    expect(repository.promoteToDrafts).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: "晋升为草稿" });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(confirm);

    await waitFor(() =>
      expect(repository.promoteToDrafts).toHaveBeenCalledWith({
        runId: "run-unverifiable",
        bindingIds: ["binding-1"],
        unverifiableAcknowledged: true
      })
    );
    expect(onNavigate).toHaveBeenCalledWith("/parameters?project=project-1");
  });

  it("hides 晋升为草稿 for contradicted, failed, restore-baseline, and users without promote permission", async () => {
    const onNavigate = vi.fn();

    const { unmount } = renderPage(
      createRepository({
        getRun: vi.fn(async () => run({ id: "run-contradicted", status: "contradicted" }))
      }),
      { canPromoteToDrafts: true, onNavigate, initialRunId: "run-contradicted" }
    );
    await waitFor(() => expect(screen.getByLabelText("运行摘要")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "晋升为草稿" })).not.toBeInTheDocument();
    unmount();

    const failedRepo = createRepository({
      getRun: vi.fn(async () => run({ id: "run-failed", status: "failed", failureCode: "transfer-failed" }))
    });
    const failedView = renderPage(failedRepo, {
      canPromoteToDrafts: true,
      onNavigate,
      initialRunId: "run-failed"
    });
    await waitFor(() => expect(failedRepo.getRun).toHaveBeenCalledWith("run-failed"));
    expect(screen.queryByRole("button", { name: "晋升为草稿" })).not.toBeInTheDocument();
    failedView.unmount();

    const restoreRepo = createRepository({
      getRun: vi.fn(async () =>
        run({ id: "run-restore", status: "verified", purpose: "restore-baseline" })
      )
    });
    const restoreView = renderPage(restoreRepo, {
      canPromoteToDrafts: true,
      onNavigate,
      initialRunId: "run-restore"
    });
    await waitFor(() => expect(restoreRepo.getRun).toHaveBeenCalledWith("run-restore"));
    expect(screen.queryByRole("button", { name: "晋升为草稿" })).not.toBeInTheDocument();
    restoreView.unmount();

    const verifiedRepo = createRepository({
      getRun: vi.fn(async () => run({ id: "run-verified", status: "verified" }))
    });
    renderPage(verifiedRepo, { canPromoteToDrafts: false, onNavigate, initialRunId: "run-verified" });
    await waitFor(() => expect(verifiedRepo.getRun).toHaveBeenCalledWith("run-verified"));
    expect(screen.queryByRole("button", { name: "晋升为草稿" })).not.toBeInTheDocument();
  });

  it("surfaces a promotion failure without navigating away", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      getRun: vi.fn(async () => run({ id: "run-verified", status: "verified" })),
      promoteToDrafts: vi.fn(async () => {
        throw new Error("该参数已有未提交草稿");
      })
    });
    const onNavigate = vi.fn();

    renderPage(repository, {
      canPromoteToDrafts: true,
      onNavigate,
      initialRunId: "run-verified"
    });

    await user.click(await screen.findByRole("button", { name: "晋升为草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/晋升为草稿失败:该参数已有未提交草稿/);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("surfaces a distillation failure without navigating away", async () => {
    const user = userEvent.setup();
    const repository = createRepository({
      getRun: vi.fn(async () => run({ id: "run-terminal", status: "contradicted" }))
    });
    const knowledgeRepository = {
      distillFromReloadRun: vi.fn(async () => {
        throw new Error("重载运行不可读");
      })
    } as unknown as KnowledgeRepository;
    const onNavigate = vi.fn();

    renderPage(repository, {
      knowledgeRepository,
      knowledgeCapability: { userId: "u-1", canView: true, canEdit: true, canManage: false },
      onNavigate,
      initialRunId: "run-terminal"
    });

    await user.click(await screen.findByRole("button", { name: "沉淀为知识" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/沉淀为知识失败:重载运行不可读/);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("renders a navigable upgrade control when deploy fails with bridge-upgrade-required", async () => {
    const user = userEvent.setup();
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createRepository({
      deployRun: vi.fn(async () => {
        throw new WiseEffApiError(
          "VALIDATION_FAILED",
          "Device bridge is missing required RPC methods. Upgrade from /api/v1/device-bridges/releases.",
          {
            code: "bridge-upgrade-required",
            releasesPath: "/api/v1/device-bridges/releases"
          },
          "req-upgrade"
        );
      })
    });
    renderPage(repository);
    await screen.findAllByText("Watchdog");
    await fillDeployFields(user);
    await setWatchdogDebugValue(user);
    await user.click(screen.getByRole("button", { name: /下发参数/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "确认部署" }));
    const upgradeLink = await screen.findByRole("link", { name: /下载或升级 Bridge/ });
    expect(upgradeLink).toHaveAttribute("href", "/node-debugging");
    expect(within(dialog).getByText("/api/v1/device-bridges/releases")).toBeInTheDocument();
  });
});
