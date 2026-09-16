import { useEffect, useState } from "react";
import { ArrowLeft, Edit3, ImageIcon, RefreshCw, Trash2 } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { productFeedbackTypeLabels } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { presentError } from "@/infrastructure/http/presentError";
import { FeedbackProgressTimeline } from "./FeedbackProgressTimeline";
import { FeedbackStatusBadge, getFeedbackDisplayStatus } from "./FeedbackStatusBadge";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function MyFeedbackView({
  productFeedbackRepository,
  onEditDraft,
  onFeedbackCountChange
}: {
  productFeedbackRepository: ProductFeedbackRepository;
  onEditDraft: (draft: ProductFeedback) => void;
  onFeedbackCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ProductFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState<ProductFeedback | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductFeedback | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  const loadMyFeedback = async () => {
    if (!productFeedbackRepository.listMine) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const res = await productFeedbackRepository.listMine();
      setItems(res.items);
      onFeedbackCountChange?.(res.items.length);
    } catch (err) {
      setErrorMessage(presentError(err, "加载我的反馈失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMyFeedback();
  }, [productFeedbackRepository]);

  // Load attachments when detail is opened
  useEffect(() => {
    if (!selectedFeedback || selectedFeedback.attachments.length === 0) {
      setAttachmentUrls({});
      return;
    }
    const getUrl =
      productFeedbackRepository.getMineAttachmentObjectUrl ??
      productFeedbackRepository.getAttachmentObjectUrl;

    let active = true;
    Promise.all(
      selectedFeedback.attachments.map(async (att) => {
        try {
          const url = await getUrl(selectedFeedback.id, att.id);
          return [att.id, url] as const;
        } catch {
          return [att.id, ""] as const;
        }
      })
    ).then((pairs) => {
      if (active) {
        setAttachmentUrls(Object.fromEntries(pairs));
      }
    });

    return () => {
      active = false;
    };
  }, [selectedFeedback, productFeedbackRepository]);

  const handleDeleteDraft = async () => {
    if (!deleteTarget || !productFeedbackRepository.deleteDraft) return;
    setDeleting(true);
    try {
      await productFeedbackRepository.deleteDraft(deleteTarget.id);
      setItems((prev) => prev.filter((it) => it.id !== deleteTarget.id));
      if (selectedFeedback?.id === deleteTarget.id) {
        setSelectedFeedback(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      setErrorMessage(presentError(err, "删除草稿失败，请稍后重试。"));
    } finally {
      setDeleting(false);
    }
  };

  if (selectedFeedback) {
    const isDraft = getFeedbackDisplayStatus(selectedFeedback) === "draft";
    return (
      <div className="flex flex-col gap-3 p-4 overflow-y-auto max-h-[70vh]">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 pl-1 text-xs"
            onClick={() => setSelectedFeedback(null)}
          >
            <ArrowLeft size={16} />
            返回反馈列表
          </Button>
          {isDraft && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onEditDraft(selectedFeedback)}
              >
                <Edit3 size={14} />
                继续编辑
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-destructive gap-1 hover:bg-destructive/10"
                onClick={() => setDeleteTarget(selectedFeedback)}
              >
                <Trash2 size={14} />
                删除草稿
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FeedbackStatusBadge
              status={getFeedbackDisplayStatus(selectedFeedback)}
              resolutionCode={selectedFeedback.resolutionCode}
            />
            <span className="text-xs text-muted-foreground">
              {productFeedbackTypeLabels[selectedFeedback.feedbackType]}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{selectedFeedback.pageTitle}</h3>
          <p className="font-mono text-xs text-muted-foreground">{selectedFeedback.pagePath}</p>
          <p className="text-[11px] text-muted-foreground">
            {isDraft ? "更新于 " : "提交于 "}
            {formatDateTime(selectedFeedback.submittedAt ?? selectedFeedback.updatedAt)}
          </p>
        </div>

        <section className="space-y-1 rounded-lg bg-muted/30 p-3">
          <h4 className="text-xs font-semibold text-muted-foreground">反馈描述</h4>
          <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">
            {selectedFeedback.description || "（无文字描述）"}
          </p>
        </section>

        {selectedFeedback.attachments.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground">
              截图附件（{selectedFeedback.attachments.length}）
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {selectedFeedback.attachments.map((att) => {
                const url = attachmentUrls[att.id];
                return (
                  <figure key={att.id} className="overflow-hidden rounded-md border border-border bg-card">
                    {url ? (
                      <img src={url} alt={att.fileName} className="h-24 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 items-center justify-center bg-muted/40 text-muted-foreground">
                        <ImageIcon size={20} />
                      </div>
                    )}
                    <figcaption className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                      {att.fileName}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        {!isDraft && (
          <section className="space-y-1 pt-1">
            <h4 className="text-xs font-semibold text-muted-foreground">处理进展时间轴</h4>
            <FeedbackProgressTimeline events={selectedFeedback.progressEvents} isAdmin={false} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto max-h-[70vh]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground">
          我的反馈记录 {items.length > 0 ? `(${items.length})` : ""}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => void loadMyFeedback()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          刷新
        </Button>
      </div>

      {errorMessage && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{errorMessage}</p>
      )}

      {loading ? (
        <p className="p-6 text-center text-xs text-muted-foreground">正在加载反馈记录...</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-xs text-muted-foreground">暂无提交记录或草稿</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isDraft = getFeedbackDisplayStatus(item) === "draft";
            return (
              <div
                key={item.id}
                className="group relative rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50 cursor-pointer"
                onClick={() => setSelectedFeedback(item)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FeedbackStatusBadge
                      status={getFeedbackDisplayStatus(item)}
                      resolutionCode={item.resolutionCode}
                    />
                    <span className="text-xs text-muted-foreground">
                      {productFeedbackTypeLabels[item.feedbackType]}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateTime(item.submittedAt ?? item.updatedAt)}
                  </span>
                </div>

                <div className="mt-1.5 space-y-1">
                  <p className="text-xs font-medium text-foreground">{item.pageTitle}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.description || "（无文字描述）"}
                  </p>
                </div>

                {item.latestPublicProgress && !isDraft && (
                  <div className="mt-2 rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground mr-1">最新进展:</span>
                    {item.latestPublicProgress}
                  </div>
                )}

                {isDraft && (
                  <div
                    className="mt-2 flex items-center justify-end gap-2 border-t border-border/40 pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={() => onEditDraft(item)}
                    >
                      <Edit3 size={12} />
                      继续编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10 gap-1"
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 size={12} />
                      删除
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除草稿？"
        description={<p>删除后该草稿将无法恢复。确认删除？</p>}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        pending={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteDraft()}
      />
    </div>
  );
}
