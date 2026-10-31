import { useEffect, useRef, useState } from "react";

import { mayRegisterInOrganization, type CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogMarkdownImportResponse, CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
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
import { openBatchRegistration } from "./batchRegistrationHandoff";
import { DEFINITION_IMPORT_TEMPLATE } from "@/domain/parameter-catalog/definitionImportTemplate";

const formatDiffValue = (value: unknown) => value == null ? "—" : typeof value === "string" ? value : JSON.stringify(value);

export type DefinitionImportDialogProps = {
  open: boolean;
  initialDocument?: string;
  runtimeMode?: WiseEffRuntimeMode;
  actor: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  domainState: CatalogDomainState;
  catalog: ParameterCatalogRepository;
  governance: ParameterCatalogGovernanceRepository;
  moduleRegistry?: Pick<ParameterModuleRegistryRepository, "getRegistry">;
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
  const [noChange, setNoChange] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [newSubjects, setNewSubjects] = useState<CatalogSubjectResponse["item"][]>([]);
  const [subjectError, setSubjectError] = useState(false);
  const [subjectEpoch, setSubjectEpoch] = useState(0);
  const [placementHints, setPlacementHints] = useState<CatalogMarkdownImportResponse["item"]["placementHints"]>([]);
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
    setDocument(props.initialDocument ?? "");
    setFileName("粘贴.md");
    setUploadedFileName(null);
    setEntries(null);
    setNoChange(false);
    setErrorsOnly(false);
    setPlacementHints([]);
    return flow.stopPolling;
  }, [open, catalog, props.currentPersonId, props.organizationId]);

  useEffect(() => {
    if (!open || !dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, dirty]);

  useEffect(() => {
    if (!open || !succeeded || !candidate) return undefined;
    let cancelled = false;
    setSubjectError(false);
    void (async () => {
      try {
        const resolved = flow.candidateVerified ? candidate : (await catalog.getPublicationCandidate(candidate.id)).item;
        const subjects = await Promise.all((resolved.impactSummary.addedSubjectIds ?? [])
          .map(async (id) => (await catalog.getSubject(id)).item));
        if (!cancelled) setNewSubjects(subjects.filter((subject) => subject.registration.status === "unregistered"));
      } catch {
        if (!cancelled) setSubjectError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, succeeded, candidate, flow.candidateVerified, catalog, subjectEpoch]);

  const close = () => {
    if (dirty && !leaveConfirm) { setLeaveConfirm(true); return; }
    setLeaveConfirm(false);
    props.onOpenChange(false);
  };
  const updateDocument = (nextDocument: string, nextFileName: string) => {
    flow.reset();
    setEntries(null);
    setPlacementHints([]);
    setNoChange(false);
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
      setPlacementHints(result.item.placementHints ?? []);
      setNoChange(result.item.noChange);
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
  const counts = { create: 0, revise: 0, error: 0, skip: 0, conflict: 0 };
  entries?.forEach((entry) => { counts[entry.outcome] += 1; });
  const summary = [...(counts.create ? [`新建 ${counts.create}`] : []), ...(counts.revise ? [`修订 ${counts.revise}`] : []), ...(counts.error ? [`错误 ${counts.error}`] : []),
    ...(counts.skip ? [`跳过 ${counts.skip}`] : []), ...(counts.conflict ? [`冲突 ${counts.conflict}`] : [])].join(" · ");
  const placementWarnings = placementHints?.flatMap((hint) => hint.warnings.map((warning) => ({
    selector: hint.selector, line: hint.line, warning,
  }))) ?? [];

  return <>
    <ModalDialog open={open} onDismiss={pending ? undefined : close}
      className={["confirm-dialog", "governance-confirm-dialog", "modal-card--lg", "parameter-catalog-publication-dialog",
        "parameter-catalog-import-dialog"].join(" ")}
      backdropClassName="param-admin-modal-backdrop" describedBy>
      {({ titleId, descriptionId }) => <>
        <h2 id={titleId}>批量导入定义</h2>
        <div className="confirm-dialog__scroll"><div id={descriptionId} className="governance-confirm-dialog__body">
          <p>粘贴或上传 Markdown 文档，格式见模板；可引用已有主体或新建主体。业务分类和模块名称为可选的登记提示，不影响发布。</p>
          {unavailable ? <p role="status">{unavailable}</p> : null}
          {advisory ? <p role="status" data-tone={advisory.tone}>{advisory.message}</p> : null}
          {status ? <p role="status" aria-label="发布任务状态" data-publication-status={job?.status}
            data-tone={status.tone}>{succeeded === "active" && entries && status.tone === "success"
              ? `已发布 ${counts.create + counts.revise} 条定义，目录已生效。` : status.message}</p> : null}
          {failure ? <p role="alert" className="governance-confirm-dialog__error">{failure}</p> : null}
          {succeeded && subjectError ? <p role="alert">新主体的登记状态加载失败，发布仍已生效。<button type="button"
            className="button subtle sm" onClick={() => setSubjectEpoch((value) => value + 1)}>重试加载</button></p> : null}
          {succeeded && newSubjects.length > 0 ? <section aria-label="待登记的新主体">
            <p>以下新主体尚未在本组织登记。登记是独立操作，不影响已生效的发布。</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">{newSubjects.map((subject) => <li key={subject.id}>{subject.canonicalName}</li>)}</ul>
            {mayRegisterInOrganization(actor, sessionPermissions, domainState)
              ? <button type="button" className="button subtle sm" onClick={() => {
                openBatchRegistration({ organizationId: props.organizationId, userId: props.currentPersonId,
                  subjectIds: newSubjects.map((subject) => subject.id), hints: Object.fromEntries(newSubjects.flatMap((subject) => {
                    const hint = placementHints?.find((item) => item.selector === subject.canonicalName && item.kind === subject.type);
                    return hint ? [[subject.id, { categoryPath: hint.categoryPath, moduleName: hint.moduleName }]] : [];
                  })) });
                props.onOpenChange(false);
              }}>前往批量登记</button> : null}
          </section> : null}
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
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(DEFINITION_IMPORT_TEMPLATE)}`}>下载模板</a>
            </div>
            <label>Markdown 文档
              <Textarea aria-label="Markdown 文档" rows={14} value={document} disabled={inputDisabled}
                onChange={(event) => updateDocument(event.target.value, fileName)} />
            </label>
          </div> : null}
            {entries ? <div className="parameter-catalog-import-dialog__results">
              {placementWarnings.length ? <section className="definition-editor__banner" data-tone="warning" aria-label="登记提示（不影响发布）">
                <strong>登记提示（不影响发布）</strong>
                <ul className="list-disc space-y-1 pl-4">{placementWarnings.map((item, index) =>
                  <li key={`${item.selector}-${item.line}-${index}`}>{item.selector} · 第 {item.line} 行：{item.warning}</li>)}</ul>
              </section> : null}
              <div className="parameter-catalog-import-dialog__summary">
                {summary ? <p>{summary}</p> : null}
                {counts.error > 0 || counts.conflict > 0
                  ? <button type="button" className="button subtle sm" aria-pressed={errorsOnly}
                    onClick={() => setErrorsOnly((value) => !value)}>仅显示错误与冲突</button> : null}
              </div>
              {noChange
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
                      {entry.outcome === "create" ? "新建" : entry.outcome === "revise" ? "修订" : entry.outcome === "error" ? "错误"
                        : entry.outcome === "skip" ? "跳过" : "冲突"}</span>
                      {entry.revisionClass ? <div>{entry.revisionClass === "semantic" ? "语义修订" : "说明修订"}</div> : null}
                      {entry.riskClass ? <div>{entry.riskClass === "high" ? "高风险" : "低风险"}</div> : null}</td>
                    <td>{entry.diffs?.map((diff) => <div key={diff.field}>{diff.field}：{formatDiffValue(diff.oldValue)} → {formatDiffValue(diff.newValue)}</div>)}
                      {entry.usageSummary ? <div>{entry.usageSummary.policyCount === null ? "策略使用量暂不可用" : `策略 ${entry.usageSummary.policyCount}`} · 项目 {entry.usageSummary.projectCount} · 当前值 {entry.usageSummary.currentValueCount}</div> : null}
                      {entry.diagnostics.map((item, i) => <div key={`${item.field}-${item.line}-${i}`}>
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
