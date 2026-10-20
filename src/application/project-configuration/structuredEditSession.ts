import type {
  DtsStructuralNode,
  DtsStructuredRepository,
  DtsStructuredSubmissionRound
} from "@/application/ports/DtsStructuredRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { loadCanonicalDtsDefinitionDetail } from "@/application/parameters/loadCanonicalDtsDefinitionDetail";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import { validateDtsValue } from "@/domain/dts/dtsValueClient";
import { validateDtsValueAgainstSchema } from "@/domain/dts/dtsValueSchema";
import {
  readStructuredEditorState,
  sameStructuredEditorState,
  type StructuredEditorState
} from "@/domain/dts/structuredEditorState";
import {
  aggregateSessionDraftSubset,
  clearSubmittedDrafts,
  isUnchangedSessionDraft,
  listSessionDraftRows,
  propertyIdentity,
  sessionDraftKey,
  type SessionDraftRow,
  type SessionPropertyDraft
} from "./sessionDrafts";
import {
  classifySessionDraftRecovery,
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
  editorState?: StructuredEditorState;
};

export type StructuredEditIdentity = {
  fileId: string;
  nodePath: string;
  propertyName: string;
};

export type StagedStructuredDraft = {
  key: string;
  draftId: string;
  bindingId: string;
  currentValueId: string | null;
  pending: true;
};

export type StructuredEditSubmitInput = {
  projectId: string;
  fileId: string;
  fileName: string;
  dtsRepository: Pick<DtsStructuredRepository, "submitStructuredEdits">;
  catalogRepository?: Pick<ParameterTopologyRepository, "listBindings" | "createBindingDraft" | "listConfigRevisions">;
  definitionRepository?: Pick<ParameterCatalogRepository, "getDefinitionRevision">;
  revisionId?: string | null;
  configSetId?: string;
};

export type StructuredEditSessionSnapshot = {
  drafts: Record<string, SessionPropertyDraft>;
  selectedKeys: ReadonlySet<string>;
  reason: string;
  recoveryStatus: StructuredEditRecoveryStatus;
  validateStatus: string;
  submitError: string;
  submitStatus: string;
  storageError: string;
  submitting: boolean;
  stagedDrafts: StagedStructuredDraft[];
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
  discard(key?: string): void;
  copyText(): string | null;
};

