import { describe, expect, it, vi } from "vitest";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import type { CatalogDefinitionRevisionResponse } from "@/application/ports/ParameterCatalogRepository";
import { SESSION_DRAFT_STORAGE_KEY } from "./sessionDraftStorage";
import { createStructuredEditSession } from "./structuredEditSession";
import { createTestParameterTopologyRepository } from "@/test/harness";
import type { BindingDraftResult, ProjectParameterBinding } from "@/application/ports/ParameterTopologyRepository";

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

const SCOPE = {
  userId: "user-1",
  organizationId: "org-1",
  projectId: "proj-1",
  configSetId: "cs-1",
  fileId: "file-board",
  baseVersionId: "ver-1"
};

const NODES: DtsStructuralNode[] = [
  {
    nodePath: "board",
    name: "board",
    labels: [],
    properties: [
      {
        name: "model",
        valueType: "string-list",
        rawText: '"Aurora"',
        normalizedValue: "Aurora",
        source: {
          startOffset: 0,
          endOffset: 10,
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 10
        }
      },
      {
        name: "compatible",
        valueType: "string-list",
        rawText: '"wiseeff,aurora"',
        normalizedValue: "wiseeff,aurora"
      }
    ],
    phandleRefs: []
  }
];

function canonicalBinding(nodePath: string, fileId = SCOPE.fileId): ProjectParameterBinding {
  return {
    id: `pbind_${fileId}_${nodePath}`, definitionId: "pdef_model",
    parameterSpecId: "pdef_model", parameterSpecVersionId: "pdrev_model",
    currentValueId: `ppv_${nodePath}`, propertyKey: "model", logicalNodeId: `node_${nodePath}`,
    sourceFileId: fileId, sourceNodePath: nodePath, sourceOccurrenceId: `occ_${fileId}_${nodePath}`,
    instanceName: nodePath, locator: nodePath, driverModule: null, moduleId: "module",
    effectiveValue: { kind: "strings", values: ["Aurora"] }, rawValue: '"Aurora"',
    schemaState: "valid", policyState: "not_applicable"
  };
}

function stagingReceipt(bindingId: string): BindingDraftResult {
  return {
    draftId: `pvdr_${bindingId}`, projectParameterBindingId: bindingId, parameterId: bindingId,
    currentValueId: bindingId.endsWith("board") ? "ppv_board" : "ppv_sibling", pending: true,
    candidateRevisionId: "revision-1", rawText: '"Updated"', action: "set", parameterSpecId: "pdef_model",
    writeTarget: { role: "canonical-project-value-draft", propertyKey: "model" }, overlayFileId: "", overlayFileName: ""
  };
}

function definitionRevisionResponse(schema: Record<string, unknown>): CatalogDefinitionRevisionResponse {
  return { item: {
    id: "drev_pinned", definitionId: "pdef_model", revisionNumber: 3,
    contentDigest: "sha256:pinned", displayName: "Pinned model",
    valueShape: { kind: "json-schema", schema }, constraints: { kind: "none" },
    documentation: null, unit: null, publishedInCatalogReleaseId: "catalog-pinned"
  } };
}

async function editedCanonicalSession(paths = ["board", "sibling"], storage = createMemoryStorage()) {
  const session = createStructuredEditSession({ storage });
  session.setStructure(paths.map((nodePath) => ({ ...NODES[0]!, nodePath })), SCOPE.fileId);
  await session.hydrate(SCOPE);
  for (const nodePath of paths) {
    session.change({ fileId: SCOPE.fileId, nodePath, propertyName: "model" },
      { rawText: '"Updated"', normalizedValue: "Updated", valid: true });
  }
  session.setReason("Stage exact source edits");
  return session;
}

