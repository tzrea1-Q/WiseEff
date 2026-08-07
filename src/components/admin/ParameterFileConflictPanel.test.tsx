import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ParameterFileRepository, ParameterFileSyncConflict } from "@/application/ports/ParameterFileRepository";
import { ParameterFileConflictPanel } from "./ParameterFileConflictPanel";

const createParameterFileClient = vi.fn();

vi.mock("@/infrastructure/http/parameterFileClient", () => ({
  createParameterFileClient: (...args: unknown[]) => createParameterFileClient(...args)
}));

function createStubRepository(overrides: Partial<ParameterFileRepository> = {}): ParameterFileRepository {
  return {
    listFiles: vi.fn().mockResolvedValue([]),
    uploadFile: vi.fn(),
    uploadVersion: vi.fn(),
    listVersions: vi.fn().mockResolvedValue([]),
    downloadVersion: vi.fn(),
    syncFile: vi.fn(),
    listConflicts: vi.fn().mockResolvedValue([]),
    resolveConflict: vi.fn(),
    previewBulkConflictResolution: vi.fn(),
    resolveConflictsBulk: vi.fn(),
    ...overrides
  } as ParameterFileRepository;
}

function openConflict(
  overrides: Partial<ParameterFileSyncConflict> = {}
): ParameterFileSyncConflict {
  return {
    id: "conflict-9",
    organizationId: "org-1",
    projectId: "atlas",
    projectParameterValueId: "value-9",
    parameterDefinitionId: "def-thermal-target",
    parameterName: "thermal_target_c",
    parameterModule: "Thermal",
    fileVersionId: "version-9",
    fileDraftId: "file-draft-9",
    uiDraftId: "ui-draft-9",
    fileValue: "44",
    uiDraftValue: "46",
    status: "open",
    createdAt: "2026-07-11T11:05:00.000Z",
    ...overrides
  };
}