function emptySnapshot(): StructuredEditSessionSnapshot {
  return {
    stagedDrafts: [],
    drafts: {},
    selectedKeys: new Set(),
    reason: "",
    recoveryStatus: "none",
    validateStatus: "",
    submitError: "",
    submitStatus: "",
    storageError: "",
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
  if (rows.length === 0) return new Set([...selected].filter((key) => key in drafts));
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

function unfinishedEditorError(state: StructuredEditorState): string {
  return state.kind === "string-input" || state.kind === "numeric-input"
    ? "批量输入待确认。" : "请完成或修正保留的单元格输入。";
}

function restoreDraft(key: string, draft: SessionPropertyDraft): SessionPropertyDraft {
  const propertyName = key.slice(key.lastIndexOf("::") + 2);
  const validation = validateDtsValue(draft.rawText, propertyName);
  const error = draft.editorState ? unfinishedEditorError(draft.editorState) : validation.error;
  return {
    rawText: draft.rawText,
    normalizedValue: validation.normalizedValue,
    ...(typeof draft.present === "boolean" ? { present: draft.present } : {}),
    ...(draft.editorState ? { editorState: draft.editorState } : {}),
    valid: !draft.editorState && validation.valid,
    ...(error ? { error } : {})
  };
}

function matchesSubmittedDraft(draft: SessionPropertyDraft | undefined, row: SessionDraftRow): boolean {
  return draft?.rawText === row.rawText && draft.present === row.present
    && sameStructuredEditorState(draft.editorState, row.editorState);
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
  let storageError = "";
  let submitting = false;
  let stagedDrafts: StagedStructuredDraft[] = [];
  let cachedSnapshot = emptySnapshot();

  function rebuildSnapshot(): StructuredEditSessionSnapshot {
    if (structureFileId && recoveryStatus !== "stale-base") {
      const unchangedKeys: string[] = [];
      for (const node of structureNodes) {
        for (const property of node.properties) {
          for (const key of [sessionDraftKey({ fileId: structureFileId, nodePath: node.nodePath, propertyName: property.name }),
            propertyIdentity(node.nodePath, property.name)]) {
            if (drafts[key] && isUnchangedSessionDraft(drafts[key], property)) unchangedKeys.push(key);
          }
        }
      }
      if (unchangedKeys.length) drafts = clearSubmittedDrafts(drafts, unchangedKeys);
    }
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
      storageError,
      submitting,
      stagedDrafts,
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
      reportStorageResult(removeSessionDraftBucket(scope, storage));
      return;
    }
    const selected = selectedKeys.size > 0 ? Array.from(selectedKeys) : draftKeys;
    reportStorageResult(upsertSessionDraftBucket(
      {
        scope,
        drafts,
        selectedKeys: selected,
        reason,
        updatedAt: now()
      },
      storage
    ));
  }

  function reportStorageResult(success: boolean): void {
    const nextError = success ? "" : Object.keys(drafts).length > 0
      ? "本地保存失败，修改仅当前页面保留。请复制当前修改后再离开页面。"
      : "无法清理本地草稿，刷新后可能再次恢复旧修改。";
    if (storageError === nextError) return;
    storageError = nextError;
    emit();
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
    get storageError() {
      return cachedSnapshot.storageError;
    },
    get submitting() {
      return cachedSnapshot.submitting;
    },
    get stagedDrafts() {
      return cachedSnapshot.stagedDrafts;
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
      if (currentScope?.fileId === fileId) persist();
    },

    async hydrate(scope) {
      if (scope && currentScope && classifySessionDraftRecovery(currentScope, scope) === "compatible") return;
      const generation = ++hydrateGeneration;
      persistEnabled = false;
      currentScope = scope;
      clearStatuses();
      storageError = "";
      stagedDrafts = [];
      submitting = false;
      drafts = {};
      selectedKeys = new Set();
      reason = "";
      recoveryStatus = "none";
      persistScope = null;
      emit();

      if (!scope) return;

      if (generation !== hydrateGeneration) return;

      const recovered = findRecoverableSessionDraft(scope, storage);
      if (generation !== hydrateGeneration) return;

      if (recovered) {
        const draftKeys = Object.keys(recovered.bucket.drafts);
        const restoredSelected =
          recovered.bucket.selectedKeys.length > 0 ? recovered.bucket.selectedKeys : draftKeys;
        drafts = Object.fromEntries(Object.entries(recovered.bucket.drafts)
          .map(([key, draft]) => [key, restoreDraft(key, draft)]));
        selectedKeys = new Set(restoredSelected);
        reason = recovered.bucket.reason;
        recoveryStatus = recovered.classification;
        persistScope = recovered.bucket.scope;
        emit();
        if (Object.keys(drafts).length > 0) {
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

      if (generation !== hydrateGeneration) return;
      persistEnabled = true;
      persist();
    },

    change(identity, next) {
      const key = sessionDraftKey(identity);
      const editorState = next.editorState ? readStructuredEditorState(next.editorState) : undefined;
      if (editorState === null) throw new Error("无效的参数编辑状态。");
      drafts = {
        ...clearSubmittedDrafts(drafts, [propertyIdentity(identity.nodePath, identity.propertyName)]),
        [key]: {
          rawText: next.rawText,
          normalizedValue: next.normalizedValue,
          ...(typeof next.valid === "boolean" ? { valid: next.valid } : {}),
          ...(next.error ? { error: next.error } : {}),
          ...(typeof next.present === "boolean" ? { present: next.present } : {}),
          ...(editorState ? { editorState, valid: false, error: next.error || unfinishedEditorError(editorState) } : {})
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
          "基线版本已变更：请先基于当前基线继续编辑，保存时会自动校验。会话草稿仍可检查或复制。";
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
      const message = `本地输入检查通过：${selected.length} 项；保存时仍需核对固定参数定义。`;
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
      const invalid = selected.filter((row) => input.catalogRepository && input.definitionRepository
        ? row.editorState || (row.present !== false && !validateDtsValue(row.rawText, row.propertyName).valid)
        : row.valid === false);
      if (invalid.length > 0) {
        const message = `仍有未通过校验的变更：${invalid
          .map((row) => `${row.nodePath}/${row.propertyName}`)
          .join("、")}`;
        submitError = message;
        emit();
        throw new Error(message);
      }
      const generation = hydrateGeneration;
      const assertCurrentScope = () => {
        if (generation !== hydrateGeneration) throw new Error("编辑会话范围已变更。");
      };
      submitting = true;
      submitError = "";
      submitStatus = "";
      emit();
      try {
        if (input.catalogRepository) {
          const repository = input.catalogRepository;
          let revisionId = input.revisionId;
          if (!revisionId && input.configSetId) {
            const revisions = await repository.listConfigRevisions(input.projectId, input.configSetId);
            assertCurrentScope();
            revisionId = revisions.find((item) => item.status === "resolved")?.id;
          }
          if (!revisionId) throw new Error("没有已解析的配置修订，无法暂存待审核草稿。");
          const bindings = await repository.listBindings(input.projectId, revisionId);
          assertCurrentScope();
          stagedDrafts = [];
          const failures: string[] = [];
          let draftId = "";
          for (const row of selected) {
            assertCurrentScope();
            try {
              const matches = bindings.filter((binding) => binding.definitionId && binding.sourceOccurrenceId
                && binding.sourceFileId === row.fileId && binding.sourceNodePath === row.nodePath
                && binding.propertyKey === row.propertyName);
              if (matches.length !== 1) throw new Error("没有唯一精确 Binding。");
              const binding = matches[0]!;
              if (input.definitionRepository) {
                const definitionRevisionId = binding.effectiveRevisionId || binding.definitionRevisionId;
                if (!definitionRevisionId) throw new Error("Binding 缺少固定参数定义修订。");
                const detail = await loadCanonicalDtsDefinitionDetail(input.definitionRepository, {
                  definitionId: binding.definitionId!, revisionId: definitionRevisionId, propertyKey: row.propertyName
                });
                assertCurrentScope();
                const valueShape = detail.valueShape;
                const schema = valueShape && typeof valueShape === "object" && "schema" in valueShape
                  ? valueShape.schema : undefined;
                const schemaError = row.present === false ? undefined
                  : validateDtsValueAgainstSchema(row.propertyName, row.rawText, schema);
                if (schemaError) {
                  const currentDraft = drafts[row.key] ?? drafts[row.identity];
                  if (matchesSubmittedDraft(currentDraft, row)) {
                    const key = drafts[row.key] ? row.key : row.identity;
                    drafts = { ...drafts, [key]: { ...currentDraft!, valid: false, error: schemaError } };
                    emit();
                    persist();
                  }
                  throw new Error(schemaError);
                }
              }
              const saved = await repository.createBindingDraft(input.projectId, binding.id, {
                baseRevisionId: revisionId, reason: trimmedReason,
                ...(row.present === false ? { action: "delete" } : {
                  action: "set", targetValue: parseDtsValue(row.propertyName, row.rawText).value
                })
              });
              assertCurrentScope();
              if (!saved.draftId || saved.pending !== true
                || saved.writeTarget.role !== "canonical-project-value-draft"
                || saved.projectParameterBindingId !== binding.id
                || saved.currentValueId === undefined
                || saved.currentValueId !== (binding.currentValueId ?? null)) {
                throw new Error("未确认待审核草稿。");
              }
              stagedDrafts.push({ key: row.key, draftId: saved.draftId, bindingId: binding.id,
                currentValueId: saved.currentValueId, pending: true });
              draftId = saved.draftId;
              const localDraft = drafts[row.key] ?? drafts[row.identity];
              if (matchesSubmittedDraft(localDraft, row)) {
                drafts = clearSubmittedDrafts(drafts, [row.key, row.identity]);
                selectedKeys.delete(row.key);
              }
              submitStatus = `已暂存 ${stagedDrafts.length} 项待审核草稿；当前值未变。`;
              if (stagedDrafts.some((draft) => draft.currentValueId === null)) {
                submitStatus += "无当前值的 Binding 仍为空。";
              }
              validateStatus = "";
              emit();
              persist();
            } catch (error) {
              assertCurrentScope();
              failures.push(`${row.fileId}: ${row.nodePath}/${row.propertyName}：${error instanceof Error ? error.message : "暂存失败。"}`);
            }
          }
          if (failures.length > 0) throw new Error(failures.join("\n"));
          return { id: draftId, projectId: input.projectId, status: "canonical-project-value-draft", items: [] };
        }
        const aggregate = aggregateSessionDraftSubset({
          fileId: input.fileId, fileName: input.fileName, rows, selectedKeys, reason: trimmedReason
        });
        if (aggregate.edits.length === 0) throw new Error("没有可提交的变更。");
        const round = await input.dtsRepository.submitStructuredEdits(input.projectId, {
          edits: aggregate.edits,
          reason: trimmedReason
        });
        assertCurrentScope();
        const submittedKeys = selected.filter((row) => matchesSubmittedDraft(drafts[row.key] ?? drafts[row.identity], row))
          .flatMap((row) => [row.key, row.identity]);
        drafts = clearSubmittedDrafts(drafts, submittedKeys);
        submitStatus = `已提交变更请求 ${round.id}`;
        validateStatus = "";
        emit();
        persist();
        return round;
      } catch (error: unknown) {
        if (generation !== hydrateGeneration) throw error;
        submitError = error instanceof Error ? error.message : "提交变更请求失败。";
        emit();
        throw error instanceof Error ? error : new Error(submitError);
      } finally {
        if (generation === hydrateGeneration) {
          submitting = false;
          emit();
        }
      }
    },

    recover() {
      if (!currentScope || Object.keys(drafts).length === 0) return;
      persistScope = currentScope;
      recoveryStatus = "none";
      submitError = "";
      validateStatus = "";
      submitStatus = "已基于当前基线继续编辑；保存时会自动校验。";
      emit();
      persist();
    },

    discard(key) {
      if (key) {
        const row = cachedSnapshot.rows.find((item) => item.key === key || item.identity === key);
        drafts = clearSubmittedDrafts(drafts, row ? [row.key, row.identity] : [key]);
        clearStatuses();
        emit();
        persist();
        return;
      }
      const scope = persistScope ?? currentScope;
      drafts = {};
      selectedKeys = new Set();
      reason = "";
      recoveryStatus = "none";
      clearStatuses();
      emit();
      if (scope) reportStorageResult(removeSessionDraftBucket(scope, storage));
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
