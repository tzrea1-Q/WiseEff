import { ArrowLeft, CheckCircle2, ChevronRight, CircleX, LockKeyhole, MessageSquare, Pencil, PlayCircle, RefreshCw, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProductFeedbackAppendProgressInput, ProductFeedbackUpdateInput } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackResolutionCode } from "@/domain/productFeedback/types";
import { productFeedbackResolutionCodes, productFeedbackResolutionLabels, productFeedbackTypeLabels } from "@/domain/productFeedback/types";
import { SelectControl } from "@/components/common/SelectControl";
import { presentError } from "@/infrastructure/http/presentError";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionSkeleton } from "@/components/common/SectionState";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { FeedbackAttachments } from "./FeedbackAttachments";
import { FeedbackStatusBadge } from "./FeedbackStatusBadge";
import { FeedbackProgressTimeline } from "./FeedbackProgressTimeline";
import "./feedback-admin.css";

type Assignee = { id: string; name: string; username: string | null };
type Action = "resolve" | "close" | "reopen";
const actionLabels = { resolve: "标记解决", close: "关闭反馈", reopen: "重新打开" };
const confirmLabels = { resolve: "确认解决", close: "确认关闭", reopen: "确认重新打开" };
const priorityLabels = { low: "低优先级", normal: "普通优先级", high: "高优先级" };

export type FeedbackAdminDrawerProps = {
  feedback: ProductFeedback | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: ProductFeedbackUpdateInput) => Promise<ProductFeedback>;
  onAppendProgress?: (id: string, input: ProductFeedbackAppendProgressInput) => Promise<ProductFeedback>;
  getAttachmentObjectUrl: (feedbackId: string, attachmentId: string) => Promise<string>;
  onRefresh?: () => Promise<ProductFeedback | null>;
  loading?: boolean;
  loadError?: string;
  listAssignees?: () => Promise<Assignee[]>;
};

