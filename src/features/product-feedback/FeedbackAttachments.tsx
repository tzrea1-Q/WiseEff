import { useEffect, useState } from "react";
import { Download, ImageIcon, RefreshCw, Trash2, X, ZoomIn } from "lucide-react";
import type { ProductFeedbackAttachment } from "@/domain/productFeedback/types";
import { MAX_FEEDBACK_ATTACHMENT_COUNT, MAX_FEEDBACK_ATTACHMENT_BYTES, MAX_FEEDBACK_MESSAGE_ATTACHMENT_BYTES } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { presentError } from "@/infrastructure/http/presentError";
import "./feedback-user.css";

export const feedbackImageAccept = "image/png,image/jpeg,image/webp";
export const feedbackImageHint = "支持 PNG、JPG、WebP，每次提交或回复最多 5 张，单张不超过 5 MB，当次总计不超过 15 MB。";
export const feedbackAttachmentQuota = (count: number, bytes: number) => `${count} / ${MAX_FEEDBACK_ATTACHMENT_COUNT} 张 · ${(bytes / 1024 / 1024).toFixed(2)} / ${MAX_FEEDBACK_MESSAGE_ATTACHMENT_BYTES / 1024 / 1024} MB`;

export function acceptFeedbackFiles(files: File[], count: number, bytes: number) {
  const accepted: File[] = [];
  let error = "";
  for (const file of files) {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      error = "请上传 PNG、JPG 或 WebP 格式截图。";
    } else if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
      error = "单张截图不能超过 5 MB。";
    } else if (count + accepted.length >= MAX_FEEDBACK_ATTACHMENT_COUNT) {
      error = "最多可附加 5 张截图，请先移除已有截图后再粘贴。";
    } else if (bytes + file.size > MAX_FEEDBACK_MESSAGE_ATTACHMENT_BYTES) {
      error = "截图总大小不能超过 15 MB。";
    } else {
      accepted.push(file);
      bytes += file.size;
    }
  }
  return { accepted, error };
}

export function FeedbackAttachments({
  feedbackId,
  attachments,
  getAttachmentObjectUrl,
  onRemove,
  onDelete,
  disabled = false
}: {
  feedbackId: string;
  attachments: ProductFeedbackAttachment[];
  getAttachmentObjectUrl: (feedbackId: string, attachmentId: string) => Promise<string>;
  onRemove?: (attachmentId: string) => void;
  onDelete?: (attachmentId: string) => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <div className="feedback-attachments">
      {attachments.map((attachment) => (
        <Attachment key={attachment.id} feedbackId={feedbackId} attachment={attachment}
          getAttachmentObjectUrl={getAttachmentObjectUrl} onRemove={onRemove} onDelete={onDelete} disabled={disabled} />
      ))}
    </div>
  );
}

function Attachment({ feedbackId, attachment, getAttachmentObjectUrl, onRemove, onDelete, disabled }: {
  feedbackId: string;
  attachment: ProductFeedbackAttachment;
  getAttachmentObjectUrl: (feedbackId: string, attachmentId: string) => Promise<string>;
  onRemove?: (attachmentId: string) => void;
  onDelete?: (attachmentId: string) => Promise<void>;
  disabled: boolean;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const removeSubmitted = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true); setDeleteError("");
    try { await onDelete(attachment.id); setConfirmDelete(false); }
    catch (error) { setDeleteError(presentError(error, attachment.deletedAt ? "文件清理失败，截图已移除，请重试。" : "删除截图失败，请重试。")); }
    finally { setDeleting(false); }
  };
  useEffect(() => {
    if (attachment.deletedAt) { setUrl(""); setExpanded(false); return; }
    let active = true;
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    void getAttachmentObjectUrl(feedbackId, attachment.id).then((value) => {
      objectUrl = value;
      if (active) setUrl(value);
      else if (value.startsWith("blob:")) URL.revokeObjectURL(value);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [feedbackId, attachment.id, attachment.deletedAt, getAttachmentObjectUrl, attempt]);

  if (attachment.deletedAt) return <figure className="feedback-attachment feedback-attachment--deleted"><div className="feedback-attachment__placeholder" role="status"><Trash2 size={20} />截图已删除</div>
    {attachment.cleanupPending ? <figcaption>消息中的文件已移除，存储清理尚未完成。</figcaption> : <figcaption>原消息保留此删除标记。</figcaption>}
    {attachment.cleanupPending && attachment.canDelete && onDelete ? <Button type="button" variant="ghost" size="sm" disabled={deleting || disabled} onClick={() => void removeSubmitted()}>{deleting ? "正在清理…" : "重试文件清理"}</Button> : null}
    {deleteError && <p role="alert">{deleteError}</p>}</figure>;

  return (
    <figure className="feedback-attachment">
      {failed ? (
        <div className="feedback-attachment__placeholder" role="status">
          <span>截图加载失败</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={14} /> 重试
          </Button>
        </div>
      ) : url ? (
        <button type="button" className="feedback-attachment__image" onClick={() => setExpanded(true)}
          aria-label={`放大截图 ${attachment.fileName}`}>
          <img src={url} alt={attachment.fileName} onError={() => setFailed(true)} />
          <ZoomIn size={16} aria-hidden="true" />
        </button>
      ) : (
        <div className="feedback-attachment__placeholder" role="status"><ImageIcon size={20} /> 正在加载截图…</div>
      )}
      <figcaption title={attachment.fileName}>{attachment.fileName}</figcaption>
      <div className="feedback-attachment__actions">
        {url && !failed && <a href={url} download={attachment.fileName} className="feedback-download"><Download size={14} />下载</a>}
        {onRemove && <Button type="button" variant="ghost" size="sm" disabled={disabled}
          aria-label={`移除截图 ${attachment.fileName}`} onClick={() => onRemove(attachment.id)}><Trash2 size={14} />移除</Button>}
        {onDelete && attachment.canDelete && <Button type="button" variant="ghost" size="sm" disabled={disabled || deleting}
          aria-label={`删除已提交截图 ${attachment.fileName}`} onClick={() => { setDeleteError(""); setConfirmDelete(true); }}><Trash2 size={14} />删除</Button>}
      </div>
      <ModalDialog open={expanded} onDismiss={() => setExpanded(false)} className="feedback-attachment-preview-dialog" backdropClassName="feedback-preview-backdrop" describedBy>
        {({ titleId, descriptionId }) => <>
          <header className="feedback-attachment-preview-dialog-head">
            <div className="feedback-attachment-preview-dialog-head-text"><h2 id={titleId}>{attachment.fileName}</h2><p id={descriptionId}>原始截图，可下载保存后查看细节。</p></div>
            <Button type="button" variant="ghost" size="icon" aria-label="关闭截图预览" onClick={() => setExpanded(false)}><X size={18} /></Button>
          </header>
          <div className="feedback-attachment-preview-dialog-body"><img className="feedback-attachment-full" src={url} alt={attachment.fileName} />
            <a className="feedback-download" href={url} download={attachment.fileName}><Download size={14} />下载截图</a>
          </div>
        </>}
      </ModalDialog>
      <ConfirmDialog open={confirmDelete} title="删除这张已提交截图？" description={<><p>{attachment.fileName}</p><p>删除后不可恢复。原消息保留删除标记，其他截图和消息保持不变。</p>{deleteError && <p role="alert">{deleteError}</p>}</>}
        confirmLabel="确认删除截图" tone="danger" pendingLabel="正在删除…" pending={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void removeSubmitted()} />
    </figure>
  );
}
