import type {
  DtsStructuralNode,
  DtsStructuredRepository,
  DtsStructuredSubmissionRound
} from "@/application/ports/DtsStructuredRepository";
import {
  aggregateSessionDraftSubset,
  clearSubmittedDrafts,
  listSessionDraftRows,
  sessionDraftKey,
  type SessionDraftRow,
  type SessionPropertyDraft
} from "./sessionDrafts";
import {
  findRecoverableSessionDraft,
  formatSessionDraftCopyText,
  removeSessionDraftBucket,
  upsertSessionDraftBucket,
  type SessionDraftScope
} from "./sessionDraftStorage";

export type StructuredEditRecoveryStatus = "none" | "compatible" | "stale-base";

export type StructuredEditChangeInput = {
  rawText: string;
  normalizedValue: string;
  valid?: boolean;
  error?: string;
  present?: boolean;
};

export type StructuredEditIdentity = {
  fileId: string;
  nodePath: string;
  propertyName: string;
};

export type StructuredEditSubmitInput = {
  projectId: string;
  fileId: string;
  fileName: string;
  dtsRepository: Pick<DtsStructuredRepository, "submitStructuredEdits">;
};

export type StructuredEditSessionSnapshot = {
  drafts: Record<string, SessionPropertyDraft>;
  selectedKeys: ReadonlySet<string>;
  reason: string;
  recoveryStatus: StructuredEditRecoveryStatus;
  validateStatus: string;
  submitError: string;
  submitStatus: string;
  submitting: boolean;
  rows: SessionDraftRow[];
  isDirty: boolean;
  isStaleBase: boolean;
};

type ReadableWritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StructuredEditSessionOptions = {
  storage?: ReadableWritableStorage;
  now?: () => string;
  onDraftsRecovered?: () => void;
};

export type StructuredEditSession = StructuredEditSessionSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StructuredEditSessionSnapshot;
  setStructure(nodes: DtsStructuralNode[], fileId: string): void;
  hydrate(scope: SessionDraftScope | null): Promise<void>;
  change(identity: StructuredEditIdentity, next: StructuredEditChangeInput): void;
  selectSubset(keys: Iterable<string>): void;
  setReason(reason: string): void;
  validate(): { ok: boolean; message: string };
  submit(input: StructuredEditSubmitInput): Promise<DtsStructuredSubmissionRound>;
  recover(): void;
  discard(): void;
  copyText(): string | null;
};

function emptySnapshot(): StructuredEditSessionSnapshot {
  return {
    drafts: {},
    selectedKeys: new Set(),
    reason: "",
    recoveryStatus: "none",
    validateStatus: "",
    submitError: "",
    submitStatus: "",
    submitting: false,
    rows: [],
    isDirty: false,
    isStaleBase: false
  };
}

function pruneSelectedKeys(
  selected: ReadonlySet<string>,
  rows: SessionDraftRow[],
  drafts: Record<string, SessionPropertyDraft>
): Set<string> {
  if (rows.length === 0) return new Set(selected);
  const valid = new Set(rows.map((row) => row.key));
  if (selected.size === 0 && Object.keys(drafts).length > 0) {
    return valid;
  }
  const next = new Set<string>();
  for (const key of selected) {
    if (valid.has(key)) next.add(key);
  }
  return next;
}

function computeRows(
  fileId: string | null,
  nodes: DtsStructuralNode[],
  drafts: Record<string, SessionPropertyDraft>
): SessionDraftRow[] {
  if (!fileId) return [];
  return listSessionDraftRows({ fileId, nodes, drafts });
}

