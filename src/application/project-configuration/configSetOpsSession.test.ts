import { describe, expect, it, vi } from "vitest";

import type { DtsConfigSet, DtsConfigSetFile } from "@/application/ports/DtsStructuredRepository";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import { createConfigSetOpsSession, formatSyncSummary } from "./configSetOpsSession";

function configSet(overrides: Partial<DtsConfigSet> = {}): DtsConfigSet {
  return {
    id: "cs-1",
    organizationId: "org-1",
    projectId: "proj-1",
    name: "board-a",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...overrides
  };
}

describe("createConfigSetOpsSession", () => {
  it("create validates empty and duplicate names without calling repository", async () => {
    const createConfigSet = vi.fn();
    const session = createConfigSetOpsSession();

    const empty = await session.create("proj-1", { name: "  ", existingNames: [] }, { createConfigSet });
    expect(empty).toEqual({ ok: false, kind: "validation", message: "请先填写配置集名称。" });
    expect(createConfigSet).not.toHaveBeenCalled();

    const dup = await session.create(
      "proj-1",
      { name: "Board-A", existingNames: ["board-a"] },
      { createConfigSet }
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.message).toMatch(/已存在/);
    expect(createConfigSet).not.toHaveBeenCalled();
  });

  it("create calls narrow createConfigSet Pick and returns item", async () => {
    const item = configSet();
    const createConfigSet = vi.fn(async () => item);
    const session = createConfigSetOpsSession();

    const result = await session.create(
      "proj-1",
      { name: "board-a", existingNames: [] },
      { createConfigSet }
    );

    expect(createConfigSet).toHaveBeenCalledWith("proj-1", { name: "board-a" });
    expect(result).toEqual({ ok: true, item, message: "已创建配置集「board-a」。" });
    expect(session.lastMessage).toMatch(/已创建/);
  });

  it("addMember and removeMember go through narrow structured Picks", async () => {
    const membership = {
      configSetId: "cs-1",
      fileId: "file-1",
      role: "base",
      sortOrder: 0
    } as DtsConfigSetFile;
    const addConfigSetFile = vi.fn(async () => membership);
    const removeConfigSetFile = vi.fn(async () => undefined);
    const session = createConfigSetOpsSession();
    const file = {
      id: "file-1",
      fileName: "board.dts",
      format: "dts",
      currentVersionId: "v1",
      currentVersionNumber: 1
    } as ProjectParameterFile;

    const added = await session.addMember(
      "proj-1",
      "cs-1",
      { fileId: "file-1", role: "base", sortOrder: 2, file },
      { addConfigSetFile }
    );
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.membership.fileId).toBe("file-1");
      expect(added.message).toMatch(/编入配置集/);
    }

    const removed = await session.removeMember("proj-1", "cs-1", "file-1", { removeConfigSetFile });
    expect(removed).toEqual({ ok: true, message: "已从配置集移除成员文件。" });
    expect(removeConfigSetFile).toHaveBeenCalledWith("proj-1", "cs-1", "file-1");
  });

  it("syncFile refreshes files and conflicts after sync", async () => {
    const session = createConfigSetOpsSession();
    const syncFile = vi.fn(async () => ({
      draftsCreated: 1,
      unchanged: 2,
      unmatched: 0,
      skipped: false
    }));
    const listFiles = vi.fn(async () => [{ id: "file-1" } as ProjectParameterFile]);
    const listConflicts = vi.fn(async () => [{ id: "c1", status: "open" as const }]);

    const result = await session.syncFile(
      "proj-1",
      { fileId: "file-1", fileName: "board.dts" },
      { syncFile, listFiles, listConflicts }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toContain("已创建 1 条草稿");
      expect(result.files).toHaveLength(1);
      expect(result.conflicts).toHaveLength(1);
    }
    expect(formatSyncSummary({ draftsCreated: 0, unchanged: 0, unmatched: 0, skipped: true })).toMatch(
      /已跳过/
    );
  });

  it("exportConfigSet builds evidence from manifest", async () => {
    const session = createConfigSetOpsSession();
    const exportConfigSet = vi.fn(async () => ({
      manifest: {
        configSetId: "cs-1",
        name: "board-a",
        members: [{ fileId: "f1" }, { fileId: "f2" }],
        validation: { ok: true, mode: "warn" }
      },
      files: []
    }));

    const result = await session.exportConfigSet("proj-1", "cs-1", "board-a", { exportConfigSet });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toContain("2 个成员");
      expect(result.evidence).toContain("校验 通过");
    }
  });
});
