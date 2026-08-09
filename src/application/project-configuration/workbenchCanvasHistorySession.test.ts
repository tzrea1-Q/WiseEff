import { describe, expect, it, vi } from "vitest";

import { createWorkbenchCanvasHistorySession } from "./workbenchCanvasHistorySession";

describe("WorkbenchCanvasHistorySession", () => {
  it("loads history bytes for history mode and ignores stale responses", async () => {
    const session = createWorkbenchCanvasHistorySession();
    let resolveFirst: (value: { bytes: Uint8Array }) => void = () => undefined;
    const first = new Promise<{ bytes: Uint8Array }>((resolve) => {
      resolveFirst = resolve;
    });
    const downloadVersion = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ bytes: new TextEncoder().encode("second") });

    const pending = session.loadModeSource({
      canvasMode: "history",
      projectId: "proj",
      fileId: "f1",
      versionId: "v1",
      workingSource: "working",
      repo: { downloadVersion }
    });
    const second = session.loadModeSource({
      canvasMode: "unified-diff",
      projectId: "proj",
      fileId: "f1",
      versionId: "v2",
      workingSource: "working",
      repo: { downloadVersion }
    });
    resolveFirst({ bytes: new TextEncoder().encode("first") });
    await Promise.all([pending, second]);
    expect(session.historySource).toBe("second");
    expect(session.compareSource).toBe("working");
    expect(session.modeSourceLoading).toBe(false);
  });

  it("loads compare bytes for unified-diff from currentVersionId", async () => {
    const session = createWorkbenchCanvasHistorySession();
    const downloadVersion = vi.fn(async (_projectId: string, _fileId: string, versionId: string) => ({
      bytes: new TextEncoder().encode(versionId === "v-hist" ? "hist" : "tip")
    }));
    await session.loadModeSource({
      canvasMode: "unified-diff",
      projectId: "proj",
      fileId: "f1",
      versionId: "v-hist",
      currentVersionId: "v-tip",
      workingSource: "fallback",
      repo: { downloadVersion }
    });
    expect(session.historySource).toBe("hist");
    expect(session.compareSource).toBe("tip");
    expect(downloadVersion).toHaveBeenCalledTimes(2);
  });

  it("clears history state for working and candidate modes", async () => {
    const session = createWorkbenchCanvasHistorySession();
    await session.loadModeSource({
      canvasMode: "history",
      projectId: "proj",
      fileId: "f1",
      versionId: "v1",
      workingSource: "w",
      repo: {
        downloadVersion: vi.fn(async () => ({ bytes: new TextEncoder().encode("hist") }))
      }
    });
    expect(session.historySource).toBe("hist");
    await session.loadModeSource({
      canvasMode: "candidate",
      projectId: "proj",
      fileId: "f1",
      versionId: "v1",
      workingSource: "w",
      repo: { downloadVersion: vi.fn() }
    });
    expect(session.historySource).toBe("");
    expect(session.modeSourceLoading).toBe(false);
  });
});