export function createStructuredEditSession(
  options: StructuredEditSessionOptions = {}
): StructuredEditSession {
  const storage = options.storage ?? localStorage;
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set<() => void>();

  let structureNodes: DtsStructuralNode[] = [];
  let structureFileId: string | null = null;
  let hydrateGeneration = 0;
  let persistEnabled = false;
  let persistScope: SessionDraftScope | null = null;
  let currentScope: SessionDraftScope | null = null;

  let drafts: Record<string, SessionPropertyDraft> = {};
  let selectedKeys = new Set<string>();
  let reason = "";
  let recoveryStatus: StructuredEditRecoveryStatus = "none";
  let validateStatus = "";
  let submitError = "";
  let submitStatus = "";
  let submitting = false;
  let cachedSnapshot = emptySnapshot();

  function rebuildSnapshot(): StructuredEditSessionSnapshot {
    const rows = computeRows(structureFileId, structureNodes, drafts);
    selectedKeys = pruneSelectedKeys(selectedKeys, rows, drafts);
    const isDirty = Object.keys(drafts).length > 0 || rows.length > 0;
    const isStaleBase = recoveryStatus === "stale-base";
    return {
      drafts,
      selectedKeys: new Set(selectedKeys),
      reason,
      recoveryStatus,
      validateStatus,
      submitError,
      submitStatus,
      submitting,
      rows,
      isDirty,
      isStaleBase
    };
  }

  function emit(): void {
    cachedSnapshot = rebuildSnapshot();
    for (const listener of listeners) listener();
  }

  function persist(): void {
    if (!persistEnabled) return;
    const scope = persistScope ?? currentScope;
    if (!scope) return;
    const draftKeys = Object.keys(drafts);
    if (draftKeys.length === 0) {
      removeSessionDraftBucket(scope, storage);
      return;
    }
    const selected = selectedKeys.size > 0 ? Array.from(selectedKeys) : draftKeys;
    upsertSessionDraftBucket(
      {
        scope,
        drafts,
        selectedKeys: selected,
        reason,
        updatedAt: now()
      },
      storage
    );
  }

  function clearStatuses(): void {
    submitError = "";
    submitStatus = "";
    validateStatus = "";
  }

  const session: StructuredEditSession = {
    get drafts() {
      return cachedSnapshot.drafts;
    },
    get selectedKeys() {
      return cachedSnapshot.selectedKeys;
    },
    get reason() {
      return cachedSnapshot.reason;
    },
    get recoveryStatus() {
      return cachedSnapshot.recoveryStatus;
    },
    get validateStatus() {
      return cachedSnapshot.validateStatus;
    },
    get submitError() {
      return cachedSnapshot.submitError;
    },
    get submitStatus() {
      return cachedSnapshot.submitStatus;
    },
    get submitting() {
      return cachedSnapshot.submitting;
    },
    get rows() {
      return cachedSnapshot.rows;
    },
    get isDirty() {
      return cachedSnapshot.isDirty;
    },
    get isStaleBase() {
      return cachedSnapshot.isStaleBase;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cachedSnapshot;
    },

    setStructure(nodes, fileId) {
      if (structureFileId === fileId && structureNodes === nodes) {
        return;
      }
      if (
        fileId === (structureFileId ?? "") &&
        nodes.length === 0 &&
        structureNodes.length === 0
      ) {
        return;
      }
      structureNodes = nodes;
      structureFileId = fileId;
      emit();
    },

    async hydrate(scope) {
      const generation = ++hydrateGeneration;
      persistEnabled = false;
      currentScope = scope;
      clearStatuses();

      if (!scope) {
        drafts = {};
        selectedKeys = new Set();
        reason = "";
        recoveryStatus = "none";
        persistScope = null;
        emit();
        return;
      }

      await Promise.resolve();
      if (generation !== hydrateGeneration) return;

      const recovered = findRecoverableSessionDraft(scope, storage);
      if (generation !== hydrateGeneration) return;

      if (recovered) {
        const draftKeys = Object.keys(recovered.bucket.drafts);
        const restoredSelected =
          recovered.bucket.selectedKeys.length > 0 ? recovered.bucket.selectedKeys : draftKeys;
        drafts = { ...recovered.bucket.drafts };
        selectedKeys = new Set(restoredSelected);
        reason = recovered.bucket.reason;
        recoveryStatus = recovered.classification;
        persistScope = recovered.bucket.scope;
        emit();
        if (draftKeys.length > 0) {
          options.onDraftsRecovered?.();
        }
      } else {
        drafts = {};
        selectedKeys = new Set();
        reason = "";
        recoveryStatus = "none";
        persistScope = scope;
        emit();
      }

      await Promise.resolve();
      if (generation !== hydrateGeneration) return;
      persistEnabled = true;
    },

    change(identity, next) {
      const key = sessionDraftKey(identity);
      drafts = {
        ...drafts,
        [key]: {
          rawText: next.rawText,
          normalizedValue: next.normalizedValue,
          ...(typeof next.valid === "boolean" ? { valid: next.valid } : {}),
          ...(next.error ? { error: next.error } : {}),
          ...(typeof next.present === "boolean" ? { present: next.present } : {})
        }
      };
      const nextKeys = new Set(selectedKeys);
      nextKeys.add(key);
      selectedKeys = nextKeys;
      clearStatuses();
      emit();
      persist();
    },

    selectSubset(keys) {
      selectedKeys = new Set(keys);
      emit();
      persist();
    },

    setReason(nextReason) {
      reason = nextReason;
      emit();
      persist();
    },

    validate() {
      if (recoveryStatus === "stale-base") {
        const message =
          "基线版本已变更：会话草稿仅可检查或复制，请先基于当前基线继续编辑后再校验。";
        validateStatus = message;
        submitError = "";
        emit();
        return { ok: false, message };
      }
      const selected = cachedSnapshot.rows.filter((row) => selectedKeys.has(row.key));
      if (selected.length === 0) {
        const message = "请先勾选要校验的会话变更。";
        validateStatus = message;
        emit();
        return { ok: false, message };
      }
      const invalid = selected.filter((row) => row.valid === false);
      if (invalid.length > 0) {
        const message = `校验未通过：${invalid.map((row) => `${row.nodePath}/${row.propertyName}`).join("、")}`;
        validateStatus = message;
        emit();
        return { ok: false, message };
      }
      const message = `校验通过：${selected.length} 项`;
      validateStatus = message;
      submitError = "";
      emit();
      return { ok: true, message };
    },

    async submit(input) {
      if (submitting) {
        throw new Error("提交进行中。");
      }
      if (recoveryStatus === "stale-base") {
        const message = "基线版本已变更：无法对过期草稿提交变更请求。请先基于当前基线继续编辑。";
        submitError = message;
        validateStatus = "";
        emit();
        throw new Error(message);
      }
      const trimmedReason = reason.trim();
      if (!trimmedReason) {
        const message = "提交变更请求前请填写变更原因。";
        submitError = message;
        emit();
        throw new Error(message);
      }
      const rows = cachedSnapshot.rows;
      const selected = rows.filter((row) => selectedKeys.has(row.key));
      if (selected.length === 0) {
        const message = "请先勾选要提交的会话变更。";
        submitError = message;
        emit();
        throw new Error(message);
      }
      const invalid = selected.filter((row) => row.valid === false);
      if (invalid.length > 0) {
        const message = `仍有未通过校验的变更：${invalid
          .map((row) => `${row.nodePath}/${row.propertyName}`)
          .join("、")}`;
        submitError = message;
        emit();
        throw new Error(message);
      }
      const aggregate = aggregateSessionDraftSubset({
        fileId: input.fileId,
        fileName: input.fileName,
        rows,
        selectedKeys,
        reason: trimmedReason
      });
      if (aggregate.edits.length === 0) {
        const message = "没有可提交的变更。";
        submitError = message;
        emit();
        throw new Error(message);
      }

      submitting = true;
      submitError = "";
      submitStatus = "";
      emit();
      try {
        const round = await input.dtsRepository.submitStructuredEdits(input.projectId, {
          edits: aggregate.edits,
          reason: trimmedReason
        });
        const submittedKeys = selected.map((row) => row.key);
        drafts = clearSubmittedDrafts(drafts, submittedKeys);
        submitStatus = `已提交变更请求 ${round.id}`;
        validateStatus = "";
        emit();
        persist();
        return round;
      } catch (error: unknown) {
        submitError = error instanceof Error ? error.message : "提交变更请求失败。";
        emit();
        throw error instanceof Error ? error : new Error(submitError);
      } finally {
        submitting = false;
        emit();
      }
    },

    recover() {
      if (!currentScope || Object.keys(drafts).length === 0) return;
      const nextBucket = {
        scope: currentScope,
        drafts,
        selectedKeys: Array.from(selectedKeys),
        reason,
        updatedAt: now()
      };
      upsertSessionDraftBucket(nextBucket, storage);
      persistScope = currentScope;
      recoveryStatus = "none";
      submitError = "";
      validateStatus = "";
      submitStatus = "已基于当前基线继续编辑；请重新校验后再提交。";
      emit();
    },

    discard() {
      const scope = persistScope ?? currentScope;
      if (scope) {
        removeSessionDraftBucket(scope, storage);
      }
      drafts = {};
      selectedKeys = new Set();
      reason = "";
      recoveryStatus = "none";
      clearStatuses();
      emit();
    },

    copyText() {
      const scope = persistScope ?? currentScope;
      if (!scope || Object.keys(drafts).length === 0) return null;
      return formatSessionDraftCopyText({
        scope,
        drafts,
        selectedKeys: Array.from(selectedKeys),
        reason,
        updatedAt: now()
      });
    }
  };

  cachedSnapshot = rebuildSnapshot();
  return session;
}
