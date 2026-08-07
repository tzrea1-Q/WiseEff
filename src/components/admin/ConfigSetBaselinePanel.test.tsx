import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DtsCompareBaselineResult,
  DtsConfigSet,
  DtsExportConfigSetResult,
  DtsReleaseBaseline,
  DtsReleaseBaselineResult,
  DtsStructuredRepository,
  DtsValidationGateResult
} from "@/application/ports/DtsStructuredRepository";
import { ConfigSetBaselinePanel } from "./ConfigSetBaselinePanel";

const PROJECT_ID = "project-atlas";

function configSet(overrides: Partial<DtsConfigSet> = {}): DtsConfigSet {
  return {
    id: "cs-1",
    organizationId: "org-1",
    projectId: PROJECT_ID,
    name: "board-a",
    description: "A board",
    createdAt: "2026-07-14T08:00:00.000Z",
    updatedAt: "2026-07-14T08:00:00.000Z",
    ...overrides
  };
}

function baseline(overrides: Partial<DtsReleaseBaseline> = {}): DtsReleaseBaseline {
  return {
    id: "bl-1",
    organizationId: "org-1",
    configSetId: "cs-1",
    name: "v1-draft",
    status: "draft",
    createdAt: "2026-07-14T09:00:00.000Z",
    ...overrides
  };
}

function gate(overrides: Partial<DtsValidationGateResult> = {}): DtsValidationGateResult {
  return {
    ok: true,
    mode: "block",
    requiresConfirmation: false,
    diagnostics: [],
    compiler: "dtc",
    ...overrides
  };
}

function exportResult(): DtsExportConfigSetResult {
  return {
    manifest: {
      configSetId: "cs-1",
      name: "board-a",
      projectId: PROJECT_ID,
      exportedAt: "2026-07-14T10:00:00.000Z",
      members: []
    },
    files: [{ name: "board.dts", format: "dts", content: "/dts-v1/;\n" }]
  };
}

function createRepository(overrides: Partial<DtsStructuredRepository> = {}): DtsStructuredRepository {
  return {
    getStructure: vi.fn(),
    search: vi.fn(),
    listConfigSets: vi.fn().mockResolvedValue([configSet()]),
    createConfigSet: vi.fn().mockResolvedValue(configSet({ id: "cs-new", name: "board-b" })),
    addConfigSetFile: vi.fn().mockImplementation(async (_projectId, configSetId, input) => ({
      configSetId,
      fileId: input.fileId,
      role: input.role,
      sortOrder: input.sortOrder ?? 0
    })),
    removeConfigSetFile: vi.fn().mockResolvedValue(undefined),
    listBaselines: vi.fn().mockResolvedValue([baseline()]),
    getReleaseReadiness: vi.fn().mockResolvedValue({
      available: true,
      level: "ready",
      blockers: [],
      warnings: [],
      gateToken: "gate-token-1",
      evaluatedAt: "2026-08-07T00:00:00.000Z",
      configSetId: "cs-1",
      projectId: PROJECT_ID,
      canCreateBaseline: true,
      canRelease: true
    }),
    createBaseline: vi.fn().mockResolvedValue(baseline({ id: "bl-new", name: "v2-draft" })),
    compareBaseline: vi.fn(),
    rollbackBaseline: vi.fn(),
    releaseBaseline: vi.fn().mockResolvedValue({
      item: baseline({ status: "released" }),
      gate: gate()
    } satisfies DtsReleaseBaselineResult),
    exportConfigSet: vi.fn().mockResolvedValue(exportResult()),
    submitStructuredEdits: vi.fn(),
    ...overrides
  };
}

