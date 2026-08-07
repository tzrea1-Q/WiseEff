import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  ParameterFileConflictBulkPreview,
  ParameterFileRepository,
  ParameterFileSyncConflict
} from "@/application/ports/ParameterFileRepository";
import { WorkbenchConflictArbitrationDock } from "./WorkbenchConflictArbitrationDock";

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
    listCandidates: vi.fn().mockResolvedValue([]),
    createCandidate: vi.fn(),
    getCandidate: vi.fn(),
    getCandidateImpact: vi.fn(),
    downloadCandidate: vi.fn(),
    abandonCandidate: vi.fn(),
    recomputeCandidate: vi.fn(),
    activateCandidate: vi.fn(),
    ...overrides
  } as ParameterFileRepository;
}

function openConflict(overrides: Partial<ParameterFileSyncConflict> = {}): ParameterFileSyncConflict {
  return {
    id: "conflict-1",
    organizationId: "org-1",
    projectId: "aurora",
    projectParameterValueId: "ppv-1",
    parameterDefinitionId: "def-model",
    parameterName: "model",
    parameterModule: "Board",
    fileVersionId: "version-12",
    fileDraftId: "fd-1",
    uiDraftId: "ud-1",
    fileValue: "Aurora",
    uiDraftValue: "Other",
    baseValue: "Legacy",
    status: "open",
    createdAt: "2026-08-07T12:00:00.000Z",
    fileVersionLabel: "v12",
    fileVersionCreatedAt: "2026-08-07T11:00:00.000Z",
    uiDraftUpdatedAt: "2026-08-07T11:30:00.000Z",
    fileId: "file-board",
    fileName: "aurora-board.dts",
    configSetId: "cs-default",
    nodePath: "board",
    propertyName: "model",
    ...overrides
  };
}

