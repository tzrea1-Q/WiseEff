import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, type CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type {
  CatalogDefinitionResponse,
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

import { canExecutePublicationAction } from "./publicationState";
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
  /** Server gate: without it the dialog only reads. */
  authoringAllowed: boolean;
};

type Phase = "compose" | "preview" | "executed";

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
  authoringAllowed
}: DefinitionEditorBodyProps) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(definition.subject.id);
  const [propertyKey, setPropertyKey] = useState(definition.propertyKey);
  const [displayName, setDisplayName] = useState(definition.currentRevision.displayName);
  const [documentation, setDocumentation] = useState(
    definition.currentRevision.documentation ?? ""
  );
  const [reason, setReason] = useState("");
  /**
   * Free text while composing, parsed into exact project ids on use. Re-joining
   * parsed ids on every keystroke would corrupt in-progress input.
   */
  const [projectIdsText, setProjectIdsText] = useState("");
  const [preview, setPreview] = useState<CatalogReplacementPreview | null>(null);
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
    setDisplayName(definition.currentRevision.displayName);
    setDocumentation(definition.currentRevision.documentation ?? "");
    setReason("");
    setProjectIdsText("");
    setPreview(null);
    setReplacement(null);
    setConfirmOpen(false);
    setPending(false);
    setError("");
    setPreviewIdempotencyKey(null);
    setIdempotencyKey(null);
    setHistoryOpen(false);
  }, [definition]);

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

  /** The form edits the definition's identity, so "unchanged" is a real state. */
  const identityChanged =
    subjectId !== definition.subject.id || propertyKey.trim() !== definition.propertyKey;
  const contentChanged = displayName.trim() !== definition.currentRevision.displayName;

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
          displayName: displayName.trim(),
          documentation,
          projectIds: [...selectedProjects],
          reason: reason.trim(),
          valueSchema: definition.currentRevision.valueShape
            .schema as never
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
            <div className="definition-editor__fields">
              <label>
                <span>主体</span>
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
              <label>
                <span>属性键</span>
                <input
                  value={propertyKey}
                  aria-label="属性键"
                  onChange={(event) => setPropertyKey(event.target.value)}
                />
              </label>
              <label>
                <span>显示名</span>
                <input
                  value={displayName}
                  aria-label="显示名"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>受影响项目</span>
              <input
                value={projectIdsText}
                aria-label="受影响项目"
                placeholder="项目编号，多个用逗号分隔"
                onChange={(event) => setProjectIdsText(event.target.value)}
              />
            </label>
            <label>
              <span>修改原因</span>
              <textarea
                value={reason}
                aria-label="修改原因"
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <p className="parameter-catalog__muted" data-definition-editor-hint="true">
              {identityChanged
                ? "保存会发布替代身份，并把选定项目的当前引用迁移过去；旧身份与历史保持不变。"
                : contentChanged
                  ? "只有主体或属性键的变更会进入迁移；显示名随新身份一起发布。"
                  : "未做任何修改。"}
            </p>
            {phase === "compose" ? (
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button primary"
                  data-correction-action="preview"
                  disabled={
                    !allowed ||
                    pending ||
                    (!identityChanged && !contentChanged) ||
                    selectedProjects.length === 0 ||
                    !reason.trim()
                  }
                  title={allowed ? undefined : "当前会话缺少发布能力。"}
                  onClick={() => void runPreview()}
                >
                  {pending ? "正在预演…" : "预演影响"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="parameter-catalog__muted">
            当前会话缺少目录编写能力，只能查看该定义。
          </p>
        )}

        {phase === "preview" && preview ? (
          <section aria-label="纠错影响预览" data-correction-preview="true">
            <h3>影响预览</h3>
            <dl className="parameter-catalog__dl">
              <dt>选定项目</dt>
              <dd>{preview.impact.selectedProjectCount}</dd>
              <dt>可迁移</dt>
              <dd>{preview.impact.compatibleProjectCount}</dd>
              <dt>被阻止</dt>
              <dd>{preview.impact.blockedProjectCount}</dd>
              <dt>旧定义当前引用</dt>
              <dd>{preview.impact.oldDefinitionCurrentReferenceCount}</dd>
              <dt>源格式受支持</dt>
              <dd>{preview.impact.sourceFormatSupported ? "是" : "否"}</dd>
              <dt>新主体需要登记</dt>
              <dd>{preview.impact.targetRegistrationRequired ? "是" : "否"}</dd>
            </dl>
            {preview.blockers.length > 0 ? (
              <ul data-correction-blockers="true">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            <table aria-label="项目迁移预览">
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
            <div className="dialog-actions">
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
          <section aria-label="纠错执行结果" data-correction-result={replacement.status}>
            <h3>执行结果</h3>
            <ul>
              <li>已完成 {replacement.projects.filter((p) => p.status === "completed").length}</li>
              <li>被阻止 {replacement.projects.filter((p) => p.status === "blocked").length}</li>
              <li>失败 {replacement.projects.filter((p) => p.status === "failed").length}</li>
              <li>待处理 {replacement.projects.filter((p) => p.status === "pending").length}</li>
            </ul>
            <table aria-label="项目迁移结果">
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
          </section>
        ) : null}

        {error ? (
          <p role="alert" data-preserve-input="true">
            {error}
          </p>
        ) : null}

        <details className="definition-editor__more">
          <summary>更多信息</summary>
          <dl className="parameter-catalog__dl">
            <dt>主体编号</dt>
            <dd>{definition.subject.id}</dd>
            <dt>定义编号</dt>
            <dd>{definition.id}</dd>
            <dt>当前修订</dt>
            <dd>{`修订 #${definition.currentRevision.revisionNumber}`}</dd>
            <dt>纳入发布</dt>
            <dd>{definition.currentRevision.publishedInCatalogReleaseId}</dd>
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
          <button
            type="button"
            className="button subtle sm"
            data-catalog-history-toggle="true"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {historyOpen ? catalogHistoryCloseLabel : catalogHistoryOpenLabel}
          </button>
          {historyOpen ? (
            <section aria-label="定义时间线" data-catalog-history-region="true">
              {history}
            </section>
          ) : null}
        </div>
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
