import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { ApplyParameterFileSourceInput, ParameterFileCandidate, ParameterFileCandidateDiagnostic, ParameterFileRepository, ParameterFileSourcePreview, SubmitParameterFileSourceReviewInput, ProjectLocalOverrideInput } from "@/application/ports/ParameterFileRepository";
import type { SourceEditSaveSnapshot, SourceEditSession } from "@/application/project-configuration/sourceEditSession";
import { sourceDraftKey, type SourceDraftScope } from "@/application/project-configuration/sourceDraftStorage";
import { fileToContentBase64 } from "@/application/project-configuration/candidateVersionFlow";
import type { DtsViewerFocusSpan } from "@/components/parameter-topology/ProjectPrimaryDtsViewer";
import { Button } from "@/components/ui/button";
import { ViewSwitch } from "@/components/ui/view-switch";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { WorkbenchDtsEditorHandle, WorkbenchDtsEditorSessions, WorkbenchDtsEditorSnapshot } from "./WorkbenchDtsEditor";
import { buildUnifiedDiff } from "./workbenchInspectorModel";
import { sourceReviewReason } from "@/application/project-configuration/sourceReviewReason";
import "./workbench-source-editing.css";

const DtsEditor = lazy(() => import("./WorkbenchDtsEditor").then((module) => ({ default: module.WorkbenchDtsEditor })));

type Props = {
  scope: SourceDraftScope;
  fileName: string;
  baseVersionId: string;
  configRevisionId: string | null;
  source: string;
  changeSummary?: string;
  session: SourceEditSession;
  editorSessions: WorkbenchDtsEditorSessions;
  repository: ParameterFileRepository;
  canEdit: boolean;
  canEditSource?: boolean;
  canDirectApply?: boolean;
  localOverrideIntent?: ProjectLocalOverrideInput;
  visible: boolean;
  legacyDraftsDirty: boolean;
  onOpenLegacyDrafts: () => void;
  onDirtyChange: (dirty: boolean) => void;
  flushRef?: RefObject<(() => void) | null>;
  onRefresh: () => void;
  focusSpan: DtsViewerFocusSpan | null;
  focusLine: number | null;
  findQuery: string;
  findNextToken: number;
  onVisibleLineChange: (line: number) => void;
};

type Attempt = { saved: SourceEditSaveSnapshot; mutationId: string; candidate?: ParameterFileCandidate; preview?: ParameterFileSourcePreview;
  submission?: SubmitParameterFileSourceReviewInput; directApplication?: ApplyParameterFileSourceInput };

