export type SourceDraftScope = {
  userId: string;
  organizationId: string;
  projectId: string;
  configSetId: string;
  fileId: string;
};

export type SourceDraftBase = {
  fileVersionId: string;
  configRevisionId: string;
  sourceDigest: string;
  localOverride?: { input: import("@/application/ports/ParameterFileRepository").ProjectLocalOverrideInput; afterValue: string | null };
};

export type SourceDraftPosition = {
  anchor: number;
  head: number;
  firstVisibleLine: number;
  scrollTop: number;
  scrollLeft: number;
};

export type SourceDraftSubmission = {
  candidateId: string;
  requestId?: string;
  submittedGeneration: number;
};

export type SourceDraftRecord = {
  version: 1;
  scope: SourceDraftScope;
  base: SourceDraftBase;
  sourceText: string;
  baseSourceText?: string;
  originalDraft?: { base: SourceDraftBase; sourceText: string; baseSourceText: string };
  rebased?: boolean;
  position: SourceDraftPosition;
  generation: number;
  updatedAt: string;
  submission?: SourceDraftSubmission;
};

export type StoredSourceDraft = { generation: number; draft: SourceDraftRecord | null };

export type SourceDraftStorage = {
  load(scope: SourceDraftScope): Promise<StoredSourceDraft>;
  compareAndSet(scope: SourceDraftScope, draft: SourceDraftRecord | null, expectedGeneration: number): Promise<number>;
  close(): void;
};

export class SourceDraftConflictError extends Error {
  constructor() {
    super("另一标签页已更新此文件的恢复草稿；当前编辑仍保留，请下载草稿后比较。");
    this.name = "SourceDraftConflictError";
  }
}

export function sourceDraftKey(scope: SourceDraftScope): string {
  return JSON.stringify([scope.userId, scope.organizationId, scope.projectId, scope.configSetId, scope.fileId]);
}

export function sameSourceDraftBase(left: SourceDraftBase, right: SourceDraftBase): boolean {
  return left.fileVersionId === right.fileVersionId && left.configRevisionId === right.configRevisionId
    && left.sourceDigest === right.sourceDigest;
}

function readStoredDraft(value: unknown, scope: SourceDraftScope): StoredSourceDraft {
  if (value === undefined) return { generation: 0, draft: null };
  if (!value || typeof value !== "object") throw new Error("DTS 恢复草稿格式损坏。");
  const stored = value as StoredSourceDraft;
  if (!Number.isSafeInteger(stored.generation) || stored.generation < 1) throw new Error("DTS 恢复草稿版本损坏。");
  if (stored.draft === null) return stored;
  const draft = stored.draft;
  if (!draft || draft.version !== 1 || !draft.scope || sourceDraftKey(draft.scope) !== sourceDraftKey(scope)
    || !draft.base || ![draft.base.fileVersionId, draft.base.configRevisionId, draft.base.sourceDigest]
      .every((item) => typeof item === "string" && item.length > 0)
    || typeof draft.sourceText !== "string" || !Number.isSafeInteger(draft.generation) || draft.generation < 0
    || (draft.base.localOverride !== undefined && (!draft.base.localOverride || !draft.base.localOverride.input
      || ![draft.base.localOverride.input.expectedConfigRevisionId, draft.base.localOverride.input.logicalNodeId, draft.base.localOverride.input.propertyName]
        .every(item => typeof item === "string" && item.length > 0)
      || !["set", "remove-override", "delete-property", "enable-node", "disable-node", "remove-status-override", "delete-node"].includes(draft.base.localOverride.input.action)
      || (draft.base.localOverride.input.rawText !== undefined && typeof draft.base.localOverride.input.rawText !== "string")
      || (draft.base.localOverride.afterValue !== null && typeof draft.base.localOverride.afterValue !== "string")))
    || (draft.baseSourceText !== undefined && typeof draft.baseSourceText !== "string")
    || (draft.rebased !== undefined && typeof draft.rebased !== "boolean")
    || (draft.originalDraft !== undefined && (!draft.originalDraft || typeof draft.originalDraft.sourceText !== "string"
      || typeof draft.originalDraft.baseSourceText !== "string" || !draft.originalDraft.base
      || ![draft.originalDraft.base.fileVersionId, draft.originalDraft.base.configRevisionId, draft.originalDraft.base.sourceDigest]
        .every((item) => typeof item === "string" && item.length > 0)))
    || typeof draft.updatedAt !== "string" || !draft.position
    || ![draft.position.anchor, draft.position.head, draft.position.firstVisibleLine,
      draft.position.scrollTop, draft.position.scrollLeft].every((item) => Number.isFinite(item) && item >= 0)
    || ![draft.position.anchor, draft.position.head, draft.position.firstVisibleLine].every(Number.isSafeInteger)
    || draft.position.anchor > draft.sourceText.length || draft.position.head > draft.sourceText.length
    || draft.position.firstVisibleLine < 1
    || (draft.submission !== undefined && (!draft.submission || typeof draft.submission.candidateId !== "string"
      || (draft.submission.requestId !== undefined && typeof draft.submission.requestId !== "string")
      || !Number.isSafeInteger(draft.submission.submittedGeneration)
      || draft.submission.submittedGeneration < 0 || draft.submission.submittedGeneration > draft.generation))) {
    throw new Error("DTS 恢复草稿内容损坏；未覆盖原记录。");
  }
  return stored;
}