describe("ParameterFileConflictPanel", () => {
  it("does not refetch when an unstable onOpenConflictCountChange identity changes", async () => {
    const listConflicts = vi.fn().mockResolvedValue([]);
    const repository = createStubRepository({ listConflicts });
    const onOpenConflictCountChange = vi.fn();

    const { rerender } = render(
      <ParameterFileConflictPanel
        open
        variant="embedded"
        projectId="atlas"
        repository={repository}
        onClose={vi.fn()}
        onOpenConflictCountChange={onOpenConflictCountChange}
      />
    );

    expect(await screen.findByText("当前项目没有待处理冲突。")).toBeInTheDocument();
    expect(listConflicts).toHaveBeenCalledTimes(1);
    expect(onOpenConflictCountChange).toHaveBeenCalledWith(0);

    rerender(
      <ParameterFileConflictPanel
        open
        variant="embedded"
        projectId="atlas"
        repository={repository}
        onClose={vi.fn()}
        onOpenConflictCountChange={() => onOpenConflictCountChange(0)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("当前项目没有待处理冲突。")).toBeInTheDocument();
    });
    expect(listConflicts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("冲突列表加载中…")).not.toBeInTheDocument();
  });

  it("shows loading before empty state while conflicts are still fetching", async () => {
    let resolveList: (value: ParameterFileSyncConflict[]) => void = () => undefined;
    const listConflicts = vi.fn(
      () =>
        new Promise<ParameterFileSyncConflict[]>((resolve) => {
          resolveList = resolve;
        })
    );
    const repository = createStubRepository({ listConflicts });

    render(
      <ParameterFileConflictPanel
        open
        variant="embedded"
        projectId="atlas"
        repository={repository}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("冲突列表加载中…")).toBeInTheDocument();
    expect(screen.queryByText("当前项目没有待处理冲突。")).not.toBeInTheDocument();

    resolveList([]);
    expect(await screen.findByText("当前项目没有待处理冲突。")).toBeInTheDocument();
    expect(screen.queryByText("冲突列表加载中…")).not.toBeInTheDocument();
  });

  it("renders open conflicts from the injected repository without HTTP client", async () => {
    const repository = createStubRepository({
      listConflicts: vi.fn().mockResolvedValue([
        {
          id: "conflict-1",
          organizationId: "org-1",
          projectId: "atlas",
          projectParameterValueId: "value-1",
          parameterDefinitionId: "def-fast-charge-current",
          parameterName: "fast_charge_current_limit_ma",
          parameterModule: "Charging Policy",
          fileVersionId: "version-1",
          fileDraftId: "file-draft-1",
          uiDraftId: "ui-draft-1",
          fileValue: "3200",
          uiDraftValue: "3400",
          status: "open",
          createdAt: "2026-07-11T11:00:00.000Z"
        },
        {
          id: "conflict-2",
          organizationId: "org-1",
          projectId: "atlas",
          projectParameterValueId: "value-2",
          parameterDefinitionId: "def-battery-temp-target",
          fileVersionId: "version-1",
          fileDraftId: "file-draft-2",
          uiDraftId: "ui-draft-2",
          fileValue: "35",
          uiDraftValue: "36",
          status: "open",
          createdAt: "2026-07-11T11:01:00.000Z"
        }
      ])
    });

    render(
      <ParameterFileConflictPanel open projectId="atlas" repository={repository} onClose={vi.fn()} />
    );

    expect(await screen.findByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("def-battery-temp-target")).toBeInTheDocument();
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();
    expect(screen.getByText("3200")).toBeInTheDocument();
    expect(screen.getByText("3400")).toBeInTheDocument();
    expect(createParameterFileClient).not.toHaveBeenCalled();
  });

  it("resolves conflict by keeping file value via the injected repository", async () => {
    const repository = createStubRepository({
      listConflicts: vi.fn().mockResolvedValue([
        {
          id: "conflict-3",
          organizationId: "org-1",
          projectId: "atlas",
          projectParameterValueId: "value-3",
          parameterDefinitionId: "def-limit",
          fileVersionId: "version-1",
          fileDraftId: "file-draft-3",
          uiDraftId: "ui-draft-3",
          fileValue: "1",
          uiDraftValue: "2",
          status: "open",
          createdAt: "2026-07-11T11:02:00.000Z"
        }
      ]),
      resolveConflict: vi.fn().mockResolvedValue({
        id: "conflict-3",
        organizationId: "org-1",
        projectId: "atlas",
        projectParameterValueId: "value-3",
        parameterDefinitionId: "def-limit",
        fileVersionId: "version-1",
        fileDraftId: "file-draft-3",
        uiDraftId: "ui-draft-3",
        fileValue: "1",
        uiDraftValue: "2",
        status: "resolved_file",
        createdAt: "2026-07-11T11:02:00.000Z"
      })
    });

    render(
      <ParameterFileConflictPanel open projectId="atlas" repository={repository} onClose={vi.fn()} />
    );

    await screen.findByText("def-limit");
    fireEvent.click(screen.getByRole("button", { name: "保留文件值" }));

    // Arbitration discards the other side irreversibly, so it goes through a confirmation.
    const confirmDialog = await screen.findByRole("dialog", { name: "保留文件值" });
    expect(repository.resolveConflict).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认裁决" }));

    await waitFor(() => {
      expect(repository.resolveConflict).toHaveBeenCalledWith("atlas", "conflict-3", { resolution: "file" });
    });
    expect(createParameterFileClient).not.toHaveBeenCalled();
  });

  it("gives both arbitration options equal emphasis", async () => {
    const repository = createStubRepository({
      listConflicts: vi.fn().mockResolvedValue([openConflict()])
    });

    render(
      <ParameterFileConflictPanel open projectId="atlas" repository={repository} onClose={vi.fn()} />
    );

    const keepFile = await screen.findByRole("button", { name: "保留文件值" });
    const keepUi = screen.getByRole("button", { name: "保留界面值" });

    // Neither side is recommended; both discard the other irreversibly.
    expect(keepFile.className).toBe(keepUi.className);
    expect(keepUi).not.toHaveClass("primary");
  });

  it("shows when the conflict appeared and which file version it came from", async () => {
    const repository = createStubRepository({
      listConflicts: vi.fn().mockResolvedValue([openConflict()])
    });

    render(
      <ParameterFileConflictPanel open projectId="atlas" repository={repository} onClose={vi.fn()} />
    );

    expect(await screen.findByText("出现时间")).toBeInTheDocument();
    expect(screen.getByText("来源文件版本")).toBeInTheDocument();
    expect(screen.getByText("version-9")).toBeInTheDocument();
  });

  it("captures an arbitration reason for the audit record", async () => {
    const onResolved = vi.fn();
    const repository = createStubRepository({
      listConflicts: vi.fn().mockResolvedValue([openConflict()]),
      resolveConflict: vi.fn().mockResolvedValue(openConflict({ status: "resolved_ui" }))
    });

    render(
      <ParameterFileConflictPanel
        open
        projectId="atlas"
        repository={repository}
        onClose={vi.fn()}
        onResolved={onResolved}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "保留界面值" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "保留界面值" });
    fireEvent.change(within(confirmDialog).getByRole("textbox"), {
      target: { value: "以硬件实测值为准" }
    });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认裁决" }));

    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: "ui", reason: "以硬件实测值为准" })
      )
    );
    expect(repository.resolveConflict).toHaveBeenCalledWith("atlas", "conflict-9", {
      resolution: "ui",
      reason: "以硬件实测值为准"
    });
  });
});
