import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { CircleX, Download, Paperclip, Save, Trash2 } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import type { ProductFeedback, ProductFeedbackAttachment, ProductFeedbackType } from "@/domain/productFeedback/types";
import { presentError } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Label } from "@/components/ui/label";
import { SelectControl } from "@/components/common/SelectControl";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { MyFeedbackView } from "./MyFeedbackView";
import { acceptFeedbackFiles, FeedbackAttachments, feedbackImageAccept, feedbackImageHint } from "./FeedbackAttachments";
import "./feedback-user.css";

const feedbackTypeOptions = [
  { value: "experience", label: "体验问题" },
  { value: "data", label: "数据问题" },
  { value: "export_submit", label: "导出/提交异常" },
  { value: "feature", label: "功能建议" }
];
type LocalImage = { id: string; file: File; objectUrl: string };
const signature = (description: string, type: ProductFeedbackType, attachments: ProductFeedbackAttachment[], images: LocalImage[]) =>
  JSON.stringify([description, type, attachments.map((item) => item.id), images.map((item) => item.id)]);
const emptySignature = signature("", "experience", [], []);

export function FeedbackDialog({ open, pagePath, pageTitle, productFeedbackRepository, onOpenChange, initialDraft }: {
  open: boolean;
  pagePath: string;
  pageTitle: string;
  productFeedbackRepository: ProductFeedbackRepository;
  onOpenChange: (open: boolean) => void;
  initialDraft?: ProductFeedback | null;
}) {
  const tabId = useId();
  const fileInputId = useId();
  const [activeTab, setActiveTab] = useState("compose");
  const [myFeedbackCount, setMyFeedbackCount] = useState(0);
  const [mineVisited, setMineVisited] = useState(false);
  const [mineState, setMineState] = useState({ dirty: false, pending: false });
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [source, setSource] = useState({ pagePath, pageTitle });
  const [savedBaseline, setSavedBaseline] = useState(emptySignature);
  const [description, setDescription] = useState("");
  const [feedbackType, setFeedbackType] = useState<ProductFeedbackType>("experience");
  const [images, setImages] = useState<LocalImage[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<ProductFeedbackAttachment[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "saving_draft">("idle");
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ProductFeedback | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<LocalImage | null>(null);
  const imagesRef = useRef<LocalImage[]>([]);
  const imageCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedInitialDraft = useRef<string | null>(null);
  const navigationConfirmed = useRef(false);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const busy = submitStatus !== "idle";
  const anyPending = busy || mineState.pending;
  const trimmedDescription = description.trim();
  const isDirty = signature(description, feedbackType, existingAttachments, images) !== savedBaseline;
  const hasMineSupport = Boolean(productFeedbackRepository.listMine);
  const hasDraftSupport = activeDraftId ? Boolean(productFeedbackRepository.saveDraft) : Boolean(productFeedbackRepository.createDraft);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => () => { imagesRef.current.forEach((image) => URL.revokeObjectURL(image.objectUrl)); }, []);
  useEffect(() => {
    if (!open || (!isDirty && !mineState.dirty && !anyPending)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!navigationConfirmed.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    const guardLeave = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (anyPending) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setPendingDraft(null); setPendingNavigation(null); setDiscardConfirmOpen(true);
    };
    window.addEventListener("wiseeff:settings-before-leave", guardLeave);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      window.removeEventListener("wiseeff:settings-before-leave", guardLeave);
      leaveDecision.current?.resolve(false); leaveDecision.current = null;
    };
  }, [open, isDirty, mineState.dirty, anyPending]);
  useEffect(() => {
    if (open && !activeDraftId && !isDirty) setSource({ pagePath, pageTitle });
  }, [open, pagePath, pageTitle, activeDraftId, isDirty]);
  useEffect(() => {
    if (open && initialDraft && loadedInitialDraft.current !== initialDraft.id) {
      loadedInitialDraft.current = initialDraft.id;
      loadDraft(initialDraft);
    }
    if (!open) loadedInitialDraft.current = null;
  }, [open, initialDraft]);

  const clearImages = () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.objectUrl));
    imagesRef.current = [];
    setImages([]);
  };
  const clearMessages = () => { setSuccessMessage(""); setErrorMessage(""); };
  function loadDraft(draft: ProductFeedback) {
    clearImages();
    setActiveDraftId(draft.id);
    setSource({ pagePath: draft.pagePath, pageTitle: draft.pageTitle });
    setDescription(draft.description || "");
    setFeedbackType(draft.feedbackType);
    setExistingAttachments(draft.attachments ?? []);
    setSavedBaseline(signature(draft.description || "", draft.feedbackType, draft.attachments ?? [], []));
    setActiveTab("compose");
    clearMessages();
  }
  const resetComposer = () => {
    setLocalPreview(null);
    clearImages();
    setActiveDraftId(null);
    setSource({ pagePath, pageTitle });
    setDescription("");
    setFeedbackType("experience");
    setExistingAttachments([]);
    setSavedBaseline(emptySignature);
    setActiveTab("compose");
    clearMessages();
  };
  const requestClose = () => {
    if (anyPending) return;
    if (isDirty || mineState.dirty) { setPendingDraft(null); setPendingNavigation(null); setDiscardConfirmOpen(true); return; }
    resetComposer();
    onOpenChange(false);
  };
  const handleEditDraft = (draft: ProductFeedback) => {
    if (busy) return;
    if (draft.id === activeDraftId) { setActiveTab("compose"); return; }
    if (isDirty) { setPendingDraft(draft); setPendingNavigation(null); setDiscardConfirmOpen(true); return; }
    loadDraft(draft);
  };
  const addFiles = (files: File[]) => {
    if (busy || files.length === 0) return;
    const result = acceptFeedbackFiles(files, existingAttachments.length + images.length,
      existingAttachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0) + images.reduce((sum, image) => sum + image.file.size, 0));
    setSuccessMessage("");
    setErrorMessage(result.error);
    const next = result.accepted.map((file) => ({ id: `feedback-image-${++imageCounter.current}`, file, objectUrl: URL.createObjectURL(file) }));
    const updated = [...images, ...next];
    imagesRef.current = updated;
    setImages(updated);
  };
  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (activeTab !== "compose") return;
    const files = Array.from(event.clipboardData.files ?? []);
    const pasted = files.length ? files : Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (pasted.length) { event.preventDefault(); addFiles(pasted); }
  };
  const saveCurrentDraft = async () => {
    if (activeDraftId && productFeedbackRepository.saveDraft) {
      return productFeedbackRepository.saveDraft(activeDraftId, {
        ...source, feedbackType, description: trimmedDescription,
        retainedAttachmentIds: existingAttachments.map((attachment) => attachment.id), newFiles: images.map((image) => image.file)
      });
    }
    if (!activeDraftId && productFeedbackRepository.createDraft) {
      return productFeedbackRepository.createDraft({ ...source, feedbackType, description: trimmedDescription, files: images.map((image) => image.file) });
    }
    return null;
  };
  const handleSaveDraft = async () => {
    if (busy) return;
    setSubmitStatus("saving_draft");
    clearMessages();
    try {
      const created = !activeDraftId;
      const saved = await saveCurrentDraft();
      if (saved) { loadDraft(saved); setSuccessMessage(created ? "草稿已创建并保存。" : "草稿已保存。"); }
    } catch (error) { setErrorMessage(presentError(error, "保存草稿失败，请稍后重试。")); }
    finally { setSubmitStatus("idle"); }
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !trimmedDescription || description.length > 4000) return;
    setSubmitStatus("submitting");
    clearMessages();
    try {
      const totalSent = existingAttachments.length + images.length;
      if (activeDraftId && productFeedbackRepository.submitDraft) {
        // Persist the complete attachment selection, including an empty retained set.
        if (productFeedbackRepository.saveDraft) {
          const saved = await saveCurrentDraft();
          if (saved) loadDraft(saved);
        } else if (isDirty) {
          throw new Error("当前环境暂不支持保存草稿变更，请稍后重试。");
        }
        await productFeedbackRepository.submitDraft(activeDraftId, { ...source, feedbackType, description: trimmedDescription });
      } else {
        await productFeedbackRepository.submit({ ...source, feedbackType, description: trimmedDescription, files: images.map((image) => image.file) });
      }
      resetComposer();
      setSuccessMessage(totalSent ? `反馈已记录，并附带 ${totalSent} 张截图。` : "反馈已记录，可在我的反馈中查看处理进展。");
    } catch (error) { setErrorMessage(presentError(error, "反馈提交失败，请稍后重试。")); }
    finally { setSubmitStatus("idle"); }
  };
  const composePanelId = `${tabId}-compose-panel`;
  const minePanelId = `${tabId}-mine-panel`;

  return (
    <>
      <ModalDialog open={open} onDismiss={anyPending ? undefined : requestClose} className="feedback-dialog feedback-compose-dialog" describedBy>
        {({ titleId, descriptionId }) => <div className="feedback-compose-surface" onPaste={handlePaste}
          onDragOver={(event) => { if (activeTab === "compose") event.preventDefault(); }}
          onDrop={(event) => { if (activeTab === "compose") { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); } }} onClickCapture={(event) => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="/feedback"]') : null;
        if (!link) return;
        if (anyPending) { event.preventDefault(); return; }
        if (!isDirty && !mineState.dirty) return;
        event.preventDefault(); setPendingDraft(null); setPendingNavigation(link.getAttribute("href")); setDiscardConfirmOpen(true);
      }}>
        <header className="feedback-dialog-header">
          <div><span className="eyebrow">产品体验</span><h2 id={titleId}>问题反馈</h2>
            <p id={descriptionId}>记录遇到的问题或建议，查看团队回复与处理进展。</p></div>
          <button type="button" className="audit-dialog-close-icon" aria-label="关闭" disabled={anyPending} onClick={requestClose}><CircleX size={22} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        {hasMineSupport && <div className="feedback-compose-tabs"><ViewSwitch variant="tabs" ariaLabel="问题反馈视图" value={activeTab}
          onValueChange={(value) => { if (!anyPending) { setActiveTab(value); if (value === "mine") setMineVisited(true); } }} items={[
            { value: "compose", label: `提交反馈${activeDraftId ? " (编辑草稿)" : ""}`, id: `${tabId}-compose-tab`, panelId: composePanelId, disabled: anyPending },
            { value: "mine", label: `我的反馈${myFeedbackCount > 0 ? ` (${myFeedbackCount})` : ""}`, id: `${tabId}-mine-tab`, panelId: minePanelId, disabled: anyPending }
          ]} /></div>}
        <TabPanel id={composePanelId} role={hasMineSupport ? "tabpanel" : "region"} aria-labelledby={hasMineSupport ? `${tabId}-compose-tab` : undefined}
          className="feedback-compose-panel" hidden={activeTab !== "compose"}>
          {activeTab === "compose" && <form onSubmit={handleSubmit}>
            <fieldset disabled={busy} className="feedback-compose-fields">
              <div className="feedback-compose-context"><span>问题来源</span><strong>{source.pageTitle}</strong><code>{source.pagePath}</code></div>
              <div className="feedback-compose-type"><Label htmlFor={`${tabId}-type`}>反馈类型</Label>
                <SelectControl id={`${tabId}-type`} ariaLabel="反馈类型" value={feedbackType} disabled={busy}
                  onValueChange={(value) => { setFeedbackType(value as ProductFeedbackType); clearMessages(); }} options={feedbackTypeOptions} /></div>
              <div className="feedback-compose-description">
                <div className="feedback-field-heading"><Label htmlFor={`${tabId}-description`}>问题描述</Label><span>{description.length} / 4000</span></div>
                <Textarea id={`${tabId}-description`} value={description} maxLength={4000} rows={6} required aria-describedby={`${tabId}-description-hint`}
                  onChange={(event) => { setDescription(event.target.value); clearMessages(); }} placeholder="发生了什么？可补充操作步骤、期望结果和实际表现。" />
                <p id={`${tabId}-description-hint`} className="feedback-help">说明操作步骤、期望结果与实际表现，有助于更快复现问题。</p>
              </div>
              <section className="feedback-compose-files" aria-labelledby={`${tabId}-attachments-title`}>
                <div className="feedback-compose-files__heading"><h3 id={`${tabId}-attachments-title`}>粘贴上传截图 <span className="feedback-help">（可选）</span></h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><Paperclip size={14} />选择图片</Button></div>
                <input id={fileInputId} ref={fileInputRef} type="file" accept={feedbackImageAccept} multiple hidden aria-label="选择反馈截图" disabled={busy}
                  onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                <p className="feedback-help">拖入图片，或在此窗口任意位置粘贴截图。{feedbackImageHint}</p>
                {existingAttachments.length > 0 && activeDraftId && <FeedbackAttachments feedbackId={activeDraftId} attachments={existingAttachments}
                  getAttachmentObjectUrl={productFeedbackRepository.getMineAttachmentObjectUrl ?? productFeedbackRepository.getAttachmentObjectUrl} disabled={busy}
                  onRemove={(id) => { setExistingAttachments((items) => items.filter((item) => item.id !== id)); clearMessages(); }} />}
                {images.length > 0 && <div className="feedback-local-images" aria-label="已粘贴截图">{images.map((image) => <figure key={image.id} className="feedback-local-image">
                  <button type="button" className="feedback-attachment__image" aria-label={`放大截图 ${image.file.name}`} onClick={() => setLocalPreview(image)}><img src={image.objectUrl} alt="问题反馈截图预览" /></button><figcaption>{image.file.name}</figcaption>
                  <Button type="button" variant="ghost" size="sm" aria-label={`移除截图 ${image.file.name}`} onClick={() => {
                    URL.revokeObjectURL(image.objectUrl);
                    const next = images.filter((item) => item.id !== image.id);
                    imagesRef.current = next; setImages(next); clearMessages();
                  }}><Trash2 size={14} />移除</Button></figure>)}</div>}
              </section>
            </fieldset>
            {successMessage && <div className="feedback-success" role="status"><p>{successMessage}</p>{hasMineSupport && <Button type="button" variant="link" size="sm" onClick={() => { setActiveTab("mine"); setMineVisited(true); }}>查看我的反馈</Button>}</div>}
            {errorMessage && <p className="feedback-error" role="alert">{errorMessage}</p>}
            <footer className="dialog-actions">
              <span className="feedback-compose-save-state" aria-live="polite">{activeDraftId ? (isDirty ? "有未保存的修改" : "草稿已保存") : ""}</span>
              <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>关闭</Button>
              {hasDraftSupport && <Button type="button" variant="outline" onClick={() => void handleSaveDraft()} disabled={busy || !isDirty}><Save size={14} />{submitStatus === "saving_draft" ? "保存中..." : "保存草稿"}</Button>}
              <Button type="submit" disabled={!trimmedDescription || busy || description.length > 4000}>{submitStatus === "submitting" ? "提交中..." : "提交反馈"}</Button>
            </footer>
          </form>}
        </TabPanel>
        {hasMineSupport && <TabPanel id={minePanelId} aria-labelledby={`${tabId}-mine-tab`} className="feedback-compose-panel" hidden={activeTab !== "mine"}>
          {mineVisited && <MyFeedbackView productFeedbackRepository={productFeedbackRepository} onEditDraft={handleEditDraft} onFeedbackCountChange={setMyFeedbackCount} onStateChange={setMineState} active={activeTab === "mine"} guardNavigation={false} />}
        </TabPanel>}
        </div>}
      </ModalDialog>
      <ModalDialog open={open && Boolean(localPreview)} onDismiss={() => setLocalPreview(null)} className="feedback-attachment-preview-dialog" backdropClassName="feedback-preview-backdrop" describedBy>
        {({ titleId, descriptionId }) => <>
          <header className="feedback-attachment-preview-dialog-head"><div className="feedback-attachment-preview-dialog-head-text"><h2 id={titleId}>{localPreview?.file.name}</h2><p id={descriptionId}>核对截图内容，确认后可随反馈提交。</p></div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLocalPreview(null)}>关闭预览</Button></header>
          <div className="feedback-attachment-preview-dialog-body"><img className="feedback-attachment-full" src={localPreview?.objectUrl} alt={localPreview?.file.name} />
            <a className="feedback-download" href={localPreview?.objectUrl} download={localPreview?.file.name}><Download size={14} />下载截图</a></div>
        </>}
      </ModalDialog>
      <ConfirmDialog open={discardConfirmOpen} title={pendingDraft ? "切换到其他草稿？" : "放弃当前反馈？"}
        description={<p>{activeDraftId ? "本次尚未保存的修改将丢失，已保存的草稿仍会保留。" : "尚未提交的反馈将丢失。"}{mineState.dirty ? "未发送的补充说明和新截图也将丢失。" : ""}{pendingDraft ? "确认放弃本次修改并打开所选草稿？" : "确认放弃，还是留在此处继续填写？"}</p>}
        confirmLabel={pendingDraft ? "放弃修改并切换" : "放弃反馈"} cancelLabel="继续填写" tone="danger" pending={anyPending}
        onCancel={() => { leaveDecision.current?.resolve(false); leaveDecision.current = null; setDiscardConfirmOpen(false); setPendingDraft(null); setPendingNavigation(null); }} onConfirm={() => {
          if (anyPending) return;
          setDiscardConfirmOpen(false);
          if (leaveDecision.current) { leaveDecision.current.resolve(true); leaveDecision.current = null; resetComposer(); onOpenChange(false); }
          else if (pendingNavigation) { navigationConfirmed.current = true; resetComposer(); window.location.assign(pendingNavigation); }
          else if (pendingDraft) { loadDraft(pendingDraft); setPendingDraft(null); }
          else { resetComposer(); onOpenChange(false); }
        }} />
    </>
  );
}
