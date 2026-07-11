import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParameterFileConflictPanel } from "./ParameterFileConflictPanel";

const listConflictsMock = vi.fn();
const resolveConflictMock = vi.fn();

vi.mock("@/infrastructure/http/parameterFileClient", () => ({
  createParameterFileClient: () => ({
    listConflicts: listConflictsMock,
    resolveConflict: resolveConflictMock
  })
}));

describe("ParameterFileConflictPanel", () => {
  it("renders open conflicts with parameter name fallback", async () => {
    listConflictsMock.mockResolvedValueOnce([
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
    ]);

    render(
      <ParameterFileConflictPanel
        open
        projectId="atlas"
        runtimeMode="api"
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("def-battery-temp-target")).toBeInTheDocument();
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();
    expect(screen.getByText("3200")).toBeInTheDocument();
    expect(screen.getByText("3400")).toBeInTheDocument();
  });

  it("resolves conflict by keeping file value", async () => {
    listConflictsMock.mockResolvedValueOnce([
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
    ]);
    resolveConflictMock.mockResolvedValueOnce({
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
    });

    render(
      <ParameterFileConflictPanel
        open
        projectId="atlas"
        runtimeMode="api"
        onClose={vi.fn()}
      />
    );

    await screen.findByText("def-limit");
    fireEvent.click(screen.getByRole("button", { name: "保留文件值" }));

    await waitFor(() => {
      expect(resolveConflictMock).toHaveBeenCalledWith("atlas", "conflict-3", "file");
    });
  });
});
