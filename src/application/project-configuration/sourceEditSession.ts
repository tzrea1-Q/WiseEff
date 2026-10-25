import {
  createSourceDraftStorage,
  sameSourceDraftBase,
  SourceDraftConflictError,
  sourceDraftKey,
  type SourceDraftBase,
  type SourceDraftPosition,
  type SourceDraftRecord,
  type SourceDraftScope,
  type SourceDraftStorage,
  type SourceDraftSubmission
} from "./sourceDraftStorage";
import { hasSourceMergeConflicts, mergeSourceText } from "./sourceTextMerge";

export type SourceEditSaveSnapshot = {
  scope: SourceDraftScope;
  base: SourceDraftBase;
  sourceText: string;
  generation: number;
};

export type SourceEditFileSnapshot = SourceEditSaveSnapshot & {
  baseSourceText?: string;
  originalDraft?: SourceDraftRecord["originalDraft"];
  rebased: boolean;
  mergeConflicts: boolean;
  latestBase: SourceDraftBase;
  position: SourceDraftPosition;
  dirty: boolean;
  loading: boolean;
  recoveryStatus: "none" | "compatible" | "stale-base";
  storageError: string;
  storageConflict: boolean;
  persisting: boolean;
  recoveryPending: boolean;
  submission?: SourceDraftSubmission;
};

export type SourceEditSessionSnapshot = { files: Readonly<Record<string, SourceEditFileSnapshot>> };
export type SourceEditOpenInput = { scope: SourceDraftScope; base: SourceDraftBase; sourceText: string };
export type SourceEditSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SourceEditSessionSnapshot;
  getFile(scope: SourceDraftScope): SourceEditFileSnapshot | undefined;
  open(input: SourceEditOpenInput): Promise<void>;
  change(scope: SourceDraftScope, sourceText: string, position?: SourceDraftPosition): void;
  rebase(scope: SourceDraftScope, originalBaseText?: string): { conflicts: boolean };
  setPosition(scope: SourceDraftScope, position: SourceDraftPosition): void;
  flush(scope?: SourceDraftScope): Promise<boolean>;
  captureSave(scope: SourceDraftScope): SourceEditSaveSnapshot;
  markSubmitted(snapshot: SourceEditSaveSnapshot, receipt: { candidateId: string; requestId?: string }): boolean;
  acknowledgeApplied(snapshot: SourceEditSaveSnapshot, base: SourceDraftBase): boolean;
  discard(scope: SourceDraftScope): Promise<boolean>;
  close(): Promise<boolean>;
};

const initialPosition = (): SourceDraftPosition => ({ anchor: 0, head: 0, firstVisibleLine: 1, scrollTop: 0, scrollLeft: 0 });
const storageErrorMessage = (error: unknown, fallback: string): string => error && typeof error === "object"
  && "message" in error && typeof error.message === "string" ? error.message : fallback;

type FileState = {
  scope: SourceDraftScope;
  base: SourceDraftBase;
  baseSourceText?: string;
  originalDraft?: SourceDraftRecord["originalDraft"];
  rebased?: boolean;
  latestBase: SourceDraftBase;
  latestSourceText: string;
  sourceText: string;
  position: SourceDraftPosition;
  generation: number;
  storedGeneration: number;
  persistedGeneration: number;
  loading: boolean;
  recoveryStatus: SourceEditFileSnapshot["recoveryStatus"];
  storageError: string;
  storageConflict: boolean;
  persisting: boolean;
  submission?: SourceDraftSubmission;
  ready: Promise<void>;
  writes: Promise<boolean>;
  timer?: ReturnType<typeof setTimeout>;
};

function clampPosition(position: SourceDraftPosition, length: number): SourceDraftPosition {
  const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return {
    anchor: Math.min(length, Math.floor(nonnegative(position.anchor))),
    head: Math.min(length, Math.floor(nonnegative(position.head))),
    firstVisibleLine: Math.max(1, Math.floor(nonnegative(position.firstVisibleLine))),
    scrollTop: nonnegative(position.scrollTop),
    scrollLeft: nonnegative(position.scrollLeft)
  };
}

