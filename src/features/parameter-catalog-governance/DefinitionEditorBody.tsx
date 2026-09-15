import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
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
  publicationJobIsPending,
  publicationStatusCopy,
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
  subjects: readonly CatalogSubjectResponse["item"][];
  /**
   * Authorized projects of the current organization. Selection is explicit: the
   * administrator names the projects to migrate and the server rejects any
   * project that is not in the caller's organization.
   */
  createIdempotencyKey?: () => string;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
  /** Read-only history the page loaded for this definition. */
  history: ReactNode;
  /** Ask the page to load revisions and the timeline for this definition. */
  onRequestHistory?: () => void;
  /** Close callback to dismiss the host dialog. */
  onClose?: () => void;
  /** Server gate: without it the dialog only reads. */
  authoringAllowed: boolean;
};


/** Editor state for the definition's content, derived from its current revision. */
type ContentDraft = Pick<
  PublicationDraft,
  "displayName" | "documentation" | "description" | "unit" | "valueType" | "minimum" | "maximum"
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
  [draft.displayName, draft.documentation, draft.unit, draft.valueType, draft.minimum, draft.maximum].join(
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
  subjects,
  createIdempotencyKey,
  onCompleted,
  onRefreshEvidence,
  history,
  onRequestHistory,
  onClose,
  authoringAllowed
}: DefinitionEditorBodyProps) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(definition.subject.id);
  const [propertyKey, setPropertyKey] = useState(definition.propertyKey);
  const [content, setContent] = useState(() => contentDraftOf(definition));
  const [reason, setReason] = useState("");
  /**
   * Free text while composing, parsed into exact project ids on use. Re-joining
   * parsed ids on every keystroke would corrupt in-progress input.
   */
  const [projectIdsText, setProjectIdsText] = useState("");
  const [preview, setPreview] = useState<CatalogReplacementPreview | null>(null);
  const [publicationJob, setPublicationJob] = useState<
    CatalogPublicationJobResponse["item"] | null
  >(null);
  const [replacement, setReplacement] = useState<CatalogReplacement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [previewIdempotencyKey, setPreviewIdempotencyKey] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const allowed = canExecutePublicationAction(
    actor,
    "preview-publication",
    domainState,
    sessionPermissions
  );

  useEffect(() => {
    setPhase("compose");
    setSubjectId(definition.subject.id);
    setPropertyKey(definition.propertyKey);
    setContent(contentDraftOf(definition));
    setReason("");
    setProjectIdsText("");
    setPreview(null);
    setReplacement(null);
    setPublicationJob(null);
    setConfirmOpen(false);
    setPending(false);
    setError("");
    setPreviewIdempotencyKey(null);
    setIdempotencyKey(null);
    setHistoryOpen(false);
    // Reset only when the edited definition changes; a refreshed snapshot yields a
    // new object for the same definition and must not collapse the disclosure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.id]);

  const selectedProjects = useMemo(
    () =>
      projectIdsText
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    [projectIdsText]
  );

  const definitionSubject = useMemo(
    () => subjects.find((subject) => subject.id === definition.subject.id),
    [definition.subject.id, subjects]
  );

  const selectableSubjects = useMemo(
    () => subjects.filter((subject) => subject.membership.status === "active"),
    [subjects]
  );

  /** The form edits identity and content, so "unchanged" is a real state. */
  const identityChanged =
    subjectId !== definition.subject.id || propertyKey.trim() !== definition.propertyKey;
  const currentContent = useMemo(() => contentDraftOf(definition), [definition]);
  const contentChanged = useMemo(
    () =>
      fingerprintContent(content) !== fingerprintContent(currentContent),
    [content, currentContent]
  );
  const schemaChanged =
    content.valueType !== currentContent.valueType ||
    content.minimum !== currentContent.minimum ||
    content.maximum !== currentContent.maximum;

  const runPreview = async () => {
    if (!allowed || pending) return;
    if (selectedProjects.length === 0) {
      setError("请选择至少一个受影响的项目。");
      return;
    }
    if (!reason.trim()) {
      setError("请填写纠错原因，用于审计。");
      return;
    }
    setPending(true);
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

  /** Content-only edit: publish a revision, no project reference moves. */
  const saveContentRevision = async () => {
    if (pending) return;
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
      setPublicationJob(published.item);
      setPhase("content-saved");
      void onRefreshEvidence?.();
      onCompleted?.();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setPending(false);
    }
  };

  const execute = async () => {
    if (!preview || pending) return;
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
    if (!replacement || pending) return;
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

  const blockedCount = replacement
    ? replacement.projects.filter((project) => project.status === "blocked").length
    : 0;

  return (
    <>
      <section
        className="definition-editor"
        role="region"
        aria-label="定义详情"
        data-catalog-detail-region="true"
      >
        <header className="definition-editor__head">
          <span className="parameter-catalog__badge" data-tone={definition.lifecycle === "active" ? undefined : "retired"}>
            {catalogLifecycleLabel(definition.lifecycle)}
          </span>
          <span className="definition-editor__subject">{definition.subject.canonicalName}</span>
          <span className="parameter-catalog__muted">{`修订 #${definition.currentRevision.revisionNumber}`}</span>
          <code className="definition-editor__id">{definition.id}</code>
        </header>

        {authoringAllowed ? (
          <div className="definition-editor__form">
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
                  <select
                    value={subjectId}
                    aria-label="主体"
                    onChange={(event) => setSubjectId(event.target.value)}
                  >
                    {selectableSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.canonicalName}
                      </option>
                    ))}
                  </select>
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
                  <select
                    value={content.valueType}
                    aria-label="取值形状"
                    onChange={(event) =>
                      setContent({ ...content, valueType: event.target.value as PublicationValueType })
                    }
                  >
                    {schemaValueTypes.map((type) => (
                      <option key={type} value={type}>
                        {schemaValueTypeLabels[type]}
                      </option>
                    ))}
                  </select>
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
                <label className="definition-editor__field definition-editor__field--full">
                  <span className="definition-editor__field-label">
                    受影响项目 {identityChanged ? <span className="definition-editor__required" aria-hidden="true">*</span> : null}
                  </span>
                  <input
                    value={projectIdsText}
                    aria-label="受影响项目"
                    placeholder="输入需要同步迁移引用的项目编号，多个项目用逗号分隔（例如 proj-a, proj-b）"
                    onChange={(event) => setProjectIdsText(event.target.value)}
                  />
                </label>
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
                  <dd>{definition.currentRevision.documentation ?? "无"}</dd>
                  <dt>使用</dt>
                  <dd>
                    策略 {definition.usageSummary.policyCount} · 项目 {definition.usageSummary.projectCount} · 当前值{" "}
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
                        ? "内容修订只发布新修订，不迁移项目引用。"
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
                        pending ||
                        selectedProjects.length === 0 ||
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
                      disabled={!allowed || pending || !contentChanged || !reason.trim()}
                      title={allowed ? undefined : "当前会话缺少发布能力。"}
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
          <p className="parameter-catalog__muted">
            当前会话缺少目录编写能力，只能查看该定义。
          </p>
        )}

        {phase === "preview" && preview ? (
          <section aria-label="纠错影响预览" data-correction-preview="true" className="definition-editor__phase-panel">
            <div className="definition-editor__card-header">
              <h3 className="definition-editor__card-title">纠错影响预览</h3>
              <span className="definition-editor__card-desc">核对受影响项目的兼容性与迁移阻挡原因</span>
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
              <dt>旧定义当前引用</dt>
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
            <div className="definition-editor__table-wrap">
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
            </div>
            <div className="dialog-actions definition-editor__dialog-actions">
              <button
                type="button"
                className="button ghost"
                disabled={pending}
                onClick={() => setPhase("compose")}
              >
                返回修改
              </button>
              <button
                type="button"
                className="button primary"
                data-correction-action="execute"
                disabled={pending}
                onClick={() => setConfirmOpen(true)}
              >
                确认并执行迁移
              </button>
            </div>
          </section>
        ) : null}

        {phase === "executed" && replacement ? (
          <section aria-label="纠错执行结果" data-correction-result={replacement.status} className="definition-editor__phase-panel">
            <div className="definition-editor__card-header">
              <h3 className="definition-editor__card-title">纠错执行结果</h3>
              <span className="definition-editor__card-desc">身份替换已生效，受影响项目引用迁移汇总</span>
            </div>
            <ul className="definition-editor__stats-list">
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
            </div>
            <div className="dialog-actions definition-editor__dialog-actions">
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
                  disabled={pending}
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
                发布任务仍在处理中，状态可能随后更新。
              </p>
            ) : null}
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


      </section>
      <ConfirmDialog
        open={confirmOpen}
        title="确认执行身份纠错迁移"
        description={
          preview
            ? [
                `将发布替代身份 ${preview.newIdentity.propertyKey}（主体 ${preview.newIdentity.subjectName}）。`,
                `迁移 ${preview.impact.compatibleProjectCount} 个项目，${preview.impact.blockedProjectCount} 个项目会被阻止并保留待续。`,
                "旧身份与旧取值不会被重写；迁移不会自动弃用旧定义。"
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
  const state = catalogStateFromFailure(error);
  return `操作失败（${state.kind}）。请刷新证据后重试，输入已保留。`;
}
