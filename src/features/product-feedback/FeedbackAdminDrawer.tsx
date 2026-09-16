import { CheckCircle2, CircleX, ImageIcon, PlayCircle, PlusCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductFeedbackAppendProgressInput } from "@/application/ports/ProductFeedbackRepository";
import type {
  ProductFeedback,
  ProductFeedbackResolutionCode,
  ProductFeedbackStatus
} from "@/domain/productFeedback/types";
import {
  productFeedbackResolutionCodes,
  productFeedbackResolutionLabels,
  productFeedbackStatusLabels,
  productFeedbackTypeLabels
} from "@/domain/productFeedback/types";
import { presentError } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type FeedbackAdminDrawerProps = {
  feedback: ProductFeedback | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: { status?: ProductFeedbackStatus; adminNote?: string | null }) => Promise<ProductFeedback>;
  onAppendProgress?: (id: string, input: ProductFeedbackAppendProgressInput) => Promise<ProductFeedback>;
  getAttachmentObjectUrl: (feedbackId: string, attachmentId: string) => Promise<string>;
};

type AttachmentPreview = {
  id: string;
  fileName: string;
  objectUrl: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function nextStatusAction(status: ProductFeedbackStatus) {
  if (status === "open") return { label: "开始处理", status: "in_progress" as const, icon: PlayCircle };
  if (status === "in_progress") return { label: "关闭反馈", status: "closed" as const, icon: CheckCircle2 };
  return null;
}

export function FeedbackAdminDrawer({
  feedback,
  open,
  onClose,
  onUpdate,
  onAppendProgress,
  getAttachmentObjectUrl
}: FeedbackAdminDrawerProps) {
  const [adminNote, setAdminNote] = useState("");
  const [previews, setPreviews] = useState<AttachmentPreview[]>([]);
  const [expandedPreview, setExpandedPreview] = useState<AttachmentPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  // New progress workflow dialogs
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolutionCode, setResolutionCode] = useState<ProductFeedbackResolutionCode>("completed");
  const [resolvePublicMessage, setResolvePublicMessage] = useState("");
  const [resolveInternalMessage, setResolveInternalMessage] = useState("");

  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [progressPublicMessage, setProgressPublicMessage] = useState("");
  const [progressInternalMessage, setProgressInternalMessage] = useState("");

  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  useEffect(() => {
    setAdminNote(feedback?.adminNote ?? "");
    setErrorMessage("");
    setExpandedPreview(null);
  }, [feedback?.id, feedback?.adminNote]);

  useEffect(() => {
    if (!open) {
      setExpandedPreview(null);
      setResolveDialogOpen(false);
      setProgressDialogOpen(false);
      setReopenDialogOpen(false);
    }
  }, [open]);

  useEffect(() => {
    let active = true;
    setPreviews([]);

    if (!feedback || feedback.attachments.length === 0) {
      return undefined;
    }

    void Promise.all(
      feedback.attachments
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(async (attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          objectUrl: await getAttachmentObjectUrl(feedback.id, attachment.id)
        }))
    )
      .then((nextPreviews) => {
        if (active) setPreviews(nextPreviews);
      })
      .catch(() => {
        if (active) setErrorMessage("截图加载失败，请稍后重试。");
      });

    return () => {
      active = false;
    };
  }, [feedback, getAttachmentObjectUrl]);

  if (!feedback) {
    return null;
  }

  const action = nextStatusAction(feedback.status);
  const readOnly = feedback.status === "closed";
  const ActionIcon = action?.icon;

  const handleStatusAction = async () => {
    if (!action) return;
    setPending(true);
    setErrorMessage("");
    try {
      // The current admin note is submitted together with the status change.
      await onUpdate(feedback.id, {
        status: action.status,
        adminNote: adminNote.trim() || null
      });
      setCloseConfirmOpen(false);
    } catch (error) {
      setErrorMessage(presentError(error, "反馈状态更新失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  };

  const handlePrimaryAction = () => {
    if (!action) return;
    if (action.status === "closed") {
      // Closing is irreversible (the feedback becomes read-only) — confirm first.
      setCloseConfirmOpen(true);
      return;
    }
    void handleStatusAction();
  };

  const handleResolve = async () => {
    if (!resolvePublicMessage.trim()) {
      setErrorMessage("请填写对外公开说明。");
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      if (onAppendProgress) {
        await onAppendProgress(feedback.id, {
          toStatus: "resolved",
          resolutionCode,
          publicMessage: resolvePublicMessage.trim(),
          internalMessage: resolveInternalMessage.trim() || null
        });
      } else {
        await onUpdate(feedback.id, {
          status: "resolved",
          adminNote: resolvePublicMessage.trim()
        });
      }
      setResolveDialogOpen(false);
    } catch (error) {
      setErrorMessage(presentError(error, "标记解决失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  };

  const handleAddProgress = async () => {
    if (!progressPublicMessage.trim() && !progressInternalMessage.trim()) {
      setErrorMessage("请至少填写公开进展或内部备注中的一项。");
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      if (onAppendProgress) {
        await onAppendProgress(feedback.id, {
          publicMessage: progressPublicMessage.trim() || null,
          internalMessage: progressInternalMessage.trim() || null
        });
      } else {
        await onUpdate(feedback.id, {
          adminNote: (progressInternalMessage.trim() || progressPublicMessage.trim()) ?? null
        });
      }
      setProgressDialogOpen(false);
      setProgressPublicMessage("");
      setProgressInternalMessage("");
    } catch (error) {
      setErrorMessage(presentError(error, "添加进展失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  };

  const handleReopen = async () => {
    if (!reopenReason.trim()) {
      setErrorMessage("请填写重新打开原因。");
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      if (onAppendProgress) {
        await onAppendProgress(feedback.id, {
          toStatus: "in_progress",
          publicMessage: reopenReason.trim()
        });
      } else {
        await onUpdate(feedback.id, {
          status: "in_progress",
          adminNote: reopenReason.trim()
        });
      }
      setReopenDialogOpen(false);
      setReopenReason("");
    } catch (error) {
      setErrorMessage(presentError(error, "重新打开失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          // Keep the detail dialog mounted while its irreversible close confirmation
          // is stacked above it, so the confirmation can complete safely.
          if (!isOpen && !closeConfirmOpen) onClose();
        }}
      >
        <DialogContent
          className="feedback-admin-dialog flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton={false}
        >
          <div className="flex flex-row items-start gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <span className="text-xs font-medium text-primary">{productFeedbackStatusLabels[feedback.status]}</span>
              <DialogTitle className="truncate text-base">{feedback.pageTitle}</DialogTitle>
              <DialogDescription className="text-xs">
                {productFeedbackTypeLabels[feedback.feedbackType]} · {feedback.pagePath} · {formatDateTime(feedback.createdAt)}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button type="button" className="audit-dialog-close-icon" aria-label="关闭">
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </DialogClose>
          </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">问题描述</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{feedback.description}</p>
          </section>

          <section className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">页面路径</span>
              <p className="mt-1 font-mono text-foreground">{feedback.pagePath}</p>
            </div>
            <div>
              <span className="text-muted-foreground">提交人</span>
              <p className="mt-1 text-foreground">
                {feedback.submitter
                  ? feedback.submitter.username
                    ? `${feedback.submitter.name} (@${feedback.submitter.username})`
                    : feedback.submitter.name
                  : feedback.submitterUserId === null
                    ? "已注销用户"
                    : feedback.submitterUserId ?? "内测用户"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">更新时间</span>
              <p className="mt-1 text-foreground">{formatDateTime(feedback.updatedAt)}</p>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              处理进展记录{feedback.progressEvents ? `（${feedback.progressEvents.length}）` : ""}
            </h4>
            {!feedback.progressEvents || feedback.progressEvents.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">暂无进展记录。</p>
            ) : (
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                {feedback.progressEvents.map((event) => (
                  <div key={event.id} className="border-l-2 border-primary/40 pl-3 py-1 text-xs space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {event.kind === "submitted" && "用户提交反馈"}
                        {event.kind === "status_changed" &&
                          `状态变更：${event.fromStatus ? productFeedbackStatusLabels[event.fromStatus] : ""} → ${event.toStatus ? productFeedbackStatusLabels[event.toStatus] : ""}`}
                        {event.kind === "reopened" && "重新打开反馈"}
                        {event.kind === "progress" && "处理进展"}
                        {event.kind === "legacy_note" && "处理备注"}
                      </span>
                      <span>{formatDateTime(event.createdAt)}</span>
                    </div>
                    {event.resolutionCode && (
                      <p className="text-muted-foreground">
                        解决结论：<span className="font-medium text-foreground">{productFeedbackResolutionLabels[event.resolutionCode]}</span>
                      </p>
                    )}
                    {event.publicMessage && (
                      <div className="rounded bg-background/80 p-2 text-foreground">
                        <span className="text-[10px] font-semibold text-primary uppercase mr-1">公开进展:</span>
                        {event.publicMessage}
                      </div>
                    )}
                    {event.internalMessage && (
                      <div className="rounded bg-amber-500/10 p-2 text-amber-950 dark:text-amber-200">
                        <span className="text-[10px] font-semibold text-amber-600 uppercase mr-1">内部备注:</span>
                        {event.internalMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">截图附件（{feedback.attachments.length}）</h4>
            {feedback.attachments.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">未附加截图。</p>
            ) : previews.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {previews.map((preview) => (
                  <figure key={preview.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <button
                      type="button"
                      className="block w-full cursor-zoom-in transition-opacity hover:opacity-90"
                      aria-label={`放大查看 ${preview.fileName}`}
                      onClick={() => setExpandedPreview(preview)}
                    >
                      <img src={preview.objectUrl} alt={`反馈截图 ${preview.fileName}`} className="h-32 w-full object-cover" />
                    </button>
                    <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">{preview.fileName}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">
                <ImageIcon className="size-4" />
                正在加载截图...
              </p>
            )}
          </section>

          <section>
            <label htmlFor="feedback-admin-note" className="text-xs font-semibold uppercase text-muted-foreground">
              处理备注
            </label>
            <Textarea
              id="feedback-admin-note"
              value={adminNote}
              rows={5}
              disabled={readOnly || pending}
              onChange={(event) => setAdminNote(event.target.value)}
              placeholder="记录处理结论、责任人或后续动作"
              className="mt-2"
            />
            {readOnly ? <p className="mt-2 text-xs text-muted-foreground">已关闭的反馈仅可查看。</p> : null}
          </section>

          {errorMessage ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMessage}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
          {action && ActionIcon ? (
            <Button size="sm" onClick={handlePrimaryAction} disabled={pending} aria-busy={pending || undefined}>
              <ActionIcon data-icon="inline-start" />
              {pending ? "处理中..." : action.label}
            </Button>
          ) : null}

          {feedback.status === "in_progress" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setResolvePublicMessage("");
                  setResolveInternalMessage("");
                  setResolveDialogOpen(true);
                }}
                disabled={pending}
              >
                <CheckCircle2 data-icon="inline-start" />
                标记解决
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setProgressPublicMessage("");
                  setProgressInternalMessage("");
                  setProgressDialogOpen(true);
                }}
                disabled={pending}
              >
                <PlusCircle data-icon="inline-start" />
                添加进展
              </Button>
            </>
          )}

          {(feedback.status === "resolved" || feedback.status === "closed") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReopenReason("");
                setReopenDialogOpen(true);
              }}
              disabled={pending}
            >
              <RotateCcw data-icon="inline-start" />
              重新打开
            </Button>
          )}
        </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={closeConfirmOpen}
        title="确认关闭反馈"
        description={
          <p>
            关闭「{feedback.pageTitle}」后该反馈进入只读状态，不能再编辑状态或备注；
            当前填写的处理备注将随关闭一并保存。
          </p>
        }
        confirmLabel="确认关闭"
        tone="danger"
        pending={pending}
        pendingLabel="关闭中…"
        error={errorMessage}
        onCancel={() => {
          if (pending) return;
          setCloseConfirmOpen(false);
        }}
        onConfirm={() => void handleStatusAction()}
      />

      <Dialog open={expandedPreview !== null} onOpenChange={(isOpen) => !isOpen && setExpandedPreview(null)}>
        <DialogContent
          className="feedback-attachment-preview-dialog sm:max-w-[min(1100px,calc(100vw-48px))]"
          showCloseButton={false}
        >
          <div className="feedback-attachment-preview-dialog-head">
            <div className="feedback-attachment-preview-dialog-head-text">
              <DialogTitle>反馈截图预览</DialogTitle>
              <DialogDescription>{expandedPreview?.fileName ?? "反馈截图"}</DialogDescription>
            </div>
            <button
              type="button"
              className="audit-dialog-close-icon"
              aria-label="关闭"
              onClick={() => setExpandedPreview(null)}
            >
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          {expandedPreview ? (
            <div className="feedback-attachment-preview-dialog-body">
              <img
                src={expandedPreview.objectUrl}
                alt={`反馈截图 ${expandedPreview.fileName}`}
                className="max-h-[min(78vh,calc(100vh-180px))] w-full rounded-md object-contain"
              />
              <p className="truncate text-center text-xs text-muted-foreground">{expandedPreview.fileName}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>标记反馈为已解决</DialogTitle>
          <DialogDescription>
            解决反馈需要选择解决结论并填写对外公开说明，提交人可在我的反馈中查看处理结果。
          </DialogDescription>
          <div className="space-y-3 py-2 text-sm">
            <div>
              <label htmlFor="resolve-resolution-code" className="text-xs font-medium text-muted-foreground">解决结论 *</label>
              <select
                id="resolve-resolution-code"
                value={resolutionCode}
                onChange={(e) => setResolutionCode(e.target.value as ProductFeedbackResolutionCode)}
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                {productFeedbackResolutionCodes.map((code) => (
                  <option key={code} value={code}>
                    {productFeedbackResolutionLabels[code]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="resolve-public-msg" className="text-xs font-medium text-muted-foreground">对外公开说明 *</label>
              <Textarea
                id="resolve-public-msg"
                value={resolvePublicMessage}
                onChange={(e) => setResolvePublicMessage(e.target.value)}
                placeholder="例如：已在 v2.5.1 版本修复此问题"
                rows={3}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="resolve-internal-msg" className="text-xs font-medium text-muted-foreground">内部处理备注（可选）</label>
              <Textarea
                id="resolve-internal-msg"
                value={resolveInternalMessage}
                onChange={(e) => setResolveInternalMessage(e.target.value)}
                placeholder="仅管理员可见的内部排查或沟通记录..."
                rows={2}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setResolveDialogOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button size="sm" onClick={() => void handleResolve()} disabled={pending}>
              {pending ? "提交中..." : "确认解决"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Progress Dialog */}
      <Dialog open={progressDialogOpen} onOpenChange={setProgressDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>添加处理进展</DialogTitle>
          <DialogDescription>
            记录最新的排查或处理进展。公开进展对反馈提交人可见，内部备注仅管理员可见。
          </DialogDescription>
          <div className="space-y-3 py-2 text-sm">
            <div>
              <label htmlFor="progress-public-msg" className="text-xs font-medium text-muted-foreground">公开进展（提交人可见）</label>
              <Textarea
                id="progress-public-msg"
                value={progressPublicMessage}
                onChange={(e) => setProgressPublicMessage(e.target.value)}
                placeholder="向用户同步的处理进展..."
                rows={3}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="progress-internal-msg" className="text-xs font-medium text-muted-foreground">内部备注（仅管理员可见）</label>
              <Textarea
                id="progress-internal-msg"
                value={progressInternalMessage}
                onChange={(e) => setProgressInternalMessage(e.target.value)}
                placeholder="内部讨论、排查结论或责任人记录..."
                rows={2}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setProgressDialogOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button size="sm" onClick={() => void handleAddProgress()} disabled={pending}>
              {pending ? "提交中..." : "添加记录"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reopen Dialog */}
      <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>重新打开反馈</DialogTitle>
          <DialogDescription>
            重新将反馈置为处理中状态。需填写说明，作为公开进展同步给提交人。
          </DialogDescription>
          <div className="space-y-3 py-2 text-sm">
            <div>
              <label htmlFor="reopen-reason" className="text-xs font-medium text-muted-foreground">重新打开原因 *</label>
              <Textarea
                id="reopen-reason"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="说明为何重新打开（例如：问题在特定机型仍复现）..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setReopenDialogOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button size="sm" onClick={() => void handleReopen()} disabled={pending}>
              {pending ? "提交中..." : "确认重新打开"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