/** Exact text is retained, including BOM, CRLF and unfinished source; the editor owns serialization. */
export function createSourceEditSession(options: {
  storage?: SourceDraftStorage;
  now?: () => string;
  persistDelayMs?: number;
} = {}): SourceEditSession {
  const storage = options.storage ?? createSourceDraftStorage();
  const now = options.now ?? (() => new Date().toISOString());
  const files = new Map<string, FileState>();
  const listeners = new Set<() => void>();
  let snapshot: SourceEditSessionSnapshot = { files: {} };
  let closed = false;

  function dirty(file: FileState): boolean {
    return Boolean(file.rebased) || file.sourceText !== file.latestSourceText || !sameSourceDraftBase(file.base, file.latestBase);
  }
  function publish(): void {
    const next: Record<string, SourceEditFileSnapshot> = {};
    for (const [key, file] of files) next[key] = {
      scope: { ...file.scope }, base: { ...file.base }, latestBase: { ...file.latestBase },
      sourceText: file.sourceText, generation: file.generation, position: { ...file.position },
      baseSourceText: file.baseSourceText, originalDraft: file.originalDraft ? structuredClone(file.originalDraft) : undefined,
      rebased: Boolean(file.rebased), mergeConflicts: Boolean(file.rebased && hasSourceMergeConflicts(file.sourceText)),
      dirty: dirty(file), loading: file.loading, recoveryStatus: file.recoveryStatus,
      storageError: file.storageError, storageConflict: file.storageConflict,
      persisting: file.persisting, recoveryPending: file.persistedGeneration !== file.generation,
      ...(file.submission ? { submission: { ...file.submission } } : {})
    };
    snapshot = { files: next };
    for (const listener of listeners) listener();
  }
  function fileFor(scope: SourceDraftScope): FileState {
    if (closed) throw new Error("DTS 编辑会话已关闭。");
    const file = files.get(sourceDraftKey(scope));
    if (!file) throw new Error("DTS 文件尚未打开。");
    if (file.loading) throw new Error("正在恢复 DTS 草稿，请稍后编辑。");
    return file;
  }
  function queuePersist(file: FileState): Promise<boolean> {
    clearTimeout(file.timer);
    file.timer = undefined;
    file.writes = file.writes.then(async () => {
      if (file.storageConflict) return false;
      if (file.persistedGeneration === file.generation) return true;
      const record: SourceDraftRecord = {
        version: 1, scope: { ...file.scope }, base: { ...file.base }, sourceText: file.sourceText,
        baseSourceText: file.baseSourceText, originalDraft: file.originalDraft, rebased: file.rebased,
        position: { ...file.position }, generation: file.generation, updatedAt: now(),
        ...(file.submission ? { submission: { ...file.submission } } : {})
      };
      file.persisting = true;
      publish();
      try {
        file.storedGeneration = await storage.compareAndSet(file.scope, record, file.storedGeneration);
        file.persistedGeneration = record.generation;
        file.storageError = "";
        return true;
      } catch (error) {
        file.storageError = storageErrorMessage(error, "保存 DTS 恢复草稿失败。");
        file.storageConflict = error instanceof SourceDraftConflictError;
        return false;
      } finally { file.persisting = false; publish(); }
    });
    return file.writes;
  }
  function changed(file: FileState): void {
    file.generation += 1;
    clearTimeout(file.timer);
    file.timer = setTimeout(() => { void queuePersist(file); }, options.persistDelayMs ?? 400);
    publish();
  }
  async function flush(scope?: SourceDraftScope): Promise<boolean> {
    const selected = scope ? [files.get(sourceDraftKey(scope))].filter((file): file is FileState => !!file) : [...files.values()];
    const results = await Promise.all(selected.map(async (file) => {
      await file.ready;
      // A keystroke during an IndexedDB transaction remains pending and is flushed by the next transaction.
      let ok = await queuePersist(file);
      while (ok && file.persistedGeneration !== file.generation) ok = await queuePersist(file);
      return ok;
    }));
    return results.every(Boolean);
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getFile: (scope) => snapshot.files[sourceDraftKey(scope)],
    async open(input) {
      if (closed) throw new Error("DTS 编辑会话已关闭。");
      const key = sourceDraftKey(input.scope);
      const existing = files.get(key);
      if (existing) {
        await existing.ready;
        const wasDirty = dirty(existing);
        existing.latestBase = { ...input.base };
        existing.latestSourceText = input.sourceText;
        if (!wasDirty) {
          const baseChanged = !sameSourceDraftBase(existing.base, input.base) || existing.sourceText !== input.sourceText;
          existing.base = { ...input.base };
          existing.sourceText = input.sourceText;
          existing.baseSourceText = input.sourceText;
          existing.position = clampPosition(existing.position, input.sourceText.length);
          if (baseChanged) changed(existing);
        }
        existing.recoveryStatus = sameSourceDraftBase(existing.base, input.base)
          ? (dirty(existing) ? "compatible" : "none") : "stale-base";
        publish();
        return;
      }
      const file: FileState = {
        scope: { ...input.scope }, base: { ...input.base }, latestBase: { ...input.base },
        latestSourceText: input.sourceText, sourceText: input.sourceText, position: initialPosition(),
        baseSourceText: input.sourceText,
        generation: 0, storedGeneration: 0, persistedGeneration: 0, loading: true,
        recoveryStatus: "none", storageError: "", storageConflict: false, persisting: false,
        ready: Promise.resolve(), writes: Promise.resolve(true)
      };
      files.set(key, file);
      file.ready = (async () => {
        try {
          const stored = await storage.load(file.scope);
          file.storedGeneration = stored.generation;
          if (stored.draft) {
            const draft = stored.draft;
            file.base = { ...(sameSourceDraftBase(draft.base, input.base) && !draft.rebased && draft.sourceText === input.sourceText
              ? input.base : draft.base) };
            file.sourceText = draft.sourceText;
            file.baseSourceText = draft.baseSourceText ?? (sameSourceDraftBase(draft.base, input.base) ? input.sourceText : undefined);
            file.originalDraft = draft.originalDraft;
            file.rebased = draft.rebased;
            file.position = clampPosition(draft.position, draft.sourceText.length);
            file.generation = draft.generation;
            file.persistedGeneration = draft.generation;
            file.submission = draft.submission ? { ...draft.submission } : undefined;
            file.recoveryStatus = sameSourceDraftBase(draft.base, input.base)
              ? (dirty(file) ? "compatible" : "none") : "stale-base";
          }
        } catch (error) {
          file.storageError = storageErrorMessage(error, "读取 DTS 恢复草稿失败。");
        } finally { file.loading = false; publish(); }
      })();
      publish();
      await file.ready;
    },
    change(scope, sourceText, position) {
      const file = fileFor(scope);
      if (file.sourceText === sourceText && !position) return;
      file.sourceText = sourceText;
      file.position = clampPosition(position ?? file.position, sourceText.length);
      changed(file);
    },
    setPosition(scope, position) {
      const file = fileFor(scope);
      const next = clampPosition(position, file.sourceText.length);
      if (Object.keys(next).every((key) => next[key as keyof SourceDraftPosition] === file.position[key as keyof SourceDraftPosition])) return;
      file.position = next;
      changed(file);
    },
    rebase(scope, originalBaseText) {
      const file = fileFor(scope);
      const baseText = file.baseSourceText ?? originalBaseText;
      if (baseText === undefined) throw new Error("无法读取草稿的原始基线；原稿仍保留，请重试或下载草稿。");
      if (file.rebased && hasSourceMergeConflicts(file.sourceText)) throw new Error("请先解决当前合并冲突，再合并最新版本。");
      const merged = mergeSourceText(baseText, file.sourceText, file.latestSourceText);
      file.originalDraft ??= { base: { ...file.base }, sourceText: file.sourceText, baseSourceText: baseText };
      file.base = { ...file.latestBase };
      file.baseSourceText = file.latestSourceText;
      file.sourceText = merged.text;
      file.position = clampPosition(file.position, merged.text.length);
      file.rebased = true;
      file.recoveryStatus = "compatible";
      changed(file);
      return { conflicts: merged.conflicts };
    },
    flush,
    captureSave(scope) {
      const file = fileFor(scope);
      if (!dirty(file)) throw new Error("DTS 文件没有未保存修改。");
      if (!sameSourceDraftBase(file.base, file.latestBase)) throw new Error("DTS 草稿基于旧版本，请先比较最新来源。");
      if (file.rebased && hasSourceMergeConflicts(file.sourceText)) throw new Error("请先解决 DTS 合并冲突并删除冲突标记，再保存。");
      return Object.freeze({ scope: Object.freeze({ ...file.scope }), base: Object.freeze({ ...file.base }),
        sourceText: file.sourceText, generation: file.generation });
    },
    markSubmitted(saved, receipt) {
      const file = fileFor(saved.scope);
      if (!sameSourceDraftBase(file.base, saved.base)) return false;
      if ((file.submission?.submittedGeneration ?? -1) > saved.generation) return false;
      file.submission = { ...receipt, submittedGeneration: saved.generation };
      changed(file);
      return true;
    },
    acknowledgeApplied(saved, base) {
      const file = fileFor(saved.scope);
      if (!sameSourceDraftBase(file.base, saved.base)) return false;
      const observedAnotherBase = !sameSourceDraftBase(file.latestBase, saved.base)
        && !sameSourceDraftBase(file.latestBase, base);
      file.base = { ...base };
      file.baseSourceText = saved.sourceText;
      file.originalDraft = undefined;
      file.rebased = false;
      if (!observedAnotherBase) {
        file.latestBase = { ...base };
        file.latestSourceText = saved.sourceText;
      }
      file.recoveryStatus = observedAnotherBase ? "stale-base" : file.sourceText === saved.sourceText ? "none" : "compatible";
      if (file.submission?.submittedGeneration === saved.generation) file.submission = undefined;
      changed(file);
      return true;
    },
    async discard(scope) {
      await files.get(sourceDraftKey(scope))?.ready;
      const file = fileFor(scope);
      const generation = file.generation;
      clearTimeout(file.timer);
      file.writes = file.writes.then(async () => {
        if (file.storageConflict) return false;
        if (file.generation !== generation) return true;
        const record: SourceDraftRecord = {
          version: 1, scope: { ...file.scope }, base: { ...file.latestBase }, sourceText: file.latestSourceText,
          baseSourceText: file.latestSourceText,
          position: clampPosition(file.position, file.latestSourceText.length), generation: generation + 1, updatedAt: now(),
          ...(file.submission ? { submission: { ...file.submission } } : {})
        };
        file.persisting = true;
        publish();
        try {
          file.storedGeneration = await storage.compareAndSet(file.scope, record, file.storedGeneration);
          file.storageError = "";
          if (file.generation === generation && sameSourceDraftBase(file.latestBase, record.base) && file.latestSourceText === record.sourceText) {
            file.base = record.base;
            file.baseSourceText = record.baseSourceText;
            file.originalDraft = undefined;
            file.rebased = false;
            file.sourceText = record.sourceText;
            file.position = record.position;
            file.recoveryStatus = "none";
            file.generation = record.generation;
            file.persistedGeneration = record.generation;
          } else changed(file);
          return true;
        } catch (error) {
          file.storageError = storageErrorMessage(error, "清除 DTS 恢复草稿失败。");
          file.storageConflict = error instanceof SourceDraftConflictError;
          return false;
        } finally { file.persisting = false; publish(); }
      });
      return await file.writes && flush(scope);
    },
    async close() {
      const ok = await flush();
      if (!ok) return false;
      closed = true;
      storage.close();
      listeners.clear();
      return true;
    }
  };
}
