import { useEffect, useMemo, useState } from "react";

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

import { canExecutePublicationAction } from "./publicationState";
import { createGovernanceIdempotencyKey } from "./governanceState";

export type DefinitionCorrectionSectionProps = {
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
 * Definition identity correction (issue #847 decisions 12-17).
 *
 * Identity is corrected by publishing a replacement identity and migrating an
 * explicitly selected, authorized project manifest. The workflow is
 * preview -> confirm -> execute -> continue, it never rewrites the old identity,
 * and it reports per-project progress rather than claiming an instance-wide
 * transaction.
 */
export function DefinitionCorrectionSection({
  actor,
  sessionPermissions,
  domainState,
  catalog,
  catalogReleaseId,
  definition,
  subjects,
  createIdempotencyKey,
  onCompleted,
  onRefreshEvidence
}: DefinitionCorrectionSectionProps) {
  const [phase, setPhase] = useState<Phase>("compose");
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
  }, [definition]);

  const selectedProjects = useMemo(
    () =>
      projectIdsText
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    [projectIdsText]
  );

  const selectableSubjects = useMemo(
    () => subjects.filter((subject) => subject.membership.status === "active"),
    [subjects]
  );

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
        className="definition-correction"
        aria-label="身份纠错"
        data-definition-correction="true"
      >
        <h3>身份纠错</h3>
        <p>
          纠错会发布一个新的替代身份，并把选定项目的当前引用迁移到新身份。旧身份、旧修订、旧取值与历史审计保持不变，不会被重写。
        </p>
        <dl className="parameter-catalog__dl">
          <dt>原定义</dt>
          <dd>{definition.id}</dd>
          <dt>原属性键</dt>
          <dd>{definition.propertyKey}</dd>
          <dt>原主体</dt>
          <dd>{definition.subject.canonicalName}</dd>
        </dl>

        {phase === "compose" ? (
          <>
            <label>
              <span>替代主体</span>
              <select
                value={subjectId}
                aria-label="替代主体"
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
              <span>替代属性键</span>
              <input
                value={propertyKey}
                aria-label="替代属性键"
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
            <fieldset>
              <legend>受影响项目（仅限本组织）</legend>
              <p>
                迁移只覆盖你在此显式选择的项目；其他组织与未选项目保持不变。多个项目用逗号分隔。
              </p>
              <label>
                <span>项目编号</span>
                <input
                  value={projectIdsText}
                  aria-label="受影响项目编号"
                  onChange={(event) => setProjectIdsText(event.target.value)}
                />
              </label>
            </fieldset>
            <label>
              <span>纠错原因</span>
              <textarea
                value={reason}
                aria-label="纠错原因"
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </>
        ) : null}

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

        <div className="dialog-actions">
          {phase === "compose" ? (
            <button
              type="button"
              className="button primary"
              data-correction-action="preview"
              disabled={!allowed || pending || selectedProjects.length === 0}
              title={allowed ? undefined : "当前会话缺少发布能力。"}
              onClick={() => void runPreview()}
            >
              {pending ? "正在预演…" : "预演影响"}
            </button>
          ) : null}
          {phase === "preview" ? (
            <button
              type="button"
              className="button primary"
              data-correction-action="execute"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
            >
              确认并执行迁移
            </button>
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
