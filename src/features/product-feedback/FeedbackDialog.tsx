import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from "react";
import { CircleX, Save, Trash2, Upload } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type {
  ProductFeedback,
  ProductFeedbackAttachment,
  ProductFeedbackType
} from "@/domain/productFeedback/types";
import { presentError } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MyFeedbackView } from "./MyFeedbackView";

const MAX_FEEDBACK_IMAGES = 5;

type FeedbackTypeLabel = "体验问题" | "数据问题" | "导出/提交异常" | "功能建议";

const feedbackTypeOptions: Array<{ value: FeedbackTypeLabel; label: FeedbackTypeLabel; apiValue: ProductFeedbackType }> = [
  { value: "体验问题", label: "体验问题", apiValue: "experience" },
  { value: "数据问题", label: "数据问题", apiValue: "data" },
  { value: "导出/提交异常", label: "导出/提交异常", apiValue: "export_submit" },
  { value: "功能建议", label: "功能建议", apiValue: "feature" }
];

const feedbackTypeByLabel = new Map(feedbackTypeOptions.map((option) => [option.value, option.apiValue]));
const feedbackLabelByType = new Map(feedbackTypeOptions.map((option) => [option.apiValue, option.value]));

type PastedFeedbackImage = {
  id: string;
  file: File;
  objectUrl: string;
};

type SelectOption<Value extends string = string> = {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
};

