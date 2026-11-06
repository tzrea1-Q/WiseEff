import { useEffect, useRef, useState } from "react";

import { mayRegisterInOrganization, type CatalogActorKind } from "@/application/parameter-catalog/authority";
import { catalogStateFromFailure, deriveCatalogDomainState, type CatalogDomainState } from "@/application/parameter-catalog/states";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Textarea } from "@/components/ui/textarea";
import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import { presentError } from "@/infrastructure/http/presentError";
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
import { formatUsageSummary } from "./formatUsageSummary";
import { createGovernanceIdempotencyKey, createGovernanceSubmitGate, fingerprintGovernanceDraft } from "./governanceState";

const formatDiffValue = (value: unknown) => value == null ? "—" : typeof value === "string" ? value : JSON.stringify(value);
const outcomeLabels = { create: "新建", revise: "修订", error: "错误", skip: "跳过", conflict: "冲突" } as const;

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
  const [registrationRoots, setRegistrationRoots] = useState<CatalogSubjectResponse["item"][]>([]);
  const [childRegistration, setChildRegistration] = useState<{
    owner: CatalogSubjectResponse["item"]; children: CatalogSubjectResponse["item"][];
    moduleId: string; moduleName: string; catalogReleaseId: string; idempotencyKey: string;
  } | null>(null);
  const [registrationPending, setRegistrationPending] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationStale, setRegistrationStale] = useState(false);
  const registrationGate = useRef(createGovernanceSubmitGate());
  const registrationEpoch = useRef(0);
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
    setNewSubjects([]);
    setRegistrationRoots([]);
    setChildRegistration(null);
    setRegistrationPending(false);
    setRegistrationError("");
    setRegistrationSuccess(false);
    setRegistrationStale(false);
    registrationGate.current.reset();
    return () => { registrationEpoch.current += 1; flow.stopPolling(); };
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
    setNewSubjects([]);
    setRegistrationRoots([]);
    void (async () => {
      try {
        const resolved = flow.candidateVerified ? candidate : (await catalog.getPublicationCandidate(candidate.id)).item;
        const subjects = await Promise.all((resolved.impactSummary.addedSubjectIds ?? [])
          .map(async (id) => (await catalog.getSubject(id)).item));
        const unregistered = subjects.filter((subject) => subject.registration.status === "unregistered");
        const owners = await Promise.all([...new Set(unregistered.flatMap(subject => subject.ownerSubjectId ? [subject.ownerSubjectId] : []))]
          .map(async id => (await catalog.getSubject(id)).item));
        const roots = [...new Map([...unregistered.filter(subject => !subject.ownerSubjectId), ...owners].map(subject => [subject.id, subject])).values()];
        if (!cancelled) { setNewSubjects(unregistered); setRegistrationRoots(roots); }
      } catch {
        if (!cancelled) setSubjectError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, succeeded, candidate, flow.candidateVerified, catalog, subjectEpoch]);

  const close = () => {
    if (registrationPending) return;
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
  const prepareChildRegistration = async (ownerId: string) => {
    if (registrationPending || !mayRegisterInOrganization(actor, sessionPermissions, domainState)) return;
    const epoch = ++registrationEpoch.current;
    setRegistrationPending(true);
    setRegistrationError("");
    setChildRegistration(null);
    setRegistrationStale(false);
    registrationGate.current.reset();
    try {
      const document = await catalog.getCatalog();
      if (!document.item || !mayRegisterInOrganization(actor, sessionPermissions, deriveCatalogDomainState({ document }))) {
        throw new Error("当前身份或目录状态不允许登记。");
      }
      const release = document.item.catalogReleaseId;
      const owner = (await catalog.getSubject(ownerId, { catalogReleaseId: release })).item;
      if (owner.id !== ownerId || owner.type !== "driver" || owner.ownerSubjectId || owner.membership.status !== "active"
        || owner.registration.status !== "active") throw new Error("驱动状态已变化，请刷新后重试。");
      const [registration, subjects, registry] = await Promise.all([
        props.governance.getRegistration(props.organizationId, owner.registration.id),
        listAllCanonicalPages(query => catalog.listSubjects(query), { type: "node-type", lifecycle: "active", registration: "unregistered", catalogReleaseId: release }),
        props.moduleRegistry?.getRegistry(),
      ]);
      const item = registration.item;
      const moduleId = item.placement.moduleId;
      const module = registry?.modules.find(module => module.id === moduleId);
      if (item.organizationId !== props.organizationId || item.subjectId !== ownerId || item.id !== owner.registration.id
        || item.status !== "active" || item.catalogReleaseId !== release) throw new Error("驱动登记已变化，请刷新后重试。");
      if (!moduleId || (registry && (!module || !(module.kind === "business" || module.kind === "unclassified")))) {
        throw new Error("请先在模块管理中为驱动设置有效的业务归属，再补登记子节点。");
      }
      const children = subjects.filter(subject => subject.ownerSubjectId === ownerId && subject.registration.status === "unregistered"
        && subject.membership.status === "active");
      if (!children.length) throw new Error("当前已没有待补登记的子节点，请刷新登记状态。");
      if (epoch === registrationEpoch.current) setChildRegistration({ owner, children, moduleId,
        moduleName: module && registry ? modulePathSegments(module, registry.modules).join(" / ") : item.placement.displayName,
        catalogReleaseId: release, idempotencyKey: createGovernanceIdempotencyKey() });
    } catch (error) {
      if (epoch === registrationEpoch.current) setRegistrationError(presentError(error, "无法读取登记信息，请重试。"));
    } finally { if (epoch === registrationEpoch.current) setRegistrationPending(false); }
  };
  const registerChildren = async () => {
    if (!childRegistration || registrationPending || registrationStale || !mayRegisterInOrganization(actor, sessionPermissions, domainState)) return;
    const body = { subjectId: childRegistration.owner.id, placement: { mode: "use-default" as const },
      destinationModuleId: childRegistration.moduleId, reason: "定义导入后补登记驱动子节点" };
    const prepared = registrationGate.current.begin({ actor, action: "register-subject",
      state: { kind: "ready", catalogReleaseId: childRegistration.catalogReleaseId, writesEnabled: true },
      catalogReleaseId: childRegistration.catalogReleaseId, draftFingerprint: fingerprintGovernanceDraft({ organizationId: props.organizationId, body }),
      createIdempotencyKey: () => childRegistration.idempotencyKey });
    if (prepared.status !== "ready") return;
    const epoch = registrationEpoch.current;
    setRegistrationPending(true);
    setRegistrationError("");
    try {
      await props.governance.createRegistration(props.organizationId, body, prepared.context);
      if (epoch !== registrationEpoch.current) return;
      registrationGate.current.succeed();
      setChildRegistration(null);
      setRegistrationSuccess(true);
      setSubjectEpoch(value => value + 1);
      props.onCompleted?.();
    } catch (error) {
      if (epoch !== registrationEpoch.current) return;
      registrationGate.current.fail();
      const state = catalogStateFromFailure(error);
      const stale = state.kind === "conflict" || state.kind === "retired" || state.kind === "unregistered"
        || (error instanceof WiseEffApiError && error.status !== undefined && error.status >= 400 && error.status < 500
          && error.status !== 408 && error.status !== 429);
      setRegistrationStale(stale);
      setRegistrationError(stale ? state.kind === "unregistered" || state.kind === "retired"
        ? "驱动已停用或登记状态已变化，请先在模块管理恢复驱动，再重新读取登记信息。"
        : `${presentError(error, "登记或目录已变化。")}请重新读取登记信息并确认。`
        : "补登记失败，可重试同一次操作。");
    } finally { if (epoch === registrationEpoch.current) setRegistrationPending(false); }
  };
  const inputDisabled = pending || Boolean(job && publicationJobIsPending(job.status));
  const visibleEntries = entries?.filter((entry) =>
    !errorsOnly || entry.outcome === "error" || entry.outcome === "conflict");
  const counts = { create: 0, revise: 0, error: 0, skip: 0, conflict: 0 };
  entries?.forEach((entry) => { counts[entry.outcome] += 1; });
  const summary = (Object.keys(outcomeLabels) as (keyof typeof outcomeLabels)[])
    .filter((outcome) => counts[outcome]).map((outcome) => `${outcomeLabels[outcome]} ${counts[outcome]}`).join(" · ");
  const placementWarnings = placementHints?.flatMap((hint) => hint.warnings.map((warning) => ({
    selector: hint.selector, line: warning.line, warning: warning.message,
  }))) ?? [];

  return <>
    <ModalDialog open={open} onDismiss={pending || registrationPending ? undefined : close}
      className={["confirm-dialog", "governance-confirm-dialog", "modal-card--lg", "parameter-catalog-publication-dialog",
        "parameter-catalog-import-dialog"].join(" ")}
      backdropClassName="param-admin-modal-backdrop" describedBy>
      {({ titleId, descriptionId }) => <>
        <h2 id={titleId}>批量导入定义</h2>
        <div className="confirm-dialog__scroll"><div id={descriptionId} className="governance-confirm-dialog__body">
          <p>粘贴或上传 Markdown 文档，格式见模板；可引用已有主体或新建主体。业务分类和展示别名为可选的登记提示，不影响发布。</p>
          {unavailable ? <p role="status">{unavailable}</p> : null}
          {advisory ? <p role="status" data-tone={advisory.tone}>{advisory.message}</p> : null}
          {status ? <p role="status" aria-label="发布任务状态" data-publication-status={job?.status}
            data-tone={status.tone}>{succeeded === "active" && entries && status.tone === "success"
              ? `已发布 ${counts.create + counts.revise} 条定义，目录已生效。` : status.message}</p> : null}
          {failure ? <p role="alert" className="governance-confirm-dialog__error">{failure}</p> : null}
          {registrationSuccess ? <p role="status">子节点登记已更新。</p> : null}
          {succeeded && subjectError ? <p role="alert">新主体的登记状态加载失败，发布仍已生效。<button type="button"
            className="button subtle sm" onClick={() => setSubjectEpoch((value) => value + 1)}>重试加载</button></p> : null}
          {succeeded && newSubjects.length > 0 ? <section aria-label="待登记的新主体">
            <p>以下新主体尚未在本组织登记。登记是独立操作，不影响已生效的发布。</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">{newSubjects.map((subject) => <li key={subject.id}>{subject.canonicalName}</li>)}</ul>
            {registrationRoots.some(subject => subject.ownerSubjectId === undefined && subject.registration.status === "unregistered")
              && mayRegisterInOrganization(actor, sessionPermissions, domainState)
              ? <button type="button" className="button subtle sm" disabled={registrationPending} onClick={() => {
                const roots = registrationRoots.filter(subject => subject.registration.status === "unregistered");
                openBatchRegistration({ organizationId: props.organizationId, userId: props.currentPersonId,
                  subjectIds: roots.map((subject) => subject.id), hints: Object.fromEntries(roots.flatMap((subject) => {
                    const hint = placementHints?.find((item) => item.selector === subject.canonicalName && item.kind === subject.type);
                    return hint ? [[subject.id, { categoryPath: hint.categoryPath, displayAlias: hint.displayAlias }]] : [];
                  })) });
                props.onOpenChange(false);
              }}>前往批量登记</button> : null}
            {newSubjects.some(subject => subject.ownerSubjectId) ? <p>子节点随所属驱动登记，并继承驱动的业务归属。</p> : null}
            {registrationRoots.filter(subject => subject.registration.status !== "unregistered").map(owner => <div key={owner.id}>
              {owner.registration.status === "active" && owner.membership.status === "active"
                ? mayRegisterInOrganization(actor, sessionPermissions, domainState) ? <button type="button" className="button subtle sm"
                  disabled={registrationPending} onClick={() => void prepareChildRegistration(owner.id)}>补登记子节点：{owner.canonicalName}</button> : null
                : <p>{owner.canonicalName}：请先恢复驱动，再处理子节点登记。</p>}
              <a className="link-button" target="_blank" rel="noopener noreferrer"
                href={withOrganizationScope(`/parameter-admin/modules?selectedSubject=${encodeURIComponent(owner.id)}`, props.organizationId)}>前往模块管理（新标签页）</a>
            </div>)}
            {registrationRoots.some(subject => subject.registration.status !== "unregistered")
              ? <p>在新标签页处理驱动后，返回此窗口刷新登记状态。</p> : null}
            {registrationError && !childRegistration ? <p role="alert">{registrationError}</p> : null}
            <button type="button" className="button subtle sm" disabled={registrationPending}
              onClick={() => setSubjectEpoch(value => value + 1)}>刷新登记状态</button>
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
                      {outcomeLabels[entry.outcome]}</span>
                      {entry.revisionClass ? <div>{entry.revisionClass === "semantic" ? "语义修订" : "说明修订"}</div> : null}
                      {entry.riskClass ? <div>{entry.riskClass === "high" ? "高风险" : "低风险"}</div> : null}</td>
                    <td>{entry.diffs?.map((diff) => <div key={diff.field}>{diff.field}：{formatDiffValue(diff.oldValue)} → {formatDiffValue(diff.newValue)}</div>)}
                      {entry.usageSummary ? <div>{formatUsageSummary(entry.usageSummary)}</div> : null}
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
          <button type="button" className="button ghost sm" disabled={pending || registrationPending} onClick={close}>关闭</button>
        </div>
      </>}
    </ModalDialog>
    <ConfirmDialog open={Boolean(childRegistration)} title="补登记子节点" confirmLabel="确认补登记" pending={registrationPending}
      confirmDisabled={registrationStale || !mayRegisterInOrganization(actor, sessionPermissions, domainState)}
      acknowledgement="我已核对全部待登记子节点及驱动的业务归属" error={registrationError}
      acknowledgementKey={childRegistration?.idempotencyKey}
      description={childRegistration ? <>
        <p>{childRegistration.owner.canonicalName} · 业务归属：{childRegistration.moduleName}</p>
        <p>补齐该驱动当前全部尚未登记的有效子节点，沿用驱动的业务归属。已停用子节点保持停用。</p>
        <ul>{childRegistration.children.map(child => <li key={child.id}>{child.canonicalName}</li>)}</ul>
      </> : null}
      extra={registrationStale && childRegistration ? <button type="button" className="button subtle sm"
        onClick={() => void prepareChildRegistration(childRegistration.owner.id)}>重新读取登记信息</button> : null}
      onConfirm={() => void registerChildren()} onCancel={() => { setChildRegistration(null); setRegistrationError(""); }} />
    <PublicationConfirmation confirm={confirm} allowed={confirm === "publish" ? canPublish : canPreview}
      risk={candidate?.riskClass ?? "high"} actor={actor} pending={pending}
      onPreview={() => void runPreview()} onPublish={() => void runPublish()} onCancel={() => setConfirm(null)} />
    <ConfirmDialog open={leaveConfirm} title="离开未保存的编写"
      description={<p>当前正文尚未发布。离开将保留本机定位，但不把未保存内容当作已生效。</p>}
      confirmLabel="离开" cancelLabel="继续编写" onConfirm={() => { setLeaveConfirm(false); props.onOpenChange(false); }}
      onCancel={() => setLeaveConfirm(false)} />
  </>;
}
