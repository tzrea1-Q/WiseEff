import { describe, expect, it, vi } from "vitest";

import { createWorkbenchCanvasHistorySession } from "./workbenchCanvasHistorySession";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

describe("WorkbenchCanvasHistorySession", () => {
  it("hides internal source errors behind the history context", async () => {
    const session = createWorkbenchCanvasHistorySession();
    await session.loadModeSource({ canvasMode: "history", projectId: "proj", fileId: "file",
      versionId: "history", workingSource: "working", repo: {
        downloadVersion: vi.fn().mockRejectedValue(new WiseEffApiError("INTERNAL_ERROR", "/private/server/source", {}, "req-source"))
      } });
    expect(session.modeSourceError).toBe("历史源码加载失败。");
  });
  it.each(["NOT_FOUND", "GONE"])("keeps an absent counterpart (%s) separate from request failures", async (code) => {
    const session = createWorkbenchCanvasHistorySession();
    await session.loadModeSource({ canvasMode: "unified-diff", projectId: "proj", fileId: "file",
      versionId: "removed", workingSource: "working", repo: {
        downloadVersion: vi.fn().mockRejectedValue(new WiseEffApiError(code, "missing", {}, "request"))
      } });
    expect(session.modeSourceError).toBe("");
    expect(session.historySource).toBe("");
  });
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
      contentType: "text/plain",
      bytes: new TextEncoder().encode(versionId === "v-hist" ? "\ufeffhist\r\n" : "\ufefftip\r\n")
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
    expect(session.historySource).toBe("\ufeffhist\r\n");
    expect(session.compareSource).toBe("\ufefftip\r\n");
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
        downloadVersion: vi.fn(async () => ({ contentType: "text/plain", bytes: new TextEncoder().encode("hist") }))
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
