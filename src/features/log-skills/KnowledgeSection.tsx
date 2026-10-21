import { useEffect, useId, useRef, useState } from "react";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import { canSeeEntry, type KnowledgeCapability } from "@/domain/knowledge/rules";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { ModalDialog } from "@/components/common/ModalDialog";
import { FileDropZone } from "@/components/common/FileDropZone";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { DataTable } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { KnowledgeStatusBadge } from "@/features/knowledge/badges";
import type { SkillSpec } from "./types";

// Knowledge module limits: schemas.ts Markdown body and service.ts file upload.
const markdownCharacterLimit = 200_000;
const knowledgeFileByteLimit = 20 * 1024 * 1024;
type UploadFile = { id: number; file: File; content?: string; status: "validating" | "ready" | "invalid" | "uploading" | "success" | "failed"; error?: string };
const uploadStatus = { validating: "正在校验…", ready: "待上传", invalid: "文件无效", uploading: "正在创建…", success: "已创建并链接", failed: "创建失败" };

export function KnowledgeSection({ spec, setSpec, disabled, apiMode, knowledgeRepository: repository, knowledgeCapability: capability, onBusyChange }: {
  spec: SkillSpec; setSpec: (spec: SkillSpec) => void; disabled: boolean; apiMode: boolean;
  knowledgeRepository?: KnowledgeRepository; knowledgeCapability?: KnowledgeCapability; onBusyChange: (busy: boolean) => void;
}) {
  const ids = spec.knowledgeEntryIds ?? [];
  const idsKey = JSON.stringify(ids);
  const [entries, setEntries] = useState<Array<{ id: string; entry: KnowledgeEntry | null }> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<KnowledgeEntry[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [pending, setPending] = useState(false);
  const fileSequence = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const canRead = apiMode && !!repository && !!capability?.canView;
  const atLimit = ids.length >= 200;
  const uploadReason = !capability?.canEdit ? "上传 Markdown 需要知识编辑权限。" : atLimit ? "每个技能最多链接 200 个知识条目，请先取消部分链接。" : "";
  const canUpload = canRead && !disabled && !!capability?.canEdit && !atLimit;
  const readyFiles = files.filter((item) => item.status === "ready" || item.status === "failed");
  const visibleEntries = (canRead ? entries ?? [] : ids.map((id) => ({ id, entry: null }))).map(({ id, entry }) => ({
    id, entry: canRead && capability && entry && canSeeEntry(entry, capability) ? entry : null
  }));

  useEffect(() => {
    let active = true;
    setLoadFailed(false); setEntries(null);
    if (!canRead) { setEntries((JSON.parse(idsKey) as string[]).map((id) => ({ id, entry: null }))); return; }
    void Promise.all((JSON.parse(idsKey) as string[]).map(async (id) => ({ id, entry: await repository!.get(id) })))
      .then((items) => { if (active) setEntries(items); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [idsKey, repository, canRead, capability?.userId, capability?.canManage, refresh]);

  useEffect(() => {
    if (!linkOpen || !canRead) return;
    let active = true;
    setChoices(null); setSearchFailed(false);
    void repository!.list({ status: "published", q: query.trim() || undefined })
      .then(({ items }) => { if (active) setChoices(items.filter((entry) => entry.status === "published")); })
      .catch(() => { if (active) setSearchFailed(true); });
    return () => { active = false; };
  }, [linkOpen, canRead, repository, capability?.userId, capability?.canManage, query, refresh]);

  async function selectFiles(selected: File[]) {
    let capacity = Math.max(0, 200 - ids.length - files.filter((item) => ["ready", "validating", "failed"].includes(item.status)).length);
    const selectedItems: UploadFile[] = selected.map((file) => {
      const error = !/\.md$/i.test(file.name) ? "仅支持 .md 文件。" : file.size > knowledgeFileByteLimit ? "文件超过知识库 20 MiB 上限。"
        : capacity <= 0 ? "每个技能最多链接 200 个知识条目，请先移除部分文件或取消已有链接。" : undefined;
      if (!error) capacity--;
      return { id: ++fileSequence.current, file, status: error ? "invalid" : "validating", error };
    });
    setFiles((current) => [...current, ...selectedItems]);
    for (const item of selectedItems) {
      if (item.error) continue;
      try {
        const content = await item.file.text();
        const error = content.length > markdownCharacterLimit ? "正文超过知识库 200,000 字符上限。" : undefined;
        setFiles((current) => current.map((row) => row.id === item.id ? { ...row, content: error ? undefined : content, status: error ? "invalid" : "ready", error } : row));
      } catch {
        setFiles((current) => current.map((row) => row.id === item.id ? { ...row, status: "invalid", error: "无法读取文件，请重新选择。" } : row));
      }
    }
  }
  async function upload() {
    if (!canUpload || pending || !readyFiles.length) return;
    setPending(true); onBusyChange(true);
    const linked = [...ids];
    let failed = files.some((item) => item.status === "invalid" || item.status === "validating");
    try {
      for (const item of readyFiles) {
        if (linked.length >= 200) {
          failed = true;
          setFiles((current) => current.map((row) => row.id === item.id ? { ...row, status: "invalid", error: "每个技能最多链接 200 个知识条目，请先取消部分链接。" } : row));
          continue;
        }
        setFiles((current) => current.map((row) => row.id === item.id ? { ...row, status: "uploading", error: undefined } : row));
        try {
          const entry = await repository!.createMarkdown({ origin: "uploaded", title: item.file.name.replace(/\.md$/i, "").slice(0, 200) || item.file.name, tags: [], contentMarkdown: item.content! });
          linked.push(entry.id);
          setFiles((current) => current.map((row) => row.id === item.id ? { ...row, status: "success" } : row));
        } catch (cause) {
          failed = true;
          setFiles((current) => current.map((row) => row.id === item.id ? { ...row, status: "failed", error: presentError(cause, "上传失败，请重试。") } : row));
        }
      }
      if (!failed) setUploadOpen(false);
    }
    finally { if (linked.length > ids.length) setSpec({ ...spec, knowledgeEntryIds: linked }); setPending(false); onBusyChange(false); }
  }

  return <section className="skill-section" aria-label="知识"><h2>知识</h2>
    <p>链接和上传结果需保存草稿，再随技能版本发布。仅已发布的知识进入分析检索；上传会创建知识草稿，请在知识库按正常流程发布。</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || !canRead || atLimit} onClick={() => { setQuery(""); setLinkOpen(true); }}>链接已有条目</Button>
      <Button disabled={!canUpload} aria-describedby={uploadReason ? reasonId : undefined} onClick={() => { setFiles([]); setUploadOpen(true); }}>上传 Markdown</Button>
    </div>
    {uploadReason ? <p id={reasonId}>{uploadReason}</p> : null}
    {!canRead ? <p>{apiMode ? "查看知识条目需要知识查看权限；仍可管理技能中保存的链接。" : "请在 API 模式下管理知识链接。"}</p> : null}
    {loadFailed ? <SectionError message="无法加载已链接知识" onRetry={() => setRefresh((value) => value + 1)} />
      : !entries ? <SectionSkeleton label="正在加载已链接知识" />
      : <DataTable rows={visibleEntries} rowKey={(row) => row.id} ariaLabel="已链接知识条目" tableClassName="table-fixed"
        emptyState={<SectionEmpty title="尚未链接知识" message="链接已发布条目，或上传 Markdown 创建知识草稿。" />}
        columns={[
          { key: "title", header: "标题", render: ({ entry }) => entry ? <span className="break-words" title={entry.title}>{entry.title}</span> : <span>无权查看的条目</span> },
          { key: "status", header: "状态", widthClass: "w-24", render: ({ entry }) => entry ? <KnowledgeStatusBadge status={entry.status} /> : null },
          { key: "revision", header: "修订", widthClass: "w-20", render: ({ entry }) => entry ? `v${entry.headRevisionNumber}` : null },
          { key: "updated", header: "更新时间", widthClass: "w-32", render: ({ entry }) => entry ? <span title={formatAbsolute(entry.updatedAt).slice(0, 16).replaceAll("-", "/")}>{formatAbsolute(entry.updatedAt).slice(0, 16).replaceAll("-", "/")}</span> : null }
        ]} renderRowActions={({ id, entry }) => <Button variant="outline" size="sm" disabled={disabled} aria-label={`取消链接 ${entry?.title ?? "无权查看的条目"}`}
          onClick={() => setUnlinking(id)}>取消链接</Button>} />}
    <ConfirmDialog open={!!unlinking} title="取消知识链接？" description="此知识条目将从当前草稿中移除，知识库中的原条目保留。" tone="danger" confirmLabel="取消链接"
      onCancel={() => setUnlinking(null)} onConfirm={() => { setSpec({ ...spec, knowledgeEntryIds: ids.filter((id) => id !== unlinking) }); setUnlinking(null); }} />
    <ModalDialog open={linkOpen} initialFocusRef={searchRef} onDismiss={() => setLinkOpen(false)} className="skill-publish-dialog modal-card--lg">
      {({ titleId }) => <div className="grid gap-4"><h2 id={titleId}>链接已有条目</h2><p>选择当前组织已发布的知识条目。链接更改需先保存草稿，再发布技能。</p>
        <SearchField ref={searchRef} value={query} onValueChange={setQuery} ariaLabel="搜索已发布知识" placeholder="搜索知识标题" disabled={!canRead} loading={canRead && !choices && !searchFailed} />
        {!canRead ? <SectionEmpty title="无法查看知识条目" message="选择知识条目需要知识查看权限。" /> : searchFailed ? <SectionError message="无法搜索知识条目" onRetry={() => setRefresh((value) => value + 1)} />
          : !choices ? <SectionSkeleton label="正在搜索知识条目" />
          : <DataTable fluid rows={choices} rowKey={(entry) => entry.id} ariaLabel="可链接知识条目" tableClassName="table-fixed [&_th:last-child]:w-24"
            emptyState={<SectionEmpty title="没有匹配的已发布知识" message="尝试其他关键词，或先在知识库发布条目。" />}
            columns={[{ key: "title", header: "标题", className: "min-w-0", render: (entry) => <span className="block min-w-0 break-all" title={entry.title}>{entry.title}</span> },
              { key: "revision", header: "修订", widthClass: "w-20", render: (entry) => `v${entry.headRevisionNumber}` }]}
            renderRowActions={(entry) => <Button variant="outline" size="sm" disabled={disabled || atLimit || ids.includes(entry.id)} aria-label={`${ids.includes(entry.id) ? "已链接" : "链接"} ${entry.title}`}
              onClick={() => setSpec({ ...spec, knowledgeEntryIds: [...ids, entry.id] })}>{ids.includes(entry.id) ? "已链接" : "链接"}</Button>} />}
        <div className="dialog-actions"><Button variant="outline" onClick={() => setLinkOpen(false)}>完成</Button></div>
      </div>}
    </ModalDialog>
    <ModalDialog open={uploadOpen} initialFocusRef={chooseRef} onDismiss={pending ? undefined : () => setUploadOpen(false)} className="skill-publish-dialog">
      {({ titleId }) => <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
        <h2 id={titleId}>上传 Markdown</h2><p>支持多选或拖放 .md 文件。每个文件创建一个知识草稿，标题取文件名；不会自动发布。</p>
        <FileDropZone label="Markdown 文件" regionLabel="拖放 Markdown 文件" browseRef={chooseRef} accept=".md" multiple disabled={pending || !canUpload}
          hint="支持多选 .md；每个文件不超过 20 MiB，正文不超过 200,000 字符。" files={files.map((item) => item.file)} listLabel="待上传文件"
          onSelect={(selected) => { void selectFiles(selected); }} onRemove={(index) => setFiles((current) => current.filter((_, at) => at !== index))}
          canRemove={(index) => files[index].status !== "success"} renderFileDetails={(index) => <>
            <span role="status" className="text-xs text-muted-foreground">{uploadStatus[files[index].status]}</span>
            {files[index].error ? <p role="alert" className="text-sm text-destructive">{files[index].error}</p> : null}
          </>} />
        {files.some((item) => item.status === "success") ? <p role="status">已创建的条目保留在当前未保存草稿中；请保存草稿，失败的文件可单独重试。</p> : null}
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => setUploadOpen(false)}>取消</Button>
          <Button type="submit" disabled={!canUpload || pending || !readyFiles.length} aria-busy={pending}>{pending ? "上传中…" : "创建并链接"}</Button></div>
      </form>}
    </ModalDialog>
  </section>;
}
