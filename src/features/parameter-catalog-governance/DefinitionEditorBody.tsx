import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { SpecRelatedKnowledgeSection, type SpecRelatedKnowledgeSource } from "@/components/parameter-topology/ParameterSpecDetail";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type {
  CatalogDefinitionResponse,
  CatalogPublicationJobResponse,
  CatalogReplacement,
  CatalogReplacementPreview,
  CatalogReplacementResponse,
  CatalogSubjectResponse
} from "@/infrastructure/http/parameterCatalogDtos";

import {
  catalogLifecycleLabel,
  catalogRegistrationLabel,
  catalogStateMessage,
  catalogValueShapeLabel
} from "../parameter-catalog/catalogPresentation";
import {
  catalogHistoryCloseLabel,
  catalogHistoryOpenLabel
} from "../parameter-catalog/copy";

import {
  buildPublicationChangeSet,
  canExecutePublicationAction,
  definitionContentOf,
  emptyPublicationDraft,
  parsePublicationExamples,
  publicationCopy,
  publicationJobIsPending,
  publicationStatusCopy,
  publicationSuccessKind,
  type PublicationDraft,
  type PublicationValueType
} from "./publicationState";
import { createGovernanceIdempotencyKey } from "./governanceState";

export type DefinitionEditorBodyProps = {
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  catalogReleaseId: string;
  definition: CatalogDefinitionResponse["item"];
  relatedKnowledge?: SpecRelatedKnowledgeSource;
  subjects: readonly CatalogSubjectResponse["item"][];
  /**
   * Authorized projects of the current organization. Selection is explicit: the
   * administrator names the projects to migrate and the server rejects any
   * project that is not in the caller's organization.
   */
  projects?: readonly { id: string; name: string }[];
  onEditorStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
  createIdempotencyKey?: () => string;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
  /** Read-only history the page loaded for this definition. */
  history: ReactNode;
  /** Ask the page to load revisions and the timeline for this definition. */
  onRequestHistory?: () => void;
  /** Close callback to dismiss the host dialog. */
  onClose?: () => void;
  onRetireDefinition?: () => void;
  /** Server gate: without it the dialog only reads. */
  authoringAllowed: boolean;
  publishingAllowed?: boolean;
};


/** Editor state for the definition's content, derived from its current revision. */
type ContentDraft = Pick<
  PublicationDraft,
  "displayName" | "documentation" | "description" | "unit" | "valueType" | "minimum" | "maximum" | "examples"
>;

const contentDraftOf = (definition: CatalogDefinitionResponse["item"]): ContentDraft => {
  const revision = definition.currentRevision;
  const schema = (revision.valueShape?.schema ?? {}) as {
    type?: string;
    minimum?: number;
    maximum?: number;
    items?: { type?: string };
    description?: string;
  };
  const { valueType, minimum, maximum } = valueTypeOf(schema);
  return {
    displayName: revision.displayName,
    documentation: revision.documentation ?? "",
    description: "",
    unit: revision.unit?.symbol ?? "",
    examples: revision.examples?.length ? JSON.stringify(revision.examples) : "",
    valueType,
    minimum,
    maximum
  };
};

/** Inverse of the publication value-schema mapping, so the revision round-trips. */
const valueTypeOf = (schema: {
  type?: string;
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
  description?: string;
}): { valueType: PublicationValueType; minimum: string; maximum: string } => {
  const bounds = {
    minimum: schema.minimum === undefined ? "" : String(schema.minimum),
    maximum: schema.maximum === undefined ? "" : String(schema.maximum)
  };
  switch (schema.type) {
    case "integer":
      return { valueType: "integer", ...bounds };
    case "number":
      return { valueType: "number", ...bounds };
    case "string":
      return { valueType: "string", ...bounds };
    case "boolean":
      return { valueType: "boolean", ...bounds };
    case "null":
      return { valueType: "empty", ...bounds };
    case "array":
      return schema.items?.type === "string"
        ? { valueType: "string-list", ...bounds }
        : { valueType: "u32-array", ...bounds };
    default:
      return { valueType: "mixed", ...bounds };
  }
};

/** The value shapes an author may pick here; the labels match the publication copy. */
const schemaValueTypes: readonly PublicationValueType[] = [
  "integer",
  "number",
  "string",
  "boolean",
  "empty",
  "u32-array",
  "string-list",
  "mixed"
];

const schemaValueTypeLabels: Record<PublicationValueType, string> = {
  integer: "整数",
  number: "数值",
  string: "字符串",
  boolean: "布尔值",
  empty: "空属性",
  "u32-array": "整数数组",
  "string-list": "字符串列表",
  bytes: "字节数组",
  "phandle-list": "句柄引用",
  mixed: "混合类型"
};

const fingerprintContent = (draft: ContentDraft): string =>
  [draft.displayName, draft.documentation, draft.unit, draft.valueType, draft.minimum, draft.maximum, draft.examples].join(
    "\u0000"
  );

type Phase = "compose" | "preview" | "executed" | "content-saved";

/** Bounded wait for the publication manager to install the successor release. */
const ACTIVATION_RETRY_LIMIT = 8;
const ACTIVATION_RETRY_DELAY_MS = 1500;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A create answer that only means "the successor publication this command
 * enqueued is not installed yet": the release is not ready, or the manager
 * activated the successor so the pinned release moved on.
 */