export function WorkbenchSourceEditingPane({ scope: inputScope, fileName, baseVersionId, configRevisionId, source, changeSummary,
  session, editorSessions, repository, canEdit, canEditSource = canEdit, canDirectApply = canEdit, localOverrideIntent, visible, legacyDraftsDirty, onOpenLegacyDrafts, onDirtyChange,
  onRefresh, focusSpan, focusLine, findQuery, findNextToken, onVisibleLineChange, flushRef }: Props) {
  const scope = useMemo(() => ({ userId: inputScope.userId, organizationId: inputScope.organizationId, projectId: inputScope.projectId,
    configSetId: inputScope.configSetId, fileId: inputScope.fileId }), [inputScope.userId, inputScope.organizationId, inputScope.projectId, inputScope.configSetId, inputScope.fileId]);
  const key = sourceDraftKey(scope);
  const store = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const file = store.files[key];
  const [editingKeys, setEditingKeys] = useState<Set<string>>(() => new Set());
  const [bufferDirty, setBufferDirty] = useState(false);
  const [resetKeys, setResetKeys] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<ParameterFileCandidateDiagnostic[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const attempts = useRef(new Map<string, Attempt>());
  const editor = useRef<WorkbenchDtsEditorHandle>(null);
  const mergeEditor = useRef<WorkbenchDtsEditorHandle>(null);
  const [reason, setReason] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const reviewers = attempt?.preview?.reviewers ?? [];
  const latestScope = useRef(key);
  const operationEpoch = useRef(0);
  const discarding = useRef(false);
  const refresh = useRef(onRefresh);
  useLayoutEffect(() => { latestScope.current = key; refresh.current = onRefresh; }, [key, onRefresh]);

  useEffect(() => {
    let cancelled = false;
    if (!configRevisionId) return;
    void Promise.resolve().then(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))).then(async (bytes) => {
      if (cancelled) return;
      const sourceDigest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (mergeEditor.current) mergeEditor.current.flush(); else editor.current?.flush();
      await session.open({ scope, base: { fileVersionId: baseVersionId, configRevisionId, sourceDigest }, sourceText: source });
    }).catch((cause) => { if (!cancelled) setError(presentError(cause, "读取 DTS 草稿失败。")); });
    return () => { cancelled = true; };
  }, [baseVersionId, configRevisionId, key, scope, session, source]);

  useEffect(() => {
    operationEpoch.current += 1;
    setError(""); setDiagnostics([]); setBusy(false); setBufferDirty(false); setSaveOpen(false); setDiscardOpen(false); setDiscardPending(false); setCompareOpen(false); setAttempt(null);
    return () => { operationEpoch.current += 1; };
  }, [key]);
  useLayoutEffect(() => { discarding.current = false; }, [key, resetKeys]);
  const change = useCallback((value: WorkbenchDtsEditorSnapshot) => {
    if (discarding.current) return;
    const target = session.getSnapshot().files[value.sessionKey];
    if (!target || target.loading) return;
    // Recovery can finish before the initial readonly editor receives its reset.
    if (value.generation === 0 && !value.dirty && value.text !== target.sourceText) return;
    session.change(target.scope, value.text, { ...target.position, ...value.selection, firstVisibleLine: value.firstVisibleLine });
  }, [session]);
  useLayoutEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => { if (mergeEditor.current) mergeEditor.current.flush(); else editor.current?.flush(); };
    return () => { flushRef.current = null; };
  }, [flushRef]);

  const beginSave = useCallback(async (editorSnapshot?: WorkbenchDtsEditorSnapshot) => {
    if (!canEdit || busy || legacyDraftsDirty || !configRevisionId) return;
    const epoch = ++operationEpoch.current;
    const current = editorSnapshot ?? editor.current?.flush();
    if (current) change(current);
    setError(""); setDiagnostics([]);
    try {
      const saved = session.captureSave(scope);
      const bytes = new TextEncoder().encode(saved.sourceText).length;
      if (!bytes || bytes > 2 * 1024 * 1024) throw new Error("DTS 必须非空且不超过 2 MiB；当前文本仍保留，可下载草稿。");
      const previous = attempts.current.get(key);
      const next: Attempt = previous && previous.saved.sourceText === saved.sourceText
        && previous.saved.base.fileVersionId === saved.base.fileVersionId && previous.saved.base.configRevisionId === saved.base.configRevisionId
        ? previous : { saved, mutationId: crypto.randomUUID() };
      attempts.current.set(key, next);
      setAttempt({ ...next }); setSaveOpen(true); setBusy(true);
      if (!next.candidate) next.candidate = await repository.createCandidate(scope.projectId, {
        fileName, fileId: scope.fileId, contentBase64: await fileToContentBase64(new File([saved.sourceText], fileName, { type: "text/plain" })),
        intent: "source_revision", ...(localOverrideIntent ? { localOverride: localOverrideIntent } : {}), expectedCurrentVersionId: saved.base.fileVersionId,
        expectedConfigRevisionId: saved.base.configRevisionId, clientMutationId: next.mutationId
      });
      if (next.candidate.status === "failed") {
        if (latestScope.current === key && operationEpoch.current === epoch) {
          setDiagnostics(next.candidate.diagnostics);
          setError("DTS 解析未通过，请修正后重新保存。文本仍保留。");
        }
        return;
      }
      next.preview = await repository.getCandidateSourcePreview(scope.projectId, next.candidate.id);
      if (latestScope.current === key && operationEpoch.current === epoch) {
        setAttempt({ ...next });
        const eligible = next.preview.reviewers ?? [];
        setReviewerId((current) => eligible.some((item) => item.userId === current) ? current : eligible.length === 1 ? eligible[0]!.userId : "");
      }
    } catch (cause) {
      if (latestScope.current === key && operationEpoch.current === epoch) {
        setError(presentError(cause, "校验 DTS 修改失败；文本仍保留。"));
        if (cause instanceof WiseEffApiError && Array.isArray(cause.details?.diagnostics)) {
          setDiagnostics(cause.details.diagnostics.filter((value): value is ParameterFileCandidateDiagnostic =>
            value && typeof value.message === "string" && typeof value.code === "string" && ["error", "warning", "info"].includes(value.severity)));
        }
      }
    } finally { if (latestScope.current === key && operationEpoch.current === epoch) setBusy(false); }
  }, [busy, canEdit, change, configRevisionId, fileName, key, legacyDraftsDirty, localOverrideIntent, repository, scope, session]);

  const submit = async () => {
    if (!attempt?.candidate || attempt.directApplication || !attempt.preview?.canSubmit || !attempt.preview.proofToken || !reason.trim() || !reviewerId || busy) return;
    const captured = attempt;
    const epoch = ++operationEpoch.current;
    setBusy(true); setError("");
    try {
      const body = captured.submission ?? {
        expectedCurrentVersionId: captured.saved.base.fileVersionId, expectedProofToken: captured.preview!.proofToken!,
        clientMutationId: captured.mutationId, reason: reason.trim(), assignedToUserId: reviewerId
      };
      const submitted = { ...captured, submission: body };
      attempts.current.set(key, submitted);
      setAttempt(submitted);
      const result = await repository.submitCandidateSourceReview(scope.projectId, captured.candidate!.id, body);
      session.markSubmitted(captured.saved, { candidateId: captured.candidate!.id, requestId: result.requestId });
      if (latestScope.current === key && operationEpoch.current === epoch) {
        setSaveOpen(false); setReason(""); refresh.current();
      }
    } catch (cause) { if (latestScope.current === key && operationEpoch.current === epoch) setError(presentError(cause, "提交失败，可重试同一请求；文本仍保留。")); }
    finally { if (latestScope.current === key && operationEpoch.current === epoch) setBusy(false); }
  };

  const applyDirectly = async () => {
    if (!canDirectApply || !repository.applyCandidateSourceRevision || !attempt?.candidate || attempt.submission
      || !attempt.preview?.canSubmit || !attempt.preview.proofToken || !reason.trim() || busy) return;
    const captured = attempt;
    const epoch = ++operationEpoch.current;
    setBusy(true); setError("");
    try {
      const body = captured.directApplication ?? {
        expectedCurrentVersionId: captured.saved.base.fileVersionId, expectedProofToken: captured.preview!.proofToken!,
        clientMutationId: captured.mutationId, reason: reason.trim()
      };
      const applying = { ...captured, directApplication: body };
      attempts.current.set(key, applying); setAttempt(applying);
      const result = await repository.applyCandidateSourceRevision(scope.projectId, captured.candidate!.id, body);
      if (result.status !== "approved" || result.applicationMode !== "administrator_direct" || !result.appliedSourceResult) {
        throw new Error("直接应用回执不完整，请重试同一操作以核对结果。");
      }
      const buffered = editor.current?.flush();
      if (buffered?.sessionKey === key) change(buffered);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(captured.saved.sourceText));
      session.acknowledgeApplied(captured.saved, { fileVersionId: result.appliedSourceResult.fileVersionId,
        configRevisionId: result.appliedSourceResult.configRevisionId,
        sourceDigest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") });
      attempts.current.delete(key);
      if (latestScope.current === key && operationEpoch.current === epoch) {
        setSaveOpen(false); setReason(""); setBufferDirty(session.getFile(scope)?.dirty ?? false);
        onDirtyChange(session.getFile(scope)?.dirty ?? false); refresh.current();
      }
    } catch (cause) {
      if (latestScope.current === key && operationEpoch.current === epoch) setError(presentError(cause, "直接应用失败，可重试同一操作；文本仍保留。"));
    } finally { if (latestScope.current === key && operationEpoch.current === epoch) setBusy(false); }
  };

  const download = (original = false) => {
    const value = compareOpen && file?.rebased ? mergeEditor.current?.flush() : editor.current?.flush();
    const url = URL.createObjectURL(new Blob([original ? file?.originalDraft?.sourceText ?? "" : value?.text ?? file?.sourceText ?? source], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const dirty = bufferDirty || Boolean(file?.dirty);
  const mixedEndings = useMemo(() => new Set(source.match(/\r\n|\r|\n/g)).size > 1, [source]);
  const isEditing = editingKeys.has(key);
  const stale = file?.recoveryStatus === "stale-base";
  const ready = Boolean(file && !file.loading && configRevisionId);
  const requestId = file?.submission?.requestId;
  const checkRequest = useCallback(async () => {
    const current = session.getFile(scope);
    if (!current?.submission?.requestId || !repository.getSourceRevisionRequest) { refresh.current(); return; }
    try {
      const request = await repository.getSourceRevisionRequest(scope.projectId, current.submission.requestId);
      if (request.status === "approved" && request.appliedSourceResult && request.after !== undefined) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.after));
        const buffered = editor.current?.flush();
        if (buffered?.sessionKey === key) change(buffered);
        session.acknowledgeApplied({ scope, base: current.base, sourceText: request.after, generation: current.submission.submittedGeneration }, {
          fileVersionId: request.appliedSourceResult.fileVersionId, configRevisionId: request.appliedSourceResult.configRevisionId,
          sourceDigest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
        });
        attempts.current.delete(key);
        if (latestScope.current === key) onDirtyChange(session.getFile(scope)?.dirty ?? false);
        refresh.current();
      } else if (request.status === "rejected" || request.status === "withdrawn") {
        attempts.current.delete(key);
        session.markSubmitted({ scope, base: current.base, sourceText: current.sourceText, generation: current.generation }, { candidateId: current.submission.candidateId });
        if (latestScope.current === key) setError(request.status === "rejected" ? "来源审核已驳回，文本仍保留，可修改后重新提交。" : "来源审核已撤回，文本仍保留。");
      }
    } catch (cause) { if (latestScope.current === key) setError(presentError(cause, "读取审核状态失败。")); }
  }, [change, key, onDirtyChange, repository, scope, session]);
  useEffect(() => { if (visible && requestId) void checkRequest(); }, [checkRequest, requestId, visible]);
  const previewDiff = useMemo(() => attempt?.preview
    ? buildUnifiedDiff(attempt.preview.before ?? source, attempt.preview.after ?? attempt.saved.sourceText, "当前来源", "本次修改") : "",
  [attempt, source]);
  const recoveryDiff = useMemo(() => compareOpen
    ? buildUnifiedDiff(source, file?.sourceText ?? source, "最新工作来源", "本地草稿") : "", [compareOpen, file?.sourceText, source]);
  const closeCompare = () => {
    if (file?.rebased) {
      mergeEditor.current?.flush();
      setResetKeys((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
    }
    setCompareOpen(false);
  };
  const rebase = async () => {
    const epoch = ++operationEpoch.current;
    editor.current?.flush();
    setBusy(true); setError("");
    try {
      const current = session.getFile(scope);
      if (!current) return;
      let originalBase = current.baseSourceText;
      if (originalBase === undefined) {
        const version = await repository.downloadVersion(scope.projectId, scope.fileId, current.base.fileVersionId);
        originalBase = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(version.bytes);
      }
      if (latestScope.current !== key || operationEpoch.current !== epoch) return;
      editor.current?.flush();
      const merged = session.rebase(scope, originalBase);
      setResetKeys((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
      setEditingKeys((current) => new Set([...current, key]));
      onDirtyChange(true);
      if (merged.conflicts) setCompareOpen(true);
      await session.flush(scope);
    } catch (cause) {
      if (latestScope.current === key && operationEpoch.current === epoch) setError(presentError(cause, "合并最新来源失败，原稿仍保留。"));
    } finally { if (latestScope.current === key && operationEpoch.current === epoch) setBusy(false); }
  };

  return <section className="workbench-source-editing" hidden={!visible} aria-label="DTS 编辑工作区">
    <div className="workbench-source-editing__toolbar">
      <ViewSwitch variant="toggle" ariaLabel="DTS 查看模式" value={isEditing ? "edit" : "preview"}
        items={[{ value: "preview", label: "预览" }, { value: "edit", label: "编辑", disabled: !canEdit || !canEditSource || !ready }]}
        onValueChange={(value) => setEditingKeys((current) => { const next = new Set(current); if (value === "edit") next.add(key); else next.delete(key); return next; })} />
      <span role="status">{!ready ? "正在准备源码…" : requestId ? "已提交审核 · 工作配置尚未更新" : dirty ? "未保存修改" : "当前工作配置"}</span>
      <div className="workbench-source-editing__actions">
        <Button variant="outline" size="sm" disabled={!canEdit || !dirty || busy || stale || file?.mergeConflicts || legacyDraftsDirty || !ready} onClick={() => void beginSave()}>保存修改</Button>
        <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={() => setDiscardOpen(true)}>放弃修改</Button>
      </div>
    </div>
    {changeSummary && dirty ? <p className="workbench-source-editing__notice" role="status">{changeSummary}</p> : null}
    {!canEdit ? <p className="workbench-source-editing__notice">当前为只读预览，需要项目文件修改权限才能编辑。</p>
      : !canEditSource ? <p className="workbench-source-editing__notice">仅可保存已证明的项目差异；整份源码编辑另需文件管理权限。</p> : null}
    {!configRevisionId ? <p className="workbench-source-editing__notice" role="status">配置修订尚未就绪，当前可预览源码。</p> : null}
    {mixedEndings && dirty ? <p className="workbench-source-editing__notice" role="note">原文件混用了换行形式，编辑后可能统一为 LF，请在保存差异中核对。</p> : null}
    {stale ? <p className="workbench-source-editing__notice" role="alert">文件或配置版本已更新，旧草稿仍保留。请核对最新版本后继续。<Button size="sm" variant="outline" disabled={!canEdit || busy || file?.mergeConflicts} onClick={() => void rebase()}>基于最新版本继续编辑</Button><Button size="sm" variant="ghost" onClick={() => setCompareOpen(true)}>对照最新来源</Button><Button size="sm" variant="ghost" onClick={() => download()}>下载草稿</Button><Button size="sm" variant="ghost" onClick={onRefresh}>刷新来源</Button></p> : null}
    {file?.rebased ? <p className="workbench-source-editing__notice" role="status">{file.mergeConflicts ? "合并存在冲突，请编辑冲突块并删除标记后保存。" : "已合并最新版本，请核对后保存"}{!stale ? <Button size="sm" variant="ghost" onClick={() => setCompareOpen(true)}>对照最新来源</Button> : null}<Button size="sm" variant="ghost" onClick={() => download(true)}>下载合并前原稿</Button></p> : null}
    {legacyDraftsDirty ? <p className="workbench-source-editing__notice">已有参数草稿，请先处理后保存完整 DTS。<Button size="sm" variant="ghost" onClick={onOpenLegacyDrafts}>查看已有草稿</Button></p> : null}
    {file?.storageError ? <p className="workbench-source-editing__notice" role="alert">本地恢复不可用：{file.storageError}<Button size="sm" variant="ghost" onClick={() => download()}>下载草稿</Button></p> : null}
    {requestId ? <p className="workbench-source-editing__notice">待审核请求 <code>{requestId}</code>
      <a href={`/parameter-submissions?project=${encodeURIComponent(scope.projectId)}&request=${encodeURIComponent(requestId)}`}>查看提交记录</a>
      <Button size="sm" variant="ghost" onClick={() => void checkRequest()}>检查审核结果</Button></p> : null}
    {error && !saveOpen ? <p className="workbench-source-editing__notice" role="alert">{error}</p> : null}
    <Suspense fallback={<p role="status">正在加载 DTS 编辑器…</p>}>
      <DtsEditor ref={editor} sessions={editorSessions} sessionKey={key} text={file?.sourceText ?? source} baseText={source}
        initialSelection={file ? { anchor: file.position.anchor, head: file.position.head } : undefined} initialVisibleLine={file?.position.firstVisibleLine}
        resetKey={`${file?.base.fileVersionId ?? baseVersionId}:${Boolean(file && !file.loading)}:${resetKeys[key] ?? 0}`} readOnly={!canEdit || !canEditSource || !isEditing || !ready || discardPending}
        focusSpan={focusSpan} focusLine={focusLine} findQuery={findQuery} findNextToken={findNextToken}
        onVisibleLineChange={onVisibleLineChange} onChange={change} onDirtyChange={(meta) => { if (meta.sessionKey === key) { setBufferDirty(meta.dirty); onDirtyChange(meta.dirty); } }}
        onSave={(value) => { void beginSave(value); }} />
    </Suspense>
    <ConfirmDialog open={discardOpen} title="放弃本地 DTS 修改？" description="恢复当前已加载的工作配置。已提交的审核请求需要单独撤回。"
      confirmLabel="放弃修改" pending={discardPending} onCancel={() => setDiscardOpen(false)} onConfirm={() => {
        if (discarding.current) return;
        discarding.current = true;
        setDiscardPending(true);
        void session.discard(scope).then((ok) => { if (!ok) throw new Error("无法清除本地恢复副本，文本仍保留，请重试或下载草稿。");
          setResetKeys((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
          setBufferDirty(false); onDirtyChange(false); setDiscardOpen(false); }).catch((cause) => {
            discarding.current = false; setError(presentError(cause, "放弃本地修改失败，请重试。")); setDiscardOpen(false);
          }).finally(() => setDiscardPending(false));
      }} />
    <ModalDialog open={compareOpen} className="workbench-source-save-dialog" backdropClassName="param-admin-modal-backdrop" onDismiss={closeCompare} describedBy>
      {({ titleId, descriptionId }) => <>
        <header><h2 id={titleId}>DTS 草稿对照</h2><p id={descriptionId}>{file?.rebased ? "编辑合并文本，保留所需内容并删除冲突标记后保存。" : "对照最新工作来源与保留的本地草稿。旧基线草稿不能直接提交。"}</p></header>
        <div className="workbench-source-save-dialog__diff"><Suspense fallback={<p role="status">正在加载差异…</p>}>
          {file?.rebased ? <DtsEditor ref={mergeEditor} sessionKey={`${key}:merge`} text={file.sourceText} baseText={source} readOnly={!canEdit}
            ariaLabel="DTS 合并源码" onChange={(value) => change({ ...value, sessionKey: key })} />
            : <DtsEditor sessionKey={`${key}:recovery-diff`} resetKey={recoveryDiff} text={recoveryDiff} readOnly ariaLabel="DTS 草稿差异源码" />}
        </Suspense></div>
        <footer className="dialog-actions"><Button variant="outline" onClick={() => download()}>下载草稿</Button><Button onClick={closeCompare}>返回草稿</Button></footer>
      </>}
    </ModalDialog>
    <ModalDialog open={saveOpen} className="workbench-source-save-dialog" backdropClassName="param-admin-modal-backdrop"
      onDismiss={busy ? undefined : () => setSaveOpen(false)} describedBy>
      {({ titleId, descriptionId }) => <>
        <header><h2 id={titleId}>保存 DTS 修改</h2><p id={descriptionId}>{fileName} · {canDirectApply ? "管理员可核对差异后直接应用，也可提交独立审核" : "核对本项目属性差异后提交独立审核"}</p></header>
        {busy ? <p role="status">正在处理来源修改…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {mixedEndings ? <p role="note">原文件混用了换行形式，编辑后可能统一为 LF，请在差异中核对。</p> : null}
        {attempt?.preview ? <>
          <p>{attempt.preview.impact?.parameterChanges ?? 0} 项参数变化 · 新增 {attempt.preview.impact?.nodeAdditions ?? 0} 个节点 · 删除 {attempt.preview.impact?.nodeRemovals ?? 0} 个节点</p>
          {attempt.preview.impact?.restoredParameters ? <p>恢复 {attempt.preview.impact.restoredParameters} 个已删除参数，保留原身份及历史。</p> : null}
          <div className="workbench-source-save-dialog__diff" role="region" aria-label="DTS 修改差异">
            <Suspense fallback={<p role="status">正在加载差异…</p>}><DtsEditor sessionKey={`${key}:save-diff`} resetKey={previewDiff}
              text={previewDiff} readOnly ariaLabel="DTS 修改差异源码" /></Suspense>
          </div>
          {attempt.preview.reason ? <p role={attempt.preview.canSubmit ? "status" : "alert"}>{sourceReviewReason(attempt.preview.reason)}</p> : null}
        </> : null}
        {[...diagnostics, ...(attempt?.preview?.diagnostics ?? [])].map((item, index) => <p key={index} role={item.severity === "error" ? "alert" : "status"}>
          {item.file && item.file !== fileName ? `${item.file}${item.line ? `:${item.line}` : ""} · ` : item.line ? <Button variant="ghost" size="sm"
            onClick={() => { setSaveOpen(false); editor.current?.revealLine(item.line!, item.column); }}>第 {item.line} 行</Button> : null}{item.message}</p>)}
        <label>修改原因<textarea aria-label="DTS 修改原因" rows={2} value={reason} maxLength={2000} disabled={busy || Boolean(attempt?.submission || attempt?.directApplication)} onChange={(event) => setReason(event.target.value)} /></label>
        <label>软件审核人（仅提交审核时需要）<SelectControl ariaLabel="DTS 软件审核人" value={reviewerId} onValueChange={setReviewerId} disabled={busy || Boolean(attempt?.submission || attempt?.directApplication)}
          placeholder="选择审核人" options={reviewers.map(({ userId, name }) => ({ value: userId, label: name }))} /></label>
        {attempt?.preview && !reviewers.length ? <p role="status">当前没有其他可选软件审核人。{canDirectApply ? "管理员可核对差异后直接应用；如需独立审核，请在项目审核角色中配置。" : "请在项目审核角色中配置软件审核人。"}</p> : null}
        <footer className="dialog-actions"><Button variant="outline" disabled={busy} onClick={() => setSaveOpen(false)}>返回编辑</Button>
          {!attempt?.preview || error ? <Button variant="outline" disabled={busy} onClick={() => void beginSave()}>重新校验</Button> : null}
          <Button variant="outline" disabled={busy || Boolean(attempt?.directApplication) || !attempt?.preview?.canSubmit || !reviewerId || !reason.trim()} onClick={() => void submit()}>{attempt?.submission ? "重试同一提交" : "提交审核"}</Button>
          {canDirectApply && repository.applyCandidateSourceRevision ? <Button disabled={busy || Boolean(attempt?.submission) || !attempt?.preview?.canSubmit || !reason.trim()}
            onClick={() => void applyDirectly()}>{attempt?.directApplication ? "重试同一应用" : "直接应用修改"}</Button> : null}</footer>
      </>}
    </ModalDialog>
  </section>;
}
