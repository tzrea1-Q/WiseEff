import { useEffect, useRef, useState } from "react";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import { KNOWLEDGE_BATCH_ENTRY_LIMIT, KNOWLEDGE_TAG_LIMIT, KNOWLEDGE_TAG_CHARACTER_LIMIT } from "@/domain/knowledge/limits";
import type { KnowledgeBatchInput, KnowledgeBatchReport, KnowledgeEntry } from "@/domain/knowledge/types";
import { DataTable } from "@/components/admin";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { parseTagsInput } from "./KnowledgeEntryEditorDialog";

export const knowledgeBatchLabels = { add_tags: "添加标签", remove_tags: "移除标签", publish: "发布", archive: "归档" };

function failureReason(error: NonNullable<KnowledgeBatchReport["results"][number]["error"]>) {
  if (error.code === "FORBIDDEN") return "没有管理此条目的权限：需要本人条目的编辑权限或知识管理权限。";
  if (error.code === "NOT_FOUND") return "条目不存在或无权查看。";
  if (error.reason === "knowledge-illegal-status-transition") {
    return "条目状态不允许此操作：发布仅适用于草稿，归档仅适用于已发布条目。";
  }
  if (error.reason === "knowledge-entry-archived") return "已归档条目不能修改标签，请先恢复条目。";
  if (error.code === "CONFLICT") return "条目已有其他修改，请刷新最新修订后重试。";
  return presentError(new WiseEffApiError(error.code, error.message, {}, ""), "条目写入失败，请刷新检查后重试。");
}

export function KnowledgeBatchDialog({ action, entries, repository, onComplete, onClose }: {
  action: KnowledgeBatchInput["action"]; entries: KnowledgeEntry[]; repository: KnowledgeRepository;
  onComplete: (report: KnowledgeBatchReport) => void; onClose: () => void;
}) {
  const [tagsText, setTagsText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<KnowledgeBatchReport | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const label = knowledgeBatchLabels[action];
  const tagging = action === "add_tags" || action === "remove_tags";
  const submit = async () => {
    if (pending || report) return;
    const tags = parseTagsInput(tagsText);
    if (entries.length > KNOWLEDGE_BATCH_ENTRY_LIMIT) { setError(`每批最多操作 ${KNOWLEDGE_BATCH_ENTRY_LIMIT} 条，请减少选择。`); return; }
    if (tagging && (!tags.length || tags.length > KNOWLEDGE_TAG_LIMIT || tags.some((tag) => tag.length > KNOWLEDGE_TAG_CHARACTER_LIMIT))) {
      setError(`请输入 1–${KNOWLEDGE_TAG_LIMIT} 个标签，每个标签不超过 ${KNOWLEDGE_TAG_CHARACTER_LIMIT} 个字符。`); return;
    }
    setPending(true);
    setError("");
    try {
      const entryIds = entries.map((entry) => entry.id);
      const result = await repository.batch(tagging ? { action, entryIds, tags } : { action, entryIds });
      setReport(result);
      if (mounted.current) onComplete(result);
    } catch (failure) {
      setError(presentError(failure, "批量请求失败，部分条目可能已完成。请刷新列表检查后再重试。"));
    } finally {
      setPending(false);
    }
  };

  return <ModalDialog open onDismiss={() => { if (!pending) onClose(); }} describedBy backdropClassName="knowledge-modal-backdrop"
    className="submission-dialog modal-card--lg flex min-w-0 flex-col gap-4">
    {({ titleId, descriptionId }) => <>
      <div>
        <h2 id={titleId} className="text-base font-semibold">{label}</h2>
        <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
          已选择 {entries.length} 条。逐条检查权限并执行，失败不影响其他条目。
          {action === "publish" ? "发布后进入知识检索。" : action === "archive" ? "归档后退出知识检索，保留内容和修订。" : "保留其他标签与条目内容。"}
        </p>
      </div>
      {!report ? <div className="min-h-0 overflow-y-auto">
        <ul className="mb-3 list-inside list-disc text-sm">{entries.map((entry) => <li key={entry.id} className="break-words">{entry.title}</li>)}</ul>
        {tagging ? <label className="flex flex-col gap-1 text-sm">标签（逗号分隔）
          <input className="rounded-md border border-input bg-background px-3 py-2" value={tagsText} disabled={pending}
            aria-invalid={error.startsWith("请输入") || undefined} aria-describedby={error.startsWith("请输入") ? `${titleId}-error` : undefined}
            onChange={(event) => setTagsText(event.target.value)} />
        </label> : null}
      </div> : <div className="min-h-0 overflow-y-auto">
        <p role="status" className="mb-2 text-sm">成功 {report.results.filter((row) => row.status === "succeeded").length} 条 · 拒绝或失败 {report.results.filter((row) => row.status !== "succeeded").length} 条</p>
        <DataTable ariaLabel="批量操作结果" rows={report.results} rowKey={(row) => row.entryId} pageSize={KNOWLEDGE_BATCH_ENTRY_LIMIT} fluid columns={[
          { key: "title", header: "条目", render: (row) => <span className="break-words">{row.title ?? entries.find((entry) => entry.id === row.entryId)?.title ?? row.entryId}</span> },
          { key: "status", header: "结果", render: (row) => ({ succeeded: "成功", refused: "拒绝", failed: "失败" })[row.status] },
          { key: "reason", header: "原因", render: (row) => <span className="break-words">{row.error ? failureReason(row.error) : `已${label}`}</span> }
        ]} />
        {report.summaryError ? <p role="alert" className="mt-2 text-destructive">{report.summaryError}</p> : null}
      </div>}
      {error ? <p id={`${titleId}-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{report ? "关闭" : "取消"}</Button>
        {!report ? <Button type="button" disabled={pending || !entries.length} aria-busy={pending || undefined} onClick={() => void submit()}>
          {pending ? "正在执行…" : `确认${label}`}
        </Button> : null}
      </div>
    </>}
  </ModalDialog>;
}