const awaitsSuccessorActivation = (error: unknown): boolean =>
  error instanceof WiseEffApiError &&
  (error.details.reason === "catalog-not-ready" || error.details.reason === "release-drift");

const projectStatusLabel = {
  completed: "已完成",
  blocked: "已阻止",
  failed: "失败",
  pending: "待处理"
} as const;

/**
 * One dialog body for a definition: read it, then correct it (issue #847
 * decisions 12-17).
 *
 * The identity fields are the form: 主体/属性键/显示名 show what the definition
 * is today and are the values a correction changes. Publishing a replacement
 * identity and migrating an explicitly selected, authorized project manifest is
 * the write path (preview -> confirm -> execute -> continue); it never rewrites
 * the old identity and reports per-project progress instead of claiming an
 * instance-wide transaction. Read-only facts sit behind 更多信息 and the loaded
 * history behind 查看历史 so the dialog stays short.
 */
export function DefinitionEditorBody({
  actor,
  sessionPermissions,
  domainState,
  catalog,
  catalogReleaseId,
  definition,
  relatedKnowledge,
  subjects,
  projects = [],
  onEditorStateChange,
  createIdempotencyKey,
  onCompleted,
  onRefreshEvidence,
  history,
  onRequestHistory,
  onClose,
  onRetireDefinition,
  authoringAllowed,
  publishingAllowed = false
}: DefinitionEditorBodyProps) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(definition.subject.id);
  const [propertyKey, setPropertyKey] = useState(definition.propertyKey);
  const [content, setContent] = useState(() => contentDraftOf(definition));
  const [reason, setReason] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [preview, setPreview] = useState<CatalogReplacementPreview | null>(null);
  const [publicationJob, setPublicationJob] = useState<
    CatalogPublicationJobResponse["item"] | null
  >(null);
  const [replacement, setReplacement] = useState<CatalogReplacement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [existingDefinition, setExistingDefinition] = useState<{ definitionId: string; subjectId: string } | null>(null);
  const [previewIdempotencyKey, setPreviewIdempotencyKey] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const allowed = canExecutePublicationAction(
    actor,
    "preview-publication",
    domainState,
    sessionPermissions
  );
  const publishDisabledReason = !publishingAllowed
    ? "当前目录暂不允许发布，请查看发布状态说明。"
    : "当前会话缺少目录发布权限。";

  useEffect(() => {
    setPhase("compose");
    setSubjectId(definition.subject.id);
    setPropertyKey(definition.propertyKey);
    setContent(contentDraftOf(definition));
    setReason("");
    setSelectedProjects([]);
    setPreview(null);
    setReplacement(null);
    setPublicationJob(null);
    setConfirmOpen(false);
    setPending(false);
    setError("");
    setExistingDefinition(null);
    setPreviewIdempotencyKey(null);
    setIdempotencyKey(null);
    setHistoryOpen(false);
    // Reset only when the edited definition changes; a refreshed snapshot yields a
    // new object for the same definition and must not collapse the disclosure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.id]);

  const definitionSubject = useMemo(
    () => subjects.find((subject) => subject.id === definition.subject.id),
    [definition.subject.id, subjects]
  );

  const selectableSubjects = useMemo(
    () => subjects.filter((subject) => subject.membership.status === "active" && subject.registration.status !== "retired"),
    [subjects]
  );
  const editable = authoringAllowed && allowed && definition.lifecycle === "active" &&
    definitionSubject?.membership.status === "active" &&
    definitionSubject.registration.status !== "retired" && definition.registration.status !== "retired";
  const targetSubjectAllowed = selectableSubjects.some((subject) => subject.id === subjectId);
  const canPublish = editable && targetSubjectAllowed && publishingAllowed && canExecutePublicationAction(
    actor, "publish-publication", domainState, sessionPermissions
  );
  useEffect(() => {
    if (!editable || !targetSubjectAllowed) setConfirmOpen(false);
  }, [editable, targetSubjectAllowed]);

  /** The form edits identity and content, so "unchanged" is a real state. */
  const identityChanged =
    subjectId !== definition.subject.id || propertyKey.trim() !== definition.propertyKey;
  const currentContent = useMemo(() => contentDraftOf(definition), [definition]);
  const contentChanged = useMemo(
    () =>
      fingerprintContent(content) !== fingerprintContent(currentContent),
    [content, currentContent]
  );
  const removedOptionalContent = [
    currentContent.unit.trim() && !content.unit.trim() ? "单位" : null,
    currentContent.examples.trim() && !content.examples.trim() ? "示例" : null
  ].filter(Boolean);
  const schemaChanged =
    content.valueType !== currentContent.valueType ||
    content.minimum !== currentContent.minimum ||
    content.maximum !== currentContent.maximum;
  const dirty = (phase === "compose" || phase === "preview") &&
    (identityChanged || contentChanged || Boolean(reason.trim()) || selectedProjects.length > 0);

  useEffect(() => {
    onEditorStateChange?.({ dirty, pending });
  }, [dirty, pending, onEditorStateChange]);

  useEffect(() => {
    if (!dirty && !pending) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, pending]);

  const refreshPublication = async () => {
    if (!publicationJob) return;
    try {
      const response = await catalog.getPublication(publicationJob.id);
      if (publicationSuccessKind(response.item)) await onRefreshEvidence?.();
      setPublicationJob(response.item);
      setError("");
    } catch (caught) {
      setError(failureText(caught));
    }
  };
  const publicationJobId = publicationJob?.id;
  const publicationPending = Boolean(publicationJob && publicationJobIsPending(publicationJob.status));

  useEffect(() => {
    if (!publicationJobId || !publicationPending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let keepPolling = true;
      try {
        const response = await catalog.getPublication(publicationJobId);
        if (cancelled) return;
        if (publicationSuccessKind(response.item)) await onRefreshEvidence?.();
        if (cancelled) return;
        keepPolling = publicationJobIsPending(response.item.status);
        setPublicationJob(response.item);
        setError("");
      } catch (caught) {
        if (!cancelled) setError(failureText(caught));
      } finally {
        if (!cancelled && keepPolling) timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [catalog, publicationJobId, publicationPending, onRefreshEvidence]);

  const runPreview = async () => {
    if (!editable || !targetSubjectAllowed || pending) return;
    if (!validateExamples()) return;
    if (selectedProjects.length === 0 && actor !== "platform-admin") {
      setError("请选择至少一个受影响的项目。");
      return;
    }
    if (!reason.trim()) {
      setError("请填写纠错原因，用于审计。");
      return;
    }
    setPending(true);
    setExistingDefinition(null);
    try {
      // Preview is a catalog write route: it requires an idempotency key, kept
      // stable so a retry of the same preview is not a second command.
      const key = previewIdempotencyKey ?? (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
      setPreviewIdempotencyKey(key);
      const response = await catalog.previewDefinitionReplacement(
        {
          oldDefinitionId: definition.id,
          newSubjectId: subjectId,
          newPropertyKey: propertyKey.trim(),
          projectIds: [...selectedProjects],
          reason: reason.trim(),
          ...definitionContentOf({ ...emptyPublicationDraft(), ...content, mode: "revise-definition", definitionId: definition.id, propertyKey: propertyKey.trim(), reason: reason.trim() })
        },
        { catalogReleaseId, idempotencyKey: key }
      );
      setPreview(response.item);
      setPhase("preview");
      setError("");
    } catch (caught) {
      if (caught instanceof WiseEffApiError && caught.details.replacement === "target-identity-conflict" &&
        typeof caught.details.existingDefinitionId === "string" && typeof caught.details.subjectId === "string") {
        setExistingDefinition({ definitionId: caught.details.existingDefinitionId, subjectId: caught.details.subjectId });
      }
      setError(failureText(caught));
    } finally {
      setPending(false);
    }
  };

  const contentDraft = (): PublicationDraft => ({
    ...emptyPublicationDraft(),
    mode: "revise-definition",
    definitionId: definition.id,
    // A value-shape change is a semantic revision; wording/unit alone is documentation.
    reviseClass: schemaChanged ? "semantic" : "documentation",
    propertyKey: definition.propertyKey,
    ...content,
    reason: reason.trim()
  });

  const validateExamples = () => {
    try {
      parsePublicationExamples(contentDraft());
      return true;
    } catch (error) {
      setError(`${error instanceof Error ? error.message : publicationCopy.invalidExamples}当前输入已保留。`);
      return false;
    }
  };

  /** Content-only edit: publish a revision, no project reference moves. */
  const saveContentRevision = async () => {
    if (!canPublish || pending) return;
    if (!validateExamples()) return;
    if (!reason.trim()) {
      setError("请填写修改原因，用于审计。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const key = idempotencyKey ?? (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
      setIdempotencyKey(key);
      const candidate = await catalog.createPublicationCandidate(
        { changeSet: buildPublicationChangeSet(contentDraft()) as never },
        { catalogReleaseId }
      );
      const published = await catalog.publishPublicationCandidate(
        candidate.item.id,
        { idempotencyKey: key },
        { catalogReleaseId }
      );
      if (publicationSuccessKind(published.item)) await onRefreshEvidence?.();
      setPublicationJob(published.item);
      setPhase("content-saved");
      onCompleted?.();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setPending(false);
    }
  };

  const execute = async () => {
    if (!canPublish || !preview || pending) return;
    setPending(true);
    const key = idempotencyKey ?? (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
    setIdempotencyKey(key);
    try {
      // The API enqueues the successor publication and the publication manager
      // installs it (CP-07 isolation): the first answer is a retryable
      // "catalog not ready", and once the manager activated the successor the
      // same command answers release-drift because the fresh release is current.
      // Retry the same idempotent command with a refreshed release pin instead of
      // reporting a failure the operator would have to guess about.
      let releaseId = catalogReleaseId;
      let response: CatalogReplacementResponse | null = null;
      for (let attempt = 0; attempt < ACTIVATION_RETRY_LIMIT; attempt += 1) {
        try {
          response = await catalog.createDefinitionReplacement(
            {
              previewId: preview.previewId,
              previewFingerprint: preview.previewFingerprint,
              idempotencyKey: key
            },
            // The frozen preview fingerprint is the If-Match: an ETag alone cannot
            // detect a source or per-project tip change since the preview.
            { catalogReleaseId: releaseId, idempotencyKey: key, ifMatch: preview.previewFingerprint }
          );
          break;
        } catch (caught) {
          if (!awaitsSuccessorActivation(caught) || attempt === ACTIVATION_RETRY_LIMIT - 1) {
            throw caught;
          }
          const refreshed = await catalog.getCatalog();
          releaseId = refreshed.item?.catalogReleaseId ?? releaseId;
          await delay(ACTIVATION_RETRY_DELAY_MS);
        }
      }
      if (!response) {
        throw new Error("definition-replacement activation did not complete");
      }
      setReplacement(response.item);
      setPhase("executed");
      setConfirmOpen(false);
      void onRefreshEvidence?.();
      onCompleted?.();
    } catch (caught) {
      setError(failureText(caught));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const continueBlocked = async () => {
    if (!canPublish || !replacement || pending) return;
    setPending(true);
    const key = (createIdempotencyKey ?? createGovernanceIdempotencyKey)();
    try {
      const response = await catalog.continueDefinitionReplacement(
        replacement.id,
        {
          idempotencyKey: key,
          projectIds: replacement.projects
            .filter((project) => project.status === "blocked" || project.status === "pending")
            .map((project) => project.projectId)
        },
        // Continue is fenced on the replacement's own ETag version.
        { catalogReleaseId, idempotencyKey: key, ifMatch: replacement.etag }
      );
      setReplacement(response.item);
      void onRefreshEvidence?.();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setPending(false);
    }
  };

  const retireOldDefinition = async () => {
    if (!replacement || pending || !onRetireDefinition) return;
    setPending(true);
    try {
      const current = (await catalog.getDefinitionReplacement(replacement.id)).item;
      setReplacement(current);
      if (current.status === "completed" && current.retirementEvidence?.authoritative &&
        current.retirementEvidence.scope === "platform" && current.retirementEvidence.remainingCurrentReferenceCount === 0) {
        onRetireDefinition();
      } else setError("旧定义已有当前项目引用，暂不能从纠错结果中退役；请先核对并迁移实际项目。当前输入已保留。");
    } catch (caught) { setError(failureText(caught)); }
    finally { setPending(false); }
  };

  const blockedCount = replacement
    ? replacement.projects.filter((project) => project.status === "blocked").length
    : 0;

  return (
    <>
      <section
        className="definition-editor"
        aria-label="定义详情"
        data-catalog-detail-region="true"
      >
        <header className="definition-editor__head">
          <span className="parameter-catalog__badge" data-tone={definition.lifecycle === "active" ? undefined : "retired"}>
            {catalogLifecycleLabel(definition.lifecycle)}
          </span>
          <span className="definition-editor__subject">{definition.subject.canonicalName || definitionSubject?.canonicalName || definition.subject.id}</span>
          <span className="parameter-catalog__muted">{`修订 #${definition.currentRevision.revisionNumber}`}</span>
          <code className="definition-editor__id">{definition.id}</code>
        </header>

        {editable ? (
          <div className="definition-editor__form">
            <fieldset className="definition-editor__inputs" disabled={pending || phase !== "compose"}>
            <div className="definition-editor__card">
              <div className="definition-editor__card-header">
                <span className="definition-editor__card-title">核心属性定义</span>
                <span className="definition-editor__card-desc">配置参数的所属主体、全局属性键及值类型规范</span>
              </div>
              <div className="definition-editor__fields">
                <label className="definition-editor__field">
                  <span className="definition-editor__field-label">
                    主体 <span className="definition-editor__required" aria-hidden="true">*</span>
                  </span>
                  <SelectControl
                    value={subjectId}
                    ariaLabel="主体"
                    disabled={pending || phase !== "compose"}
                    onValueChange={(value) => setSubjectId(value)}
                    options={[
                      ...(!targetSubjectAllowed ? [{ value: subjectId, label: `${subjects.find((subject) => subject.id === subjectId)?.canonicalName || subjectId}（当前不可用）`, disabled: true }] : []),
                      ...selectableSubjects.map((subject) => ({ value: subject.id, label: subject.canonicalName }))
                    ]}
                  />
                </label>
                <label className="definition-editor__field">
                  <span className="definition-editor__field-label">
                    属性键 <span className="definition-editor__required" aria-hidden="true">*</span>
                  </span>
                  <input
                    value={propertyKey}
                    aria-label="属性键"
                    onChange={(event) => setPropertyKey(event.target.value)}
                  />
                </label>
                <label className="definition-editor__field">
                  <span className="definition-editor__field-label">显示名</span>
                  <input
                    value={content.displayName}
                    aria-label="显示名"
                    placeholder="输入参数显示名称"
                    onChange={(event) => setContent({ ...content, displayName: event.target.value })}
                  />
                </label>
                <label className="definition-editor__field">
                  <span className="definition-editor__field-label">单位</span>
                  <input
                    value={content.unit}
                    aria-label="单位"
                    placeholder="例如 mA, us, ℃"
                    onChange={(event) => setContent({ ...content, unit: event.target.value })}
                  />
                </label>
                <label className="definition-editor__field">
                  <span className="definition-editor__field-label">取值形状</span>
                  <SelectControl
                    value={content.valueType}
                    ariaLabel="取值形状"
                    disabled={pending || phase !== "compose"}
                    onValueChange={(value) =>
                      setContent({ ...content, valueType: value as PublicationValueType })
                    }
                    options={schemaValueTypes.map((type) => ({ value: type, label: schemaValueTypeLabels[type] }))}
                  />
                </label>
                {content.valueType === "integer" || content.valueType === "number" ? (
                  <div className="definition-editor__range-group">
                    <label className="definition-editor__field">
                      <span className="definition-editor__field-label">最小值</span>
                      <input
                        value={content.minimum}
                        aria-label="最小值"
                        placeholder="下限"
                        onChange={(event) => setContent({ ...content, minimum: event.target.value })}
                      />
                    </label>
                    <label className="definition-editor__field">
                      <span className="definition-editor__field-label">最大值</span>
                      <input
                        value={content.maximum}
                        aria-label="最大值"
                        placeholder="上限"
                        onChange={(event) => setContent({ ...content, maximum: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="definition-editor__field-placeholder" aria-hidden="true" />
                )}
                <label className="definition-editor__field definition-editor__field--full">
                  <span className="definition-editor__field-label">{publicationCopy.examples}</span>
                  <textarea
                    value={content.examples}
                    aria-label={publicationCopy.examples}
                    rows={4}
                    placeholder={publicationCopy.examplesPlaceholder}
                    onChange={(event) => setContent({ ...content, examples: event.target.value })}
                  />
                </label>
                <label className="definition-editor__field definition-editor__field--full">
                  <span className="definition-editor__field-label">说明</span>
                  <textarea
                    value={content.documentation}
                    aria-label="说明"
                    rows={2}
                    placeholder="请详细描述该参数的工程含义、硬件接口与约束要求…"
                    onChange={(event) => setContent({ ...content, documentation: event.target.value })}
                  />
                </label>
              </div>
            </div>

            <div className="definition-editor__card">
              <div className="definition-editor__card-header">
                <span className="definition-editor__card-title">变更治理与审计</span>
                <span className="definition-editor__card-desc">配置受影响范围并填写修改原因，保障每次变更可溯</span>
              </div>

              {identityChanged ? (
                <div className="definition-editor__banner" data-tone="warning">
                  <strong>身份纠错变更模式：</strong>
                  <span>检测到主体或属性键发生变化。保存将发布替代身份，并把选定项目的当前引用迁移至新身份；旧身份与历史版本保持不变。</span>
                </div>
              ) : null}

              <div className="definition-editor__governance-stack">
                {identityChanged ? <fieldset className="definition-editor__projects">
                  <legend>受影响项目</legend>
                  <p className="parameter-catalog__muted">{actor === "platform-admin"
                    ? "不选择项目时，预演和发布会核对全平台当前引用；仅无引用定义可直接纠错。有引用时请选择实际项目并沿用迁移流程。"
                    : "仅迁移明确选中的项目，预演会核对其引用与兼容性。"}</p>
                  {projects.length === 0 ? <p role="status">{actor === "platform-admin"
                    ? "无需创建或选择无关项目。"
                    : "当前没有可选择的项目。请确认项目访问权限后重试。"}</p> : projects.map((project) => (
                    <label key={project.id}>
                      <input type="checkbox" checked={selectedProjects.includes(project.id)}
                        onChange={(event) => setSelectedProjects((current) => event.target.checked
                          ? [...current, project.id] : current.filter((id) => id !== project.id))} />
                      {project.name}
                    </label>
                  ))}
                </fieldset> : null}
                <label className="definition-editor__field definition-editor__field--full">
                  <span className="definition-editor__field-label">
                    修改原因 <span className="definition-editor__required" aria-hidden="true">*</span>
                  </span>
                  <textarea
                    value={reason}
                    aria-label="修改原因"
                    rows={2}
                    placeholder="请填写详细的修改原因，该信息将写入不可变发布审计日志…"
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              </div>
            </div>
            </fieldset>

            <div className="definition-editor__disclosures">
              <details className="definition-editor__more">
                <summary>更多信息</summary>
                <dl className="parameter-catalog__dl definition-editor__dl">
                  <dt>主体编号</dt>
                  <dd><code>{definition.subject.id}</code></dd>
                  <dt>定义编号</dt>
                  <dd><code>{definition.id}</code></dd>
                  <dt>当前修订</dt>
                  <dd>{`修订 #${definition.currentRevision.revisionNumber}`}</dd>
                  <dt>纳入发布</dt>
                  <dd><code>{definition.currentRevision.publishedInCatalogReleaseId}</code></dd>
                  <dt>取值形状</dt>
                  <dd>{catalogValueShapeLabel(definition.currentRevision.valueShape.schema as never)}</dd>
                  <dt>单位</dt>
                  <dd>{definition.currentRevision.unit?.symbol ?? "未设置"}</dd>
                  <dt>说明</dt>
                  <dd className="parameter-text-content" aria-label="已发布参数说明">{definition.currentRevision.documentation ?? "无"}</dd>
                  <dt>使用</dt>
                  <dd>
                    {definition.usageSummary.policyCount === null
                      ? "策略使用量暂不可用"
                      : `策略 ${definition.usageSummary.policyCount}`} · 项目 {definition.usageSummary.projectCount} · 当前值{" "}
                    {definition.usageSummary.currentValueCount}
                  </dd>
                  <dt>登记</dt>
                  <dd>
                    {catalogRegistrationLabel(definition.registration.status)}
                    {definition.registration.status !== "unregistered" && definition.registration.id
                      ? ` · ${definition.registration.id}`
                      : ""}
                  </dd>
                  <dt>放置</dt>
                  <dd>
                    {definition.registration.status === "unregistered"
                      ? "未建立"
                      : definition.registration.placement?.displayName ?? "未建立"}
                  </dd>
                  {definitionSubject?.aliases?.length ? (
                    <>
                      <dt>别名</dt>
                      <dd>{definitionSubject.aliases.join("、")}</dd>
                    </>
                  ) : null}
                </dl>
              </details>

              <div className="definition-editor__history">
                <div className="definition-editor__history-header">
                  <span className="definition-editor__history-title">定义时间线与变更历史</span>
                  <button
                    type="button"
                    className="button subtle sm"
                    data-catalog-history-toggle="true"
                    aria-expanded={historyOpen}
                    onClick={() => {
                      const next = !historyOpen;
                      setHistoryOpen(next);
                      if (next) onRequestHistory?.();
                    }}
                  >
                    {historyOpen ? catalogHistoryCloseLabel : catalogHistoryOpenLabel}
                  </button>
                </div>
                {historyOpen ? (
                  <section aria-label="定义时间线" data-catalog-history-region="true" className="definition-editor__history-body">
                    {history}
                  </section>
                ) : null}
              </div>
            </div>

            {phase === "compose" ? (
              <div className="definition-editor__footer">
                <div className="definition-editor__footer-status">
                  <span
                    className="definition-editor__status-dot"
                    data-status={identityChanged ? "warning" : contentChanged ? "info" : "neutral"}
                  />
                  <p className="parameter-catalog__muted" data-definition-editor-hint="true">
                    {identityChanged
                      ? "保存会发布替代身份，并把选定项目的当前引用迁移过去；旧身份与历史保持不变。"
                      : contentChanged
                        ? `内容修订只发布新修订，不迁移项目引用。${removedOptionalContent.length ? `本次将移除：${removedOptionalContent.join("、")}。` : ""}`
                        : "未做任何修改。"}
                  </p>
                </div>
                <div className="dialog-actions definition-editor__dialog-actions">
                  {onClose ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={pending}
                      onClick={onClose}
                    >
                      取消
                    </button>
                  ) : null}
                  {identityChanged ? (
                    <button
                      type="button"
                      className="button primary"
                      data-correction-action="preview"
                      disabled={
                        !allowed ||
                        !targetSubjectAllowed ||
                        pending ||
                        (selectedProjects.length === 0 && actor !== "platform-admin") ||
                        !reason.trim()
                      }
                      title={allowed ? undefined : "当前会话缺少发布能力。"}
                      onClick={() => void runPreview()}
                    >
                      {pending ? "正在预演…" : "预演影响"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button primary"
                      data-editor-action="save-content"
                      disabled={!canPublish || pending || !contentChanged || !reason.trim()}
                      title={canPublish ? undefined : publishDisabledReason}
                      onClick={() => void saveContentRevision()}
                    >
                      {pending ? "正在发布…" : "保存内容修订"}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="definition-editor__readonly">
            <dl className="parameter-catalog__dl definition-editor__dl">
              <dt>显示名</dt>
              <dd>{definition.currentRevision.displayName || "未设置"}</dd>
              <dt>取值形状</dt>
              <dd>{catalogValueShapeLabel(definition.currentRevision.valueShape.schema as never)}</dd>
              <dt>单位</dt>
              <dd>{definition.currentRevision.unit?.symbol ?? "未设置"}</dd>
              <dt>登记</dt>
              <dd>{catalogRegistrationLabel(definition.registration.status)}</dd>
              <dt>所属模块</dt>
              <dd>{definition.registration.status === "unregistered" ? "未建立" : definition.registration.placement?.displayName ?? "未建立"}</dd>
              <dt>取值约束</dt>
              <dd><details><summary>查看完整约束</summary><pre>{JSON.stringify(definition.currentRevision.valueShape.schema, null, 2)}</pre></details></dd>
              {typeof definition.currentRevision.valueShape.schema.minimum === "number" ? <>
                <dt>最小值</dt><dd>{String(definition.currentRevision.valueShape.schema.minimum)}</dd>
              </> : null}
              {typeof definition.currentRevision.valueShape.schema.maximum === "number" ? <>
                <dt>最大值</dt><dd>{String(definition.currentRevision.valueShape.schema.maximum)}</dd>
              </> : null}
              <dt>当前修订</dt>
              <dd>{`修订 #${definition.currentRevision.revisionNumber}`}</dd>
              <dt>说明</dt>
              <dd className="parameter-text-content" aria-label="已发布参数说明">{definition.currentRevision.documentation ?? "无"}</dd>
              <dt>使用</dt>
              <dd>
                {definition.usageSummary.policyCount === null
                  ? "策略使用量暂不可用"
                  : `策略 ${definition.usageSummary.policyCount}`} · 项目 {definition.usageSummary.projectCount} · 当前值{" "}
                {definition.usageSummary.currentValueCount}
              </dd>
            </dl>
            <details className="definition-editor__more">
              <summary>技术标识</summary>
              <dl className="parameter-catalog__dl definition-editor__dl">
                <dt>主体编号</dt><dd><code>{definition.subject.id}</code></dd>
                <dt>定义编号</dt><dd><code>{definition.id}</code></dd>
                <dt>纳入发布</dt><dd><code>{definition.currentRevision.publishedInCatalogReleaseId}</code></dd>
              </dl>
            </details>
            <div className="definition-editor__history">
              <div className="definition-editor__history-header">
                <span className="definition-editor__history-title">定义时间线与变更历史</span>
                <button
                  type="button"
                  className="button subtle sm"
                  data-catalog-history-toggle="true"
                  aria-expanded={historyOpen}
                  onClick={() => {
                    const next = !historyOpen;
                    setHistoryOpen(next);
                    if (next) onRequestHistory?.();
                  }}
                >
                  {historyOpen ? catalogHistoryCloseLabel : catalogHistoryOpenLabel}
                </button>
              </div>
              {historyOpen ? (
                <section
                  aria-label="定义时间线"
                  data-catalog-history-region="true"
                  className="definition-editor__history-body"
                >
                  {history}
                </section>
              ) : null}
            </div>
          </div>
        )}

        {editable && phase === "preview" && preview ? (
          <section aria-label="纠错影响预览" data-correction-preview="true" className="definition-editor__phase-panel">
            <div className="definition-editor__card-header">
              <h3 className="definition-editor__card-title">纠错影响预览</h3>
              <span className="definition-editor__card-desc">{preview.impact.selectedProjectCount === 0 ? "发布时会再次核对全平台当前引用" : "核对受影响项目的兼容性与迁移阻挡原因"}</span>
            </div>
            <dl className="parameter-catalog__dl definition-editor__preview-dl">
              <dt>选定项目</dt>
              <dd>{preview.impact.selectedProjectCount}</dd>
              <dt>可迁移</dt>
              <dd className="definition-editor__val--success">{preview.impact.compatibleProjectCount}</dd>
              <dt>被阻止</dt>
              <dd className={preview.impact.blockedProjectCount > 0 ? "definition-editor__val--danger" : ""}>
                {preview.impact.blockedProjectCount}
              </dd>
              <dt>{preview.impact.selectedProjectCount === 0 ? "全平台当前引用" : "旧定义当前引用"}</dt>
              <dd>{preview.impact.oldDefinitionCurrentReferenceCount}</dd>
              <dt>源格式受支持</dt>
              <dd>{preview.impact.sourceFormatSupported ? "是" : "否"}</dd>
              <dt>新主体需要登记</dt>
              <dd>{preview.impact.targetRegistrationRequired ? "是" : "否"}</dd>
            </dl>
            {preview.blockers.length > 0 ? (
              <ul data-correction-blockers="true" className="definition-editor__blockers">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            {preview.projects.length > 0 ? <div className="definition-editor__table-wrap">
              <table aria-label="项目迁移预览" className="definition-editor__table">
                <thead>
                  <tr>
                    <th scope="col">项目</th>
                    <th scope="col">状态</th>
                    <th scope="col">取值兼容</th>
                    <th scope="col">阻止原因</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.projects.map((project) => (
                    <tr key={project.projectId}>
                      <td>{project.projectName}</td>
                      <td>{projectStatusLabel[project.status]}</td>
                      <td>{project.compatible ? "兼容" : "不兼容"}</td>
                      <td>{project.blockerReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div> : null}
            <div className="dialog-actions definition-editor__dialog-actions">
              <button
                type="button"
                className="button ghost"
                disabled={pending}
                onClick={() => { setPhase("compose"); setPreview(null); setPreviewIdempotencyKey(null); setIdempotencyKey(null); setError(""); }}
              >
                返回修改
              </button>
              <button
                type="button"
                className="button primary"
                data-correction-action="execute"
                disabled={!canPublish || pending}
                title={canPublish ? undefined : publishDisabledReason}
                onClick={() => setConfirmOpen(true)}
              >
                {preview.impact.selectedProjectCount === 0 ? "确认并执行纠错" : "确认并执行迁移"}
              </button>
            </div>
          </section>
        ) : null}

        {phase === "executed" && replacement ? (
          <section aria-label="纠错执行结果" data-correction-result={replacement.status} className="definition-editor__phase-panel">
            <div className="definition-editor__card-header">
              <h3 className="definition-editor__card-title">纠错执行结果</h3>
              <span className="definition-editor__card-desc">{preview?.impact.selectedProjectCount === 0
                ? "替代身份已发布，旧定义保持有效；纠错不会自动退役或删除旧定义。"
                : "身份替换已生效，受影响项目引用迁移汇总"}</span>
            </div>
            {preview?.impact.selectedProjectCount === 0 ? <dl className="parameter-catalog__dl">
              <dt>旧身份</dt><dd>{replacement.oldIdentity.propertyKey}</dd>
              <dt>替代身份</dt><dd>{replacement.newIdentity.propertyKey}</dd>
            </dl> : <><ul className="definition-editor__stats-list">
              <li>已完成 {replacement.projects.filter((p) => p.status === "completed").length}</li>
              <li>被阻止 {replacement.projects.filter((p) => p.status === "blocked").length}</li>
              <li>失败 {replacement.projects.filter((p) => p.status === "failed").length}</li>
              <li>待处理 {replacement.projects.filter((p) => p.status === "pending").length}</li>
            </ul>
            <div className="definition-editor__table-wrap">
              <table aria-label="项目迁移结果" className="definition-editor__table">
                <thead>
                  <tr>
                    <th scope="col">项目</th>
                    <th scope="col">状态</th>
                    <th scope="col">阻止原因</th>
                  </tr>
                </thead>
                <tbody>
                  {replacement.projects.map((project) => (
                    <tr key={project.projectId}>
                      <td>{project.projectName}</td>
                      <td>{projectStatusLabel[project.status]}</td>
                      <td>{project.blockerReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></>}
            <div className="dialog-actions definition-editor__dialog-actions">
              {actor === "platform-admin" && onRetireDefinition && replacement.status === "completed" &&
                replacement.retirementEvidence?.authoritative && replacement.retirementEvidence.scope === "platform" &&
                replacement.retirementEvidence.remainingCurrentReferenceCount === 0 ? (
                  <button type="button" className="button subtle" disabled={!canPublish || pending} onClick={() => void retireOldDefinition()}>
                    单独退役旧定义
                  </button>
                ) : null}
              {onClose ? (
                <button type="button" className="button subtle" onClick={onClose}>
                  关闭
                </button>
              ) : null}
              {blockedCount > 0 ? (
                <button
                  type="button"
                  className="button subtle"
                  data-correction-continue="true"
                  disabled={!canPublish || pending}
                  onClick={() => void continueBlocked()}
                >
                  继续处理被阻止的项目
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {phase === "content-saved" && publicationJob ? (
          <section aria-label="内容修订结果" data-editor-result="content" className="definition-editor__phase-panel">
            <div className="definition-editor__card-header">
              <h3 className="definition-editor__card-title">内容修订结果</h3>
            </div>
            <p>{publicationStatusCopy(publicationJob).message}</p>
            {publicationJobIsPending(publicationJob.status) ? (
              <p className="parameter-catalog__muted">
                发布任务仍在处理中，状态将自动更新。
              </p>
            ) : null}
            {publicationJobIsPending(publicationJob.status) || error ? <button type="button" className="button subtle" onClick={() => void refreshPublication()}>刷新发布状态</button> : null}
            {onClose ? (
              <div className="dialog-actions definition-editor__dialog-actions">
                <button type="button" className="button subtle" onClick={onClose}>
                  关闭
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p role="alert" data-preserve-input="true" className="definition-editor__error">
            {error}
          </p>
        ) : null}
        {existingDefinition ? <a target="_blank" rel="noreferrer" href={`?${new URLSearchParams({
          subjectId: existingDefinition.subjectId, definitionId: existingDefinition.definitionId })}`}>查看已有定义</a> : null}
        {relatedKnowledge ? (
          <details className="definition-editor__more">
            <summary>相关知识</summary>
            <SpecRelatedKnowledgeSection key={definition.id} specId={definition.id} source={relatedKnowledge} allowLink />
          </details>
        ) : null}
      </section>
      <ConfirmDialog
        open={confirmOpen && canPublish}
        title={preview?.impact.selectedProjectCount === 0 ? "确认执行身份纠错" : "确认执行身份纠错迁移"}
        description={
          preview
            ? [
                `将发布替代身份 ${preview.newIdentity.propertyKey}（主体 ${preview.newIdentity.subjectName}）。`,
                preview.impact.selectedProjectCount === 0
                  ? "全平台当前引用为 0，无需迁移项目；发布时将重新检查。"
                  : `迁移 ${preview.impact.compatibleProjectCount} 个项目，${preview.impact.blockedProjectCount} 个项目会被阻止并保留待续。`,
                "旧身份与旧取值不会被重写；迁移不会自动退役旧定义。"
              ].join("\n")
            : ""
        }
        confirmLabel="确认执行"
        pending={pending}
        pendingLabel="正在执行…"
        error={error}
        onConfirm={() => void execute()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function failureText(error: unknown): string {
  if (error instanceof WiseEffApiError) {
    if (error.details.replacement === "current-project-references") return "旧定义已有当前项目引用，请选择实际项目并使用迁移流程。当前输入已保留。";
    if (error.details.replacement === "target-identity-conflict") return "目标身份已存在，请查看已有定义或修改目标身份。当前输入已保留。";
    if (error.details.replacement === "replacement-target-unavailable") return "已发布的替代定义当前不可用，请刷新 Catalog 后核对目标身份。当前输入已保留。";
  }
  const state = catalogStateFromFailure(error);
  return `${catalogStateMessage(state) ?? "操作未完成，请稍后重试。"} 当前输入已保留。`;
}
