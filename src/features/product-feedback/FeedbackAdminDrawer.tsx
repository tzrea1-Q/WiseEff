import { CheckCircle2, ImageIcon, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductFeedback, ProductFeedbackStatus } from "@/domain/productFeedback/types";
import { productFeedbackStatusLabels, productFeedbackTypeLabels } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

export type FeedbackAdminDrawerProps = {
  feedback: ProductFeedback | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: { status?: ProductFeedbackStatus; adminNote?: string | null }) => Promise<ProductFeedback>;
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
  if (status === "in_progress") return { label: "关闭", status: "closed" as const, icon: CheckCircle2 };
  return null;
}

export function FeedbackAdminDrawer({
  feedback,
  open,
  onClose,
  onUpdate,
  getAttachmentObjectUrl
}: FeedbackAdminDrawerProps) {
  const [adminNote, setAdminNote] = useState("");
  const [previews, setPreviews] = useState<AttachmentPreview[]>([]);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setAdminNote(feedback?.adminNote ?? "");
    setErrorMessage("");
  }, [feedback?.id, feedback?.adminNote]);

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
      await onUpdate(feedback.id, {
        status: action.status,
        adminNote: adminNote.trim() || null
      });
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message ? error.message : "反馈状态更新失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="gap-1 border-b border-border p-4">
          <span className="text-xs font-medium text-primary">{productFeedbackStatusLabels[feedback.status]}</span>
          <SheetTitle className="truncate text-base">{feedback.pageTitle}</SheetTitle>
          <SheetDescription className="text-xs">
            {productFeedbackTypeLabels[feedback.feedbackType]} · {feedback.pagePath} · {formatDateTime(feedback.createdAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">问题描述</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{feedback.description}</p>
          </section>

          <section className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">页面路径</span>
              <p className="mt-1 font-mono text-foreground">{feedback.pagePath}</p>
            </div>
            <div>
              <span className="text-muted-foreground">更新时间</span>
              <p className="mt-1 text-foreground">{formatDateTime(feedback.updatedAt)}</p>
            </div>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">截图附件（{feedback.attachments.length}）</h4>
            {feedback.attachments.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">未附加截图。</p>
            ) : previews.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {previews.map((preview) => (
                  <figure key={preview.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <img src={preview.objectUrl} alt={`反馈截图 ${preview.fileName}`} className="h-32 w-full object-cover" />
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
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭面板
          </Button>
          {action && ActionIcon ? (
            <Button size="sm" onClick={handleStatusAction} disabled={pending} aria-busy={pending || undefined}>
              <ActionIcon data-icon="inline-start" />
              {pending ? "处理中..." : action.label}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