export function FeedbackAdminDrawer({ feedback, open, onClose, onUpdate, onAppendProgress, getAttachmentObjectUrl, onRefresh, loading = false, loadError = "", listAssignees }: FeedbackAdminDrawerProps) {
  const [action, setAction] = useState<Action | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [resolutionCode, setResolutionCode] = useState<ProductFeedbackResolutionCode>("completed");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyMode, setReplyMode] = useState<"public" | "internal">("public");
  const [replies, setReplies] = useState({ public: "", internal: "" });
  const [editingTriage, setEditingTriage] = useState(false);
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assigneesError, setAssigneesError] = useState("");
  const [assigneesAttempt, setAssigneesAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [taskError, setTaskError] = useState("");
  const [triageError, setTriageError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [discardTarget, setDiscardTarget] = useState<"page" | "action" | null>(null);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const triageDirty = editingTriage && Boolean(feedback && (priority !== (feedback.priority ?? "normal") || assigneeUserId !== (feedback.assigneeUserId ?? "")));
  const dirty = Boolean(replies.public.trim() || replies.internal.trim() || triageDirty || (action && actionMessage.trim()));

  useEffect(() => {
    setAction(null); setActionMessage(""); setReplies({ public: "", internal: "" }); setReplyOpen(false); setReplyMode("public");
    setEditingTriage(false); setErrorMessage(""); setTaskError(""); setTriageError(""); setSuccessMessage(""); setDiscardTarget(null);
    if (open) headingRef.current?.focus();
  }, [feedback?.id, open]);
  useEffect(() => {
    setPriority(feedback?.priority ?? "normal"); setAssigneeUserId(feedback?.assigneeUserId ?? "");
  }, [feedback?.id, feedback?.priority, feedback?.assigneeUserId]);
  useEffect(() => { if (replyOpen) replyRef.current?.focus(); }, [replyOpen, replyMode]);
  useEffect(() => {
    let active = true;
    if (!open || !editingTriage || !listAssignees) return;
    setAssigneesLoading(true); setAssigneesError("");
    void listAssignees().then((result) => { if (active) setAssignees(result); })
      .catch(() => { if (active) setAssigneesError("负责人列表加载失败，请重试。"); })
      .finally(() => { if (active) setAssigneesLoading(false); });
    return () => { active = false; };
  }, [open, editingTriage, listAssignees, assigneesAttempt]);
  useEffect(() => {
    if (!open || (!dirty && !pending)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (pending) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setDiscardTarget("page");
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      leaveDecision.current?.resolve(false); leaveDecision.current = null;
    };
  }, [dirty, open, pending]);

  if (!open) return null;
  const description = feedback?.description.trim() ?? "";
  const firstLine = description.split("\n")[0];
  const title = firstLine?.slice(0, 100) || "反馈详情";
  const body = firstLine && firstLine.length <= 100 ? description.slice(firstLine.length).trim() : description;
  const author = feedback?.submitter ? feedback.submitter.username ? `${feedback.submitter.name} (@${feedback.submitter.username})` : feedback.submitter.name : feedback?.submitterUserId === null ? "已注销用户" : "内测用户";
  const locked = pending || loading;
  const requestClose = () => { if (!pending) { if (dirty) setDiscardTarget("page"); else onClose(); } };
  const cancelAction = () => { setAction(null); setActionMessage(""); setTaskError(""); };
  const openAction = (next: Action) => { setResolutionCode(feedback?.resolutionCode ?? "completed"); setActionMessage(""); setTaskError(""); setAction(next); };
  const append = async (input: ProductFeedbackAppendProgressInput) => {
    if (!feedback || !onAppendProgress) throw new Error("当前环境暂不支持保存处理记录，请刷新后重试。");
    return onAppendProgress(feedback.id, input);
  };
  const startProcessing = async () => {
    if (locked) return;
    setPending(true); setErrorMessage(""); setSuccessMessage("");
    try { await append({ toStatus: "in_progress", publicMessage: null, internalMessage: null }); setSuccessMessage("已开始处理。"); }
    catch (error) { setErrorMessage(presentError(error, "开始处理失败，请重试。")); }
    finally { setPending(false); }
  };
  const saveReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked || feedback?.status === "closed" || !replies[replyMode].trim()) return;
    const mode = replyMode;
    setPending(true); setErrorMessage(""); setSuccessMessage("");
    try {
      await append({ publicMessage: mode === "public" ? replies.public.trim() : null, internalMessage: mode === "internal" ? replies.internal.trim() : null });
      setReplies((current) => ({ ...current, [mode]: "" }));
      if (!replies[mode === "public" ? "internal" : "public"].trim()) setReplyOpen(false);
      setSuccessMessage(mode === "public" ? "回复已发送，提交人会收到通知。" : "内部备注已保存。");
    } catch (error) { setErrorMessage(presentError(error, "保存失败，请重试。")); }
    finally { setPending(false); }
  };
  const saveAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action || locked) return;
    if (!actionMessage.trim()) { setTaskError(action === "reopen" ? "请填写重新打开原因。" : "请填写处理说明。"); reasonRef.current?.focus(); return; }
    if (action !== "reopen" && !productFeedbackResolutionCodes.includes(resolutionCode)) { setTaskError("请选择有效的处理结论。"); return; }
    setPending(true); setTaskError(""); setSuccessMessage("");
    try {
      await append({ toStatus: action === "resolve" ? "resolved" : action === "close" ? "closed" : "in_progress", ...(action !== "reopen" ? { resolutionCode } : {}), publicMessage: actionMessage.trim(), internalMessage: null });
      setSuccessMessage(action === "resolve" ? "反馈已标记为已解决。" : action === "close" ? "反馈已关闭。" : "反馈已重新打开。"); cancelAction();
    } catch (error) { setTaskError(presentError(error, "操作失败，请重试。")); }
    finally { setPending(false); }
  };
  const saveTriage = async () => {
    if (!feedback || locked || !triageDirty) return;
    if (assigneeUserId && assigneeUserId !== feedback.assigneeUserId && !assignees.some((item) => item.id === assigneeUserId)) { setTriageError("请选择列表中的负责人。"); return; }
    setPending(true); setTriageError(""); setSuccessMessage("");
    try { await onUpdate(feedback.id, { priority, assigneeUserId: assigneeUserId || null }); setEditingTriage(false); setSuccessMessage("处理安排已保存。"); }
    catch (error) { setTriageError(presentError(error, "处理安排保存失败，请重试。")); }
    finally { setPending(false); }
  };
  const beginReply = (mode: "public" | "internal") => { setReplyMode(mode); setReplyOpen(true); setErrorMessage(""); setSuccessMessage(""); };

  return <>
    <article className="feedback-record" aria-label={title} aria-busy={locked || undefined}>
      <header className="feedback-record-toolbar">
        <Button variant="ghost" size="sm" disabled={pending} onClick={requestClose}><ArrowLeft data-icon="inline-start" />返回反馈列表</Button>
        <div className="feedback-record-toolbar-actions">
          {onRefresh && <Button variant="ghost" size="icon" aria-label="刷新反馈详情" disabled={locked || dirty} onClick={() => void onRefresh()}><RefreshCw className="size-4" /></Button>}
          {feedback?.status === "resolved" && <Button variant="ghost" size="sm" disabled={locked} onClick={() => openAction("reopen")}><RotateCcw data-icon="inline-start" />重新打开</Button>}
          {feedback && <Button size="sm" disabled={locked} onClick={() => feedback.status === "open" ? void startProcessing() : openAction(feedback.status === "in_progress" ? "resolve" : feedback.status === "resolved" ? "close" : "reopen")}>
            {feedback.status === "open" ? <PlayCircle data-icon="inline-start" /> : feedback.status === "closed" ? <RotateCcw data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}
            {feedback.status === "open" ? "开始处理" : feedback.status === "in_progress" ? "标记解决" : feedback.status === "resolved" ? "关闭反馈" : "重新打开"}
          </Button>}
        </div>
      </header>
      {loadError && <div className="feedback-record-notice" role="alert">{loadError}{onRefresh && <Button variant="ghost" size="sm" disabled={locked || dirty} onClick={() => void onRefresh()}>重新加载详情</Button>}</div>}
      {loading && !feedback && <div className="feedback-record-content"><SectionSkeleton label="正在加载反馈详情" /></div>}
      {feedback && <div className="feedback-record-grid">
        <div className="feedback-record-content">
          <section className="feedback-record-issue">
            <div className="feedback-record-eyebrow"><FeedbackStatusBadge status={feedback.status} resolutionCode={feedback.resolutionCode} /><span>{productFeedbackTypeLabels[feedback.feedbackType]}</span></div>
            <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
            <p className="feedback-record-byline">{author}<span>提交于 <time dateTime={feedback.submittedAt ?? feedback.createdAt} title={formatAbsolute(feedback.submittedAt ?? feedback.createdAt)}>{formatRelativeOrAbsolute(feedback.submittedAt ?? feedback.createdAt)}</time></span></p>
            {body && <p className="feedback-record-description">{body}</p>}
            {feedback.attachments.length > 0 && <div className="feedback-record-evidence"><h3>附件 <span>{feedback.attachments.length}</span></h3><FeedbackAttachments feedbackId={feedback.id} attachments={feedback.attachments} getAttachmentObjectUrl={getAttachmentObjectUrl} /></div>}
          </section>
          <section className="feedback-record-conversation" aria-label="沟通与进展">
            <div className="feedback-record-section-heading"><h3>沟通与进展</h3><span>{feedback.progressEvents?.length ?? 0} 条记录</span></div>
            {replyOpen ? <form className="feedback-record-reply" onSubmit={saveReply}>
              <div className="feedback-record-reply-head"><ViewSwitch variant="toggle" ariaLabel="回复可见范围" value={replyMode} onValueChange={(mode) => { setReplyMode(mode as "public" | "internal"); setErrorMessage(""); }} items={[{ value: "public", label: `公开回复${replies.public.trim() ? " · 未发送" : ""}`, disabled: locked }, { value: "internal", label: `内部备注${replies.internal.trim() ? " · 未保存" : ""}`, disabled: locked }]} /></div>
              <label className="sr-only" htmlFor="feedback-reply">{replyMode === "public" ? "公开回复" : "内部备注"}</label>
              <Textarea ref={replyRef} id="feedback-reply" rows={3} value={replies[replyMode]} maxLength={2000} disabled={locked || feedback.status === "closed"} onChange={(event) => { setReplies((current) => ({ ...current, [replyMode]: event.target.value })); setErrorMessage(""); }} placeholder={replyMode === "public" ? "向提交人说明进展，或询问更多信息…" : "记录排查线索或交接信息，仅管理员可见…"} />
              <p className="feedback-record-reply-visibility">{replyMode === "internal" ? <LockKeyhole size={13} /> : <MessageSquare size={13} />}{feedback.status === "closed" ? "反馈已关闭，未发送的内容仍保留。重新打开后可继续发送。" : replyMode === "public" ? "提交人可见，发送后会通知对方" : "仅管理员可见，不通知提交人"}</p>
              {errorMessage && <p className="feedback-admin-inline-error" role="alert">{errorMessage}</p>}
              <div className="feedback-record-reply-actions"><span>{replies[replyMode].length} / 2000</span><Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => { setReplies({ public: "", internal: "" }); setReplyOpen(false); setErrorMessage(""); }}>取消</Button><Button type="submit" size="sm" disabled={locked || feedback.status === "closed" || !replies[replyMode].trim()}><Send data-icon="inline-start" />{pending ? "保存中…" : replyMode === "public" ? "发送回复" : "保存内部备注"}</Button></div>
            </form> : feedback.status !== "closed" ? <div className="feedback-record-reply-prompt"><button type="button" disabled={locked} onClick={() => beginReply("public")}><MessageSquare size={17} /><span>回复提交人…</span><ChevronRight size={15} /></button><Button variant="ghost" size="sm" disabled={locked} onClick={() => beginReply("internal")}><LockKeyhole data-icon="inline-start" />写内部备注</Button></div> : <p className="feedback-record-closed">反馈已关闭。需要继续沟通时，可在右上角重新打开。</p>}
            {errorMessage && !replyOpen && <p className="feedback-admin-inline-error" role="alert">{errorMessage}</p>}
            {successMessage && <p className="feedback-record-success" role="status">{successMessage}</p>}
            <FeedbackProgressTimeline key={feedback.id} events={feedback.progressEvents} isAdmin initialVisibleCount={4} />
            {feedback.adminNote && !feedback.progressEvents?.some((event) => event.internalMessage === feedback.adminNote) && <div className="feedback-admin-legacy-note"><h4>历史内部备注</h4><p>{feedback.adminNote}</p></div>}
          </section>
        </div>
        <aside className="feedback-record-aside" aria-label="反馈信息">
          <section><div className="feedback-record-section-heading"><h3>处理安排</h3><Button variant="ghost" size="sm" disabled={locked || editingTriage} onClick={() => { setEditingTriage(true); setTriageError(""); }}><Pencil data-icon="inline-start" />编辑</Button></div>
            {editingTriage ? <div className="feedback-record-triage-editor">
              <div className="feedback-admin-field"><label htmlFor="feedback-priority">优先级</label><SelectControl id="feedback-priority" ariaLabel="优先级" value={priority} onValueChange={setPriority} disabled={locked} options={Object.entries(priorityLabels).map(([value, label]) => ({ value: value as typeof priority, label }))} /></div>
              <div className="feedback-admin-field"><label htmlFor="feedback-assignee">负责人</label><SelectControl id="feedback-assignee" ariaLabel="负责人" value={assigneeUserId} onValueChange={setAssigneeUserId} disabled={locked || assigneesLoading || Boolean(assigneesError) || !listAssignees} options={[{ value: "", label: "未分配负责人" }, ...assignees.map((item) => ({ value: item.id, label: item.name })), ...(assigneeUserId && !assignees.some((item) => item.id === assigneeUserId) ? [{ value: assigneeUserId, label: feedback.assignee?.name ?? "当前负责人" }] : [])]} /></div>
              {assigneesLoading && <p className="feedback-admin-help" role="status">正在加载负责人…</p>}{assigneesError && <p className="feedback-admin-inline-error" role="alert">{assigneesError}<Button variant="ghost" size="sm" onClick={() => setAssigneesAttempt((attempt) => attempt + 1)}>重试</Button></p>}{!listAssignees && <p className="feedback-admin-help">当前环境暂不支持调整负责人。</p>}
              {triageError && <p className="feedback-admin-inline-error" role="alert">{triageError}</p>}
              <div className="feedback-record-triage-actions"><Button variant="ghost" size="sm" disabled={locked} onClick={() => { setPriority(feedback.priority ?? "normal"); setAssigneeUserId(feedback.assigneeUserId ?? ""); setEditingTriage(false); }}>取消</Button><Button variant="outline" size="sm" disabled={locked || !triageDirty} onClick={() => void saveTriage()}>保存安排</Button></div>
            </div> : <dl className="feedback-record-properties"><div><dt>负责人</dt><dd>{feedback.assignee?.name ?? "未分配"}</dd></div><div><dt>优先级</dt><dd data-priority={feedback.priority ?? "normal"}>{priorityLabels[feedback.priority ?? "normal"]}</dd></div></dl>}
          </section>
          <section><h3>问题来源</h3><p className="feedback-record-source">{feedback.pageTitle}<code>{feedback.pagePath}</code></p></section>
          <section><h3>最近更新</h3><time className="feedback-record-updated" dateTime={feedback.updatedAt} title={formatAbsolute(feedback.updatedAt)}>{formatRelativeOrAbsolute(feedback.updatedAt)}</time></section>
        </aside>
      </div>}
    </article>
    <ModalDialog open={action !== null} className="feedback-action-dialog" onDismiss={pending ? undefined : () => actionMessage.trim() ? setDiscardTarget("action") : cancelAction()} initialFocusRef={reasonRef} describedBy>
      {({ titleId, descriptionId }) => <form onSubmit={saveAction}>
        <header className="feedback-action-head"><div><h2 id={titleId}>{action ? actionLabels[action] : "处理反馈"}</h2><p id={descriptionId}>{action === "reopen" ? "说明为什么需要继续处理，提交人会收到通知。" : action === "close" ? "关闭后仍可重新打开，处理记录会保留。" : "填写处理结果，提交人会收到通知。"}</p></div><Button type="button" variant="ghost" size="icon" aria-label="关闭操作窗口" disabled={pending} onClick={() => actionMessage.trim() ? setDiscardTarget("action") : cancelAction()}><CircleX size={18} /></Button></header>
        <div className="feedback-action-fields">
          {action !== "reopen" && <div className="feedback-admin-field"><label htmlFor="feedback-resolution">处理结论</label><SelectControl id="feedback-resolution" ariaLabel="处理结论" value={resolutionCode} onValueChange={setResolutionCode} disabled={pending} options={productFeedbackResolutionCodes.map((value) => ({ value, label: productFeedbackResolutionLabels[value] }))} /></div>}
          <div className="feedback-admin-field"><label htmlFor="feedback-action-message">{action === "reopen" ? "重新打开原因" : "处理说明"}</label><Textarea ref={reasonRef} id="feedback-action-message" rows={4} maxLength={2000} disabled={pending} value={actionMessage} onChange={(event) => { setActionMessage(event.target.value); setTaskError(""); }} placeholder={action === "reopen" ? "还有什么问题需要继续跟进？" : "说明处理结果及需要用户确认的事项…"} aria-invalid={Boolean(taskError) || undefined} aria-describedby={taskError ? "feedback-task-error" : undefined} /><p className="feedback-admin-help">提交人可见 · {actionMessage.length} / 2000</p></div>
          {taskError && <p id="feedback-task-error" className="feedback-admin-inline-error" role="alert">{taskError}</p>}
        </div>
        <footer className="feedback-action-footer"><Button type="button" variant="ghost" disabled={pending} onClick={cancelAction}>取消</Button><Button type="submit" disabled={pending}>{pending ? "保存中…" : action ? confirmLabels[action] : "确认"}</Button></footer>
      </form>}
    </ModalDialog>
    <ConfirmDialog open={discardTarget !== null} title="放弃未保存的修改？" description={discardTarget === "action" ? "尚未提交的处理说明将丢失。" : "尚未发送的回复、内部备注或处理安排将丢失。"} confirmLabel={discardTarget === "action" ? "放弃说明" : "放弃并返回"} cancelLabel="继续编辑" pending={pending} onCancel={() => { leaveDecision.current?.resolve(false); leaveDecision.current = null; setDiscardTarget(null); }} onConfirm={() => { const target = discardTarget; const decision = leaveDecision.current; leaveDecision.current = null; setDiscardTarget(null); if (target === "action") cancelAction(); else if (decision) decision.resolve(true); else onClose(); }} />
  </>;
}
