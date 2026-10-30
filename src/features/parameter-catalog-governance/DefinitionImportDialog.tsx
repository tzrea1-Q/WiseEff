import { useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogMarkdownImportResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import "@/features/parameter-catalog/parameter-catalog.css";

import { PublicationConfirmation } from "./PublicationConfirmation";
import { publicationSurfaceAdvisory, type PublicationSurfaceItem } from "./publicationSurface";
import {
  canExecutePublicationAction, emptyPublicationDraft, publicationApprovalCopy, publicationCopy,
  publicationFailureCopy, publicationJobIsPending, publicationMustRePreview,
  publicationStatusCopy, publicationSuccessKind,
} from "./publicationState";
import { usePublicationFlow } from "./usePublicationFlow";

const TEMPLATE = `# Driver \`vendor,existing-driver\`

## \`current-limit\` 电流限制
| 字段 | 值 |
| --- | --- |
| 类型 | integer |
| 单位 | uA |
| 最小值 | 0 |
| 最大值 | 5000000 |
| 示例 | 3000000 |
| 简述 | 电流限制 |

在此填写定义的 Markdown 说明。
`;

export type DefinitionImportDialogProps = {
  open: boolean;
  runtimeMode?: WiseEffRuntimeMode;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  catalogReleaseId: string;
  currentPersonId: string;
  organizationId: string;
  publicationSurface?: PublicationSurfaceItem | null;
  createIdempotencyKey?: () => string;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
  onRefreshEvidence?: () => void | Promise<void>;
};

export function DefinitionImportDialog(props: DefinitionImportDialogProps) {
  const { open, actor, sessionPermissions, domainState, catalog, catalogReleaseId } = props;
  const flow = usePublicationFlow(props);
  const { candidate, job, pending, failure, confirm, setConfirm } = flow;
  const [document, setDocument] = useState("");
  const [fileName, setFileName] = useState("粘贴.md");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<CatalogMarkdownImportResponse["item"]["entries"] | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const unavailable = props.runtimeMode === "mock" || !catalog.previewMarkdownImport
    ? "模拟模式不支持导入预览，请使用 API 模式。" : null;
  const canPreview = !unavailable && props.publicationSurface?.authoringAllowed === true
    && canExecutePublicationAction(actor, "preview-publication", domainState, sessionPermissions);
  const canPublish = props.publicationSurface?.publishingAllowed === true
    && canExecutePublicationAction(actor, "publish-publication", domainState, sessionPermissions);
  const previewStale = Boolean(candidate && (!flow.candidateVerified
    || candidate.expectedBaseReleaseId !== catalogReleaseId
    || (flow.previewFingerprint !== null && flow.previewFingerprint !== JSON.stringify([document, fileName]))));
  const mustRePreview = publicationMustRePreview({
    previewStale, jobStatus: job?.status, failureReason: job?.failure?.reason,
  });
  const succeeded = job ? publicationSuccessKind(job) : null;
  const status = job ? publicationStatusCopy(job) : null;
  const advisory = props.publicationSurface ? publicationSurfaceAdvisory(props.publicationSurface) : null;
  const dirty = Boolean(document) && !succeeded;
  const canRefresh = Boolean(props.onRefreshEvidence
    && (failure || job?.status === "needs-rebase" || job?.failure?.reason === "needs-rebase" || advisory));

  useEffect(() => {
    if (!open) { flow.stopPolling(); return undefined; }
    flow.restore(true, () => null);
    setDocument("");
    setFileName("粘贴.md");
    setUploadedFileName(null);
    setEntries(null);
    setErrorsOnly(false);
    return flow.stopPolling;
  }, [open, catalog, props.currentPersonId, props.organizationId]);

  useEffect(() => {
    if (!open || !dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, dirty]);

  const close = () => {
    if (dirty && !leaveConfirm) { setLeaveConfirm(true); return; }
    setLeaveConfirm(false);
    props.onOpenChange(false);
  };
  const updateDocument = (nextDocument: string, nextFileName: string) => {
    flow.reset();
    setEntries(null);
    setErrorsOnly(false);
    setDocument(nextDocument);
    setFileName(nextFileName);
  };
  const runPreview = async () => {
    if (!canPreview || pending || !document.trim() || !catalog.previewMarkdownImport) return;
    await flow.preview(async () => {
      const result = await catalog.previewMarkdownImport!(
        { markdownImport: { document, fileName } }, { catalogReleaseId },
      );
      setEntries(result.item.entries);
      setErrorsOnly(false);
      return result.item.candidate;
    }, JSON.stringify([document, fileName]), flow.captureError);
  };
  const runPublish = async () => {
    if (!canPublish || pending || !candidate || mustRePreview || (job && publicationJobIsPending(job.status))) return;
    await flow.publish(emptyPublicationDraft(), true, flow.captureError);
  };
  const refresh = async () => {
    flow.setPending(true);
    try { await props.onRefreshEvidence?.(); flow.setFailure(null); }
    catch (error) { flow.setFailure(publicationFailureCopy(error)); }
    finally { flow.setPending(false); }
  };
  const inputDisabled = pending || Boolean(job && publicationJobIsPending(job.status));
  const visibleEntries = entries?.filter((entry) =>
    !errorsOnly || entry.outcome === "error" || entry.outcome === "conflict");
  const counts = { create: 0, error: 0, skip: 0, conflict: 0 };
  entries?.forEach((entry) => { counts[entry.outcome] += 1; });
  const summary = [`新建 ${counts.create}`, `错误 ${counts.error}`,
    ...(counts.skip ? [`跳过 ${counts.skip}`] : []), ...(counts.conflict ? [`冲突 ${counts.conflict}`] : [])].join(" · ");

  return <>
    <ModalDialog open={open} onDismiss={pending ? undefined : close}
      className={["confirm-dialog", "governance-confirm-dialog", "modal-card--lg", "parameter-catalog-publication-dialog",
        "parameter-catalog-import-dialog"].join(" ")}
      backdropClassName="param-admin-modal-backdrop" describedBy>
      {({ titleId, descriptionId }) => <>
        <h2 id={titleId}>批量导入定义</h2>
        <div className="confirm-dialog__scroll"><div id={descriptionId} className="governance-confirm-dialog__body">
          <p>粘贴或上传 Markdown 文档；主体须已存在，支持 integer、number、string、boolean。</p>
          {unavailable ? <p role="status">{unavailable}</p> : null}
          {advisory ? <p role="status" data-tone={advisory.tone}>{advisory.message}</p> : null}
          {status ? <p role="status" aria-label="发布任务状态" data-publication-status={job?.status}
            data-tone={status.tone}>{succeeded === "active" && entries && status.tone === "success"
              ? `已发布 ${counts.create} 条定义，目录已生效。` : status.message}</p> : null}
          {failure ? <p role="alert" className="governance-confirm-dialog__error">{failure}</p> : null}
          {canPreview && !succeeded ? <div className="parameter-catalog-publication-dialog__form">
            <div className="parameter-catalog-import-dialog__file-actions">
              <button type="button" className="button subtle sm" disabled={inputDisabled}
                onClick={() => fileInput.current?.click()}>上传 .md 文件</button>
              <input ref={fileInput} aria-label="上传 .md 文件" type="file" accept=".md,text/markdown"
                hidden disabled={inputDisabled} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!/\.md$/iu.test(file.name)) { flow.setFailure("请选择 .md 文件。"); return; }
                flow.setPending(true);
                void file.text().then((text) => { updateDocument(text, file.name); setUploadedFileName(file.name); })
                  .catch(() => flow.setFailure("文件读取失败，请重试。"))
                  .finally(() => flow.setPending(false));
              }} />
              {uploadedFileName ? <span>{uploadedFileName}</span> : null}
              <a className="link-button" download="定义导入模板.md"
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}>下载模板</a>
            </div>
            <label>Markdown 文档
              <Textarea aria-label="Markdown 文档" rows={14} value={document} disabled={inputDisabled}
                onChange={(event) => updateDocument(event.target.value, fileName)} />
            </label>
          </div> : null}
            {entries ? <div className="parameter-catalog-import-dialog__results">
              <div className="parameter-catalog-import-dialog__summary">
                <p>{summary}</p>
                {counts.error > 0 || counts.conflict > 0
                  ? <button type="button" className="button subtle sm" aria-pressed={errorsOnly}
                    onClick={() => setErrorsOnly((value) => !value)}>仅显示错误与冲突</button> : null}
              </div>
              {!candidate && entries.length > 0 && entries.every((entry) => entry.outcome === "skip")
                ? <p role="status">没有需要发布的变更。</p> : null}
              <table className="definition-editor__table parameter-catalog-import-dialog__table">
                <caption>导入结果</caption><colgroup><col /><col /><col /><col /><col /></colgroup><thead><tr>
                  <th scope="col">主体</th><th scope="col">属性键</th><th scope="col">显示名</th>
                  <th scope="col">结果</th><th scope="col">诊断</th>
                </tr></thead><tbody>{visibleEntries?.map((entry, index) =>
                  <tr key={`${entry.subjectHeading}-${entry.definitionHeading}-${index}`}>
                    <td>{entry.selector || "—"}</td><td><code>{entry.propertyKey || "—"}</code></td>
                    <td>{entry.displayName || "—"}</td>
                    <td><span className="parameter-catalog__badge"
                      data-tone={entry.outcome === "error" || entry.outcome === "conflict" ? "warning" : undefined}>
                      {entry.outcome === "create" ? "新建" : entry.outcome === "error" ? "错误"
                        : entry.outcome === "skip" ? "跳过" : "冲突"}</span></td>
                    <td>{entry.diagnostics.map((item, i) => <div key={`${item.field}-${item.line}-${i}`}>
                      第 {item.line} 行 · {item.field}：{item.message}</div>)}</td>
                  </tr>)}</tbody>
              </table>
            </div> : null}
          {candidate && !previewStale && !succeeded
            ? <dl className="parameter-catalog-publication-dialog__preview" aria-label="发布预览">
            <div><dt>{publicationCopy.added}</dt><dd>{candidate.impactSummary.addedDefinitionCount}</dd></div>
            <div><dt>{publicationCopy.changed}</dt><dd>{candidate.impactSummary.changedDefinitionCount}</dd></div>
            <div><dt>{publicationCopy.addedSubjects}</dt><dd>{candidate.impactSummary.addedSubjectCount}</dd></div>
            <div><dt>{publicationCopy.risk}</dt>
              <dd>{candidate.riskClass === "high" ? publicationCopy.riskHigh : publicationCopy.riskLow}</dd></div>
            <div><dt>{publicationCopy.approval}</dt><dd>{publicationApprovalCopy(candidate.riskClass, actor)}</dd></div>
            <div><dt>{publicationCopy.scope}</dt><dd>{publicationCopy.sharedScope}</dd></div>
          </dl> : null}
        </div></div>
        <div className="dialog-actions">
          {canPreview && !succeeded && (!candidate || mustRePreview)
            ? <button type="button" className="button primary sm"
            disabled={pending || !document.trim()} onClick={() => void runPreview()}>
            {mustRePreview ? publicationCopy.rebase : "解析并预览"}</button> : null}
          {canPublish && candidate && !succeeded ? <button type="button" className="button primary sm"
            disabled={pending || mustRePreview || Boolean(job && publicationJobIsPending(job.status))}
            onClick={() => setConfirm("publish")}>
            {pending ? publicationCopy.processing : publicationCopy.publish}</button> : null}
          {job && publicationJobIsPending(job.status) ? <button type="button" className="button ghost sm"
            onClick={() => void flow.pollJob(job.id)}>{publicationCopy.refreshJob}</button> : null}
          {canRefresh ? <button type="button" className="button ghost sm" disabled={pending}
            onClick={() => void refresh()}>更新发布状态</button> : null}
          <button type="button" className="button ghost sm" disabled={pending} onClick={close}>关闭</button>
        </div>
      </>}
    </ModalDialog>
    <PublicationConfirmation confirm={confirm} allowed={confirm === "publish" ? canPublish : canPreview}
      risk={candidate?.riskClass ?? "high"} actor={actor} pending={pending}
      onPreview={() => void runPreview()} onPublish={() => void runPublish()} onCancel={() => setConfirm(null)} />
    <ConfirmDialog open={leaveConfirm} title="离开未保存的编写"
      description={<p>当前正文尚未发布。离开将保留本机定位，但不把未保存内容当作已生效。</p>}
      confirmLabel="离开" cancelLabel="继续编写" onConfirm={() => { setLeaveConfirm(false); props.onOpenChange(false); }}
      onCancel={() => setLeaveConfirm(false)} />
  </>;
}
