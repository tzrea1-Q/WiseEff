import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Edit3, ExternalLink, MessageSquarePlus, Paperclip, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { productFeedbackTypeLabels } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import { Textarea } from "@/components/ui/textarea";
import { presentError } from "@/infrastructure/http/presentError";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { FeedbackProgressTimeline } from "./FeedbackProgressTimeline";
import { FeedbackStatusBadge, getFeedbackDisplayStatus, type FeedbackDisplayStatus } from "./FeedbackStatusBadge";
import { acceptFeedbackFiles, FeedbackAttachments, feedbackImageAccept, feedbackImageHint } from "./FeedbackAttachments";
import "./feedback-user.css";

const statusOptions = [
  { value: "all", label: "全部状态" }, { value: "draft", label: "草稿" }, { value: "open", label: "待处理" },
  { value: "in_progress", label: "处理中" }, { value: "resolved", label: "已解决" }, { value: "closed", label: "已关闭" }
];
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function formatDateTime(value: string) { return dateFormatter.format(new Date(value)); }
function summary(feedback: ProductFeedback) { return feedback.description.trim().split("\n")[0]?.slice(0, 100) || "未填写描述的草稿"; }

export function MyFeedbackView({ productFeedbackRepository, onEditDraft, onFeedbackCountChange, selectedId, onSelectedIdChange, onStateChange, active = true, guardNavigation = true }: {
  productFeedbackRepository: ProductFeedbackRepository;
  onEditDraft: (draft: ProductFeedback) => void;
  onFeedbackCountChange?: (count: number) => void;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  onStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
  active?: boolean;
  guardNavigation?: boolean;
}) {
  const [items, setItems] = useState<ProductFeedback[]>([]);
  const itemsRef = useRef<ProductFeedback[]>([]);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | FeedbackDisplayStatus>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [detailId, setDetailId] = useState<string | null>(selectedId ?? null);
  const [selectedFeedback, setSelectedFeedback] = useState<ProductFeedback | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProductFeedback | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [reopen, setReopen] = useState(false);
  const [replyPending, setReplyPending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySuccess, setReplySuccess] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveTarget = useRef<{ id?: string | null; href?: string } | null>(null);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const navigationConfirmed = useRef(false);
  const replyDirty = Boolean(replyMessage.trim() || replyFiles.length);
  const replyRequest = useRef(0);
  const previousActive = useRef(active);
  const editRequest = useRef(0);
  const onEditDraftRef = useRef(onEditDraft);
  const operationPending = replyPending || Boolean(editingDraftId) || deleting;
  const replyId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const replyTriggerRef = useRef<HTMLButtonElement>(null);
  const replyWasOpen = useRef(false);

  const loadMyFeedback = useCallback(async (cursor?: string) => {
    if (!productFeedbackRepository.listMine) { setLoading(false); return; }
    const request = ++listRequest.current;
    if (cursor) setLoadingMore(true); else { setLoading(true); setItems([]); itemsRef.current = []; }
    setErrorMessage("");
    try {
      const response = await productFeedbackRepository.listMine({ cursor, limit: 30, q: query.trim() || undefined, status: status === "all" ? undefined : status });
      if (request !== listRequest.current) return;
      const next = cursor ? [...itemsRef.current, ...response.items.filter((item) => !itemsRef.current.some((current) => current.id === item.id))] : response.items;
      itemsRef.current = next;
      setItems(next);
      setNextCursor(response.nextCursor);
      onFeedbackCountChange?.(next.length);
    } catch (error) {
      if (request === listRequest.current) setErrorMessage(presentError(error, "加载我的反馈失败，请稍后重试。"));
    } finally {
      if (request === listRequest.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [productFeedbackRepository, query, status, onFeedbackCountChange]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void loadMyFeedback(), query ? 250 : 0);
    return () => { window.clearTimeout(timer); ++listRequest.current; };
  }, [loadMyFeedback, query, active]);
  useEffect(() => { onStateChange?.({ dirty: replyDirty, pending: operationPending }); }, [replyDirty, operationPending, onStateChange]);
  useEffect(() => () => { onStateChange?.({ dirty: false, pending: false }); }, [onStateChange]);
  useEffect(() => () => { ++editRequest.current; }, []);
  useEffect(() => { onEditDraftRef.current = onEditDraft; }, [onEditDraft]);
  useEffect(() => { if (!active) { ++editRequest.current; setEditingDraftId(null); } }, [active]);
  useEffect(() => {
    if (replyOpen) replyInputRef.current?.focus();
    else if (replyWasOpen.current) replyTriggerRef.current?.focus();
    replyWasOpen.current = replyOpen;
  }, [replyOpen]);

  const applySelection = (id: string | null) => { setDetailId(id); onSelectedIdChange?.(id); };
  const selectFeedback = (id: string | null) => {
    if (operationPending) return;
    if (replyDirty) { leaveTarget.current = { id }; setLeaveOpen(true); }
    else applySelection(id);
  };
  useEffect(() => {
    if (!guardNavigation || (!replyDirty && !operationPending)) return;
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (operationPending) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      leaveTarget.current = null; setLeaveOpen(true);
    };
    const guardUnload = (event: BeforeUnloadEvent) => {
      if (!navigationConfirmed.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    window.addEventListener("beforeunload", guardUnload);
    return () => {
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      window.removeEventListener("beforeunload", guardUnload);
      leaveDecision.current?.resolve(false); leaveDecision.current = null;
    };
  }, [replyDirty, operationPending, guardNavigation]);
  const finishLeave = (allowed: boolean) => {
    if (operationPending) return;
    leaveDecision.current?.resolve(allowed); leaveDecision.current = null;
    setLeaveOpen(false);
    if (allowed) {
      setReplyMessage(""); setReplyFiles([]); setReopen(false); setReplyOpen(false);
      if (leaveTarget.current?.href) { navigationConfirmed.current = true; window.location.assign(leaveTarget.current.href); }
      else if (leaveTarget.current && "id" in leaveTarget.current) applySelection(leaveTarget.current.id ?? null);
    }
    leaveTarget.current = null;
  };
  useEffect(() => { if (selectedId !== undefined) setDetailId(selectedId); }, [selectedId]);
  const loadDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const fresh = productFeedbackRepository.getMine ? await productFeedbackRepository.getMine(id) : itemsRef.current.find((item) => item.id === id) ?? null;
      if (request !== detailRequest.current) return;
      if (!fresh) { setSelectedFeedback(null); setDetailError("此反馈不存在或当前账号无权查看。"); }
      else { setSelectedFeedback(fresh); }
    } catch (error) {
      if (request === detailRequest.current) setDetailError(presentError(error, "加载反馈详情失败，请重试。"));
    } finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, [productFeedbackRepository]);
  useEffect(() => {
    ++replyRequest.current;
    ++editRequest.current;
    setReplyPending(false);
    setSelectedFeedback(null);
    setDetailError("");
    setReplyMessage(""); setReplyFiles([]); setReopen(false); setReplyOpen(false); setReplyError(""); setReplySuccess("");
    if (detailId) void loadDetail(detailId);
    return () => { ++detailRequest.current; ++replyRequest.current; };
  }, [detailId, loadDetail]);
  useEffect(() => {
    if (active && !previousActive.current && detailId) void loadDetail(detailId);
    previousActive.current = active;
  }, [active, detailId, loadDetail]);

  const handleDeleteDraft = async () => {
    if (!deleteTarget || !productFeedbackRepository.deleteDraft || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      await productFeedbackRepository.deleteDraft(deleteTarget.id);
      const remaining = itemsRef.current.filter((item) => item.id !== deleteTarget.id);
      itemsRef.current = remaining; setItems(remaining); onFeedbackCountChange?.(remaining.length);
      if (detailId === deleteTarget.id) applySelection(null);
      setDeleteTarget(null);
      void loadMyFeedback();
    } catch (error) { setDeleteError(presentError(error, "删除草稿失败，请稍后重试。")); }
    finally { setDeleting(false); }
  };
  const editDraft = async (draft: ProductFeedback) => {
    if (editingDraftId) return;
    const request = ++editRequest.current;
    setEditingDraftId(draft.id);
    try {
      const fresh = productFeedbackRepository.getMine ? await productFeedbackRepository.getMine(draft.id) : draft;
      if (request !== editRequest.current) return;
      if (!fresh || getFeedbackDisplayStatus(fresh) !== "draft") throw new Error("此草稿已提交或不存在，请刷新列表后重试。");
      onEditDraftRef.current(fresh);
    } catch (error) {
      const message = presentError(error, "加载草稿失败，请重试。");
      if (detailId) setDetailError(message); else setErrorMessage(message);
    } finally { if (request === editRequest.current) setEditingDraftId(null); }
  };
  const addReplyFiles = (files: File[]) => {
    if (replyPending || !selectedFeedback) return;
    const result = acceptFeedbackFiles(files, selectedFeedback.attachments.length + replyFiles.length,
      selectedFeedback.attachments.reduce((sum, item) => sum + item.sizeBytes, 0) + replyFiles.reduce((sum, file) => sum + file.size, 0));
    setReplyFiles((current) => [...current, ...result.accepted]); setReplyError(result.error); setReplySuccess("");
  };
  const openReply = (reopenIntent: boolean) => {
    if (operationPending) return;
    setReopen(reopenIntent); setReplyOpen(true); setReplyError(""); setReplySuccess("");
  };
  const cancelReply = () => {
    if (replyPending) return;
    setReplyMessage(""); setReplyFiles([]); setReopen(false); setReplyOpen(false); setReplyError(""); setReplySuccess("");
  };
  const handleReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFeedback || !productFeedbackRepository.replyToMine || replyPending || !replyMessage.trim() || (selectedFeedback.status === "closed" && !reopen) || (reopen && selectedFeedback.status !== "resolved" && selectedFeedback.status !== "closed")) return;
    ++detailRequest.current;
    setDetailLoading(false);
    setReplyPending(true); setReplyError(""); setReplySuccess("");
    const request = ++replyRequest.current;
    try {
      const updated = await productFeedbackRepository.replyToMine(selectedFeedback.id, { message: replyMessage.trim(), files: replyFiles, reopen });
      if (request !== replyRequest.current) return;
      ++detailRequest.current;
      setSelectedFeedback(updated); setReplyMessage(""); setReplyFiles([]); setReopen(false); setReplyOpen(false);
      setReplySuccess(reopen ? "反馈已重新打开，团队会继续跟进。" : "补充说明已发送。");
      void loadMyFeedback();
    } catch (error) { if (request === replyRequest.current) setReplyError(presentError(error, "发送补充说明失败，请重试。")); }
    finally { if (request === replyRequest.current) setReplyPending(false); }
  };
  const isDraft = selectedFeedback && getFeedbackDisplayStatus(selectedFeedback) === "draft";
  const descriptionLines = selectedFeedback?.description.trim().split("\n") ?? [];
  const descriptionBody = selectedFeedback && descriptionLines[0] === summary(selectedFeedback)
    ? descriptionLines.slice(1).join("\n").trim() : selectedFeedback?.description.trim();
  const canReopen = selectedFeedback?.status === "resolved" || selectedFeedback?.status === "closed";
  const replyIntentValid = selectedFeedback?.status === "closed" ? reopen : !reopen || canReopen;

  return (
    <div className={`feedback-mine${detailId ? " feedback-mine-detail" : ""}`} onClickCapture={(event) => {
      if (event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/feedback"]') : null;
      if (!link) return;
      if (operationPending) { event.preventDefault(); return; }
      if (replyDirty) { event.preventDefault(); leaveTarget.current = { href: link.getAttribute("href") ?? "/feedback" }; setLeaveOpen(true); }
    }}>
      {detailId ? <>
        <div className="feedback-mine-detail-toolbar">
          <Button type="button" variant="ghost" size="sm" disabled={operationPending} aria-label="返回反馈列表" onClick={() => selectFeedback(null)}><ArrowLeft size={16} />返回列表</Button>
          <div className="feedback-mine-detail-tools">
            {selectedFeedback && <a className="feedback-download" aria-label="反馈详情链接" aria-disabled={operationPending || undefined} href={`/feedback?id=${encodeURIComponent(selectedFeedback.id)}`}><ExternalLink size={14} />链接</a>}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新详情" disabled={detailLoading || operationPending}
            onClick={() => void loadDetail(detailId)}><RefreshCw size={14} /></Button>
            {isDraft && selectedFeedback && <><Button type="button" variant="outline" size="sm" disabled={Boolean(editingDraftId)} onClick={() => void editDraft(selectedFeedback)}><Edit3 size={14} />继续编辑</Button>
              <Button type="button" variant="ghost" size="sm" disabled={operationPending} onClick={() => { setDeleteTarget(selectedFeedback); setDeleteError(""); }}><Trash2 size={14} />删除草稿</Button></>}
          </div>
        </div>
        {detailError && <p className="feedback-mine-error" role="alert">{detailError}</p>}
        {detailLoading && <p className="feedback-mine-status" role="status">正在加载最新详情…</p>}
        {replySuccess && <p role="status" className="feedback-mine-sent">{replySuccess}</p>}
        {selectedFeedback && <>
          <header className="feedback-mine-detail-header">
            <div className="feedback-mine-card__meta"><FeedbackStatusBadge status={getFeedbackDisplayStatus(selectedFeedback)} resolutionCode={selectedFeedback.resolutionCode} />
              <span>{productFeedbackTypeLabels[selectedFeedback.feedbackType]}</span></div>
            <div className="feedback-mine-detail-heading"><h2>{summary(selectedFeedback)}</h2>
              {!isDraft && productFeedbackRepository.replyToMine && !replyOpen && <div className="feedback-mine-detail-actions">
                {selectedFeedback.status === "resolved" && <Button type="button" variant="ghost" size="sm" disabled={operationPending} onClick={() => openReply(true)}><RotateCcw size={14} />问题仍未解决</Button>}
                <Button ref={replyTriggerRef} type="button" size="sm" disabled={operationPending} onClick={() => openReply(selectedFeedback.status === "closed")}>
                  {selectedFeedback.status === "closed" ? <RotateCcw size={14} /> : <MessageSquarePlus size={14} />}{selectedFeedback.status === "closed" ? "补充并重新打开" : "补充说明"}
                </Button></div>}
            </div>
            <div className="feedback-mine-detail-context"><span>{selectedFeedback.pageTitle}</span><code title={selectedFeedback.pagePath}>{selectedFeedback.pagePath}</code>
              <time dateTime={selectedFeedback.submittedAt ?? selectedFeedback.updatedAt} title={formatAbsolute(selectedFeedback.submittedAt ?? selectedFeedback.updatedAt)}>
                {isDraft ? "更新于 " : "提交于 "}{formatRelativeOrAbsolute(selectedFeedback.submittedAt ?? selectedFeedback.updatedAt)}</time></div>
          </header>
          {descriptionBody && <section className="feedback-mine-section" aria-label="问题详情"><p className="feedback-mine-description">{descriptionBody}</p></section>}
          {selectedFeedback.attachments.length > 0 && <section className="feedback-mine-section"><h3>相关截图 <span>{selectedFeedback.attachments.length}</span></h3>
            <FeedbackAttachments feedbackId={selectedFeedback.id} attachments={selectedFeedback.attachments}
              getAttachmentObjectUrl={productFeedbackRepository.getMineAttachmentObjectUrl ?? productFeedbackRepository.getAttachmentObjectUrl} /></section>}
          {!isDraft && productFeedbackRepository.replyToMine && replyOpen && <form className="feedback-mine-reply" aria-label={reopen ? "补充并重新打开反馈" : "补充反馈说明"} onSubmit={handleReply} onPaste={(event) => {
            const files = Array.from(event.clipboardData.files ?? []); if (files.length) { event.preventDefault(); addReplyFiles(files); }
          }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addReplyFiles(Array.from(event.dataTransfer.files)); }}>
            <div className="feedback-field-heading"><label htmlFor={`${replyId}-message`} className="font-semibold">{reopen ? "说明仍未解决的原因" : "补充说明"}</label><span>{replyMessage.length} / 2000</span></div>
            {selectedFeedback.status === "closed" && !reopen && <div className="feedback-mine-reply-intent"><p className="feedback-help">此反馈刚刚被关闭。补充内容已保留，发送前需重新打开反馈。</p>
              <Button type="button" variant="outline" size="sm" disabled={replyPending} onClick={() => { setReopen(true); replyInputRef.current?.focus(); }}><RotateCcw size={14} />改为补充并重新打开</Button></div>}
            {reopen && !canReopen && <div className="feedback-mine-reply-intent"><p className="feedback-help">此反馈已重新打开，无需重复操作。补充内容已保留。</p>
              <Button type="button" variant="outline" size="sm" disabled={replyPending} onClick={() => { setReopen(false); replyInputRef.current?.focus(); }}><MessageSquarePlus size={14} />改为普通补充</Button></div>}
            {reopen && canReopen && <p className="feedback-help">发送后将重新打开反馈，团队会继续跟进。</p>}
            <Textarea ref={replyInputRef} id={`${replyId}-message`} value={replyMessage} maxLength={2000} rows={4} disabled={replyPending}
              onChange={(event) => { setReplyMessage(event.target.value); setReplyError(""); setReplySuccess(""); }} placeholder={reopen ? "说明仍未解决的现象，可补充复现步骤或新截图。" : "补充复现步骤、处理结果或新的截图。"} required />
            <input ref={fileInputRef} type="file" accept={feedbackImageAccept} multiple hidden aria-label="选择补充截图" disabled={replyPending}
              onChange={(event) => { addReplyFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
            <div className="feedback-mine-reply-attachments"><Button type="button" variant="ghost" size="sm" disabled={replyPending} onClick={() => fileInputRef.current?.click()}><Paperclip size={14} />添加截图</Button>
              <span className="feedback-help">也可拖入或粘贴图片</span><details className="feedback-mine-upload-help"><summary>附件要求</summary><p>{feedbackImageHint}（包含已有附件）</p></details></div>
            {replyFiles.map((file, index) => <div className="feedback-mine-toolbar" key={`${file.name}-${index}`}><span className="feedback-help">{file.name}</span>
              <Button type="button" variant="ghost" size="sm" disabled={replyPending} aria-label={`移除补充截图 ${file.name}`} onClick={() => {
                setReplyFiles((files) => files.filter((_, itemIndex) => itemIndex !== index)); setReplyError(""); setReplySuccess("");
              }}><Trash2 size={14} />移除</Button></div>)}
            {replyError && <p role="alert" className="feedback-mine-error">{replyError}</p>}
            <div className="feedback-mine-reply-actions"><Button type="button" variant="ghost" disabled={replyPending} onClick={cancelReply}>取消补充</Button>
              <Button type="submit" disabled={replyPending || !replyMessage.trim() || !replyIntentValid}><Send size={14} />{replyPending ? "发送中…" : reopen ? "发送并重新打开" : "发送补充"}</Button></div>
          </form>}
          {!isDraft && <section className="feedback-mine-section"><h3>处理记录</h3><FeedbackProgressTimeline events={selectedFeedback.progressEvents} isAdmin={false} initialVisibleCount={4} /></section>}
        </>}
      </> : <>
        <div className="feedback-mine-toolbar"><SearchField className="feedback-mine-search" ariaLabel="搜索我的反馈" placeholder="搜索问题描述或来源页面" value={query} onValueChange={setQuery} />
          <div className="feedback-mine-filter"><SelectControl ariaLabel="筛选反馈状态" value={status} onValueChange={(value) => setStatus(value as typeof status)} options={statusOptions} withinModal /></div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMyFeedback()} disabled={loading || loadingMore}><RefreshCw size={14} />刷新</Button></div>
        {errorMessage && <div><p className="feedback-mine-error" role="alert">{errorMessage}</p><Button type="button" variant="ghost" onClick={() => void loadMyFeedback()}>重试加载</Button></div>}
        {loading ? <p className="feedback-mine-empty" role="status">正在加载反馈记录…</p> : items.length === 0 ? <div className="feedback-mine-empty">{query || status !== "all" ? "没有符合条件的反馈，试试调整搜索或状态。" : "暂无提交记录或草稿"}</div> : <>
          <p className="feedback-mine-status">我的反馈记录 · 已显示 {items.length} 条{nextCursor ? "，下方可继续加载" : ""}</p>
          <div className="feedback-mine-list">{items.map((item) => <article key={item.id} className="feedback-mine-card">
            <button type="button" className="feedback-mine-card__open" disabled={operationPending} onClick={() => selectFeedback(item.id)} aria-label={`查看反馈：${summary(item)}`}>
              <div className="feedback-mine-card__meta"><FeedbackStatusBadge status={getFeedbackDisplayStatus(item)} resolutionCode={item.resolutionCode} /><span>{productFeedbackTypeLabels[item.feedbackType]}</span><time>{formatDateTime(item.submittedAt ?? item.updatedAt)}</time></div>
              <h3 className="feedback-mine-card__title">{summary(item)}</h3><span className="feedback-mine-card__context">{item.pageTitle}</span>
              {item.latestPublicProgress && getFeedbackDisplayStatus(item) !== "draft" && <p className="feedback-mine-card__progress">{item.latestPublicProgress}</p>}
            </button>
            {getFeedbackDisplayStatus(item) === "draft" && <div className="feedback-mine-card__actions"><Button type="button" variant="outline" size="sm" disabled={Boolean(editingDraftId)} onClick={() => void editDraft(item)}><Edit3 size={14} />继续编辑</Button>
              <Button type="button" variant="ghost" size="sm" disabled={operationPending} onClick={() => { setDeleteTarget(item); setDeleteError(""); }}><Trash2 size={14} />删除</Button></div>}
          </article>)}</div>
          {nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMyFeedback(nextCursor)}>{loadingMore ? "加载中…" : "加载更多反馈"}</Button>}
        </>}
      </>}
      <ConfirmDialog open={deleteTarget !== null} title="确认删除草稿？" description={<p>删除后该草稿将无法恢复。确认删除？</p>}
        confirmLabel="确认删除" cancelLabel="取消" tone="danger" pending={deleting} error={deleteError}
        onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDeleteDraft()} />
      <ConfirmDialog open={leaveOpen} title="放弃未发送的补充？" description={<p>本次补充说明和新添加的截图尚未发送，离开后将丢失。已提交的反馈不会受到影响。</p>}
        confirmLabel="放弃并离开" cancelLabel="继续填写" tone="danger" pending={operationPending} onConfirm={() => finishLeave(true)} onCancel={() => finishLeave(false)} />
    </div>
  );
}
