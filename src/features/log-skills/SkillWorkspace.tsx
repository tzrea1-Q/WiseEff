import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { DataTable } from "@/components/admin/DataTable";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { mockLogSkills, mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { formatPercent } from "@/domain/format/formatPercent";
import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import type { AnalysisSkill, SkillRevision, SkillSpec, SkillWorkspaceRepository, SkillSample, SkillDryRun } from "./types";
import { specJson } from "./diffSkillSpecs";
import { SkillSpecDiff } from "./SkillSpecDiff";
import { SkillSamplePane } from "./SkillSamplePane";
import { stringify } from "yaml";
import { ParsingSection, parseParsingYaml } from "./ParsingSection";
import { DecodingSection } from "./DecodingSection";
import { parsingSpecSchema } from "@wiseeff/dto-schemas";
import { SourceSnapshots } from "./SourceSnapshots";
import { SkillDryRunDrawer } from "./SkillDryRunDrawer";
import "./skill-workspace.css";

type SectionProps = { skill: AnalysisSkill; spec: SkillSpec; setSpec: (spec: SkillSpec) => void; disabled: boolean;
  sample: SkillSample | null;
  selectedLine: number | null;
  parsingYaml: string; onParsingYamlChange: (text: string) => void;
  revisions: SkillRevision[]; onRestore: (revision: SkillRevision) => void;
  repository?: Partial<SkillWorkspaceRepository>; apiMode: boolean; canEdit: boolean; dirty: boolean;
  onSkillUpdated: (skill: AnalysisSkill) => void; onBusyChange: (busy: boolean) => void;
  stats?: { analyses7d?: number; helpfulRate7d?: number | null } };
const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未发布";
const status = { published: "当前", draft: "草稿", superseded: "已替代" };

function Parsing({ skill, parsingYaml, onParsingYamlChange, disabled, repository, sample }: SectionProps) {
  return <ParsingSection skillId={skill.id} yaml={parsingYaml} onChange={onParsingYamlChange} disabled={disabled} repository={repository} sample={sample} />;
}

function Decoding({ skill, parsingYaml, onParsingYamlChange, disabled, repository, sample, selectedLine }: SectionProps) {
  return <DecodingSection skillId={skill.id} yaml={parsingYaml} onChange={onParsingYamlChange} disabled={disabled} repository={repository} sample={sample} selectedLine={selectedLine} />;
}

const procedureOutline = ["适用场景", "先检查什么", "根因判定", "常见误判", "建议动作"]
  .map((heading) => `## ${heading}\n请补充${heading}。`).join("\n\n");

function Procedure({ spec, setSpec, disabled }: SectionProps) {
  const [view, setView] = useState("edit");
  const id = useId();
  const procedure = spec.procedure ?? procedureOutline;
  const preview = useMemo(() => renderMarkdownPreview(procedure), [procedure]);
  return <section className="skill-section" aria-label="诊断流程"><h2>诊断流程</h2>
    <ViewSwitch variant="tabs" ariaLabel="诊断流程视图" value={view} onValueChange={setView} items={[
      { value: "edit", label: "编辑", id: `${id}-edit`, panelId: `${id}-edit-panel` },
      { value: "preview", label: "预览", id: `${id}-preview`, panelId: `${id}-preview-panel` }
    ]} />
    <TabPanel id={`${id}-edit-panel`} aria-labelledby={`${id}-edit`} hidden={view !== "edit"}>
      <label>诊断流程内容<Textarea disabled={disabled} rows={18} maxLength={20000} value={procedure}
        aria-describedby={`${id}-count`} onChange={(event) => setSpec({ ...spec, procedure: event.target.value })} /></label>
    </TabPanel>
    <TabPanel id={`${id}-preview-panel`} aria-labelledby={`${id}-preview`} hidden={view !== "preview"}>
      <div className="knowledge-markdown-preview" dangerouslySetInnerHTML={{ __html: preview }} />
    </TabPanel>
    <p id={`${id}-count`}>{procedure.length} / 20000 字符</p>
  </section>;
}

function Overview({ skill, spec, setSpec, disabled, stats }: SectionProps) {
  return <section className="skill-section" aria-label="概览">
    <h2>概览</h2>
    <dl className="skill-facts"><dt>名称</dt><dd>{skill.name}</dd>
      <dt>当前版本</dt><dd>v{skill.currentRevision.number} · {time(skill.currentRevision.publishedAt)}</dd>
      <dt>发布者</dt><dd>{skill.currentRevision.publishedByDisplayName ?? (skill.currentRevision.publishedByUserId ? "已删除用户" : "系统")}</dd>
      <dt>草稿状态</dt><dd>{skill.draft ? "未发布更改" : "无草稿"}</dd>
      <dt>近 7 天分析</dt><dd>{stats?.analyses7d ?? "暂无数据"}</dd>
      <dt>有用率</dt><dd>{stats?.helpfulRate7d == null ? "暂无反馈" : formatPercent(stats.helpfulRate7d)}</dd>
    </dl>
    <label>描述<Textarea maxLength={2000} disabled={disabled} value={spec.description ?? skill.description ?? ""}
      onChange={(event) => setSpec({ ...spec, description: event.target.value })} /></label>
    <label>模型覆盖<Input maxLength={200} disabled={disabled} value={spec.modelOverride ?? ""} placeholder="使用平台默认模型"
      onChange={(event) => { const next = { ...spec }; if (event.target.value) next.modelOverride = event.target.value; else delete next.modelOverride; setSpec(next); }} /></label>
    <section aria-label="已配置内容"><h3>已配置内容</h3><dl className="skill-facts">
      <dt>基础格式</dt><dd>{spec.formatProfile ? "已配置" : "未配置"}</dd>
      <dt>信号规则</dt><dd>{spec.signalRules ? `${spec.signalRules.rules.length} 条` : "平台默认充电规则"}</dd>
    </dl></section>
  </section>;
}

function Versions({ skill, revisions, disabled, onRestore }: SectionProps) {
  const [leftId, setLeftId] = useState(revisions.find((r) => r.status === "superseded")?.id ?? skill.currentRevision.id);
  const [rightId, setRightId] = useState<string | null>(null);
  const left = revisions.find((r) => r.id === leftId) ?? skill.currentRevision;
  const right = revisions.find((r) => r.id === rightId) ?? skill.currentRevision;
  return <section className="skill-section" aria-label="版本"><h2>版本</h2>
    <DataTable rows={revisions} rowKey={(r) => r.id} ariaLabel="技能版本历史" selectedRowKey={left.id} columns={[
      { key: "number", header: "版本", render: (r) => <Button variant="link" size="sm" onClick={() => { setLeftId(r.id); setRightId(null); }}>v{r.number}</Button> },
      { key: "status", header: "状态", render: (r) => <span className="badge">{status[r.status]}</span> },
      { key: "publishedAt", header: "发布时间", render: (r) => time(r.publishedAt) },
      { key: "publisher", header: "发布者", render: (r) => r.status === "draft" ? "尚未发布" : r.publishedByDisplayName ?? (r.publishedByUserId ? "已删除用户" : "系统") },
      { key: "restore", header: "操作", render: (r) => r.status === "superseded" ? <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRestore(r)}>回滚到此版本</Button> : null }
    ]} />
    <div className="skill-compare-selectors">{(["left", "right"] as const).map((side) => <label key={side}>{side === "left" ? "变更前版本" : "变更后版本"}
      <SelectControl value={side === "left" ? left.id : right.id} ariaLabel={side === "left" ? "变更前版本" : "变更后版本"}
        onValueChange={side === "left" ? setLeftId : (id) => setRightId(id === skill.currentRevision.id ? null : id)} options={revisions.map((r) => ({ value: r.id, label: `v${r.number} · ${status[r.status]}` }))} />
    </label>)}</div><SkillSpecDiff before={left.spec} after={right.spec} />
  </section>;
}

