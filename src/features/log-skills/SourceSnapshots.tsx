import { useEffect, useId, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ModalDialog } from "@/components/common/ModalDialog";
import { FileDropZone } from "@/components/common/FileDropZone";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectControl } from "@/components/common/SelectControl";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import { mockSourceSnapshots } from "@/infrastructure/mock/logSkills";
import type { AnalysisSkill, SkillWorkspaceRepository, SourceSnapshot, SourceStatementMatches } from "./types";

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
  const [trySnapshotId, setTrySnapshotId] = useState("");
  const [tryLine, setTryLine] = useState("");
  const [tryPending, setTryPending] = useState(false);
  const [tryError, setTryError] = useState("");
  const [matches, setMatches] = useState<SourceStatementMatches | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const editable = apiMode && canEdit;
  const defaultId = (skill.draft ?? skill.currentRevision).spec.defaultSourceSnapshotId;
  const readySnapshots = items?.filter((item) => item.status === "ready") ?? [];
  const selectedTrySnapshot = readySnapshots.find((item) => item.id === trySnapshotId) ?? readySnapshots.find((item) => item.id === defaultId) ?? readySnapshots[0];
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
  async function tryLocate() {
    if (!selectedTrySnapshot || !tryLine.trim() || !repository?.locateSourceStatement) return;
    setTryPending(true); setTryError(""); setMatches(null);
    try { setMatches(await repository.locateSourceStatement(skill.id, selectedTrySnapshot.id, tryLine.trim())); }
    catch (cause) { setTryError(presentError(cause, "定位失败，请稍后重试。")); }
    finally { setTryPending(false); }
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
        { key: "createdAt", header: "上传时间", widthClass: "w-28 whitespace-nowrap", render: (item) => <span title={formatAbsolute(item.createdAt).slice(0, 16).replaceAll("-", "/")}>{formatAbsolute(item.createdAt).slice(0, 16).replaceAll("-", "/")}</span> },
        { key: "default", header: "默认", widthClass: "w-20 whitespace-nowrap", render: (item) => item.id === defaultId ? <span className="badge whitespace-nowrap">{skill.draft ? "草稿默认" : "已发布默认"}</span> : "—" }
      ]} renderRowActions={editable ? (item) => {
        if (item.status === "archived") return null;
        const defaultAction = { id: "default", label: "设为默认", disabled: disabled || dirty || item.id === defaultId, onSelect: async () => {
          try { await mutate(async () => onSkillUpdated(await repository!.setDefaultSourceSnapshot!(skill.id, item.id))); }
          catch (cause) { setError(presentError(cause, "设置默认快照失败，请刷新后重试。")); }
        } };
        return <RowActionMenu label={`${item.versionLabel} 快照操作`}
        primaryAction={item.status === "failed" ? { id: "retry", label: "重试索引", disabled: disabled || pending || !repository?.retrySourceSnapshot, onSelect: async () => {
          try { await mutate(async () => {
            const queued = await repository!.retrySourceSnapshot!(skill.id, item.id);
            setItems(current => current?.map(snapshot => snapshot.id === queued.id ? queued : snapshot) ?? null);
            setRefresh(value => value + 1);
          }); } catch (cause) { setError(presentError(cause, "重新排队失败，请重试。")); }
        } } : defaultAction} items={[...(item.status === "failed" ? [defaultAction] : []), { id: "archive", label: "归档", destructive: true, disabled,
          confirmation: { title: "归档源码快照？", description: `将归档“${item.versionLabel}”。已发布版本的引用保留，使用此快照的后续分析将注明源码不可用。`, confirmLabel: "归档" },
          onSelect: async () => { await mutate(async () => { await repository!.archiveSourceSnapshot!(skill.id, item.id); setRefresh((value) => value + 1); }); }
        }]} />;
      } : undefined} />}
    {editable && items && !loadFailed ? <section className="grid gap-3" aria-label="日志语句试一试">
      <h3>试一试</h3><p>粘贴一条日志，在就绪快照中定位输出语句；结果仅供核对。</p>
      {!readySnapshots.length ? <SectionEmpty title="暂无就绪快照" message="快照索引完成后可定位日志语句。" /> : <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void tryLocate(); }}>
        <label className="grid gap-2">选择就绪快照<SelectControl ariaLabel="选择就绪快照" value={selectedTrySnapshot?.id ?? ""} disabled={tryPending}
          options={readySnapshots.map((item) => ({ value: item.id, label: item.versionLabel }))} onValueChange={(value) => { setTrySnapshotId(value); setMatches(null); setTryError(""); }} /></label>
        <label className="grid gap-2">日志行<Textarea rows={2} maxLength={4000} disabled={tryPending} value={tryLine} placeholder="粘贴一条日志，例如 thermal foldback: temp=71"
          onChange={(event) => { setTryLine(event.target.value); setMatches(null); setTryError(""); }} /></label>
        <div><Button type="submit" disabled={tryPending || !tryLine.trim() || !repository?.locateSourceStatement} aria-busy={tryPending}>{tryPending ? "定位中…" : "定位语句"}</Button></div>
      </form>}
      {tryError ? <p role="alert">{tryError}</p> : null}
      {matches ? <div aria-live="polite">{matches.items.length ? <ul className="grid gap-3">{matches.items.map((match) => <li key={`${match.snapshotId}:${match.path}:${match.line}`} className="grid gap-1">
        <strong className="break-all">{match.path}:{match.line}</strong><span>{match.versionLabel} · 匹配置信度 {Math.round(match.confidence * 100)}%</span>
        <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs" aria-label={`${match.path} 源码摘录`}>{match.excerpt.split("\n").map((line, index) => {
          const lineNumber = match.startLine + index;
          const matched = lineNumber === match.line;
          return <span key={lineNumber} aria-label={matched ? `匹配源码行 ${lineNumber}` : undefined} className={matched ? "bg-[var(--accent-soft)] font-semibold" : undefined}>{matched ? "> " : "  "}{lineNumber}: {line}{"\n"}</span>;
        })}</pre>
      </li>)}</ul> : <SectionEmpty title="未找到匹配语句" message="请核对快照版本或尝试其他日志行。" />}{matches.truncated ? <p>结果已达上限，仅显示部分匹配。</p> : null}</div> : null}
    </section> : null}
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
        <div className="grid gap-2"><span>源码压缩包</span><FileDropZone label="源码压缩包" accept=".tar.gz,.tgz,.zip" required disabled={pending} invalid={!!formError}
          describedBy={formError ? errorId : undefined} files={file ? [file] : []} onSelect={(files) => setFile(files[0] ?? null)} onRemove={() => setFile(null)} /></div>
        <p>支持 .tar.gz、.tgz、.zip；上传上限由服务器配置，默认 100 MiB。</p>
        {formError ? <p id={errorId} role="alert">{formError}</p> : null}
        <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => setUploadOpen(false)}>取消</Button><Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "上传中…" : "上传"}</Button></div>
      </form>}
    </ModalDialog>
  </section>;
}
