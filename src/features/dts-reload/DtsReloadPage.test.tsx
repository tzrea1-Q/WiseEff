import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { DTS_RELOAD_CONFIRMATION_TOKEN } from "@/domain/dtsReload/types";
import { DtsReloadPage } from "./DtsReloadPage";
import { getRequiredRoleForPage } from "@/app/permissions";

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
    valueShapeKind: "cells",
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
    getReloadConfiguration: vi.fn(),
    updateOrganisationReloadConfiguration: vi.fn(),
    upsertDeviceReloadConfiguration: vi.fn(),
    deleteDeviceReloadConfiguration: vi.fn(),
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
      {...overrides}
    />
  );
}

async function fillDeployFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("目标标识 targetRef"), "device-serial-1");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DtsReloadPage", () => {
  it("requires committer role for the page", () => {
    expect(getRequiredRoleForPage("dts-reload")).toBe("hardware-committer");
  });

  it("renders a static unavailable state when no repository is injected", () => {
    render(
      <DtsReloadPage projects={[{ id: "project-1", name: "Demo" }]} repository={null} canStartRun={false} />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/仅在 API 模式下可用/);
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
            constraints: {}
          }),
          candidate({
            bindingId: "binding-blocked",
            displayName: "Blocked",
            nodePath: "/amba",
            debuggable: false,
            blockReason: "synthesised-anchor"
          })
        ]
      }))
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:overlay");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    renderPage(repository);

    expect((await screen.findAllByText("Watchdog")).length).toBeGreaterThan(0);
    expect(screen.getByText(/合成 \/label 锚点/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("按模块筛选"), "uart");
    expect(screen.queryByRole("checkbox", { name: "选择 Watchdog" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 Compatible" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("按模块筛选"), "");

    await user.type(screen.getByLabelText("按名称搜索参数"), "Watch");
    expect(screen.getByRole("checkbox", { name: "选择 Watchdog" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "选择 Compatible" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("按名称搜索参数"));

    await user.click(screen.getByLabelText("选择 Compatible"));
    expect(screen.getByText(/已选 2 个参数/)).toBeInTheDocument();

    const watchdogInput = screen.getByLabelText("Watchdog 调试值");
    await user.clear(watchdogInput);
    await user.type(watchdogInput, "<99999>");
    await fillDeployFields(user);
    await user.click(screen.getByRole("button", { name: /启动重载运行/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/最大值/);
    expect(repository.startRun).not.toHaveBeenCalled();

    await user.clear(watchdogInput);
    await user.type(watchdogInput, "<7000>");
    const compatibleInput = screen.getByLabelText("Compatible 调试值");
    await user.clear(compatibleInput);
    await user.type(compatibleInput, '"sc8562", "sc8562-v2"');
    await user.click(screen.getByRole("button", { name: /启动重载运行/ }));

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
    expect(screen.getByText(/已选 0 个参数/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText(/u32 cell 数组与字符串列表/)).toBeInTheDocument();
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

    expect(await screen.findAllByText("敏感 · critical")).not.toHaveLength(0);
    expect(screen.getAllByText("敏感 · high").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/parameter:edit-critical/).length).toBeGreaterThan(0);

    const startButton = screen.getByRole("button", { name: /启动重载运行/ });
    expect(startButton).toBeDisabled();

    await fillDeployFields(user);
    await user.click(screen.getByLabelText("确认 critical 敏感节点重载"));
    expect(startButton).toBeEnabled();
    await user.click(startButton);

    await waitFor(() =>
      expect(repository.startRun).toHaveBeenCalledWith({
        projectId: "project-1",
        targets: [{ bindingId: "binding-1", debugValue: "<6000>" }],
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
    await user.click(screen.getByRole("button", { name: /启动重载运行/ }));

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
    await user.click(screen.getByRole("button", { name: /启动重载运行/ }));
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
    await user.click(screen.getByRole("button", { name: /启动重载运行/ }));
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
});
