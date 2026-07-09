import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from "react";
import { CircleX, Trash2, Upload } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedbackType } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
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

const MAX_FEEDBACK_IMAGES = 5;

type FeedbackTypeLabel = "体验问题" | "数据问题" | "导出/提交异常" | "功能建议";

const feedbackTypeOptions: Array<{ value: FeedbackTypeLabel; label: FeedbackTypeLabel; apiValue: ProductFeedbackType }> = [
  { value: "体验问题", label: "体验问题", apiValue: "experience" },
  { value: "数据问题", label: "数据问题", apiValue: "data" },
  { value: "导出/提交异常", label: "导出/提交异常", apiValue: "export_submit" },
  { value: "功能建议", label: "功能建议", apiValue: "feature" }
];

const feedbackTypeByLabel = new Map(feedbackTypeOptions.map((option) => [option.value, option.apiValue]));

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
  const [description, setDescription] = useState("");
  const [feedbackType, setFeedbackType] = useState<FeedbackTypeLabel>("体验问题");
  const [images, setImages] = useState<PastedFeedbackImage[]>([]);
  const [captureStatus, setCaptureStatus] = useState<"idle" | "ready" | "invalid" | "full">("idle");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting">("idle");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const imageIdCounterRef = useRef(0);
  const imagesRef = useRef<PastedFeedbackImage[]>([]);
  const trimmedDescription = description.trim();
  const isSubmitting = submitStatus === "submitting";
  const submitDisabled = !trimmedDescription || isSubmitting;

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
    }
  }, [open]);

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
      const availableSlots = MAX_FEEDBACK_IMAGES - currentImages.length;
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
      setCaptureStatus(nextImages.length === 0 ? "idle" : "ready");
      return nextImages;
    });
  };

  const clearImages = () => {
    revokeImages(imagesRef.current);
    setImages([]);
    setCaptureStatus("idle");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) {
      return;
    }

    setSubmitStatus("submitting");
    setErrorMessage("");
    setSuccessMessage("");
    const files = images.map((image) => image.file);

    try {
      await productFeedbackRepository.submit({
        pagePath,
        pageTitle,
        feedbackType: feedbackTypeByLabel.get(feedbackType) ?? "experience",
        description: trimmedDescription,
        files
      });
      setDescription("");
      setSuccessMessage(files.length > 0 ? `反馈已记录，并附带 ${files.length} 张粘贴截图。` : "反馈已记录，内测团队会结合页面路径和问题类型跟进。");
      clearImages();
    } catch (error) {
      setErrorMessage(readableSubmitError(error));
    } finally {
      setSubmitStatus("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="feedback-dialog" showCloseButton={false}>
        <form onSubmit={handleSubmit}>
          <DialogHeader className="feedback-dialog-header">
            <div>
              <span className="eyebrow">Internal Beta Feedback</span>
              <DialogTitle>问题反馈</DialogTitle>
              <DialogDescription>反馈会携带页面路径、类型、描述和可选截图，方便内测团队定位问题。</DialogDescription>
            </div>
            <button type="button" className="audit-dialog-close-icon" aria-label="关闭" onClick={() => onOpenChange(false)}>
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </DialogHeader>
          <div className="feedback-context">
            <div>
              <span>当前页面</span>
              <strong>{pageTitle}</strong>
            </div>
            <code>{pagePath}</code>
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
              <div className={images.length > 0 ? "feedback-screenshot-preview has-image" : "feedback-screenshot-preview"}>
                {images.length > 0 ? (
                  <div className="feedback-thumbnail-grid" aria-label="已粘贴截图">
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
              {captureStatus === "ready" ? <p className="feedback-capture-status success">截图已粘贴，可随反馈一起提交。</p> : null}
              {captureStatus === "invalid" ? <p className="feedback-capture-status">请粘贴 PNG、JPG 或 WebP 格式截图。</p> : null}
              {captureStatus === "full" ? <p className="feedback-capture-status">最多可附加 5 张截图，请先移除已有截图后再粘贴。</p> : null}
            </section>
          </div>
          {successMessage ? (
            <p className="feedback-success">
              {imageCountAtLastSuccess === 1 ? "反馈已记录，并附带 1 张粘贴截图。" : successMessage}
            </p>
          ) : null}
          {errorMessage ? <p className="feedback-error">{errorMessage}</p> : null}
          <DialogFooter className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {isSubmitting ? "提交中..." : "提交反馈"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "反馈提交失败，请稍后重试。";
}