describe("WorkbenchConflictArbitrationDock", () => {
  it("returns null when there are no open conflicts", () => {
    const { container } = render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository()}
        conflicts={[]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders three-way values with equal-weight outcome buttons", () => {
    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository()}
        conflicts={[openConflict()]}
      />
    );

    expect(screen.getByText("基线值")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText("文件值")).toBeInTheDocument();
    expect(screen.getByText("Aurora")).toBeInTheDocument();
    expect(screen.getByText("界面草稿值")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("v12")).toBeInTheDocument();
    expect(screen.getAllByText("aurora-board.dts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("model").length).toBeGreaterThan(0);
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /冲突仲裁/ })).toBeInTheDocument();

    const useFile = screen.getByRole("button", { name: "使用文件值" });
    const keepUi = screen.getByRole("button", { name: "保留界面值" });
    expect(useFile.className).toBe(keepUi.className);
    expect(useFile).not.toHaveClass("primary");
    expect(keepUi).not.toHaveClass("primary");
    expect(useFile).not.toHaveClass("button-primary");
    expect(keepUi).not.toHaveClass("button-primary");
  });

  it("shows an em dash when base value is missing", () => {
    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository()}
        conflicts={[openConflict({ baseValue: undefined })]}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("无基线")).toBeInTheDocument();
  });

  it("confirms with optional reason and calls resolveConflict", async () => {
    const resolveConflict = vi.fn().mockResolvedValue(openConflict({ status: "resolved_ui" }));
    const listConflicts = vi.fn().mockResolvedValue([]);
    const onConflictsChange = vi.fn();
    const onQueueEmpty = vi.fn();
    const repository = createStubRepository({ resolveConflict, listConflicts });

    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={repository}
        conflicts={[openConflict()]}
        onConflictsChange={onConflictsChange}
        onQueueEmpty={onQueueEmpty}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "保留界面值" }));
    const dialog = await screen.findByRole("dialog", { name: "保留界面值" });
    expect(dialog).toHaveTextContent("界面值");
    expect(dialog).toHaveTextContent("文件值");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "以实测为准" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认裁决" }));

    await waitFor(() =>
      expect(resolveConflict).toHaveBeenCalledWith("aurora", "conflict-1", {
        resolution: "ui",
        reason: "以实测为准"
      })
    );
    await waitFor(() => expect(onConflictsChange).toHaveBeenCalledWith([]));
    expect(onQueueEmpty).toHaveBeenCalled();
  });

  it("advances to the next conflict after resolve", async () => {
    const first = openConflict({ id: "conflict-1", parameterName: "model", fileValue: "A", uiDraftValue: "B" });
    const second = openConflict({
      id: "conflict-2",
      parameterName: "vendor",
      fileValue: "X",
      uiDraftValue: "Y",
      parameterDefinitionId: "def-vendor"
    });
    const resolveConflict = vi.fn().mockResolvedValue({ ...first, status: "resolved_file" });
    const listConflicts = vi.fn().mockResolvedValue([second]);
    const onConflictsChange = vi.fn();
    const onQueueEmpty = vi.fn();
    const repository = createStubRepository({ resolveConflict, listConflicts });

    const { rerender } = render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={repository}
        conflicts={[first, second]}
        onConflictsChange={onConflictsChange}
        onQueueEmpty={onQueueEmpty}
      />
    );

    expect(screen.getByLabelText("冲突仲裁")).toHaveTextContent("model");
    fireEvent.click(screen.getByRole("button", { name: "使用文件值" }));
    const dialog = await screen.findByRole("dialog", { name: "使用文件值" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认裁决" }));

    await waitFor(() => expect(onConflictsChange).toHaveBeenCalledWith([second]));
    expect(onQueueEmpty).not.toHaveBeenCalled();

    rerender(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={repository}
        conflicts={[second]}
        onConflictsChange={onConflictsChange}
        onQueueEmpty={onQueueEmpty}
      />
    );

    expect(await screen.findByText("vendor")).toBeInTheDocument();
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
  });

  it("calls onLocateConflict when locating the active conflict", () => {
    const onLocateConflict = vi.fn();
    const conflict = openConflict();
    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository()}
        conflicts={[conflict]}
        onLocateConflict={onLocateConflict}
        autoLocate={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "在源码中定位" }));
    expect(onLocateConflict).toHaveBeenCalledWith(conflict);
  });

  it("auto-locates when the active conflict is shown", () => {
    const onLocateConflict = vi.fn();
    const conflict = openConflict();
    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository()}
        conflicts={[conflict]}
        onLocateConflict={onLocateConflict}
      />
    );
    expect(onLocateConflict).toHaveBeenCalledWith(conflict);
  });

  it("previews bulk impact then resolves eligible conflicts", async () => {
    const first = openConflict({ id: "conflict-1", parameterName: "model" });
    const second = openConflict({
      id: "conflict-2",
      parameterName: "vendor",
      parameterDefinitionId: "def-vendor"
    });
    const preview: ParameterFileConflictBulkPreview = {
      resolution: "file",
      eligible: [first, second],
      ineligible: [
        {
          conflict: { id: "conflict-skip" },
          reason: "already_resolved"
        }
      ],
      impact: {
        eligibleCount: 2,
        ineligibleCount: 1,
        parameterNames: ["model", "vendor"],
        fileIds: ["file-board"]
      }
    };
    const previewBulkConflictResolution = vi.fn().mockResolvedValue(preview);
    const resolveConflictsBulk = vi.fn().mockResolvedValue({
      resolved: [
        { ...first, status: "resolved_file" },
        { ...second, status: "resolved_file" }
      ],
      skipped: preview.ineligible
    });
    const listConflicts = vi.fn().mockResolvedValue([]);
    const onConflictsChange = vi.fn();
    const onQueueEmpty = vi.fn();

    render(
      <WorkbenchConflictArbitrationDock
        projectId="aurora"
        repository={createStubRepository({
          previewBulkConflictResolution,
          resolveConflictsBulk,
          listConflicts
        })}
        conflicts={[first, second]}
        onConflictsChange={onConflictsChange}
        onQueueEmpty={onQueueEmpty}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "批量裁决" }));
    fireEvent.click(screen.getByRole("button", { name: "批量使用文件值" }));

    await waitFor(() =>
      expect(previewBulkConflictResolution).toHaveBeenCalledWith("aurora", {
        resolution: "file",
        conflictIds: ["conflict-1", "conflict-2"]
      })
    );

    const dialog = await screen.findByRole("dialog", { name: "批量使用文件值" });
    expect(dialog).toHaveTextContent("2");
    expect(dialog).toHaveTextContent("model");
    expect(dialog).toHaveTextContent("vendor");
    expect(dialog).toHaveTextContent("已排除");

    fireEvent.click(within(dialog).getByRole("button", { name: "确认批量裁决" }));

    await waitFor(() =>
      expect(resolveConflictsBulk).toHaveBeenCalledWith("aurora", {
        resolution: "file",
        conflictIds: ["conflict-1", "conflict-2"]
      })
    );
    await waitFor(() => expect(onConflictsChange).toHaveBeenCalledWith([]));
    expect(onQueueEmpty).toHaveBeenCalled();
  });
});