describe("canonical structured staging", () => {
  it("checks the pinned schema for every restored draft before creating an unopened out-of-range value", async () => {
    const storage = createMemoryStorage();
    const original = await editedCanonicalSession(["board"], storage);
    original.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: "<101>", normalizedValue: "101", valid: false, error: "old business error" });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    expect(session.rows[0]?.valid).toBe(true);
    expect(session.validate()).toEqual({ ok: true,
      message: "本地输入检查通过：1 项；保存时仍需核对固定参数定义。" });
    const createBindingDraft = vi.fn();
    const getDefinitionRevision = vi.fn().mockResolvedValue(definitionRevisionResponse({ type: "integer", maximum: 100 }));
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      definitionRepository: { getDefinitionRevision },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"), effectiveRevisionId: "drev_pinned",
          definitionRevisionId: "drev_older" }]), createBindingDraft
      }) })).rejects.toThrow(/不能大于 100/);
    expect(getDefinitionRevision).toHaveBeenCalledWith("pdef_model", "drev_pinned");
    expect(createBindingDraft).not.toHaveBeenCalled();
    expect(session.rows[0]).toMatchObject({ rawText: "<101>", valid: false, error: "取值不能大于 100" });
  });

  it("keeps a draft when its definition cannot load and retries its fixed schema before staging", async () => {
    const session = await editedCanonicalSession(["board"]);
    const getDefinitionRevision = vi.fn().mockRejectedValueOnce(new Error("definition unavailable"))
      .mockResolvedValue(definitionRevisionResponse({ type: "string" }));
    const createBindingDraft = vi.fn(async () => stagingReceipt("pbind_file-board_board"));
    const input = { projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      definitionRepository: { getDefinitionRevision },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"), definitionRevisionId: "drev_pinned" }]), createBindingDraft
      }) };
    await expect(session.submit(input)).rejects.toThrow(/definition unavailable/);
    expect(createBindingDraft).not.toHaveBeenCalled();
    expect(session.rows[0]?.rawText).toBe('"Updated"');
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Updated"', normalizedValue: "Updated", valid: false, error: "previous schema error" });
    await session.submit(input);
    expect(getDefinitionRevision).toHaveBeenCalledTimes(2);
    expect(createBindingDraft).toHaveBeenCalledOnce();
    expect(session.rows).toEqual([]);
  });

  it.each(["missing", "mismatch"])("blocks staging when the pinned definition identity is %s", async (identity) => {
    const session = await editedCanonicalSession(["board"]);
    const createBindingDraft = vi.fn();
    const getDefinitionRevision = vi.fn().mockResolvedValue({ ...definitionRevisionResponse({ type: "string" }),
      item: { ...definitionRevisionResponse({ type: "string" }).item, id: "drev_other" } });
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() }, definitionRepository: { getDefinitionRevision },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"),
          ...(identity === "mismatch" ? { definitionRevisionId: "drev_pinned" } : {}) }]), createBindingDraft
      }) })).rejects.toThrow(identity === "missing" ? /缺少固定参数定义修订/ : /identity mismatch/);
    expect(createBindingDraft).not.toHaveBeenCalled();
    expect(session.rows).toHaveLength(1);
  });

  it("does not overwrite newer input when an older pinned-schema check fails", async () => {
    const session = await editedCanonicalSession(["board"]);
    const identity = { fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" };
    session.change(identity, { rawText: "<101>", normalizedValue: "101", valid: true });
    const getDefinitionRevision = vi.fn(async () => {
      session.change(identity, { rawText: "<90>", normalizedValue: "90", valid: true });
      return definitionRevisionResponse({ type: "integer", maximum: 100 });
    });
    const createBindingDraft = vi.fn();
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() }, definitionRepository: { getDefinitionRevision },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"), definitionRevisionId: "drev_pinned" }]), createBindingDraft
      }) })).rejects.toThrow(/不能大于 100/);
    expect(session.rows[0]).toMatchObject({ rawText: "<90>", valid: true });
    expect(session.rows[0]?.error).toBeUndefined();
    expect(createBindingDraft).not.toHaveBeenCalled();
  });

  it("checks the fixed definition identity but skips its value schema for property deletion", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure([{ ...NODES[0]!, properties: [{ name: "model", valueType: "bool", rawText: "", normalizedValue: "true" }] }], SCOPE.fileId);
    await session.hydrate(SCOPE);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: "", normalizedValue: "true", valid: true, present: false });
    session.setReason("Remove property");
    const createBindingDraft = vi.fn(async () => stagingReceipt("pbind_file-board_board"));
    const getDefinitionRevision = vi.fn().mockResolvedValue(definitionRevisionResponse({ type: "integer", minimum: 5 }));
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() }, definitionRepository: { getDefinitionRevision },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"), definitionRevisionId: "drev_pinned" }]), createBindingDraft
      }) });
    expect(getDefinitionRevision).toHaveBeenCalledWith("pdef_model", "drev_pinned");
    expect(createBindingDraft).toHaveBeenCalledWith(SCOPE.projectId, "pbind_file-board_board",
      expect.objectContaining({ action: "delete" }));
  });

  it("removes reverted drafts and their persisted bucket, including explicit present=true", async () => {
    const storage = createMemoryStorage();
    const session = await editedCanonicalSession(["board"], storage);
    expect(session.isDirty).toBe(true);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora"', normalizedValue: "Aurora", valid: true, present: true });
    expect(session.rows).toEqual([]);
    expect(session.drafts).toEqual({});
    expect(session.selectedKeys.size).toBe(0);
    expect(session.isDirty).toBe(false);
    expect(session.copyText()).toBeNull();
    const restored = createStructuredEditSession({ storage });
    restored.setStructure(NODES, SCOPE.fileId);
    await restored.hydrate(SCOPE);
    expect(restored.isDirty).toBe(false);
    expect(restored.recoveryStatus).toBe("none");
  });

  it("discards one draft without dropping other changes, then discards the whole session", async () => {
    const session = await editedCanonicalSession();
    session.discard("file-board::board::model");
    expect(session.rows.map((row) => row.nodePath)).toEqual(["sibling"]);
    expect(session.isDirty).toBe(true);
    session.discard();
    expect(session.drafts).toEqual({});
    expect(session.selectedKeys.size).toBe(0);
    expect(session.isDirty).toBe(false);
  });

  it("cleans a recovered legacy property key when its value is restored", async () => {
    const storage = createMemoryStorage({ [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, buckets: [{
      scope: SCOPE, drafts: { "board::model": { rawText: '"Updated"', normalizedValue: "Updated" } },
      selectedKeys: ["board::model"], reason: "Recovered edit", updatedAt: "2026-10-17T00:00:00.000Z"
    }] }) });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    expect(session.isDirty).toBe(true);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora"', normalizedValue: "Aurora", valid: true });
    expect(session.drafts).toEqual({});
    expect(session.isDirty).toBe(false);
  });

  it("retains invalid input and explicit deletion even when the raw text matches the original", async () => {
    const session = await editedCanonicalSession(["board"]);
    const identity = { fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" };
    session.change(identity, { rawText: '"Aurora"', normalizedValue: "Aurora", valid: false, error: "invalid" });
    expect(session.isDirty).toBe(true);
    expect(session.rows[0]?.valid).toBe(false);
    session.change(identity, { rawText: '"Aurora"', normalizedValue: "Aurora", valid: true, present: false });
    expect(session.isDirty).toBe(true);
    expect(session.rows[0]?.present).toBe(false);
  });

  it("preserves confirmed receipts and local edits when hydrating the same scope", async () => {
    const session = await editedCanonicalSession(["board"]);
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => stagingReceipt("pbind_file-board_board"))
      }) });
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Newer"', normalizedValue: "Newer", valid: true });
    session.setReason("Keep editing this scope");
    const before = session.getSnapshot();
    await session.hydrate({ ...SCOPE });
    expect(session.getSnapshot()).toEqual(before);
  });

  it("keeps an in-flight staging receipt valid after same-scope hydration", async () => {
    const session = await editedCanonicalSession(["board"]);
    let finish!: (receipt: BindingDraftResult) => void;
    const createBindingDraft = vi.fn(() => new Promise<BindingDraftResult>((resolve) => { finish = resolve; }));
    const submission = session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft
      }) });
    const outcome = submission.catch((error: unknown) => error);
    await vi.waitFor(() => expect(createBindingDraft).toHaveBeenCalledOnce());
    await session.hydrate({ ...SCOPE });
    expect(session.submitting).toBe(true);
    finish(stagingReceipt("pbind_file-board_board"));
    await expect(outcome).resolves.toMatchObject({ status: "canonical-project-value-draft" });
    expect(session.stagedDrafts).toHaveLength(1);
    expect(session.rows).toEqual([]);
    expect(session.submitting).toBe(false);
  });

  it.each(["success", "failure"])("does not let an old staging %s finish the new scope's submission", async (outcome) => {
    const session = await editedCanonicalSession(["board"]);
    let finishOld!: () => void;
    const oldPending = new Promise<void>((resolve) => { finishOld = resolve; });
    const oldDraft = vi.fn(async () => {
      await oldPending;
      if (outcome === "failure") throw new Error("Old scope failed");
      return stagingReceipt("pbind_file-board_board");
    });
    const submit = (projectId: string, createBindingDraft: typeof oldDraft) => session.submit({
      projectId, fileId: SCOPE.fileId, fileName: "board.dts", revisionId: "revision-1",
      dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft
      })
    });
    const oldSubmission = submit(SCOPE.projectId, oldDraft).catch(() => undefined);
    await vi.waitFor(() => expect(oldDraft).toHaveBeenCalledOnce());
    await session.hydrate({ ...SCOPE, projectId: "new-project" });
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"New project"', normalizedValue: "New project", valid: true });
    session.setReason("New project staging");
    let finishNew!: (receipt: BindingDraftResult) => void;
    const newDraft = vi.fn(() => new Promise<BindingDraftResult>((resolve) => { finishNew = resolve; }));
    const newSubmission = submit("new-project", newDraft).catch((error: unknown) => error);
    await vi.waitFor(() => expect(newDraft).toHaveBeenCalledOnce());
    finishOld();
    await oldSubmission;
    expect(session.submitting).toBe(true);
    expect(session.submitError).toBe("");
    expect(session.submitStatus).toBe("");
    expect(session.stagedDrafts).toEqual([]);
    expect(session.rows).toEqual([expect.objectContaining({ rawText: '"New project"' })]);
    finishNew(stagingReceipt("pbind_file-board_board"));
    await expect(newSubmission).resolves.toMatchObject({ status: "canonical-project-value-draft" });
    expect(session.submitting).toBe(false);
    expect(session.stagedDrafts).toHaveLength(1);
    expect(session.rows).toEqual([]);
  });

  it("accepts an explicitly null staged receipt when the Binding has no current value", async () => {
    const session = await editedCanonicalSession(["board"]);
    const binding = canonicalBinding("board");
    delete binding.currentValueId;
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [binding]),
        createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), currentValueId: null }))
      }) });
    expect(session.stagedDrafts).toEqual([expect.objectContaining({
      draftId: "pvdr_pbind_file-board_board", bindingId: "pbind_file-board_board", currentValueId: null, pending: true
    })]);
    expect(session.rows).toEqual([]);
    expect(session.isDirty).toBe(false);
    expect(session.submitStatus).toMatch(/已暂存 1 项待审核.*当前值未变/);
    expect(session.submitStatus).toContain("无当前值");
  });

  it.each(["userId", "organizationId", "projectId", "configSetId", "fileId", "baseVersionId"] as const)(
    "clears confirmed receipts when %s changes", async (field) => {
      const session = await editedCanonicalSession(["board"]);
      await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
        revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
        catalogRepository: createTestParameterTopologyRepository({
          listBindings: vi.fn(async () => [canonicalBinding("board")]),
          createBindingDraft: vi.fn(async () => stagingReceipt("pbind_file-board_board"))
        }) });
      expect(session.stagedDrafts).toHaveLength(1);
      const hydration = session.hydrate({ ...SCOPE, [field]: "other-scope" });
      expect(session.stagedDrafts).toEqual([]);
      await hydration;
      expect(session.stagedDrafts).toEqual([]);
      expect(session.submitStatus).toBe("");
    }
  );

  it("clears confirmed receipts when scope is removed", async () => {
    const session = await editedCanonicalSession(["board"]);
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => stagingReceipt("pbind_file-board_board"))
      }) });
    await session.hydrate(null);
    expect(session.stagedDrafts).toEqual([]);
    expect(session.submitStatus).toBe("");
    expect(session.submitting).toBe(false);
  });

  it.each(["success", "failure"])("ignores late staging %s after switching scope", async (outcome) => {
    const session = await editedCanonicalSession(["board"]);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const createBindingDraft = vi.fn(async () => {
      await pending;
      if (outcome === "failure") throw new Error("old-project staging failed");
      return stagingReceipt("pbind_file-board_board");
    });
    const submission = session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft
      }) }).catch(() => undefined);
    await vi.waitFor(() => expect(createBindingDraft).toHaveBeenCalledOnce());
    await session.hydrate({ ...SCOPE, projectId: "other-project" });
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Other project"', normalizedValue: "Other project", valid: true });
    session.setReason("Other project edit");
    finish();
    await submission;
    expect(session.stagedDrafts).toEqual([]);
    expect(session.rows).toEqual([expect.objectContaining({ rawText: '"Other project"' })]);
    expect(session.submitStatus).toBe("");
    expect(session.submitError).toBe("");
    expect(session.submitting).toBe(false);
  });

  it.each(["revisions", "bindings"])("ignores late %s discovery without staging in a different scope", async (lookup) => {
    const session = await editedCanonicalSession(["board"]);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const listConfigRevisions = vi.fn(async () => {
      if (lookup === "revisions") await pending;
      return [{ id: "revision-1", status: "resolved" as const, revisionNumber: 1, createdAt: "2026-08-17T10:00:00.000Z", configSetId: SCOPE.configSetId }];
    });
    const listBindings = vi.fn(async () => {
      if (lookup === "bindings") await pending;
      return [canonicalBinding("board")];
    });
    const createBindingDraft = vi.fn(async () => stagingReceipt("pbind_file-board_board"));
    const submission = session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      configSetId: SCOPE.configSetId, dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({ listConfigRevisions, listBindings, createBindingDraft })
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(lookup === "revisions" ? listConfigRevisions : listBindings).toHaveBeenCalledOnce());
    await session.hydrate({ ...SCOPE, projectId: "other-project" });
    finish();
    await expect(submission).resolves.toBeInstanceOf(Error);
    expect(createBindingDraft).not.toHaveBeenCalled();
    expect(session.stagedDrafts).toEqual([]);
    expect(session.submitError).toBe("");
    expect(session.submitStatus).toBe("");
    expect(session.submitting).toBe(false);
  });

  it.each(["success", "failure"])("ignores a late legacy submission %s after switching scope", async (outcome) => {
    const session = await editedCanonicalSession(["board"]);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const submitStructuredEdits = vi.fn(async () => {
      await pending;
      if (outcome === "failure") throw new Error("Old submission failed");
      return { id: "old-round", projectId: SCOPE.projectId, status: "submitted", items: [] };
    });
    const submission = session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      dtsRepository: { submitStructuredEdits }
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(submitStructuredEdits).toHaveBeenCalledOnce());
    await session.hydrate({ ...SCOPE, projectId: "other-project" });
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Other project"', normalizedValue: "Other project", valid: true });
    finish();
    await expect(submission).resolves.toBeInstanceOf(Error);
    expect(session.rows).toEqual([expect.objectContaining({ rawText: '"Other project"' })]);
    expect(session.submitError).toBe("");
    expect(session.submitStatus).toBe("");
    expect(session.submitting).toBe(false);
  });

  it.each([
    [undefined, undefined], [undefined, "unexpected-current"], ["ppv_board", null]
  ] as const)("keeps the edit when current-value confirmation differs: %s to %s", async (currentValueId, receiptValueId) => {
    const session = await editedCanonicalSession(["board"]);
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [{ ...canonicalBinding("board"), currentValueId }]),
        createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), currentValueId: receiptValueId }))
      }) })).rejects.toThrow(/board\/model.*未确认/);
    expect(session.rows).toHaveLength(1);
    expect(session.stagedDrafts).toEqual([]);
  });

  it("retains edits made while an earlier version is being staged", async () => {
    const session = await editedCanonicalSession(["board"]);
    const createBindingDraft = vi.fn(async () => {
      session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
        { rawText: '"Newer"', normalizedValue: "Newer", valid: true });
      return stagingReceipt("pbind_file-board_board");
    });
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({ listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft }) });
    expect(session.rows).toEqual([expect.objectContaining({ rawText: '"Newer"' })]);
    expect(session.stagedDrafts).toHaveLength(1);
  });

  it("preserves boolean removal rather than staging the still-present property", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure([{ ...NODES[0]!, properties: [{ name: "model", valueType: "bool", rawText: "", normalizedValue: "true" }] }], SCOPE.fileId);
    await session.hydrate(SCOPE);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: "", normalizedValue: "true", valid: true, present: false });
    session.setReason("Remove boolean property");
    const createBindingDraft = vi.fn(async () => stagingReceipt("pbind_file-board_board"));
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({ listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft }) });
    expect(createBindingDraft).toHaveBeenCalledWith(SCOPE.projectId, "pbind_file-board_board", {
      baseRevisionId: "revision-1", action: "delete", reason: "Remove boolean property"
    });
  });

  it("clears only confirmed edits on partial failure and reports the Definition constraint per edit", async () => {
    const storage = createMemoryStorage();
    const session = await editedCanonicalSession(["board", "sibling"], storage);
    const createBindingDraft = vi.fn(async (_projectId: string, bindingId: string) => {
      if (bindingId.endsWith("sibling")) throw new Error("Definition revision constraint: two strings required");
      return { ...stagingReceipt(bindingId), draftId: "pvdr_confirmed" };
    });
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board"), canonicalBinding("sibling")]), createBindingDraft
      }) })).rejects.toThrow(/file-board.*sibling\/model.*Definition revision constraint/);
    expect(session.rows.map((row) => row.nodePath)).toEqual(["sibling"]);
    expect(session.stagedDrafts).toEqual([expect.objectContaining({ draftId: "pvdr_confirmed", pending: true })]);
    expect(session.submitStatus).toMatch(/已暂存 1 项待审核/);
    expect(Object.keys(JSON.parse(storage.getItem(SESSION_DRAFT_STORAGE_KEY)!).buckets[0].drafts))
      .toEqual(["file-board::sibling::model"]);
  });

  it("keeps an edit when the server does not confirm canonical pending staging", async () => {
    const session = await editedCanonicalSession(["board"]);
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), draftId: "pvdr_unconfirmed", pending: false }))
      }) })).rejects.toThrow(/board\/model.*未确认/);
    expect(session.rows).toHaveLength(1);
    expect(session.stagedDrafts).toEqual([]);
  });

  it("returns a pending draft receipt with unchanged current value, not a committed value", async () => {
    const session = await editedCanonicalSession(["board"]);
    const round = await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), draftId: "pvdr_receipt" }))
      }) });
    expect(round.status).toBe("canonical-project-value-draft");
    expect(session.stagedDrafts).toEqual([{ key: "file-board::board::model", draftId: "pvdr_receipt",
      bindingId: "pbind_file-board_board", currentValueId: "ppv_board", pending: true }]);
    expect(session.submitStatus).toMatch(/已暂存.*待审核.*当前值未变/);
    expect(session.submitStatus).not.toMatch(/已写入正式项目值/);
  });

  it.each([
    ['<1 0x02>, <3 4>', { kind: "cells", bits: 32, groups: [
      [{ kind: "integer", raw: "1", value: "1" }, { kind: "integer", raw: "0x02", value: "2" }],
      [{ kind: "integer", raw: "3", value: "3" }, { kind: "integer", raw: "4", value: "4" }]
    ] }],
    ['<&clock 2>, <&reset 0>', { kind: "cells", bits: 32, groups: [
      [{ kind: "phandle", label: "clock" }, { kind: "integer", raw: "2", value: "2" }],
      [{ kind: "phandle", label: "reset" }, { kind: "integer", raw: "0", value: "0" }]
    ] }],
    ['"first", "second"', { kind: "strings", values: ["first", "second"], items: [
      { value: "first", raw: '"first"' }, { value: "second", raw: ' "second"' }
    ] }],
    ['[00 7f ff]', { kind: "bytes", values: [0, 127, 255] }]
  ])("preserves the typed editor value %s at the repository port", async (rawText, targetValue) => {
    const session = await editedCanonicalSession(["board"]);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: rawText as string, normalizedValue: "display only", valid: true });
    const createBindingDraft = vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), draftId: "pvdr_typed" }));
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]), createBindingDraft
      }) });
    expect(createBindingDraft).toHaveBeenCalledWith(SCOPE.projectId, "pbind_file-board_board", {
      baseRevisionId: "revision-1", action: "set", reason: "Stage exact source edits", targetValue
    });
  });

  it("resolves duplicate property names to each exact source occurrence, never another file", async () => {
    const session = await editedCanonicalSession();
    const createBindingDraft = vi.fn(async (_projectId: string, bindingId: string) => stagingReceipt(bindingId));
    const catalogRepository = createTestParameterTopologyRepository({
      listBindings: vi.fn(async () => [canonicalBinding("board", "other-file"), canonicalBinding("sibling"), canonicalBinding("board")]),
      createBindingDraft
    });
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", catalogRepository, dtsRepository: { submitStructuredEdits: vi.fn() } });
    expect(createBindingDraft.mock.calls.map((call) => call[1])).toEqual([
      "pbind_file-board_board", "pbind_file-board_sibling"
    ]);
    expect(session.rows).toHaveLength(0);
  });

  it("reports the missing exact Binding against the edit without falling back by name", async () => {
    const session = await editedCanonicalSession(["board"]);
    const createBindingDraft = vi.fn();
    await expect(session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits: vi.fn() },
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("sibling"), canonicalBinding("board", "other-file")]), createBindingDraft
      }) })).rejects.toThrow(/file-board.*board\/model.*Binding/);
    expect(createBindingDraft).not.toHaveBeenCalled();
    expect(session.rows).toHaveLength(1);
  });
});