export function FeedbackDialog({
  open,
  pagePath,
  pageTitle,
  productFeedbackRepository,
  onOpenChange
}: {
  open: boolean;
  pagePath: string;
  pageTitle: string;
  productFeedbackRepository: ProductFeedbackRepository;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<"compose" | "mine">("compose");
  const [myFeedbackCount, setMyFeedbackCount] = useState(0);

  // Composer form state
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [feedbackType, setFeedbackType] = useState<FeedbackTypeLabel>("体验问题");
  const [images, setImages] = useState<PastedFeedbackImage[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<ProductFeedbackAttachment[]>([]);
  const [existingAttachmentUrls, setExistingAttachmentUrls] = useState<Record<string, string>>({});
  const [captureStatus, setCaptureStatus] = useState<"idle" | "ready" | "invalid" | "full">("idle");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "saving_draft">("idle");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const imageIdCounterRef = useRef(0);
  const imagesRef = useRef<PastedFeedbackImage[]>([]);
  const trimmedDescription = description.trim();
  const isSubmitting = submitStatus === "submitting";
  const isSavingDraft = submitStatus === "saving_draft";
  const submitDisabled = !trimmedDescription || isSubmitting || isSavingDraft;
  const totalImageCount = existingAttachments.length + images.length;
  const isDirty = Boolean(trimmedDescription) || images.length > 0;

  const requestClose = () => {
    if (isSubmitting || isSavingDraft) {
      return;
    }
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const confirmDiscard = () => {
    setDiscardConfirmOpen(false);
    resetComposer();
    onOpenChange(false);
  };

  const resetComposer = () => {
    setActiveDraftId(null);
    setDraftSavedAt(null);
    setDescription("");
    setFeedbackType("体验问题");
    setExistingAttachments([]);
    setExistingAttachmentUrls({});
    clearImages();
    setSuccessMessage("");
    setErrorMessage("");
  };

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      revokeImages(imagesRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setSuccessMessage("");
      setErrorMessage("");
      setSubmitStatus("idle");
      setActiveTab("compose");
    }
  }, [open]);

  // Load object URLs for retained draft attachments
  useEffect(() => {
    if (existingAttachments.length === 0) {
      setExistingAttachmentUrls({});
      return;
    }
    const getUrl =
      productFeedbackRepository.getMineAttachmentObjectUrl ??
      productFeedbackRepository.getAttachmentObjectUrl;

    let active = true;
    Promise.all(
      existingAttachments.map(async (att) => {
        try {
          const url = await getUrl(activeDraftId ?? "", att.id);
          return [att.id, url] as const;
        } catch {
          return [att.id, ""] as const;
        }
      })
    ).then((pairs) => {
      if (active) {
        setExistingAttachmentUrls(Object.fromEntries(pairs));
      }
    });

    return () => {
      active = false;
    };
  }, [existingAttachments, activeDraftId, productFeedbackRepository]);

  const imageCountAtLastSuccess = useMemo(() => {
    const match = successMessage.match(/附带 (\d+) 张/);
    return match ? Number(match[1]) : 0;
  }, [successMessage]);

  const clearTransientMessages = () => {
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleScreenshotPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const pastedImages = getPastedImages(event.clipboardData);
    if (pastedImages.length === 0) {
      setCaptureStatus("invalid");
      return;
    }

    event.preventDefault();
    clearTransientMessages();
    setImages((currentImages) => {
      const availableSlots = MAX_FEEDBACK_IMAGES - (existingAttachments.length + currentImages.length);
      if (availableSlots <= 0) {
        setCaptureStatus("full");
        return currentImages;
      }

      const acceptedFiles = pastedImages.slice(0, availableSlots);
      const nextImages = acceptedFiles.map((file) => {
        imageIdCounterRef.current += 1;
        return {
          id: `feedback-image-${imageIdCounterRef.current}`,
          file,
          objectUrl: URL.createObjectURL(file)
        };
      });
      setCaptureStatus(pastedImages.length > availableSlots ? "full" : "ready");
      return [...currentImages, ...nextImages];
    });
  };

  const removeScreenshot = (imageId: string) => {
    clearTransientMessages();
    setImages((currentImages) => {
      const removedImage = currentImages.find((image) => image.id === imageId);
      if (removedImage) {
        URL.revokeObjectURL(removedImage.objectUrl);
      }
      const nextImages = currentImages.filter((image) => image.id !== imageId);
      setCaptureStatus(nextImages.length === 0 && existingAttachments.length === 0 ? "idle" : "ready");
      return nextImages;
    });
  };

  const removeExistingAttachment = (attachmentId: string) => {
    clearTransientMessages();
    setExistingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const clearImages = () => {
    revokeImages(imagesRef.current);
    setImages([]);
    setCaptureStatus("idle");
  };

  const handleEditDraft = (draft: ProductFeedback) => {
    setActiveDraftId(draft.id);
    setDescription(draft.description || "");
    setFeedbackType(
      feedbackLabelByType.get(draft.feedbackType) ?? "体验问题"
    );
    setExistingAttachments(draft.attachments ?? []);
    clearImages();
    setDraftSavedAt(draft.updatedAt);
    setActiveTab("compose");
  };

  const handleSaveDraft = async () => {
    if (!productFeedbackRepository.saveDraft && !productFeedbackRepository.createDraft) {
      return;
    }
    setSubmitStatus("saving_draft");
    clearTransientMessages();

    try {
      const apiType = feedbackTypeByLabel.get(feedbackType) ?? "experience";
      const newFiles = images.map((i) => i.file);

      if (activeDraftId && productFeedbackRepository.saveDraft) {
        const updated = await productFeedbackRepository.saveDraft(activeDraftId, {
          pagePath,
          pageTitle,
          feedbackType: apiType,
          description: trimmedDescription,
          retainedAttachmentIds: existingAttachments.map((a) => a.id),
          newFiles
        });
        setExistingAttachments(updated.attachments ?? []);
        clearImages();
        setDraftSavedAt(new Date().toISOString());
        setSuccessMessage("草稿已保存。");
      } else if (productFeedbackRepository.createDraft) {
        const created = await productFeedbackRepository.createDraft({
          pagePath,
          pageTitle,
          feedbackType: apiType,
          description: trimmedDescription,
          files: newFiles
        });
        setActiveDraftId(created.id);
        setExistingAttachments(created.attachments ?? []);
        clearImages();
        setDraftSavedAt(new Date().toISOString());
        setSuccessMessage("草稿已创建并保存。");
      }
    } catch (error) {
      setErrorMessage(presentError(error, "保存草稿失败，请稍后重试。"));
    } finally {
      setSubmitStatus("idle");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) {
      return;
    }

    setSubmitStatus("submitting");
    clearTransientMessages();
    const files = images.map((image) => image.file);
    const apiType = feedbackTypeByLabel.get(feedbackType) ?? "experience";

    try {
      if (activeDraftId && productFeedbackRepository.submitDraft) {
        // If there were modifications to draft attachments before submit, save draft first
        if (files.length > 0 || existingAttachments.length > 0) {
          if (productFeedbackRepository.saveDraft) {
            await productFeedbackRepository.saveDraft(activeDraftId, {
              pagePath,
              pageTitle,
              feedbackType: apiType,
              description: trimmedDescription,
              retainedAttachmentIds: existingAttachments.map((a) => a.id),
              newFiles: files
            });
          }
        }
        await productFeedbackRepository.submitDraft(activeDraftId, {
          pagePath,
          pageTitle,
          feedbackType: apiType,
          description: trimmedDescription
        });
      } else {
        await productFeedbackRepository.submit({
          pagePath,
          pageTitle,
          feedbackType: apiType,
          description: trimmedDescription,
          files
        });
      }
      const totalSent = existingAttachments.length + files.length;
      resetComposer();
      setSuccessMessage(
        totalSent > 0
          ? `反馈已记录，并附带 ${totalSent} 张粘贴截图。`
          : "反馈已记录，内测团队会结合页面路径和问题类型跟进。"
      );
    } catch (error) {
      setErrorMessage(readableSubmitError(error));
    } finally {
      setSubmitStatus("idle");
    }
  };

  const hasDraftSupport = Boolean(productFeedbackRepository.createDraft || productFeedbackRepository.saveDraft);
  const hasMineSupport = Boolean(productFeedbackRepository.listMine);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        requestClose();
      }}
    >
      <DialogContent className="feedback-dialog" showCloseButton={false}>
        <DialogHeader className="feedback-dialog-header">
          <div>
            <span className="eyebrow">内测反馈</span>
            <DialogTitle>问题反馈</DialogTitle>
            <DialogDescription>
              {activeTab === "compose"
                ? "反馈会携带页面路径、类型、描述和可选截图，方便内测团队定位问题。"
                : "查看您提交的历史反馈记录、处理状态与最新处理进展。"}
            </DialogDescription>
          </div>
          <button type="button" className="audit-dialog-close-icon" aria-label="关闭" onClick={requestClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </DialogHeader>

        {hasMineSupport && (
          <div className="flex border-b border-border px-6 pt-1 gap-4 text-xs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "compose"}
              onClick={() => {
                clearTransientMessages();
                setActiveTab("compose");
              }}
              className={cn(
                "pb-2 font-medium transition-colors border-b-2 -mb-px",
                activeTab === "compose"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              提交反馈{activeDraftId ? " (编辑草稿)" : ""}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "mine"}
              onClick={() => {
                clearTransientMessages();
                setActiveTab("mine");
              }}
              className={cn(
                "pb-2 font-medium transition-colors border-b-2 -mb-px",
                activeTab === "mine"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              我的反馈{myFeedbackCount > 0 ? ` (${myFeedbackCount})` : ""}
            </button>
          </div>
        )}

        {activeTab === "mine" ? (
          <MyFeedbackView
            productFeedbackRepository={productFeedbackRepository}
            onEditDraft={handleEditDraft}
            onFeedbackCountChange={setMyFeedbackCount}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="feedback-context">
              <div>
                <span>当前页面</span>
                <strong>{pageTitle}</strong>
              </div>
              <code>{pagePath}</code>
              {draftSavedAt && (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  草稿已保存
                </span>
              )}
            </div>
            <div className="feedback-layout">
              <section className="feedback-section" aria-labelledby="feedback-info-title">
                <div className="feedback-section-title">
                  <span id="feedback-info-title">问题信息</span>
                  <small>必填</small>
                </div>
                <Label htmlFor="feedback-type">反馈类型</Label>
                <SelectControl
                  id="feedback-type"
                  ariaLabel="反馈类型"
                  value={feedbackType}
                  onValueChange={setFeedbackType}
                  options={feedbackTypeOptions.map(({ value, label }) => ({ value, label }))}
                />
                <Label htmlFor="feedback-description">问题描述</Label>
                <Textarea
                  id="feedback-description"
                  value={description}
                  onChange={(event) => {
                    clearTransientMessages();
                    setDescription(event.target.value);
                  }}
                  rows={6}
                  placeholder="描述复现步骤、期望结果或你看到的异常现象"
                />
              </section>
              <section
                className="feedback-section feedback-capture-panel"
                aria-labelledby="feedback-capture-title"
                onPaste={handleScreenshotPaste}
                tabIndex={0}
              >
                <div className="feedback-section-title">
                  <span id="feedback-capture-title">粘贴上传截图</span>
                  <small>可选</small>
                </div>
                <div
                  className={
                    totalImageCount > 0
                      ? "feedback-screenshot-preview has-image"
                      : "feedback-screenshot-preview"
                  }
                >
                  {totalImageCount > 0 ? (
                    <div className="feedback-thumbnail-grid" aria-label="已粘贴截图">
                      {existingAttachments.map((att) => {
                        const url = existingAttachmentUrls[att.id];
                        return (
                          <figure key={att.id} className="feedback-thumbnail">
                            {url ? (
                              <img src={url} alt="草稿截图预览" />
                            ) : (
                              <div className="flex h-20 items-center justify-center bg-muted/40">
                                <Upload size={20} className="text-muted-foreground" />
                              </div>
                            )}
                            <figcaption>{att.fileName}</figcaption>
                            <Button
                              aria-label={`移除截图 ${att.fileName}`}
                              className="feedback-remove-shot"
                              type="button"
                              variant="outline"
                              onClick={() => removeExistingAttachment(att.id)}
                            >
                              <Trash2 size={16} />
                              移除
                            </Button>
                          </figure>
                        );
                      })}
                      {images.map((image) => (
                        <figure key={image.id} className="feedback-thumbnail">
                          <img src={image.objectUrl} alt="问题反馈截图预览" />
                          <figcaption>{image.file.name}</figcaption>
                          <Button
                            aria-label={`移除截图 ${image.file.name}`}
                            className="feedback-remove-shot"
                            type="button"
                            variant="outline"
                            onClick={() => removeScreenshot(image.id)}
                          >
                            <Trash2 size={16} />
                            移除
                          </Button>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <Upload size={28} />
                      <strong>粘贴截图</strong>
                      <span>复制截图后点击此区域，按 Ctrl/⌘ + V 粘贴，支持 PNG、JPG、WebP。</span>
                    </div>
                  )}
                </div>
                {captureStatus === "ready" ? (
                  <p className="feedback-capture-status success">截图已粘贴，可随反馈一起提交。</p>
                ) : null}
                {captureStatus === "invalid" ? (
                  <p className="feedback-capture-status">请粘贴 PNG、JPG 或 WebP 格式截图。</p>
                ) : null}
                {captureStatus === "full" ? (
                  <p className="feedback-capture-status">最多可附加 5 张截图，请先移除已有截图后再粘贴。</p>
                ) : null}
              </section>
            </div>
            {successMessage ? (
              <div className="flex items-center justify-between feedback-success">
                <p>
                  {imageCountAtLastSuccess === 1
                    ? "反馈已记录，并附带 1 张粘贴截图。"
                    : successMessage}
                </p>
                {hasMineSupport && (
                  <button
                    type="button"
                    className="ml-2 text-xs font-medium text-primary underline hover:opacity-80"
                    onClick={() => setActiveTab("mine")}
                  >
                    查看我的反馈
                  </button>
                )}
              </div>
            ) : null}
            {errorMessage ? <p className="feedback-error">{errorMessage}</p> : null}
            <DialogFooter className="dialog-actions">
              <Button type="button" variant="outline" onClick={requestClose}>
                关闭
              </Button>
              {hasDraftSupport && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSaveDraft()}
                  disabled={isSavingDraft || isSubmitting || (!trimmedDescription && totalImageCount === 0)}
                >
                  <Save size={14} className="mr-1" />
                  {isSavingDraft ? "保存中..." : "保存草稿"}
                </Button>
              )}
              <Button type="submit" disabled={submitDisabled}>
                {isSubmitting ? "提交中..." : "提交反馈"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
      <ConfirmDialog
        open={discardConfirmOpen}
        title="放弃当前反馈？"
        description={
          <p>
            尚未提交的反馈将丢失
            {images.length > 0 ? `（含 ${images.length} 张已粘贴截图）` : ""}。确认放弃，还是留在此处继续填写？
          </p>
        }
        confirmLabel="放弃反馈"
        cancelLabel="继续填写"
        tone="danger"
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={confirmDiscard}
      />
    </Dialog>
  );
}

function SelectControl<Value extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  id,
  className,
  placeholder,
  disabled
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: SelectOption<Value>[];
  ariaLabel?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as Value)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className} data-value={value}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getPastedImages(clipboardData: DataTransfer) {
  const files = Array.from(clipboardData.files ?? []).filter(isSupportedScreenshotImage);
  if (files.length > 0) {
    return files;
  }

  return Array.from(clipboardData.items ?? [])
    .filter((clipboardItem) => clipboardItem.kind === "file" && isSupportedScreenshotMimeType(clipboardItem.type))
    .map((clipboardItem) => clipboardItem.getAsFile())
    .filter((file): file is File => file !== null);
}

function isSupportedScreenshotImage(file: File) {
  return isSupportedScreenshotMimeType(file.type);
}

function isSupportedScreenshotMimeType(type: string) {
  return /^image\/(png|jpe?g|webp)$/i.test(type);
}

function revokeImages(images: PastedFeedbackImage[]) {
  for (const image of images) {
    URL.revokeObjectURL(image.objectUrl);
  }
}

function readableSubmitError(error: unknown) {
  return presentError(error, "反馈提交失败，请稍后重试。");
}