export const skillSections: Array<{ id: string; label: string; component?: ComponentType<SectionProps> }> = [
  { id: "overview", label: "概览", component: Overview }, { id: "procedure", label: "诊断流程", component: Procedure },
  { id: "parsing", label: "样例与解析", component: Parsing }, { id: "decoding", label: "解码", component: Decoding }, { id: "signals", label: "信号" },
  { id: "knowledge", label: "知识" }, { id: "source", label: "源码", component: SourceSnapshots }, { id: "tests", label: "测试" },
  { id: "integration", label: "集成" }, { id: "versions", label: "版本", component: Versions }
];

export function SkillWorkspace({ skillId, search, repository, apiMode, canEdit, onNavigate, onPublished }: {
  skillId: string; search: string; repository?: Pick<LogAnalysisRepository, keyof SkillWorkspaceRepository | "listLogSkills" | "getSkillSample" | "replaceSkillSample" | "deleteSkillSample">; apiMode: boolean; canEdit: boolean;
  onNavigate: (path: string) => void; onPublished: (message: string) => void;
}) {
  const [skill, setSkill] = useState<AnalysisSkill | null>(null);
  const [sample, setSample] = useState<SkillSample | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const onSampleChange = useCallback((next: SkillSample | null) => { setSample(next); setSelectedLine(null); }, []);
  const [spec, setSpec] = useState<SkillSpec>({ schemaVersion: "skill/v1" });
  const [parsingYamlDraft, setParsingYamlDraft] = useState<string | null>(null);
  const parsingYaml = parsingYamlDraft ?? stringify(spec.parsing ?? { schemaVersion: "parsing/v1", extractors: [] });
  const yamlInvalid = useMemo(() => {
    const parsed = parseParsingYaml(parsingYaml);
    return !!parsed.error || !parsingSpecSchema.safeParse(parsed.value).success;
  }, [parsingYaml]);
  const [revisions, setRevisions] = useState<SkillRevision[]>([]);
  const [stats, setStats] = useState<SectionProps["stats"]>();
  const [loadError, setLoadError] = useState<"missing" | "error" | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [dryRun, setDryRun] = useState<SkillDryRun | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => void } | null>(null);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const sectionNavigation = useRef(false);
  const base = skill?.draft ?? skill?.currentRevision;
  const dirty = !!base && (specJson(spec) !== specJson(base.spec) || parsingYamlDraft !== null);
  const disabled = !apiMode || !canEdit || pending;
  const selected = skillSections.find((s) => s.id === new URLSearchParams(search).get("section") && s.component) ?? skillSections[0];
  const Component = selected.component!;
  const loadGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadError(null);
    try {
      const found = apiMode ? await repository!.getLogSkill!(skillId) : mockSkillWorkspace(skillId);
      if (!found) { if (generation === loadGeneration.current) setLoadError("missing"); return; }
      const [history, summaries] = apiMode ? await Promise.all([repository!.listSkillRevisions!(skillId), repository!.listLogSkills?.({ includeArchived: true })])
        : [[found.currentRevision], mockLogSkills];
      if (generation !== loadGeneration.current) return;
      setSkill(found); setSpec(structuredClone((found.draft ?? found.currentRevision).spec)); setRevisions(history);
      setParsingYamlDraft(null);
      setStats(summaries?.find((s) => s.id === skillId)); setConflict(false); setError("");
    } catch (cause) {
      if (generation === loadGeneration.current) setLoadError(cause instanceof WiseEffApiError && cause.code === "NOT_FOUND" ? "missing" : "error");
    }
  }, [apiMode, repository, skillId]);
  useEffect(() => { void refresh(); return () => { loadGeneration.current++; }; }, [refresh]);
  useLayoutEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: Event) => {
      if (sectionNavigation.current) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (pending) return;
      if (!leaveDecision.current) {
        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((complete) => { resolve = complete; });
        leaveDecision.current = { promise, resolve };
      }
      (event as CustomEvent<SettingsLeaveRequest>).detail.decision = leaveDecision.current.promise;
      setConfirm({ title: "放弃未保存的更改？", description: "离开将放弃本页未保存的更改。", action: () => {
        leaveDecision.current?.resolve(true); leaveDecision.current = null;
      } });
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("wiseeff:settings-before-leave", guard); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("wiseeff:settings-before-leave", guard); window.removeEventListener("beforeunload", unload); leaveDecision.current?.resolve(false); leaveDecision.current = null; };
  }, [dirty, pending]);
  const run = async (action: () => Promise<void>) => {
    setPending(true); setError("");
    try { await action(); } catch (cause) {
      setPublishOpen(false);
      if (cause instanceof WiseEffApiError && cause.code === "LOG_SKILL_DRAFT_CONFLICT") setConflict(true);
      else setError(cause instanceof WiseEffApiError && Array.isArray(cause.details.issues) ? cause.details.issues.map((item: { path?: string[]; message?: string }) => `${item.path?.join(".")}：${item.message}`).join("；")
        : cause instanceof WiseEffApiError && cause.code === "LOG_SKILL_DRAFT_EXISTS" ? "请先发布或放弃现有草稿，再回滚版本。" : "操作失败，请重试。");
    } finally { setPending(false); }
  };
  const save = async () => {
    const cleaned = { ...spec, ...(spec.description !== undefined ? { description: spec.description.trim() } : {}) };
    if (cleaned.modelOverride?.trim()) cleaned.modelOverride = cleaned.modelOverride.trim(); else delete cleaned.modelOverride;
    const draft = await repository!.saveSkillDraft!(skillId, cleaned, skill!.draft?.id ?? null, skill!.currentRevision.id);
    setSkill({ ...skill!, draft }); setSpec(draft.spec);
    setParsingYamlDraft(null);
    setRevisions([draft, ...revisions.filter((r) => r.status !== "draft")]);
    return draft;
  };
  const ask = (title: string, description: string, action: () => void) => setConfirm({ title, description, action });
  const switchSection = (id: string) => {
    const query = new URLSearchParams(search); query.set("section", id);
    sectionNavigation.current = true;
    onNavigate(`/log-admin/skills/${encodeURIComponent(skillId)}?${query}`);
    sectionNavigation.current = false;
  };
  const back = () => onNavigate("/log-admin?tab=skills");
  if (loadError === "missing") return <SectionEmpty title="未找到分析技能" message="该技能不存在或不可访问。" actionLabel="返回分析技能" onAction={back} />;
  if (loadError) return <SectionError message="无法加载分析技能" onRetry={() => void refresh()} />;
  if (!skill) return <SectionSkeleton label="正在加载分析技能" />;
  return <div className="skill-workspace" aria-busy={pending}>
    <NavigatorWorkbench pageKey="log-skill-workspace" navigatorLabel="技能分区" taskLabel={selected.label}
      inspectorHidden={!["overview", "parsing", "decoding", "signals"].includes(selected.id)}
      inspectorLabel="样例日志" inspector={<SkillSamplePane key={skillId} skillId={skillId} repository={repository} apiMode={apiMode} canEdit={canEdit} onSampleChange={onSampleChange}
        selectedLine={selectedLine} onLineSelect={setSelectedLine} />}
      toolbar={<><Button variant="link" onClick={back}>返回分析技能</Button><strong>{skill.name}</strong>
        {apiMode && canEdit ? <Button variant="outline" disabled={dryRun?.status === "processing" ? pending : disabled || conflict || yamlInvalid || !sample || !repository?.startSkillDryRun || !repository?.getSkillDryRun}
          title={!sample ? "请先上传样例日志" : undefined} onClick={() => {
            if (dryRun?.status === "processing") { setDryRunOpen(true); return; }
            void run(async () => {
              if (dirty || !skill.draft) await save();
              const started = await repository!.startSkillDryRun!(skillId); setDryRun(started); setDryRunOpen(true);
            });
          }}>{dryRun?.status === "processing" ? "查看试运行" : "试运行"}</Button> : null}</>}
      context={<>
        {!apiMode || !canEdit ? <p>{!apiMode ? "演示技能仅供查看；请在 API 模式下编辑。" : "仅供查看；编辑需要技能管理权限。"}</p> : null}
        {skill.draft || dirty ? <div className="skill-draft-bar" role="group" aria-label="未发布更改"><strong>未发布更改</strong>
          <Button variant="outline" disabled={disabled} onClick={() => ask("放弃草稿？", skill.draft ? "将删除已保存的草稿并放弃未保存的更改，当前发布版本不受影响。" : "将放弃未保存的更改，当前发布版本不受影响。", () => {
            if (!skill.draft) { setSpec(structuredClone(skill.currentRevision.spec)); setParsingYamlDraft(null); return; }
            void run(async () => { await repository!.discardSkillDraft!(skillId, skill.draft!.id); await refresh(); });
          })}>放弃草稿</Button>
          <Button variant="outline" disabled={disabled || conflict || !dirty || yamlInvalid} onClick={() => void run(async () => { await save(); })}>保存草稿</Button>
          <Button disabled={disabled || conflict || yamlInvalid} onClick={() => setPublishOpen(true)}>发布</Button>
        </div> : null}
      </>}
      notice={conflict ? <div className="status-banner" data-tone="warning" role="alert"><p>草稿已被其他人更新</p><Button variant="outline" disabled={pending} onClick={() => ask("重新加载草稿？", "将丢弃本地更改并加载服务器上的最新草稿。", () => void run(refresh))}>重新加载</Button></div>
        : error ? <div className="status-banner" data-tone="danger" role="alert"><p>{error}</p></div> : undefined}
      navigator={<nav aria-label="技能分区导航">{skillSections.map((s) => <Button key={s.id} variant="ghost" disabled={!s.component || pending}
        aria-current={s.id === selected.id ? "page" : undefined} title={!s.component ? "即将推出" : undefined} onClick={() => switchSection(s.id)}>
        {s.label}{!s.component ? <small>即将推出</small> : null}</Button>)}</nav>}>
      <Component key={selected.id} skill={skill} spec={spec} setSpec={setSpec} disabled={disabled} stats={stats} revisions={revisions}
        sample={sample?.skillId === skillId ? sample : null} selectedLine={selectedLine}
        parsingYaml={parsingYaml} onParsingYamlChange={(text) => {
          setParsingYamlDraft(text);
          const parsed = parseParsingYaml(text);
          const validated = parsingSpecSchema.safeParse(parsed.value);
          if (!parsed.error && validated.success) setSpec({ ...spec, parsing: validated.data });
        }}
        repository={repository} apiMode={apiMode} canEdit={canEdit} dirty={dirty} onBusyChange={setPending}
        onSkillUpdated={(updated) => { setSkill(updated); setSpec(structuredClone((updated.draft ?? updated.currentRevision).spec));
          setRevisions((history) => [...(updated.draft ? [updated.draft] : []), ...history.filter((revision) => revision.status !== "draft")]); }}
        onRestore={(revision) => { if (dirty || skill.draft) { setError("请先发布或放弃现有草稿，再回滚版本。"); return; }
          ask(`回滚到 v${revision.number}？`, "此版本将发布为新的版本，历史记录保持不变。", () => void run(async () => {
            const restored = await repository!.restoreSkillRevision!(skillId, revision.id); onPublished(`已发布 v${restored.currentRevision.number}`); await refresh();
          })); }} />
    </NavigatorWorkbench>
    {dryRun && apiMode && canEdit ? <SkillDryRunDrawer key={dryRun.id} skillId={skillId} run={dryRun} repository={repository!}
      open={dryRunOpen} onClose={() => setDryRunOpen(false)} onRunChange={setDryRun} /> : null}
    <ModalDialog open={publishOpen} onDismiss={pending ? undefined : () => setPublishOpen(false)} className="skill-publish-dialog modal-card--lg">
      {({ titleId }) => <><h2 id={titleId}>发布技能</h2><SkillSpecDiff before={skill.currentRevision.spec} after={spec} />
        <div aria-label="发布提醒" />
        <div className="dialog-actions"><Button variant="outline" disabled={pending} onClick={() => setPublishOpen(false)}>取消</Button>
          <Button disabled={disabled || conflict || yamlInvalid} aria-busy={pending} onClick={() => void run(async () => {
            const draft = dirty ? await save() : skill.draft!;
            const published = await repository!.publishSkill!(skillId, draft.id); setPublishOpen(false);
            onPublished(`已发布 v${published.currentRevision.number}`); await refresh();
          })}>{pending ? "发布中…" : "发布"}</Button></div></>}
    </ModalDialog>
    <ConfirmDialog open={!!confirm} title={confirm?.title ?? "确认"} description={confirm?.description ?? ""} confirmLabel="确认" pending={pending}
      onCancel={() => { leaveDecision.current?.resolve(false); leaveDecision.current = null; setConfirm(null); }} onConfirm={() => { const action = confirm?.action; setConfirm(null); action?.(); }} />
  </div>;
}