/** IndexedDB transactions serialize writers across tabs; tombstones prevent a delete/recreate ABA race. */
export function createSourceDraftStorage(factory: IDBFactory | undefined = globalThis.indexedDB): SourceDraftStorage {
  let opening: Promise<IDBDatabase> | undefined;
  function database(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("浏览器无法使用 IndexedDB，恢复草稿不可用。"));
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open("wiseeff-source-drafts", 1);
        let unavailable = false;
        request.onupgradeneeded = () => request.result.createObjectStore("drafts");
        request.onerror = () => reject(request.error ?? new Error("无法打开 DTS 恢复草稿存储。"));
        request.onblocked = () => {
          unavailable = true;
          reject(new Error("DTS 恢复草稿存储升级被其他标签页阻止。"));
        };
        request.onsuccess = () => {
          if (unavailable) { request.result.close(); return; }
          request.result.onversionchange = () => { request.result.close(); opening = undefined; };
          resolve(request.result);
        };
      }).catch((error: unknown) => { opening = undefined; throw error; });
    }
    return opening;
  }

  return {
    async load(scope) {
      const db = await database();
      return new Promise<StoredSourceDraft>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readonly");
        const request = transaction.objectStore("drafts").get(sourceDraftKey(scope));
        let result: StoredSourceDraft;
        let failure: unknown;
        request.onsuccess = () => {
          try { result = readStoredDraft(request.result, scope); }
          catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("读取 DTS 恢复草稿失败。"));
        transaction.onerror = () => { failure ??= transaction.error; };
      });
    },
    async compareAndSet(scope, draft, expectedGeneration) {
      if (draft) readStoredDraft({ generation: 1, draft }, scope);
      if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) throw new Error("无效的草稿存储版本。");
      const db = await database();
      return new Promise<number>((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite");
        const store = transaction.objectStore("drafts");
        const request = store.get(sourceDraftKey(scope));
        let nextGeneration = 0;
        let failure: unknown;
        request.onsuccess = () => {
          try {
            const current = readStoredDraft(request.result, scope);
            if (current.generation !== expectedGeneration) throw new SourceDraftConflictError();
            nextGeneration = current.generation + 1;
            if (!Number.isSafeInteger(nextGeneration)) throw new Error("草稿存储版本超出范围。");
            store.put({ generation: nextGeneration, draft }, sourceDraftKey(scope));
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(nextGeneration);
        transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("保存 DTS 恢复草稿失败。"));
        transaction.onerror = () => { failure ??= transaction.error; };
      });
    },
    close() {
      const pending = opening;
      opening = undefined;
      void pending?.then((db) => db.close(), () => undefined);
    }
  };
}
