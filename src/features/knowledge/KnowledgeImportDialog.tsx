import { useEffect, useRef, useState } from "react";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import { KNOWLEDGE_IMPORT_DOCUMENT_LIMIT, KNOWLEDGE_IMPORT_BYTE_LIMIT, KNOWLEDGE_FILE_BYTE_LIMIT, KNOWLEDGE_TAG_LIMIT, KNOWLEDGE_TAG_CHARACTER_LIMIT } from "@/domain/knowledge/limits";
import type { KnowledgeImportOutcome } from "@/domain/knowledge/types";
import { DataTable } from "@/components/admin";
import { FileDropZone } from "@/components/common/FileDropZone";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { parseTagsInput } from "./KnowledgeEntryEditorDialog";

type Row = { name: string; outcome?: KnowledgeImportOutcome; requestError?: string };
const labels = { created: "已创建草稿", duplicate_skipped: "重复，已跳过", unsupported_skipped: "格式不支持，已跳过",
  extraction_failed: "提取失败，草稿已保留", rejected: "导入失败" };
const isZip = (file: File) => /\.zip$/i.test(file.name);

export function KnowledgeImportDialog({ open, repository, onClose, onComplete }: {
  open: boolean; repository: KnowledgeRepository; onClose: () => void; onComplete: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [current, setCurrent] = useState(-1);
  const [pending, setPending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const complete = async (id: string) => {
    setError("");
    try {
      await repository.completeImport(id);
      setSummaryPending(false);
      if (mounted.current) onComplete();
    } catch (failure) {
      setSummaryPending(true);
      setError(presentError(failure, "文档结果已保留，批次汇总失败，请重试汇总。"));
    }
  };
  const submit = async () => {
    if (!files.length) { setError("请选择要导入的文档。"); return; }
    if (files.filter(isZip).length > 1) { setError("每批最多选择一个 ZIP 压缩包。"); return; }
    if (files.filter((file) => !isZip(file)).length > KNOWLEDGE_IMPORT_DOCUMENT_LIMIT) { setError(`每批最多导入 ${KNOWLEDGE_IMPORT_DOCUMENT_LIMIT} 个文档。`); return; }
    if (files.filter((file) => !isZip(file)).reduce((total, file) => total + file.size, 0) > KNOWLEDGE_IMPORT_BYTE_LIMIT
      || files.some((file) => isZip(file) && file.size > KNOWLEDGE_IMPORT_BYTE_LIMIT)) {
      setError(`每批文件总大小不能超过 ${KNOWLEDGE_IMPORT_BYTE_LIMIT / 1024 / 1024} MB。`); return;
    }
    const batchTags = parseTagsInput(tags);
    if (batchTags.length > KNOWLEDGE_TAG_LIMIT || batchTags.some((tag) => tag.length > KNOWLEDGE_TAG_CHARACTER_LIMIT)) {
      setError(`每批最多 ${KNOWLEDGE_TAG_LIMIT} 个标签，每个标签不超过 ${KNOWLEDGE_TAG_CHARACTER_LIMIT} 个字符。`); return;
    }
    setPending(true);
    setError("");
    let id: string;
    try {
      id = (await repository.openImport(batchTags)).id;
    } catch (failure) {
      setError(presentError(failure, "无法开始导入，请重试。"));
      setPending(false);
      return;
    }
    setBatchId(id);
    const progress: Row[] = files.map((file) => ({ name: file.webkitRelativePath || file.name }));
    setRows([...progress]);
    let offset = 0;
    for (const [index, file] of files.entries()) {
      const rowIndex = index + offset;
      setCurrent(rowIndex);
      try {
        if (isZip(file)) {
          const { outcomes } = await repository.importArchive(id, file);
          progress.splice(rowIndex, 1, ...outcomes.map((outcome) => ({ name: outcome.relativePath, outcome })));
          offset += outcomes.length - 1;
        } else {
          progress[rowIndex].outcome = await repository.importDocument(id, { file, relativePath: progress[rowIndex].name });
        }
      } catch (failure) {
        progress[rowIndex].requestError = presentError(failure, "导入请求失败，请检查知识库中的结果后重试。");
      }
      setRows(progress.map((row) => ({ ...row })));
    }
    setCurrent(-1);
    await complete(id);
    setFinished(true);
    setPending(false);
  };

  return <ModalDialog open={open} onDismiss={onClose} describedBy backdropClassName="knowledge-modal-backdrop"
    className="submission-dialog modal-card--lg flex min-w-0 flex-col gap-4">
    {({ titleId, descriptionId }) => <>
      <div>
        <h2 id={titleId} className="text-base font-semibold text-foreground">批量导入</h2>
        <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
          支持 PDF、DOCX、TXT、MD 和一个 ZIP 压缩包，文件夹名转为标签。每批最多 {KNOWLEDGE_IMPORT_DOCUMENT_LIMIT} 个文档、解压后 {KNOWLEDGE_IMPORT_BYTE_LIMIT / 1024 / 1024} MB，每个文档最多 {KNOWLEDGE_FILE_BYTE_LIMIT / 1024 / 1024} MB。每份文档创建独立草稿，重复内容跳过。
        </p>
      </div>
      <div className="min-h-0 overflow-auto">
        {!batchId ? <div className="flex flex-col gap-4">
          <FileDropZone label="选择文档或 ZIP" multiple accept=".pdf,.docx,.txt,.md,.zip" files={files} disabled={pending}
            onSelect={(selected) => setFiles((previous) => [...previous, ...selected])}
            onRemove={(index) => setFiles((previous) => previous.filter((_, i) => i !== index))} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            批次标签（逗号分隔）
            <input className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" value={tags}
              disabled={pending} onChange={(event) => setTags(event.target.value)} />
          </label>
        </div> : finished ? <DataTable<Row & { index: number }> ariaLabel="导入报告" fluid pageSize={20}
          rows={rows.map((row, index) => ({ ...row, index }))} rowKey={(row) => String(row.index)} columns={[
            { key: "name", header: "文档", render: (row) => <span className="break-all">{row.name}</span> },
            { key: "status", header: "结果", render: (row) => <div>
              <span>{row.outcome ? labels[row.outcome.status] : "导入失败"}</span>
              {row.outcome?.warnings?.map((warning) => <p key={warning} className="text-xs text-muted-foreground break-words">{warning}</p>)}
              {row.requestError || row.outcome?.error ? <p className="text-xs text-muted-foreground break-words">
                {row.requestError || presentError(new Error(row.outcome!.error!), "文本提取失败，请查看草稿并替换文件。")}
              </p> : null}
            </div> },
            { key: "entry", header: "条目", render: (row) => row.outcome?.entryId ?
              <a className="text-primary underline" href={`/knowledge?entryId=${encodeURIComponent(row.outcome.entryId)}`}>
                {row.outcome.status === "duplicate_skipped" ? "查看已有条目" : "查看草稿"}
              </a> : "—" }
          ]} /> : <div aria-live="polite">
          <p className="text-sm text-foreground">{current >= 0 ? `正在导入：${rows[current]?.name}` : "正在汇总导入结果…"}</p>
          <ol aria-label="文档导入进度" className="mt-2 space-y-2 text-sm">{rows.map((row, index) =>
            <li key={index} className="break-all">{row.name} · {row.outcome ? labels[row.outcome.status] : row.requestError ? "导入失败" : index === current ? "导入中" : "等待导入"}</li>
          )}</ol>
        </div>}
      </div>
      {pending ? <p className="text-xs text-muted-foreground">关闭对话框或离开此页面不会取消已提交的文档。</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
        {!batchId ? <Button size="sm" disabled={pending || !files.length} aria-busy={pending || undefined} onClick={() => void submit()}>
          {pending ? "正在开始…" : "开始导入"}
        </Button> : null}
        {summaryPending ? <Button size="sm" onClick={() => void complete(batchId!)}>重试汇总</Button> : null}
        {finished && !summaryPending ? <Button size="sm" onClick={() => {
          setBatchId(null); setFiles([]); setRows([]); setTags(""); setFinished(false); setError("");
        }}>继续导入</Button> : null}
      </div>
    </>}
  </ModalDialog>;
}
