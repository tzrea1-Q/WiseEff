import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { DtsReloadPage } from "./DtsReloadPage";
import { getRequiredRoleForPage } from "@/app/permissions";

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
    steps: [],
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
    getRun: vi.fn(async () => run()),
    downloadArtifact: vi.fn(async () => new Blob([Uint8Array.from([1, 2, 3])])),
    getReloadConfiguration: vi.fn(),
    updateOrganisationReloadConfiguration: vi.fn(),
    upsertDeviceReloadConfiguration: vi.fn(),
    deleteDeviceReloadConfiguration: vi.fn(),
    ...overrides
  };
}

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
    const createObjectURL = vi.fn(() => "blob:overlay");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    render(
      <DtsReloadPage projects={[{ id: "project-1", name: "Demo" }]} repository={repository} canStartRun />
    );

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

    render(
      <DtsReloadPage projects={[{ id: "project-1", name: "Demo" }]} repository={repository} canStartRun />
    );

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

    render(
      <DtsReloadPage projects={[{ id: "project-1", name: "Demo" }]} repository={repository} canStartRun />
    );

    expect(await screen.findAllByText("敏感 · critical")).not.toHaveLength(0);
    expect(screen.getAllByText("敏感 · high").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/parameter:edit-critical/).length).toBeGreaterThan(0);

    const startButton = screen.getByRole("button", { name: /启动重载运行/ });
    expect(startButton).toBeDisabled();

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
  });
});
