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
    expect(within(memberList).getByText("overlay")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移除 engine.dts" }));

    await waitFor(() => expect(repository.removeConfigSetFile).toHaveBeenCalledWith(PROJECT_ID, "cs-1", "file-1"));
    expect(within(memberList).queryByText("engine.dts")).not.toBeInTheDocument();
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
      expect(repository.createBaseline).toHaveBeenCalledWith(PROJECT_ID, "cs-1", { name: "v2-draft" })
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

    await waitFor(() => expect(repository.releaseBaseline).toHaveBeenCalledWith(PROJECT_ID, "bl-1"));
    const gateRegion = await screen.findByRole("status", { name: "校验门禁结果" });
    expect(within(gateRegion).getByText(/mode:\s*block/i)).toBeInTheDocument();
    expect(within(gateRegion).getByText(/requiresConfirmation:\s*false/i)).toBeInTheDocument();
    expect(within(gateRegion).getByText("dtc failed")).toBeInTheDocument();
  });

  it("shows warn gate requiresConfirmation when release returns warn", async () => {
    const repository = createRepository({
      releaseBaseline: vi.fn().mockResolvedValue({
        item: baseline({ status: "released" }),
        gate: gate({
          ok: true,
          mode: "warn",
          requiresConfirmation: true,
          diagnostics: [{ severity: "warning", message: "dtc unavailable" }]
        })
      })
    });
    await renderPanel(repository);

    fireEvent.click(screen.getByRole("button", { name: "选择 board-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "发布 v1-draft" }));

    const gateRegion = await screen.findByRole("status", { name: "校验门禁结果" });
    expect(within(gateRegion).getByText(/mode:\s*warn/i)).toBeInTheDocument();
    expect(within(gateRegion).getByText(/requiresConfirmation:\s*true/i)).toBeInTheDocument();
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

