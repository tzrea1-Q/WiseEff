import { describe, expect, it, vi } from "vitest";

import type { DtsConfigSet, DtsConfigSetFile, DtsExportConfigSetResult } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileSyncConflict, ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
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
  it("clears only success feedback while preserving a concurrent operation error", async () => {
    const session = createConfigSetOpsSession();
    let completeCreate!: (item: DtsConfigSet) => void;
    const creating = session.create("proj-1", { name: "board-a", existingNames: [] }, {
      createConfigSet: () => new Promise((resolve) => { completeCreate = resolve; })
    });
    await session.removeMember("proj-1", "cs-1", "file-1", {
      removeConfigSetFile: async () => { throw new Error("移除失败，请重试"); }
    });
    completeCreate(configSet());
    await creating;
    expect(session.lastMessage).toBe("已创建配置「board-a」。");
    expect(session.lastError).toBe("移除失败，请重试");

    session.clearSuccessMessage();
    expect(session.getSnapshot()).toEqual({ lastMessage: "", lastError: "移除失败，请重试" });
    session.clearSuccessMessage();
    expect(session.lastError).toBe("移除失败，请重试");
  });

  it("create validates empty and duplicate names without calling repository", async () => {
    const createConfigSet = vi.fn();
    const session = createConfigSetOpsSession();

    const empty = await session.create("proj-1", { name: "  ", existingNames: [] }, { createConfigSet });
    expect(empty).toEqual({ ok: false, kind: "validation", message: "请先填写配置名称。" });
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
    expect(result).toEqual({ ok: true, item, message: "已创建配置「board-a」。" });
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
      expect(added.message).toMatch(/加入配置/);
    }

    const removed = await session.removeMember("proj-1", "cs-1", "file-1", { removeConfigSetFile });
    expect(removed).toEqual({ ok: true, message: "已从当前配置移除文件。" });
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
    const listConflicts = vi.fn(async (): Promise<ParameterFileSyncConflict[]> => [{
      id: "c1", organizationId: "org-1", projectId: "proj-1", projectParameterValueId: "value-1",
      parameterDefinitionId: "definition-1", fileVersionId: "version-1", fileDraftId: "file-draft-1", uiDraftId: "ui-draft-1",
      fileValue: "file", uiDraftValue: "ui", status: "open", createdAt: "2026-08-09T00:00:00.000Z"
    }]);

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

  it("labels canonical sync as a source consistency check without claiming drafts", () => {
    expect(
      formatSyncSummary({
        sourceWorkflow: "canonical",
        message: "single binding byte proof passed",
        draftsCreated: 0,
        unchanged: 1,
        unmatched: 0,
        skipped: false
      })
    ).toBe("来源一致性校验：已检查当前文件版本；存在可用固定来源时，已与其中一份来源修订核对配置文件及文件版本。未逐项证明全部参数绑定一致，也未同步参数、创建草稿或审核请求。");
  });

  it.each([
    ["source-membership-drift", "文件、文件版本或参数绑定的来源记录", "仅在来源证明完整且基版本有效时提交人工审核"],
    ["mixed-source-revisions", "不同的来源修订", "上传候选不能直接解除此冲突"],
    ["source-pin-missing", "缺少可验证的活动来源固定记录", "先修复来源，再重新校验"],
    ["source-proof-busy", "暂时无法取得稳定证明", "等待相关操作完成后刷新重试"]
  ])("maps canonical sync %s to an actionable Chinese error", async (reason, cause, action) => {
    const session = createConfigSetOpsSession();
    const result = await session.syncFile("proj-1", { fileId: "file-1", fileName: "board.json" }, {
      syncFile: async () => { throw new WiseEffApiError("CONFLICT", "Canonical source check failed.", { reason }, "request-1"); },
      listFiles: vi.fn(),
      listConflicts: vi.fn()
    });
    expect(result).toEqual({ ok: false, message: expect.stringContaining(cause) });
    expect(session.lastError).toContain(action);
    expect(session.lastError).toContain("未同步参数或创建审核请求");
    expect(session.lastError).not.toContain("Canonical source");
    if (reason === "source-membership-drift") {
      expect(session.lastError).toContain("文件管理 → 更新文件");
      expect(session.lastError).not.toContain("页面顶部「上传候选」");
    }
  });

  it("keeps legacy sync errors unchanged", async () => {
    const session = createConfigSetOpsSession();
    const result = await session.syncFile("proj-1", { fileId: "file-1", fileName: "board.dts" }, {
      syncFile: async () => { throw new Error("旧同步失败"); },
      listFiles: vi.fn(),
      listConflicts: vi.fn()
    });
    expect(result).toEqual({ ok: false, message: "旧同步失败" });
  });

  it("exportConfigSet builds evidence from manifest", async () => {
    const session = createConfigSetOpsSession();
    await session.create("proj-1", { name: "board-a", existingNames: [] }, { createConfigSet: async () => configSet() });
    expect(session.lastMessage).toContain("已创建配置");
    const exportConfigSet = vi.fn(async (): Promise<DtsExportConfigSetResult> => ({
      manifest: {
        configSetId: "cs-1",
        name: "board-a",
        projectId: "proj-1",
        exportedAt: "2026-08-09T00:00:00.000Z",
        members: ["f1", "f2"].map((fileId, sortOrder) => ({
          fileId, fileName: `${fileId}.dts`, role: "base", sortOrder, versionNumber: 1, format: "dts"
        })),
        validation: { ok: true, mode: "warn", compiler: "dtc", requiresConfirmation: false }
      },
      files: []
    }));

    const exporting = session.exportConfigSet("proj-1", "cs-1", "board-a", { exportConfigSet });
    expect(session.lastMessage).toBe("");
    const result = await exporting;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toContain("2 个文件");
      expect(result.evidence).toContain("校验 通过");
    }
    expect(session.lastMessage).toBe("");
  });
});
