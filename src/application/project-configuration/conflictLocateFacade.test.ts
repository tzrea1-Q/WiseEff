import { describe, expect, it, vi } from "vitest";

import type { ParameterFileSyncConflict } from "@/application/ports/ParameterFileRepository";
import { createConflictLocateFacade } from "./conflictLocateFacade";

function conflict(overrides: Partial<ParameterFileSyncConflict> = {}): ParameterFileSyncConflict {
  return {
    id: "c1",
    organizationId: "org-1",
    projectId: "proj-1",
    projectParameterValueId: "ppv-1",
    parameterDefinitionId: "def-1",
    parameterName: "model",
    fileVersionId: "ver-1",
    fileDraftId: "fd-1",
    uiDraftId: "ud-1",
    fileValue: "A",
    uiDraftValue: "B",
    status: "open",
    createdAt: "2026-08-09T00:00:00.000Z",
    fileId: "file-board",
    nodePath: "board",
    propertyName: "model",
    source: {
      startOffset: 0,
      endOffset: 1,
      startLine: 12,
      startColumn: 1,
      endLine: 12,
      endColumn: 5
    },
    ...overrides
  };
}

describe("createConflictLocateFacade", () => {
  it("load keeps only open conflicts via narrow listConflicts Pick", async () => {
    const listConflicts = vi.fn(async () => [
      conflict({ id: "open-1", status: "open" }),
      conflict({ id: "done", status: "resolved_file" })
    ]);
    const facade = createConflictLocateFacade();

    await facade.load("proj-1", { listConflicts });

    expect(listConflicts).toHaveBeenCalledWith("proj-1");
    expect(facade.conflicts.map((item) => item.id)).toEqual(["open-1"]);
    expect(facade.loading).toBe(false);
  });

  it("load fail-closes to empty list with error", async () => {
    const facade = createConflictLocateFacade();
    await facade.load("proj-1", {
      listConflicts: vi.fn(async () => {
        throw new Error("boom");
      })
    });
    expect(facade.conflicts).toEqual([]);
    expect(facade.error).toMatch(/boom/);
  });

  it("locate projects file/node/property/focusLine and stores pending target", () => {
    const facade = createConflictLocateFacade();
    const target = facade.locate(
      conflict({
        fileId: "file-x",
        nodePath: undefined,
        sourceNodePath: "root/child",
        propertyName: "reg",
        source: {
          startOffset: 0,
          endOffset: 1,
          startLine: 44,
          startColumn: 1,
          endLine: 44,
          endColumn: 2
        }
      })
    );

    expect(target).toEqual({
      fileId: "file-x",
      nodePath: "root/child",
      propertyName: "reg",
      focusLine: 44
    });
    expect(facade.locateTarget).toEqual(target);
  });

  it("locate returns null without fileId", () => {
    const facade = createConflictLocateFacade();
    expect(facade.locate(conflict({ fileId: undefined }))).toBeNull();
    expect(facade.locateTarget).toBeNull();
  });

  it("openArbitration refreshes open queue and optional seed locate", async () => {
    const listConflicts = vi.fn(async () => [conflict({ id: "c-open" })]);
    const facade = createConflictLocateFacade();

    await facade.openArbitration("proj-1", { listConflicts }, {
      fileId: "file-board",
      nodePath: "board",
      propertyName: "model",
      focusLine: 9
    });

    expect(facade.conflicts).toHaveLength(1);
    expect(facade.locateTarget).toEqual({
      fileId: "file-board",
      nodePath: "board",
      propertyName: "model",
      focusLine: 9
    });
  });

  it("setOpenConflicts drops non-open rows; consumeLocateTargetIfMatched clears when selection matches", () => {
    const facade = createConflictLocateFacade();
    facade.setOpenConflicts([
      conflict({ id: "a", status: "open" }),
      conflict({ id: "b", status: "resolved_ui" })
    ]);
    expect(facade.conflicts.map((item) => item.id)).toEqual(["a"]);

    facade.locate(conflict({ id: "a" }));
    expect(
      facade.consumeLocateTargetIfMatched({
        fileId: "other",
        nodePath: "board",
        propertyName: "model"
      })
    ).toBeNull();
    expect(facade.locateTarget).not.toBeNull();

    const consumed = facade.consumeLocateTargetIfMatched({
      fileId: "file-board",
      nodePath: "board",
      propertyName: "model"
    });
    expect(consumed?.focusLine).toBe(12);
    expect(facade.locateTarget).toBeNull();
  });
});
