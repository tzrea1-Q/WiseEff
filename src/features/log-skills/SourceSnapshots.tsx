import { useEffect, useId, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ModalDialog } from "@/components/common/ModalDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import { mockSourceSnapshots } from "@/infrastructure/mock/logSkills";
import type { AnalysisSkill, SkillWorkspaceRepository, SourceSnapshot } from "./types";

const labels = { queued: "等待索引", indexing: "索引中", ready: "就绪", failed: "索引失败", archived: "已归档" };
const tones = { queued: "text-[var(--info)] bg-[var(--info-soft)]", indexing: "text-[var(--info)] bg-[var(--info-soft)]", ready: "text-[var(--success)] bg-[var(--success-soft)]", failed: "text-[var(--danger)] bg-[var(--danger-soft)]", archived: "text-muted-foreground bg-muted" };
const active = (item: SourceSnapshot) => item.status === "queued" || item.status === "indexing";
const skipLabels: Record<string, string> = { "第三方或忽略目录": "第三方", "二进制或非 UTF-8 文件": "二进制", "不支持的文件类型": "类型不支持", "超过单文件大小上限": "超过大小限制" };
function skippedSummary(item: SourceSnapshot) {
  const counts = new Map<string, number>();
  for (const entry of item.skippedFiles) {
    const label = skipLabels[entry.reason] ?? "其他";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const reasons = [...counts].map(([label, count]) => `${label} ${count}`).join(" · ");
  return `${item.skippedCount} 个${reasons ? ` · ${item.skippedCount > item.skippedFiles.length ? "已列出：" : ""}${reasons}` : ""}`;
}

export function SourceSnapshots({ skill, repository, apiMode, canEdit, disabled, dirty, onSkillUpdated, onBusyChange }: {
  skill: AnalysisSkill; repository?: Partial<SkillWorkspaceRepository>; apiMode: boolean; canEdit: boolean; disabled: boolean; dirty: boolean;
  onSkillUpdated: (skill: AnalysisSkill) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<SourceSnapshot[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [skippedSnapshot, setSkippedSnapshot] = useState<SourceSnapshot | null>(null);
  const [versionLabel, setVersionLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const editable = apiMode && canEdit;
  const defaultId = (skill.draft ?? skill.currentRevision).spec.defaultSourceSnapshotId;
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const found = apiMode ? await repository!.listSourceSnapshots!(skill.id) : mockSourceSnapshots;
        if (!mounted) return;
        setItems(found); setLoadFailed(false);
        if (found.some(active)) timer = setTimeout(() => { void load(); }, 2000);
      } catch { if (mounted) setLoadFailed(true); }
    };
    void load();
    return () => { mounted = false; clearTimeout(timer); };
  }, [apiMode, repository, skill.id, refresh]);

  async function mutate(action: () => Promise<void>) {
    setPending(true); onBusyChange(true); setError("");
    try { await action(); } finally { setPending(false); onBusyChange(false); }
  }
  async function upload() {
    if (!versionLabel.trim()) { setFormError("请输入版本标签。"); labelRef.current?.focus(); return; }
    if (!file) { setFormError("请选择源码压缩包。"); return; }
    if (!/\.(?:tar\.gz|tgz|zip)$/i.test(file.name)) { setFormError("请选择 .tar.gz、.tgz 或 .zip 压缩包。"); return; }
    if (!file.size) { setFormError("压缩包不能为空。"); return; }
    setFormError("");
    try {
      await mutate(async () => {
        await repository!.uploadSourceSnapshot!(skill.id, { versionLabel: versionLabel.trim(), file });
        setUploadOpen(false); setRefresh((value) => value + 1);
      });
    } catch (cause) { setFormError(presentError(cause, "上传失败，请检查版本标签是否重复及压缩包大小后重试。")); }
  }
  return <section className="skill-section" aria-label="源码"><h2>源码</h2>
    <p>默认快照随下一次技能发布生效。快照尚未就绪时，日志分析会继续完成并注明未使用源码。</p>
    {editable ? <div><Button disabled={disabled} onClick={() => { setVersionLabel(""); setFile(null); setFormError(""); setUploadOpen(true); }}>上传快照</Button></div> : null}
    {editable && dirty ? <p>请先保存或放弃未保存的更改，再设为默认快照。</p> : null}
    {error ? <div role="alert">{error}</div> : null}
    {loadFailed ? <SectionError message="无法加载源码快照" onRetry={() => { setLoadFailed(false); setRefresh((value) => value + 1); }} />
      : !items ? <SectionSkeleton label="正在加载源码快照" />
      : <DataTable rows={items} rowKey={(item) => item.id} ariaLabel="源码快照" tableClassName="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3" emptyState={<SectionEmpty title="尚无源码快照" message="上传源码压缩包后，将在后台建立索引。" />} columns={[
        { key: "versionLabel", header: "版本标签", render: (item) => <span className={item.versionLabel.length > 40 ? "block max-w-48 break-all" : "whitespace-nowrap"}>{item.versionLabel}</span> },
        { key: "fileCount", header: "文件数", widthClass: "w-20 whitespace-nowrap", align: "right", render: (item) => item.fileCount },
        { key: "status", header: "索引状态", widthClass: "w-24 whitespace-nowrap", render: (item) => <><Badge variant="outline" className={tones[item.status]}>{labels[item.status]}</Badge>
          {active(item) ? <p aria-label="索引进度">{item.filesProcessed} / {item.filesTotal}</p> : null}
          {item.status === "failed" ? <p>{presentErrorMessage(item.error, "索引失败，请检查压缩包格式及索引限制。")}</p> : null}</> },
        { key: "skips", header: "跳过文件", widthClass: "w-48", render: (item) => item.skippedCount ? <div className="grid gap-1">
          <span className="text-xs">{skippedSummary(item)}</span><Button variant="link" size="sm" className="w-fit" onClick={() => setSkippedSnapshot(item)}>查看</Button>
        </div> : "无" },
        { key: "createdAt", header: "上传时间", widthClass: "w-28 whitespace-nowrap", render: (item) => <span title={formatAbsolute(item.createdAt)}>{formatRelativeOrAbsolute(item.createdAt)}</span> },
        { key: "default", header: "默认", widthClass: "w-20 whitespace-nowrap", render: (item) => item.id === defaultId ? <span className="badge whitespace-nowrap">{skill.draft ? "草稿默认" : "已发布默认"}</span> : "—" }
      ]} renderRowActions={editable ? (item) => item.status === "archived" ? null : <RowActionMenu label={`${item.versionLabel} 快照操作`}
        primaryAction={{ id: "default", label: "设为默认", disabled: disabled || dirty || item.id === defaultId, onSelect: async () => {
          try { await mutate(async () => onSkillUpdated(await repository!.setDefaultSourceSnapshot!(skill.id, item.id))); }
          catch (cause) { setError(presentError(cause, "设置默认快照失败，请刷新后重试。")); }
        } }} items={[{ id: "archive", label: "归档", destructive: true, disabled,
          confirmation: { title: "归档源码快照？", description: `将归档“${item.versionLabel}”。已发布版本的引用保留，使用此快照的后续分析将注明源码不可用。`, confirmLabel: "归档" },
          onSelect: async () => { await mutate(async () => { await repository!.archiveSourceSnapshot!(skill.id, item.id); setRefresh((value) => value + 1); }); }
        }]} /> : undefined} />}
    <ModalDialog open={!!skippedSnapshot} onDismiss={() => setSkippedSnapshot(null)} className="skill-publish-dialog w-full max-w-4xl">
      {({ titleId }) => skippedSnapshot ? <>
        <h2 id={titleId}>跳过的源码文件</h2><p className="break-all">{skippedSnapshot.versionLabel}</p>
        {skippedSnapshot.skippedCount > skippedSnapshot.skippedFiles.length ? <p>仅显示前 {skippedSnapshot.skippedFiles.length} 项，共 {skippedSnapshot.skippedCount} 项。</p> : null}
        <DataTable rows={skippedSnapshot.skippedFiles} rowKey={(entry) => entry.path} ariaLabel="跳过的源码文件" tableClassName="table-fixed" columns={[
          { key: "path", header: "路径", widthClass: "w-3/4", className: "break-all", render: (entry) => entry.path },
          { key: "reason", header: "原因", render: (entry) => presentErrorMessage(entry.reason, "未纳入索引") }
        ]} />
        <div className="dialog-actions"><Button variant="outline" onClick={() => setSkippedSnapshot(null)}>关闭</Button></div>
      </> : null}
    </ModalDialog>
    <ModalDialog open={uploadOpen} initialFocusRef={labelRef} onDismiss={pending ? undefined : () => setUploadOpen(false)} className="skill-publish-dialog">
      {({ titleId }) => <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void upload(); }} noValidate>
        <h2 id={titleId}>上传源码快照</h2>
        <label className="grid gap-2">版本标签<Input ref={labelRef} value={versionLabel} maxLength={200} disabled={pending} required aria-invalid={!!formError} aria-describedby={formError ? errorId : undefined} onChange={(event) => setVersionLabel(event.target.value)} /></label>
        <label className="grid gap-2">源码压缩包<Input type="file" accept=".tar.gz,.tgz,.zip" required disabled={pending} aria-invalid={!!formError} aria-describedby={formError ? errorId : undefined} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <p>支持 .tar.gz、.tgz、.zip；上传上限由服务器配置，默认 100 MiB。</p>
        {formError ? <p id={errorId} role="alert">{formError}</p> : null}
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => setUploadOpen(false)}>取消</Button><Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "上传中…" : "上传"}</Button></div>
      </form>}
    </ModalDialog>
  </section>;
}
