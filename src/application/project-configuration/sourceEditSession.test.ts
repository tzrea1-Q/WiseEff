import { describe, expect, it } from "vitest";
import { createSourceEditSession } from "./sourceEditSession";
import {
  createSourceDraftStorage,
  SourceDraftConflictError,
  sourceDraftKey,
  type SourceDraftBase,
  type SourceDraftRecord,
  type SourceDraftScope,
  type SourceDraftStorage,
  type StoredSourceDraft
} from "./sourceDraftStorage";

const scope: SourceDraftScope = { userId: "u", organizationId: "o", projectId: "p", configSetId: "c", fileId: "f" };
const base: SourceDraftBase = { fileVersionId: "v1", configRevisionId: "c1", sourceDigest: "digest1" };
const nextBase: SourceDraftBase = { fileVersionId: "v2", configRevisionId: "c2", sourceDigest: "digest2" };

it("keeps a newly prepared exact node intent when a clean persisted source is reopened after navigation", async () => {
  const storage = memoryStorage();
  const first = createSourceEditSession({ storage, persistDelayMs: 0 });
  await first.open({ scope, base, sourceText: "before" });
  first.change(scope, "discarded");
  await first.discard(scope); await first.close();
  const intent = { input: { expectedConfigRevisionId: "c1", logicalNodeId: "logical", propertyName: "status", action: "delete-node" as const }, afterValue: null };
  const reopened = createSourceEditSession({ storage, persistDelayMs: 0 });
  await reopened.open({ scope, base: { ...base, localOverride: intent }, sourceText: "before" });
  reopened.change(scope, "before\n/delete-node/ device;");
  expect(reopened.captureSave(scope).base.localOverride).toEqual(intent);
  await reopened.close();
});

it("recovers the restricted local override intent with the exact source draft and clears it on discard", async () => {
  const storage=memoryStorage();
  const intent={input:{expectedConfigRevisionId:"c1",logicalNodeId:"logical",propertyName:"rate",action:"set" as const,rawText:"<2>"},afterValue:"<2>"};
  const first=createSourceEditSession({storage,persistDelayMs:0});
  await first.open({scope,base:{...base,localOverride:intent},sourceText:"before"});first.change(scope,"after");await first.flush();
  const recovered=createSourceEditSession({storage,persistDelayMs:0});
  await recovered.open({scope,base,sourceText:"before"});
  expect(recovered.captureSave(scope)).toMatchObject({sourceText:"after",base:{localOverride:intent}});
  await recovered.discard(scope);expect(recovered.getFile(scope)?.base.localOverride).toBeUndefined();
  await first.close();await recovered.close();
});

function memoryStorage(): SourceDraftStorage & { records: Map<string, StoredSourceDraft> } {
  const records = new Map<string, StoredSourceDraft>();
  return {
    records,
    async load(key) { return structuredClone(records.get(sourceDraftKey(key)) ?? { generation: 0, draft: null }); },
    async compareAndSet(key, draft, expectedGeneration) {
      const stored = records.get(sourceDraftKey(key));
      if ((stored?.generation ?? 0) !== expectedGeneration) throw new SourceDraftConflictError();
      const generation = expectedGeneration + 1;
      records.set(sourceDraftKey(key), structuredClone({ generation, draft }));
      return generation;
    },
    close() {}
  };
}