async function renderPanel(
  repository = createRepository(),
  props: Partial<{ canAdmin: boolean; availableFiles: { id: string; fileName: string }[] }> = {}
) {
  render(
    <ConfigSetBaselinePanel
      projectId={PROJECT_ID}
      repository={repository}
      canAdmin={props.canAdmin ?? true}
      availableFiles={props.availableFiles ?? [{ id: "file-1", fileName: "engine.dts" }]}
    />
  );
  await screen.findByRole("region", { name: "配置集 / 基线" });
  return repository;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConfigSetBaselinePanel", () => {
  it("lists config sets from the injected repository", async () => {
    await renderPanel(createRepository({ listConfigSets: vi.fn().mockResolvedValue([configSet({ name: "board-a" })]) }));

    expect(screen.getByText("board-a")).toBeInTheDocument();
  });

  it("creates a config set through the repository", async () => {
    const repository = createRepository({
      listConfigSets: vi.fn().mockResolvedValue([]),
      createConfigSet: vi.fn().mockResolvedValue(configSet({ id: "cs-new", name: "board-new" }))
    });
    await renderPanel(repository);

    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "board-new" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));

    await waitFor(() =>
      expect(repository.createConfigSet).toHaveBeenCalledWith(PROJECT_ID, { name: "board-new" })
    );
    expect(await screen.findByText("board-new")).toBeInTheDocument();
  });

  it("adds and removes config set members with roles kept in local state", async () => {
    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));

    fireEvent.change(screen.getByLabelText("成员文件"), { target: { value: "file-1" } });
    fireEvent.change(screen.getByLabelText("成员角色"), { target: { value: "overlay" } });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));

    await waitFor(() =>
      expect(repository.addConfigSetFile).toHaveBeenCalledWith(PROJECT_ID, "cs-1", {
        fileId: "file-1",
        role: "overlay"
      })
    );
    const memberList = screen.getByRole("list", { name: "配置集成员" });
    expect(await within(memberList).findByText("engine.dts")).toBeInTheDocument();
    expect(within(memberList).getByText("覆盖层")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移除 engine.dts" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "移除配置集成员" });
    expect(repository.removeConfigSetFile).not.toHaveBeenCalled();
    expect(confirmDialog).toHaveTextContent(/engine\.dts/);
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认移除" }));

    await waitFor(() => expect(repository.removeConfigSetFile).toHaveBeenCalledWith(PROJECT_ID, "cs-1", "file-1"));
    expect(within(memberList).queryByText("engine.dts")).not.toBeInTheDocument();
  });

  it("abandons a member removal when the confirmation is cancelled", async () => {
    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.change(screen.getByLabelText("成员文件"), { target: { value: "file-1" } });
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const memberList = await screen.findByRole("list", { name: "配置集成员" });
    await within(memberList).findByText("engine.dts");

    fireEvent.click(screen.getByRole("button", { name: "移除 engine.dts" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "移除配置集成员" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "移除配置集成员" })).not.toBeInTheDocument()
    );
    expect(repository.removeConfigSetFile).not.toHaveBeenCalled();
    expect(within(memberList).getByText("engine.dts")).toBeInTheDocument();
  });

  it("reports an empty config set name instead of doing nothing", async () => {
    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写配置集名称。");
    expect(screen.getByLabelText("配置集名称")).toHaveAttribute("aria-invalid", "true");
    expect(repository.createConfigSet).not.toHaveBeenCalled();
  });

  it("rejects a config set name that already exists", async () => {
    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "board-a" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已存在名为「board-a」的配置集。");
    expect(repository.createConfigSet).not.toHaveBeenCalled();
  });

  it("reports an empty baseline name instead of doing nothing", async () => {
    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "创建基线" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写基线名称。");
    expect(repository.createBaseline).not.toHaveBeenCalled();
  });

  it("lists and creates baselines for the selected config set", async () => {
    const repository = createRepository({
      listBaselines: vi.fn().mockResolvedValue([baseline({ name: "v1-draft" })]),
      createBaseline: vi.fn().mockResolvedValue(baseline({ id: "bl-2", name: "v2-draft" }))
    });
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));

    expect(await screen.findByText("v1-draft")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("基线名称"), { target: { value: "v2-draft" } });
    fireEvent.click(screen.getByRole("button", { name: "创建基线" }));

    await waitFor(() =>
      expect(repository.createBaseline).toHaveBeenCalledWith(PROJECT_ID, "cs-1", {
        name: "v2-draft",
        gateToken: "gate-token-1"
      })
    );
    expect(await screen.findByText("v2-draft")).toBeInTheDocument();
  });

  it("releases a baseline and shows block gate result", async () => {
    const repository = createRepository({
      releaseBaseline: vi.fn().mockResolvedValue({
        item: baseline({ status: "draft" }),
        gate: gate({
          ok: false,
          mode: "block",
          requiresConfirmation: false,
          diagnostics: [{ severity: "error", message: "dtc failed" }]
        })
      })
    });
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    expect(await screen.findByText("v1-draft")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "发布 v1-draft" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "发布基线" });
    expect(repository.releaseBaseline).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() =>
      expect(repository.releaseBaseline).toHaveBeenCalledWith(PROJECT_ID, "bl-1", {
        gateToken: "gate-token-1"
      })
    );
    const gateRegion = await screen.findByRole("status", { name: "校验门禁结果" });
    expect(gateRegion).toHaveAttribute("data-ok", "false");
    expect(within(gateRegion).getByText(/修订校验未通过/)).toBeInTheDocument();
    expect(within(gateRegion).getByText(/门禁：阻断发布/)).toBeInTheDocument();
    expect(within(gateRegion).getByText("dtc failed")).toBeInTheDocument();
    expect(within(gateRegion).getByText("错误")).toBeInTheDocument();
    // The gate stopped leaking its own field names into the UI.
    expect(within(gateRegion).queryByText(/requiresConfirmation/)).not.toBeInTheDocument();
  });

  it("blocks a release behind an explicit acknowledgement when the gate requires confirmation", async () => {
    const repository = createRepository();
    const onAudit = vi.fn();
    render(
      <ConfigSetBaselinePanel
        projectId={PROJECT_ID}
        repository={repository}
        canAdmin
        availableFiles={[{ id: "file-1", fileName: "engine.dts" }]}
        revisionId="revision-7"
        onAudit={onAudit}
        validateRevision={vi.fn().mockResolvedValue({
          id: "run-1",
          status: "failed",
          stage: "toolchain",
          diagnostics: [
            { path: "board.dts", startLine: 12, severity: "error", message: "overlay overlap" },
            { severity: "warning", message: "unused label power" }
          ]
        })}
      />
    );
    await screen.findByRole("region", { name: "配置集 / 基线" });

    fireEvent.click(screen.getByRole("button", { name: "校验修订" }));
    const gateRegion = await screen.findByRole("status", { name: "校验门禁结果" });
    expect(within(gateRegion).getByText(/需要人工确认风险/)).toBeInTheDocument();
    expect(within(gateRegion).getByText("overlay overlap")).toBeInTheDocument();
    expect(within(gateRegion).getByText("board.dts:12")).toBeInTheDocument();
    expect(within(gateRegion).getByText("unused label power")).toBeInTheDocument();
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "revision-validated", summary: expect.stringContaining("revision-7") })
    );

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "发布 v1-draft" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "发布基线" });
    const confirm = within(confirmDialog).getByRole("button", { name: "确认发布" });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(confirmDialog).getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(repository.releaseBaseline).toHaveBeenCalledWith(PROJECT_ID, "bl-1", {
        gateToken: "gate-token-1"
      })
    );
  });

  it("confirms a rollback and states that it overwrites later changes", async () => {
    const repository = createRepository({
      listBaselines: vi.fn().mockResolvedValue([baseline({ status: "released" })]),
      rollbackBaseline: vi.fn().mockResolvedValue({ restored: 4 })
    });
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "回滚 v1-draft" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "回滚基线" });
    expect(confirmDialog).toHaveTextContent(/不可撤销/);
    expect(repository.rollbackBaseline).not.toHaveBeenCalled();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认回滚" }));
    await waitFor(() => expect(repository.rollbackBaseline).toHaveBeenCalledWith(PROJECT_ID, "bl-1"));
  });

  it("exposes an export download entry that calls exportConfigSet", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const repository = createRepository();
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(screen.getByRole("button", { name: "导出配置集" }));

    await waitFor(() => expect(repository.exportConfigSet).toHaveBeenCalledWith(PROJECT_ID, "cs-1"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it("hides interactive admin controls when canAdmin is false", async () => {
    await renderPanel(createRepository(), { canAdmin: false });

    expect(screen.queryByRole("button", { name: "创建配置集" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("配置集名称")).not.toBeInTheDocument();
    expect(screen.getByText("board-a")).toBeInTheDocument();
    expect(screen.getByText(/仅管理员可管理配置集与基线/)).toBeInTheDocument();
  });

  it("compares a baseline and renders StructuredDiffView from compareBaseline result", async () => {
    const comparison: DtsCompareBaselineResult = {
      baselineId: "bl-1",
      members: [
        {
          fileId: "file-1",
          fileName: "engine.dts",
          status: "version_changed",
          structuralDiff: [
            {
              kind: "prop_changed",
              nodePath: "demo_integer",
              prop: "single_value",
              before: "<42>",
              after: "<43>"
            }
          ]
        }
      ]
    };
    const repository = createRepository({
      compareBaseline: vi.fn().mockResolvedValue(comparison)
    });
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "对比 v1-draft" }));

    await waitFor(() => expect(repository.compareBaseline).toHaveBeenCalledWith(PROJECT_ID, "bl-1"));
    const diffRegion = await screen.findByRole("region", { name: /结构化差异/i });
    expect(within(diffRegion).getByText("engine.dts")).toBeInTheDocument();
    expect(within(diffRegion).getByText(/属性变更/)).toBeInTheDocument();
    expect(within(diffRegion).getByText("<43>")).toBeInTheDocument();
  });
});