describe("createStructuredEditSession", () => {
  it("restores unfinished numeric groups without collapsing empty or partial tokens", async () => {
    const storage = createMemoryStorage();
    const nodes: DtsStructuralNode[] = [{ ...NODES[0]!, properties: [
      { name: "values", valueType: "u32-array", rawText: "<4500 0>", normalizedValue: "<4500 0>" }
    ] }];
    const session = createStructuredEditSession({ storage });
    session.setStructure(nodes, SCOPE.fileId);
    await session.hydrate(SCOPE);
    const editorState = { kind: "cells" as const, bits: 32 as const, groups: [["", "0"], ["-", "0x"]] };
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "values" },
      { rawText: "< 0>, <- 0x>", normalizedValue: "pending", editorState, valid: false });
    editorState.groups[0]![0] = "caller changed";
    const copiedState = session.rows[0]?.editorState;
    expect(copiedState?.kind === "cells" && copiedState.groups).toEqual([["", "0"], ["-", "0x"]]);
    expect(session.copyText()).toContain('"groups":[["","0"],["-","0x"]]');

    const restored = createStructuredEditSession({ storage });
    restored.setStructure(nodes, SCOPE.fileId);
    await restored.hydrate(SCOPE);
    expect(restored.rows).toEqual([expect.objectContaining({ valid: false,
      editorState: { kind: "cells", bits: 32, groups: [["", "0"], ["-", "0x"]] } })]);
    expect(restored.validate().ok).toBe(false);
  });

  it("restores unconfirmed line-based string input while preserving the original DTS value", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    const text = ' first\n\nhuawei,direct_charger\na"b\n';
    const identity = { fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" };
    session.change(identity, { rawText: '"Aurora"', normalizedValue: "Aurora",
      editorState: { kind: "string-input", format: "lines", text } });
    expect(session.rows[0]?.valid).toBe(false);

    const restored = createStructuredEditSession({ storage });
    restored.setStructure(NODES, SCOPE.fileId);
    await restored.hydrate(SCOPE);
    expect(restored.rows).toEqual([expect.objectContaining({ rawText: '"Aurora"', valid: false,
      error: "批量输入待确认。", editorState: { kind: "string-input", format: "lines", text } })]);
    expect(restored.validate().ok).toBe(false);
    restored.change(identity, { rawText: '"confirmed"', normalizedValue: "confirmed", valid: true });
    expect(restored.rows[0]?.editorState).toBeUndefined();
    expect(restored.validate().ok).toBe(true);
  });

  it("restores numeric bulk text with the unfinished source groups it will replace or append to", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    const editorState = { kind: "numeric-input" as const, format: "table" as const, text: "12\t14\n0x", source: {
      kind: "cells" as const, bits: 32 as const, groups: [["", "0"], ["-", "0x"]]
    } };
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: "< 0>, <- 0x>", normalizedValue: "pending", editorState });
    const restored = createStructuredEditSession({ storage });
    restored.setStructure(NODES, SCOPE.fileId);
    await restored.hydrate(SCOPE);
    expect(restored.rows).toEqual([expect.objectContaining({ rawText: "< 0>, <- 0x>", valid: false,
      error: "批量输入待确认。", editorState })]);
    expect(restored.copyText()).toContain('"text":"12\\t14\\n0x"');
    expect(restored.validate().ok).toBe(false);
  });

  it("rechecks recovered syntax instead of trusting old valid flags or errors", async () => {
    const storage = createMemoryStorage({ [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, buckets: [{
      scope: SCOPE, drafts: {
        "file-board::board::model": { rawText: "<0xGG>", normalizedValue: "claimed valid", valid: true },
        "file-board::board::compatible": { rawText: '"valid"', normalizedValue: "valid", valid: false, error: "outdated" }
      }, selectedKeys: [], reason: "restored", updatedAt: "2026-10-19T00:00:00.000Z"
    }] }) });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    expect(session.rows.find((row) => row.propertyName === "model")).toMatchObject({ valid: false });
    expect(session.rows.find((row) => row.propertyName === "compatible")).toMatchObject({ valid: true });
    expect(session.rows.find((row) => row.propertyName === "compatible")?.error).toBeUndefined();
  });

  it("finishes synchronous local recovery before accepting the next edit", async () => {
    const storage = createMemoryStorage();
    const original = await editedCanonicalSession(["board"], storage);
    expect(original.rows).toHaveLength(1);
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, SCOPE.fileId);
    const hydration = session.hydrate(SCOPE);
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Typed immediately"', normalizedValue: "Typed immediately", valid: true });
    await hydration;
    expect(session.rows[0]?.rawText).toBe('"Typed immediately"');
  });

  it("publishes local storage failures and clears the warning after persistence succeeds", async () => {
    const storage = createMemoryStorage();
    let unavailable = false;
    const session = createStructuredEditSession({ storage: {
      getItem: storage.getItem,
      setItem(key, value) { if (unavailable) throw new Error("full"); storage.setItem(key, value); },
      removeItem(key) { if (unavailable) throw new Error("denied"); storage.removeItem(key); }
    } });
    session.setStructure(NODES, SCOPE.fileId);
    await session.hydrate(SCOPE);
    const notifications: string[] = [];
    session.subscribe(() => notifications.push(session.storageError));
    unavailable = true;
    session.change({ fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" },
      { rawText: '"Keep me"', normalizedValue: "Keep me", valid: true });
    expect(session.storageError).toMatch(/仅当前页面保留/);
    expect(notifications.at(-1)).toBe(session.storageError);
    expect(session.copyText()).toContain("Keep me");
    unavailable = false;
    session.setReason("retry write");
    expect(session.storageError).toBe("");
    unavailable = true;
    session.discard();
    expect(session.storageError).toMatch(/无法清理本地草稿/);
  });

  it.each(["canonical", "legacy"])("keeps new unfinished input with the same serialized text during %s saving", async (mode) => {
    const session = await editedCanonicalSession(["board"]);
    const identity = { fileId: SCOPE.fileId, nodePath: "board", propertyName: "model" };
    session.change(identity, { rawText: "< 0>", normalizedValue: "<0>", valid: true });
    const typeDuringSave = () => session.change(identity, { rawText: "< 0>", normalizedValue: "<0>",
      valid: false, editorState: { kind: "cells", bits: 32, groups: [["", "0"]] } });
    const submitStructuredEdits = vi.fn(async () => {
      typeDuringSave();
      return { id: "round-later", projectId: SCOPE.projectId, status: "submitted", items: [] };
    });
    await session.submit({ projectId: SCOPE.projectId, fileId: SCOPE.fileId, fileName: "board.dts",
      revisionId: "revision-1", dtsRepository: { submitStructuredEdits },
      ...(mode === "canonical" ? { catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => { typeDuringSave(); return stagingReceipt("pbind_file-board_board"); })
      }) } : {}) });
    expect(session.rows).toEqual([expect.objectContaining({ rawText: "< 0>", valid: false,
      editorState: { kind: "cells", bits: 32, groups: [["", "0"]] } })]);
    expect(session.isDirty).toBe(true);
  });

  it("hydrates compatible drafts from storage and reports isDirty / rows", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: SCOPE,
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-X"',
                normalizedValue: "Aurora-X",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "bump",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    expect(session.isDirty).toBe(true);
    expect(session.isStaleBase).toBe(false);
    expect(session.reason).toBe("bump");
    expect(session.rows).toHaveLength(1);
    expect(session.rows[0]?.propertyName).toBe("model");
    expect(session.selectedKeys.has("file-board::board::model")).toBe(true);
  });

  it("marks recovered drafts stale-base and blocks validate/submit until recover()", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: { ...SCOPE, baseVersionId: "ver-old" },
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-X"',
                normalizedValue: "Aurora-X",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "bump",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    expect(session.isStaleBase).toBe(true);
    expect(session.validate().ok).toBe(false);
    expect(session.validate().message).toMatch(/基线版本已变更/);

    const submitStructuredEdits = vi.fn();
    await expect(
      session.submit({
        projectId: SCOPE.projectId,
        fileId: SCOPE.fileId,
        fileName: "aurora-board.dts",
        dtsRepository: { submitStructuredEdits }
      })
    ).rejects.toThrow(/基线版本已变更/);
    expect(submitStructuredEdits).not.toHaveBeenCalled();

    session.recover();
    expect(session.isStaleBase).toBe(false);
    expect(session.submitStatus).toBe("已基于当前基线继续编辑；保存时会自动校验。");
    expect(session.validate().ok).toBe(true);
  });

  it("ignores late hydrate recovery from a previous scope generation", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");

    const first = session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"live"', normalizedValue: "live", valid: true }
    );
    await session.hydrate({ ...SCOPE, fileId: "file-other" });
    await first;

    expect(session.drafts["file-board::board::model"]).toBeUndefined();
    expect(Object.keys(session.drafts)).toHaveLength(0);
  });

  it("validates and submits a selected subset via narrow submitStructuredEdits Pick", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);

    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "compatible" },
      { rawText: '"wiseeff,aurora-v2"', normalizedValue: "wiseeff,aurora-v2", valid: true }
    );
    session.selectSubset(["file-board::board::model"]);
    session.setReason("board model bump");

    expect(session.validate()).toEqual({ ok: true, message: "本地输入检查通过：1 项；保存时仍需核对固定参数定义。" });

    const submitStructuredEdits = vi.fn().mockResolvedValue({
      id: "round-1",
      projectId: SCOPE.projectId,
      status: "submitted",
      items: []
    });
    const round = await session.submit({
      projectId: SCOPE.projectId,
      fileId: SCOPE.fileId,
      fileName: "aurora-board.dts",
      dtsRepository: { submitStructuredEdits }
    });

    expect(round.id).toBe("round-1");
    expect(submitStructuredEdits).toHaveBeenCalledWith(
      SCOPE.projectId,
      expect.objectContaining({
        edits: [
          expect.objectContaining({
            fileId: "file-board",
            nodePath: "board",
            propertyName: "model",
            rawText: expect.stringMatching(/Aurora-X/),
            reason: "board model bump"
          })
        ],
        reason: "board model bump"
      })
    );
    expect(submitStructuredEdits.mock.calls[0][1].edits).toHaveLength(1);
    expect(session.rows.map((row) => row.propertyName)).toEqual(["compatible"]);
    expect(session.submitStatus).toMatch(/已提交变更请求/);
  });

  it("stages canonical drafts through the repository and does not call legacy structured edits", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage, now: () => "2026-01-01T00:00:00.000Z" });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: "<24>", normalizedValue: "24", valid: true }
    );
    session.setReason("official save");
    const submitStructuredEdits = vi.fn();
    const round = await session.submit({
      projectId: SCOPE.projectId,
      fileId: SCOPE.fileId,
      fileName: "aurora-board.dts",
      dtsRepository: { submitStructuredEdits },
      revisionId: "revision-1",
      catalogRepository: createTestParameterTopologyRepository({
        listBindings: vi.fn(async () => [canonicalBinding("board")]),
        createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), draftId: "pvdr_24" }))
      })
    });
    expect(submitStructuredEdits).not.toHaveBeenCalled();
    expect(round.status).toBe("canonical-project-value-draft");
    expect(session.submitStatus).toMatch(/已暂存.*待审核/);
    expect(session.rows).toEqual([]);
  });

  it("fails closed when canonical staging does not confirm the unchanged current value", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage, now: () => "2026-01-01T00:00:00.000Z" });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: "<24>", normalizedValue: "24", valid: true }
    );
    session.setReason("official save");
    const submitStructuredEdits = vi.fn();
    await expect(
      session.submit({
        projectId: SCOPE.projectId,
        fileId: SCOPE.fileId,
        fileName: "aurora-board.dts",
        dtsRepository: { submitStructuredEdits },
        revisionId: "revision-1",
        catalogRepository: createTestParameterTopologyRepository({
          listBindings: vi.fn(async () => [canonicalBinding("board")]),
          createBindingDraft: vi.fn(async () => ({ ...stagingReceipt("pbind_file-board_board"), currentValueId: "ppv_other" }))
        })
      })
    ).rejects.toThrow(/未确认待审核/);
    expect(submitStructuredEdits).not.toHaveBeenCalled();
    expect(session.rows).toHaveLength(1);
  });

  it("preserves drafts when submitStructuredEdits fails", async () => {
    const session = createStructuredEditSession({ storage: createMemoryStorage() });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    session.setReason("fail me");

    const submitStructuredEdits = vi.fn().mockRejectedValue(new Error("submit failed"));
    await expect(
      session.submit({
        projectId: SCOPE.projectId,
        fileId: SCOPE.fileId,
        fileName: "aurora-board.dts",
        dtsRepository: { submitStructuredEdits }
      })
    ).rejects.toThrow("submit failed");

    expect(session.rows).toHaveLength(1);
    expect(session.submitError).toBe("submit failed");
  });

  it("discard clears memory and storage bucket", async () => {
    const storage = createMemoryStorage();
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate(SCOPE);
    session.change(
      { fileId: "file-board", nodePath: "board", propertyName: "model" },
      { rawText: '"Aurora-X"', normalizedValue: "Aurora-X", valid: true }
    );
    // Allow persist effect path
    await Promise.resolve();
    await Promise.resolve();

    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeTruthy();
    session.discard();
    expect(session.isDirty).toBe(false);
    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not restore drafts when hydrate scope userId differs from stored bucket", async () => {
    const storage = createMemoryStorage({
      [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        buckets: [
          {
            scope: SCOPE,
            drafts: {
              "file-board::board::model": {
                rawText: '"Aurora-UserA"',
                normalizedValue: "Aurora-UserA",
                valid: true
              }
            },
            selectedKeys: ["file-board::board::model"],
            reason: "user-a only",
            updatedAt: "2026-08-01T00:00:00.000Z"
          }
        ]
      })
    });
    const session = createStructuredEditSession({ storage });
    session.setStructure(NODES, "file-board");
    await session.hydrate({ ...SCOPE, userId: "user-b" });

    expect(session.isDirty).toBe(false);
    expect(session.rows).toHaveLength(0);
    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeTruthy();
  });
});