describe("whole-source draft recovery", () => {
  it("keeps the original draft and merge base through leaving and returning, and saves after resolving conflicts", async () => {
    const storage = memoryStorage();
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "a\nb\n" });
    session.change(scope, "local\nb\n");
    await session.open({ scope, base: nextBase, sourceText: "remote\nb\n" });
    expect(session.rebase(scope)).toEqual({ conflicts: true });
    const merged = session.getFile(scope)!.sourceText;
    expect(() => session.captureSave(scope)).toThrow("冲突");
    expect(await session.close()).toBe(true);
    const returned = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await returned.open({ scope, base: nextBase, sourceText: "remote\nb\n" });
    expect(returned.getFile(scope)).toMatchObject({ sourceText: merged, base: nextBase, dirty: true, mergeConflicts: true,
      originalDraft: { base, sourceText: "local\nb\n", baseSourceText: "a\nb\n" } });
    returned.change(scope, "resolved\nb\n");
    const saved = returned.captureSave(scope);
    expect(saved.sourceText).toBe("resolved\nb\n");
    returned.acknowledgeApplied(saved, { ...nextBase, fileVersionId: "v3" });
    expect(returned.getFile(scope)?.originalDraft).toBeUndefined();
    await returned.close();
  });

  it("rebases a clean merge onto the latest base but retains it as an unsaved draft", async () => {
    const session = createSourceEditSession({ storage: memoryStorage() });
    await session.open({ scope, base, sourceText: "a\nb\n" });
    session.change(scope, "A\nb\n");
    await session.open({ scope, base: nextBase, sourceText: "a\nB\n" });
    expect(session.rebase(scope)).toEqual({ conflicts: false });
    expect(session.getFile(scope)).toMatchObject({ sourceText: "A\nB\n", dirty: true, recoveryStatus: "compatible", base: nextBase });
    expect(session.captureSave(scope).base).toEqual(nextBase);
    await session.close();
  });

  it("reads an old recovery record's historical base without overwriting the draft on a failed rebase", async () => {
    const storage = memoryStorage();
    const first = createSourceEditSession({ storage });
    await first.open({ scope, base, sourceText: "a\nb\n" });
    first.change(scope, "A\nb\n"); await first.close();
    delete storage.records.get(sourceDraftKey(scope))!.draft!.baseSourceText;
    const returned = createSourceEditSession({ storage });
    await returned.open({ scope, base: nextBase, sourceText: "a\nB\n" });
    expect(() => returned.rebase(scope)).toThrow("原始基线");
    expect(returned.getFile(scope)?.sourceText).toBe("A\nb\n");
    expect(returned.rebase(scope, "a\nb\n")).toEqual({ conflicts: false });
    expect(returned.getFile(scope)?.sourceText).toBe("A\nB\n");
    await returned.close();
  });

  it("recovers exact BOM, CRLF, unfinished text and positions, isolated by every scope field", async () => {
    const storage = memoryStorage();
    const first = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await first.open({ scope, base, sourceText: "/ {};\r\n" });
    const sourceText = '\ufeff/ {\r\n values = /bits/ 64 <9007199254740993>;\r\n names = "", "same", "same", "unfinished';
    const position = { anchor: 5, head: 8, firstVisibleLine: 2, scrollTop: 20, scrollLeft: 30 };
    first.change(scope, sourceText, position);
    expect(await first.flush()).toBe(true);
    const second = createSourceEditSession({ storage });
    await second.open({ scope, base, sourceText: "/ {};\r\n" });
    expect(second.getFile(scope)).toMatchObject({ sourceText, position, dirty: true, recoveryStatus: "compatible", recoveryPending: false });
    for (const field of Object.keys(scope) as (keyof SourceDraftScope)[]) {
      const another = { ...scope, [field]: "other" };
      await second.open({ scope: another, base, sourceText: "other source" });
      expect(second.getFile(another)).toMatchObject({ sourceText: "other source", dirty: false, recoveryStatus: "none" });
    }
    await first.close(); await second.close();
  });

  it("preserves independent file buffers and blocks stale-base submission without changing the recovered text", async () => {
    const storage = memoryStorage();
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    const other = { ...scope, fileId: "f2" };
    await session.open({ scope, base, sourceText: "base" });
    await session.open({ scope: other, base, sourceText: "other" });
    session.change(scope, "local incomplete {");
    session.change(other, "second file");
    await session.flush();
    await session.open({ scope, base: nextBase, sourceText: "remote change" });
    expect(session.getFile(scope)).toMatchObject({ sourceText: "local incomplete {", base, latestBase: nextBase, recoveryStatus: "stale-base" });
    expect(() => session.captureSave(scope)).toThrow("旧版本");
    expect(session.getFile(other)?.sourceText).toBe("second file");
    await session.close();
    const recovered = createSourceEditSession({ storage });
    await recovered.open({ scope, base: nextBase, sourceText: "remote change" });
    expect(recovered.getFile(scope)).toMatchObject({ sourceText: "local incomplete {", recoveryStatus: "stale-base" });
    expect(await recovered.discard(scope)).toBe(true);
    expect(recovered.getFile(scope)).toMatchObject({ sourceText: "remote change", base: nextBase, dirty: false });
    await recovered.close();
  });

  it("discards a recovery copy even when leaving before its initial read completes", async () => {
    const storage = memoryStorage();
    const first = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await first.open({ scope, base, sourceText: "base" });
    first.change(scope, "old local draft");
    await first.close();
    const load = storage.load.bind(storage);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    storage.load = async (key) => { await pending; return load(key); };
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    const opening = session.open({ scope, base: nextBase, sourceText: "latest source" });
    const discarding = session.discard(scope);
    expect(session.getFile(scope)?.loading).toBe(true);
    release();
    await opening;
    expect(await discarding).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "latest source", base: nextBase, dirty: false, recoveryPending: false });
    await session.close();
    const reopened = createSourceEditSession({ storage });
    await reopened.open({ scope, base: nextBase, sourceText: "latest source" });
    expect(reopened.getFile(scope)).toMatchObject({ sourceText: "latest source", dirty: false, recoveryStatus: "none" });
    await reopened.close();
  });

  it("does not let old submission/application receipts clear newer input or overwrite a later loaded base", async () => {
    const session = createSourceEditSession({ storage: memoryStorage(), persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "original" });
    session.change(scope, "submitted");
    const saved = session.captureSave(scope);
    session.change(scope, "newer input");
    expect(session.markSubmitted(saved, { candidateId: "candidate", requestId: "request" })).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "newer input", dirty: true, submission: { submittedGeneration: saved.generation } });
    expect(session.acknowledgeApplied(saved, nextBase)).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "newer input", base: nextBase, dirty: true, recoveryStatus: "compatible" });
    expect(session.getFile(scope)?.submission).toBeUndefined();
    expect(session.acknowledgeApplied(saved, base)).toBe(false);
    await session.close();
  });

  it("retains typing that arrives during a discard write", async () => {
    const storage = memoryStorage();
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "base" });
    session.change(scope, "discard this");
    await session.flush();
    const write = storage.compareAndSet.bind(storage);
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    storage.compareAndSet = async (...args) => { started(); await pending; return write(...args); };
    const discarding = session.discard(scope);
    await inFlight;
    session.change(scope, "new input");
    release();
    expect(await discarding).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "new input", dirty: true, recoveryPending: false });
    expect(storage.records.get(sourceDraftKey(scope))?.draft?.sourceText).toBe("new input");
    await session.close();
  });

  it("retains typing while discard is queued behind an earlier write", async () => {
    const storage = memoryStorage();
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "base" });
    const write = storage.compareAndSet.bind(storage);
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    storage.compareAndSet = async (...args) => { started(); await pending; return write(...args); };
    session.change(scope, "old input");
    const flushing = session.flush();
    await inFlight;
    const discarding = session.discard(scope);
    await Promise.resolve();
    session.change(scope, "new input");
    release();
    expect(await discarding).toBe(true);
    expect(await flushing).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "new input", dirty: true, recoveryPending: false });
    expect(storage.records.get(sourceDraftKey(scope))?.draft?.sourceText).toBe("new input");
    await session.close();
  });

  it("persists typing that arrives while a previous IndexedDB write is in flight", async () => {
    const storage = memoryStorage();
    const write = storage.compareAndSet.bind(storage);
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    storage.compareAndSet = async (...args) => {
      if (first) { first = false; started(); await pending; }
      return write(...args);
    };
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "base" });
    session.change(scope, "first");
    const flushing = session.flush();
    await inFlight;
    session.change(scope, "second");
    release();
    expect(await flushing).toBe(true);
    expect(storage.records.get(sourceDraftKey(scope))?.draft?.sourceText).toBe("second");
    expect(session.getFile(scope)?.recoveryPending).toBe(false);
    await session.close();
  });

  it("does not regress a later observed authoritative version when an older approval response arrives", async () => {
    const session = createSourceEditSession({ storage: memoryStorage(), persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "v1 source" });
    session.change(scope, "submitted v2");
    const saved = session.captureSave(scope);
    session.markSubmitted(saved, { candidateId: "candidate", requestId: "request" });
    session.change(scope, "later local input");
    const thirdBase = { fileVersionId: "v3", configRevisionId: "c3", sourceDigest: "digest3" };
    await session.open({ scope, base: thirdBase, sourceText: "v3 remote source" });
    expect(session.acknowledgeApplied(saved, nextBase)).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "later local input", base: nextBase,
      latestBase: thirdBase, recoveryStatus: "stale-base", dirty: true });
    expect(() => session.captureSave(scope)).toThrow("旧版本");
    await session.discard(scope);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "v3 remote source", base: thirdBase, dirty: false });
    await session.close();
  });

  it("prevents a second tab from overwriting recovery, retaining its editable/downloadable buffer", async () => {
    const storage = memoryStorage();
    const first = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    const second = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await Promise.all([first.open({ scope, base, sourceText: "base" }), second.open({ scope, base, sourceText: "base" })]);
    first.change(scope, "first tab");
    expect(await first.flush()).toBe(true);
    second.change(scope, "second tab");
    expect(await second.flush()).toBe(false);
    expect(second.getFile(scope)).toMatchObject({ sourceText: "second tab", dirty: true, storageConflict: true, recoveryPending: true });
    expect(second.getFile(scope)?.storageError).toContain("另一标签页");
    expect(storage.records.get(sourceDraftKey(scope))?.draft?.sourceText).toBe("first tab");
    expect(await second.discard(scope)).toBe(false);
    expect(second.getFile(scope)).toMatchObject({ sourceText: "second tab", dirty: true, storageConflict: true });
    expect(storage.records.get(sourceDraftKey(scope))?.draft?.sourceText).toBe("first tab");
    await first.close();
  });

  it("exposes storage failure and retries without pretending unsaved text is recoverable", async () => {
    const storage = memoryStorage();
    const write = storage.compareAndSet.bind(storage);
    storage.compareAndSet = async () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "base" });
    session.change(scope, "download me");
    expect(await session.flush()).toBe(false);
    expect(session.getFile(scope)).toMatchObject({ sourceText: "download me", storageError: "Quota exceeded", recoveryPending: true });
    storage.compareAndSet = write;
    expect(await session.flush()).toBe(true);
    expect(session.getFile(scope)).toMatchObject({ storageError: "", recoveryPending: false });
    await session.close();
  });

  it("persists refreshed clean bases so a reload cannot revive the old clean source as a stale draft", async () => {
    const storage = memoryStorage();
    const session = createSourceEditSession({ storage, persistDelayMs: 60_000 });
    await session.open({ scope, base, sourceText: "old" });
    session.setPosition(scope, { anchor: 1, head: 1, firstVisibleLine: 1, scrollTop: 0, scrollLeft: 0 });
    await session.flush();
    await session.open({ scope, base: nextBase, sourceText: "new" });
    await session.close();
    const recovered = createSourceEditSession({ storage });
    await recovered.open({ scope, base: nextBase, sourceText: "new" });
    expect(recovered.getFile(scope)).toMatchObject({ sourceText: "new", dirty: false, recoveryStatus: "none" });
    await recovered.close();
  });
});

describe("native IndexedDB boundary", () => {
  it("reports unavailable IndexedDB instead of falling back to synchronous localStorage", async () => {
    const storage = createSourceDraftStorage(undefined);
    // Vitest's DOM environment does not provide IndexedDB.
    await expect(storage.load(scope)).rejects.toThrow("IndexedDB");
  });

  it("validates records before starting native writes and preserves exact scope keys", async () => {
    const storage = createSourceDraftStorage(undefined);
    const invalid = { version: 1, scope, base, sourceText: "text", generation: 1,
      updatedAt: "now", position: { anchor: 0, head: 0, firstVisibleLine: 1, scrollTop: 0 } } as SourceDraftRecord;
    await expect(storage.compareAndSet(scope, invalid, 0)).rejects.toThrow("损坏");
    expect(sourceDraftKey({ ...scope, fileId: "f::x" })).not.toBe(sourceDraftKey({ ...scope, configSetId: "c::f", fileId: "x" }));
  });
});
