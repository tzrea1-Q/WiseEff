import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { historicalIdentityLabel } from "@/domain/identity/historicalAttribution";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { DataTable } from "@/components/admin/DataTable";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import type { SettingsLeaveRequest } from "@/application/settingsFormNavigation";
import { mockLogSkills, mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { formatPercent } from "@/domain/format/formatPercent";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import type { AnalysisSkill, SkillRevision, SkillSpec, SkillSample, ParseTestRun, ParsePreview, SkillDryRun, AnalysisCaseList } from "./types";
import { specJson } from "./diffSkillSpecs";
import { SkillSpecDiff } from "./SkillSpecDiff";
import { SkillSamplePane } from "./SkillSamplePane";
import { stringify } from "yaml";
import { ParsingSection, parseParsingYaml, boundedSamplePreview } from "./ParsingSection";
import { parsingSpecSchema, parseTestsSchema, logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { SignalsSection } from "./SignalsSection";
import { DecodingSection } from "./DecodingSection";
import { SourceSnapshots } from "./SourceSnapshots";
import { matchSkillFile } from "@/domain/logs/fileApplicability";
import { SkillDryRunDrawer } from "./SkillDryRunDrawer";
import { KnowledgeSection } from "./KnowledgeSection";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import { IntegrationSection } from "./IntegrationSection";
import { ParseTestsSection } from "./ParseTestsSection";
import { AnalysisCasesSection, AnalysisCasePublishSummary } from "./AnalysisCasesSection";
import { ExportSkillPackageDialog } from "./SkillPackageDialogs";
import { SkillDeletionDialog } from "./SkillDeletionDialog";
import type { SkillDeletionStatus } from "./types";
import "./skill-workspace.css";

export type SectionProps = { skill: AnalysisSkill; spec: SkillSpec; setSpec: (spec: SkillSpec) => void; disabled: boolean;
  sample: SkillSample | null;
  onSignalHit: (line: number) => void;
  selectedLine: number | null;
  parseTestRun: ParseTestRun | null; onRunTests: () => void;
  testsRunning: boolean; testRunDisabled: boolean; parseTestError?: string;
  onTestValidityChange: (invalid: boolean) => void;
  onLineSelect: (line: number) => void; onProfileValidityChange: (valid: boolean) => void;
  parsingYaml: string; onParsingYamlChange: (text: string) => void;
  revisions: SkillRevision[]; onRestore: (revision: SkillRevision) => void;
  repository?: Partial<LogAnalysisRepository>; apiMode: boolean; canEdit: boolean; dirty: boolean;
  knowledgeRepository?: KnowledgeRepository; knowledgeCapability?: KnowledgeCapability;
  canOpenKnowledge?: boolean;
  organizationId?: string;
  fieldErrors?: Record<string, string>;
  onSkillUpdated: (skill: AnalysisSkill) => void; onBusyChange: (busy: boolean) => void;
  onWebhookDirtyChange?: (dirty: boolean) => void;
  onNavigate?: (path: string) => void;
  beforeCaseRun: () => Promise<unknown>;
  testTab: "parse" | "cases"; onTestTabChange: (tab: "parse" | "cases") => void;
  onSectionChange?: (section: string, tab?: "parse" | "cases") => void;
  procedureEdited?: boolean;
  stats?: { analyses7d?: number; helpfulRate7d?: number | null } };
const time = (value: string | null) => value ? formatAbsolute(value).slice(0, 16).replaceAll("-", "/") : "尚未发布";
const status = { published: "当前", draft: "草稿", superseded: "已替代" };

function Parsing({ skill, spec, setSpec, parsingYaml, onParsingYamlChange, disabled, repository, sample, selectedLine, onLineSelect, onProfileValidityChange }: SectionProps) {
  return <ParsingSection skillId={skill.id} yaml={parsingYaml} onChange={onParsingYamlChange} disabled={disabled} repository={repository} sample={sample} files={spec.files}
    onFilesChange={(files) => { const next = { ...spec }; if (files === undefined) delete next.files; else next.files = files; setSpec(next); }}
    selectedLine={selectedLine} onLineSelect={onLineSelect} profile={spec.formatProfile} onProfileValidityChange={onProfileValidityChange}
    onProfileChange={(formatProfile) => { const next = { ...spec }; if (formatProfile === undefined) delete next.formatProfile; else next.formatProfile = formatProfile; setSpec(next); }} />;
}

function Signals({ skill, spec, setSpec, disabled, repository, sample, onSignalHit }: SectionProps) {
  return <SignalsSection skillId={skill.id} spec={spec} onChange={setSpec} disabled={disabled} repository={repository} sample={sample} onHit={onSignalHit} />;
}
function Decoding({ skill, spec, parsingYaml, onParsingYamlChange, disabled, repository, sample, selectedLine }: SectionProps) {
  return <DecodingSection skillId={skill.id} yaml={parsingYaml} onChange={onParsingYamlChange} disabled={disabled} repository={repository} sample={sample} files={spec.files} selectedLine={selectedLine} />;
}

function Tests({ skill, spec, setSpec, disabled, repository, apiMode, canEdit, dirty, sample, selectedLine, parseTestRun, testsRunning, testRunDisabled, parseTestError, onRunTests, onBusyChange, onTestValidityChange, beforeCaseRun, testTab, onTestTabChange }: SectionProps) {
  const id = useId();
  const [cases, setCases] = useState<AnalysisCaseList | null>(null);
  const caseRun = cases?.latestRun;
  const casesCurrent = cases?.current && !dirty && caseRun?.status === "complete" && caseRun.skillRevisionId === skill.draft?.id;
  return <section className="skill-section skill-tests" aria-label="测试"><h2>测试</h2>
    <ViewSwitch variant="tabs" ariaLabel="测试类型" value={testTab} onValueChange={(value) => onTestTabChange(value as "parse" | "cases")} items={[
      { value: "parse", label: <>解析测试 <small>{testsRunning ? "运行中" : parseTestRun ? `通过 ${parseTestRun.passed} / ${parseTestRun.total}` : "未运行"}</small></>, id: `${id}-parse`, panelId: `${id}-parse-panel` },
      { value: "cases", label: <>分析用例 <small>{casesCurrent ? `通过 ${caseRun.results.filter((result) => result.draft.passed).length} / ${cases.items.length}` : "未运行"}</small></>, id: `${id}-cases`, panelId: `${id}-cases-panel` }
    ]} />
    <TabPanel id={`${id}-parse-panel`} aria-labelledby={`${id}-parse`} hidden={testTab !== "parse"}>
      <ParseTestsSection key={(skill.draft ?? skill.currentRevision).id} skillId={skill.id} spec={spec} setSpec={setSpec} disabled={disabled} repository={repository}
        sample={sample} selectedLine={selectedLine} result={parseTestRun} running={testsRunning} runDisabled={testRunDisabled} runError={parseTestError} onRun={onRunTests} onBusyChange={onBusyChange} onValidityChange={onTestValidityChange} />
    </TabPanel>
    <TabPanel id={`${id}-cases-panel`} aria-labelledby={`${id}-cases`} hidden={testTab !== "cases"}>
      <AnalysisCasesSection skillId={skill.id} repository={apiMode ? repository : undefined} canEdit={canEdit && !disabled} beforeRun={beforeCaseRun} onResultsChange={setCases}
        draftId={skill.draft?.id ?? null} dirty={dirty} />
    </TabPanel>
  </section>;
}

const procedureOutline = ["适用场景", "先检查什么", "根因判定", "常见误判", "建议动作"]
  .map((heading) => `## ${heading}\n请补充${heading}。`).join("\n\n");

function Procedure({ spec, setSpec, disabled, procedureEdited }: SectionProps) {
  const [view, setView] = useState("edit");
  const id = useId();
  const procedure = spec.procedure === procedureOutline && !procedureEdited ? "" : spec.procedure ?? "";
  const preview = useMemo(() => renderMarkdownPreview(procedure), [procedure]);
  return <section className="skill-section" aria-label="诊断流程"><h2>诊断流程</h2>
    <div className="skill-section-toolbar"><ViewSwitch variant="tabs" ariaLabel="诊断流程视图" value={view} onValueChange={setView} items={[
      { value: "edit", label: "编辑", id: `${id}-edit`, panelId: `${id}-edit-panel` },
      { value: "preview", label: "预览", id: `${id}-preview`, panelId: `${id}-preview-panel` }
    ]} /><Button variant="secondary" size="sm" disabled={disabled || !!procedure} onClick={() => setSpec({ ...spec, procedure: procedureOutline })}>插入提纲</Button></div>
    <TabPanel id={`${id}-edit-panel`} aria-labelledby={`${id}-edit`} hidden={view !== "edit"}>
      <label>诊断流程内容<Textarea disabled={disabled} rows={18} maxLength={20000} value={procedure} placeholder={procedureOutline}
        aria-describedby={`${id}-count`} onChange={(event) => setSpec({ ...spec, procedure: event.target.value })} /></label>
    </TabPanel>
    <TabPanel id={`${id}-preview-panel`} aria-labelledby={`${id}-preview`} hidden={view !== "preview"}>
      <div className="knowledge-markdown-preview" dangerouslySetInnerHTML={{ __html: preview }} />
    </TabPanel>
    <p id={`${id}-count`}>{procedure.length} / 20000 字符</p>
  </section>;
}

function Overview({ skill, spec, setSpec, disabled, stats, fieldErrors, sample, parseTestRun, repository, apiMode, dirty, onSectionChange }: SectionProps) {
  const [cases, setCases] = useState<AnalysisCaseList | null>(null);
  const [casesError, setCasesError] = useState(false);
  useEffect(() => {
    let active = true;
    setCases(null); setCasesError(false);
    if (apiMode && repository?.listAnalysisCases) void repository.listAnalysisCases(skill.id)
      .then((result) => { if (active) setCases(result); }).catch(() => { if (active) setCasesError(true); });
    return () => { active = false; };
  }, [apiMode, repository, skill.id, skill.draft?.id]);
  const caseRun = cases?.latestRun;
  const casesCurrent = cases?.current && !dirty && caseRun?.status === "complete" && caseRun.skillRevisionId === skill.draft?.id;
  const checks = [
    { label: "样例日志", value: sample ? "已上传" : "未上传", section: "parsing" },
    { label: "解析测试", value: parseTestRun ? `通过 ${parseTestRun.passed}/${parseTestRun.total}` : "未运行", section: "tests", tab: "parse" as const },
    { label: "分析用例", value: casesError ? "暂时无法读取" : casesCurrent ? `通过 ${caseRun.results.filter((result) => result.draft.passed).length}/${cases.items.length}` : "未运行", section: "tests", tab: "cases" as const },
    { label: "默认源码快照（可选）", value: spec.defaultSourceSnapshotId ? "已配置" : "未配置", section: "source" }
  ];
  return <section className="skill-section" aria-label="概览">
    <h2>概览</h2>
    {skill.currentRevision.status !== "draft" ? <p>v{skill.currentRevision.number} · {historicalIdentityLabel(skill.currentRevision.historicalAttribution?.actors.published_by_user_id)} 发布于 {time(skill.currentRevision.publishedAt)}</p> : null}
    <dl className="skill-facts"><dt>近 7 天分析</dt><dd>{stats?.analyses7d ?? "暂无数据"}</dd>
      <dt>有帮助率</dt><dd>{stats?.helpfulRate7d == null ? "暂无反馈" : formatPercent(stats.helpfulRate7d)}</dd>
    </dl>
    <label>描述<Textarea maxLength={2000} disabled={disabled} value={spec.description ?? skill.description ?? ""}
      onChange={(event) => setSpec({ ...spec, description: event.target.value })} /></label>
    <section aria-label="运行设置"><h3>运行设置</h3><p>模型和预算随技能草稿保存并发布；留空使用平台默认值。</p>
      <label>模型覆盖<Input maxLength={200} disabled={disabled} value={spec.modelOverride ?? ""} placeholder="使用平台默认模型"
        onChange={(event) => { const next = { ...spec }; if (event.target.value) next.modelOverride = event.target.value; else delete next.modelOverride; setSpec(next); }} /></label>
      {([['stepBudget', '步骤预算'], ['tokenBudget', '令牌预算']] as const).map(([field, label]) => <div key={field}><label>{label}<Input type="number" min={field === "tokenBudget" ? Math.min(4096, skill.budgetCaps?.tokenBudget ?? 4096) : 1} step={1}
        max={skill.budgetCaps?.[field]} disabled={disabled} value={spec[field] ?? ""} placeholder="使用平台默认预算"
        aria-invalid={!!fieldErrors?.[field]} aria-describedby={`skill-${field}-help${fieldErrors?.[field] ? ` skill-${field}-error` : ""}`}
        onChange={(event) => { const next = { ...spec }; if (event.target.value) next[field] = Number(event.target.value); else delete next[field]; setSpec(next); }} /></label>
        <div className="skill-budget-help"><span id={`skill-${field}-help`}>最小 {field === "tokenBudget" ? Math.min(4096, skill.budgetCaps?.tokenBudget ?? 4096) : 1}，{skill.budgetCaps ? `上限 ${skill.budgetCaps[field]}` : "上限由服务器校验"}</span>
          {field === "tokenBudget" ? <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" aria-label="令牌预算说明">说明</Button></TooltipTrigger>
            <TooltipContent>每次模型调用前检查累计令牌用量，单次调用可能超出预算；留空使用平台默认预算。</TooltipContent></Tooltip></TooltipProvider> : null}
        </div>
        {fieldErrors?.[field] ? <p id={`skill-${field}-error`} role="alert" className="skill-field-error">{fieldErrors[field]}</p> : null}
      </div>)}
    </section>
    <section aria-label="发布前检查"><h3>发布前检查</h3><ul className="skill-prepublish-checks">{checks.map((check) => <li key={check.label}>
      <Button variant="link" onClick={() => onSectionChange?.(check.section, check.tab)}>{check.label}</Button><span>{check.value}</span>
    </li>)}</ul></section>
  </section>;
}

function Versions({ skill, revisions, disabled, onRestore, repository, apiMode, canEdit, dirty }: SectionProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [leftId, setLeftId] = useState(revisions.find((r) => r.status === "superseded")?.id ?? skill.currentRevision.id);
  const [rightId, setRightId] = useState<string | null>(null);
  const left = revisions.find((r) => r.id === leftId) ?? skill.currentRevision;
  const right = revisions.find((r) => r.id === rightId) ?? skill.currentRevision;
  return <section className="skill-section" aria-label="版本"><header className="flex items-center justify-between gap-3"><h2>版本</h2>
    {apiMode && canEdit ? <Button variant="outline" disabled={disabled || !repository?.exportSkillPackage} onClick={() => setExportOpen(true)}>导出技能包</Button> : null}</header>
    {exportOpen && repository ? <ExportSkillPackageDialog skill={skill} dirty={dirty} repository={repository} onDismiss={() => setExportOpen(false)} /> : null}
    <DataTable rows={revisions} rowKey={(r) => r.id} ariaLabel="技能版本历史" selectedRowKey={left.id} columns={[
      { key: "number", header: "版本", render: (r) => <Button variant="link" size="sm" onClick={() => { setLeftId(r.id); setRightId(null); }}>v{r.number}</Button> },
      { key: "status", header: "状态", render: (r) => <span className="badge">{status[r.status]}</span> },
      { key: "publishedAt", header: "发布时间", render: (r) => time(r.publishedAt) },
      { key: "publisher", header: "发布者", render: (r) => r.status === "draft" ? "尚未发布" : historicalIdentityLabel(r.historicalAttribution?.actors.published_by_user_id) },
      { key: "restore", header: "操作", render: (r) => r.status === "superseded" ? <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRestore(r)}>回滚到此版本</Button> : null }
    ]} />
    {revisions.length >= 2 ? <><div className="skill-compare-selectors">{(["left", "right"] as const).map((side) => <label key={side}>{side === "left" ? "变更前版本" : "变更后版本"}
      <SelectControl value={side === "left" ? left.id : right.id} ariaLabel={side === "left" ? "变更前版本" : "变更后版本"}
        onValueChange={side === "left" ? setLeftId : (id) => setRightId(id === skill.currentRevision.id ? null : id)} options={revisions.map((r) => ({ value: r.id, label: `v${r.number} · ${status[r.status]}` }))} />
    </label>)}</div><SkillSpecDiff before={left.spec} after={right.spec} /></> : null}
  </section>;
}

export const skillSections: Array<{ id: string; label: string; component?: ComponentType<SectionProps>; inspectorHidden?: boolean }> = [
  { id: "overview", label: "概览", component: Overview, inspectorHidden: true }, { id: "procedure", label: "诊断流程", component: Procedure, inspectorHidden: true },
  { id: "parsing", label: "样例与解析", component: Parsing }, { id: "decoding", label: "解码", component: Decoding }, { id: "signals", label: "信号", component: Signals },
  { id: "knowledge", label: "知识", component: KnowledgeSection, inspectorHidden: true }, { id: "source", label: "源码", component: SourceSnapshots, inspectorHidden: true }, { id: "tests", label: "测试", component: Tests },
  { id: "integration", label: "集成", component: IntegrationSection, inspectorHidden: true }, { id: "versions", label: "版本", component: Versions, inspectorHidden: true }
];

export function SkillWorkspace({ skillId, search, repository, apiMode, canEdit, knowledgeRepository, knowledgeCapability, canOpenKnowledge = true, onNavigate, onPublished }: {
  skillId: string; search: string; repository?: Partial<LogAnalysisRepository>; apiMode: boolean; canEdit: boolean;
  onNavigate: (path: string) => void; onPublished: (message: string) => void;
  knowledgeRepository?: KnowledgeRepository; knowledgeCapability?: KnowledgeCapability;
  canOpenKnowledge?: boolean;
}) {
  const [skill, setSkill] = useState<AnalysisSkill | null>(null);
  const [sample, setSample] = useState<SkillSample | null>(null);
  const [highlight, setHighlight] = useState({ line: null as number | null, request: 0 });
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const updateSample = useCallback((next: SkillSample | null) => { setSample(next); setHighlight((value) => ({ ...value, line: null })); setSelectedLine(null); }, []);
  const [spec, setSpec] = useState<SkillSpec>({ schemaVersion: "skill/v1" });
  const [procedureEdited, setProcedureEdited] = useState(false);
  const [testExecution, setTestExecution] = useState<{ specKey: string; run: ParseTestRun } | null>(null);
  const [testsRunning, setTestsRunning] = useState(false);
  const [testError, setTestError] = useState<{ specKey: string; message: string } | null>(null);
  const parseTestError = testError?.specKey === specJson(spec) ? testError.message : undefined;
  const [testsEditorInvalid, setTestsEditorInvalid] = useState(false);
  const parseTestRun = !testsEditorInvalid && testExecution?.specKey === specJson(spec) ? testExecution.run : null;
  const [parsingYamlDraft, setParsingYamlDraft] = useState<string | null>(null);
  const [editReset, setEditReset] = useState(0);
  const testsInvalid = testsEditorInvalid || !parseTestsSchema.safeParse(spec.parseTests ?? []).success;
  const [formatValid, setFormatValid] = useState(true);
  const [webhookDirty, setWebhookDirty] = useState(false);
  const [retainedSections, setRetainedSections] = useState<string[]>([]);
  const [editorReset, setEditorReset] = useState(0);
  const parsingYaml = parsingYamlDraft ?? stringify(spec.parsing ?? { schemaVersion: "parsing/v1", extractors: [] });
  const yamlInvalid = useMemo(() => {
    const parsed = parseParsingYaml(parsingYaml);
    return !!parsed.error || !parsingSpecSchema.safeParse(parsed.value).success;
  }, [parsingYaml]);
  const signalsInvalid = useMemo(() => !logSkillSpecSchema.safeParse(spec).success, [spec]);
  const [revisions, setRevisions] = useState<SkillRevision[]>([]);
  const [stats, setStats] = useState<SectionProps["stats"]>();
  const [loadError, setLoadError] = useState<"missing" | "error" | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deleted, setDeleted] = useState<SkillDeletionStatus>();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const budgetErrors: Record<string, string> = {};
  for (const field of ["stepBudget", "tokenBudget"] as const) {
    const value = spec[field];
    const minimum = field === "tokenBudget" ? Math.min(4096, skill?.budgetCaps?.tokenBudget ?? 4096) : 1;
    const cap = skill?.budgetCaps?.[field];
    if (value !== undefined && (!Number.isInteger(value) || value < minimum || (cap !== undefined && value > cap))) {
      budgetErrors[field] = `预算须为整数，最小值为 ${minimum}${cap === undefined ? "" : `，且不得超过平台上限 ${cap}`}。`;
    }
  }
  const budgetInvalid = Object.keys(budgetErrors).length > 0;
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [dryRun, setDryRun] = useState<SkillDryRun | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => void; confirmLabel?: string; tone?: "danger" } | null>(null);
  const leaveDecision = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(null);
  const sectionNavigation = useRef(false);
  const base = skill?.draft ?? skill?.currentRevision;
  const dirty = !deleted && !!base && (specJson(spec) !== specJson(base.spec) || parsingYamlDraft !== null || !formatValid);
  const disabled = !apiMode || !canEdit || pending;
  const [lastTestTab, setLastTestTab] = useState<"parse" | "cases">("parse");
  useEffect(() => {
    const query = new URLSearchParams(search);
    if (query.get("section") === "tests") setLastTestTab(query.get("tab") === "cases" ? "cases" : "parse");
  }, [search]);
  const selected = skillSections.find((s) => s.id === new URLSearchParams(search).get("section") && s.component) ?? skillSections[0];
  useEffect(() => {
    if (selected.id === "parsing" || selected.id === "integration") setRetainedSections((ids) => ids.includes(selected.id) ? ids : [...ids, selected.id]);
  }, [selected.id]);
  const highlightSpec = useMemo(() => {
    const parsed = parseParsingYaml(parsingYaml);
    const result = parsingSpecSchema.safeParse(parsed.value);
    return !parsed.error && result.success ? result.data : null;
  }, [parsingYaml]);
  const sampleSkillMatched = !!sample && logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files: spec.files }).success
    && matchSkillFile(spec.files, sample.contentFilePath ?? sample.fileName).skillMatched;
  const [highlightOutcome, setHighlightOutcome] = useState<{ yaml: string; sample: SkillSample; files: SkillSpec["files"]; preview?: ParsePreview; error?: string } | null>(null);
  const currentHighlights = sampleSkillMatched && highlightOutcome?.yaml === parsingYaml && highlightOutcome.sample === sample && highlightOutcome.files === spec.files ? highlightOutcome : null;
  useEffect(() => {
    if (!apiMode || !sample || !sampleSkillMatched || !highlightSpec?.extractors.length || !repository?.parsePreview) return;
    let active = true;
    const timer = setTimeout(() => {
      void repository.parsePreview!(skillId, { parsing: highlightSpec, sampleText: boundedSamplePreview(sample.content).content, fileName: sample.contentFilePath ?? sample.fileName })
        .then((preview) => { if (active) setHighlightOutcome({ yaml: parsingYaml, sample, files: spec.files, preview }); })
        .catch(() => { if (active) setHighlightOutcome({ yaml: parsingYaml, sample, files: spec.files, error: "无法高亮匹配行，请检查解析规则后重试。" }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [apiMode, skillId, sample, sampleSkillMatched, spec.files, highlightSpec, parsingYaml, repository]);
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
      setSkill(found); setSpec(structuredClone((found.draft ?? found.currentRevision).spec)); setRevisions(history); setProcedureEdited(false);
      setParsingYamlDraft(null); setFormatValid(true); setEditorReset((value) => value + 1);
      setEditReset((generation) => generation + 1);
      const loadedRevision = found.draft ?? found.currentRevision;
      setTestExecution(loadedRevision.parseTestRun ? { specKey: specJson(loadedRevision.spec), run: loadedRevision.parseTestRun } : null);
      setTestError(null);
      setStats(summaries?.find((s) => s.id === skillId)); setConflict(false); setError("");
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "NOT_FOUND" && repository?.getSkillDeletionStatus) {
        try { const item = await repository.getSkillDeletionStatus(skillId); if (generation === loadGeneration.current) setDeleted(item); return; } catch { /* A missing receipt retains the normal missing state. */ }
      }
      if (generation === loadGeneration.current) setLoadError(cause instanceof WiseEffApiError && cause.code === "NOT_FOUND" ? "missing" : "error");
    }
  }, [apiMode, repository, skillId]);
  useEffect(() => { void refresh(); return () => { loadGeneration.current++; }; }, [refresh]);
  useLayoutEffect(() => {
    if (!dirty && !webhookDirty && !pending) return;
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
      setConfirm({ title: "放弃未保存的更改？", description: "离开将放弃本页未保存的更改。", confirmLabel: "放弃更改", tone: "danger", action: () => {
        leaveDecision.current?.resolve(true); leaveDecision.current = null;
      } });
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("wiseeff:settings-before-leave", guard); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("wiseeff:settings-before-leave", guard); window.removeEventListener("beforeunload", unload); leaveDecision.current?.resolve(false); leaveDecision.current = null; };
  }, [dirty, webhookDirty, pending]);
  const run = async (action: () => Promise<void>) => {
    setPending(true); setError(""); setFieldErrors({});
    try { await action(); return true; } catch (cause) {
      setPublishOpen(false);
      if (cause instanceof WiseEffApiError && Array.isArray(cause.details.issues)) {
        setFieldErrors(Object.fromEntries(cause.details.issues.map((item: { path?: string[]; message?: string }) => {
          const field = item.path?.at(-1) ?? "";
          return [field, item.message && /[\u3400-\u9fff]/.test(item.message) ? item.message : "字段值无效，请检查后重试。"];
        })));
      }
      if (cause instanceof WiseEffApiError && cause.code === "LOG_SKILL_DRAFT_CONFLICT") setConflict(true);
      else setError(cause instanceof WiseEffApiError && Array.isArray(cause.details.issues) ? "字段校验未通过，请检查标记的字段后重试。" : "操作失败，请重试。");
      return false;
    } finally { setPending(false); }
  };
  const save = async () => {
    const cleaned = { ...spec, ...(spec.description !== undefined ? { description: spec.description.trim() } : {}) };
    if (cleaned.modelOverride?.trim()) cleaned.modelOverride = cleaned.modelOverride.trim(); else delete cleaned.modelOverride;
    if (cleaned.parseTests) { setTestsRunning(true); setTestError(null); }
    try {
      const draft = await repository!.saveSkillDraft!(skillId, cleaned, skill!.draft?.id ?? null, skill!.currentRevision.id);
      setSkill({ ...skill!, draft, currentRevision: skill!.currentRevision.status === "draft" ? draft : skill!.currentRevision }); setSpec(draft.spec);
      setParsingYamlDraft(null);
      setRevisions([draft, ...revisions.filter((r) => r.status !== "draft")]);
      if (draft.parseTestRun) setTestExecution({ specKey: specJson(draft.spec), run: draft.parseTestRun });
      else if (draft.spec.parseTests && repository?.runSkillParseTests) {
        const result = await repository.runSkillParseTests(skillId, draft.spec);
        setTestExecution({ specKey: specJson(draft.spec), run: result });
      }
      return draft;
    } finally { setTestsRunning(false); }
  };
  const executeTests = async () => {
    if (!repository?.runSkillParseTests) return;
    setTestsRunning(true); setTestError(null);
    try {
      const result = await repository.runSkillParseTests(skillId, spec);
      setTestExecution({ specKey: specJson(spec), run: result });
    } catch { setTestExecution(null); setTestError({ specKey: specJson(spec), message: "解析测试暂时无法运行，请重试。仍可发布技能。" }); }
    finally { setTestsRunning(false); }
  };
  const ask = (title: string, description: string, action: () => void, confirmLabel?: string) => setConfirm({ title, description, action, confirmLabel, tone: confirmLabel ? "danger" : undefined });
  const switchSection = (id: string, tab?: "parse" | "cases") => {
    setError("");
    const query = new URLSearchParams(search); query.set("section", id);
    if (id === "tests") query.set("tab", tab ?? lastTestTab);
    else query.delete("tab");
    sectionNavigation.current = true;
    onNavigate(`/log-admin/skills/${encodeURIComponent(skillId)}?${query}`);
    sectionNavigation.current = false;
  };
  const back = () => onNavigate("/log-admin?tab=skills");
  const startDryRun = async () => {
    if (dryRunReason) throw new Error(dryRunReason);
    if (dirty || !skill!.draft) await save();
    const started = await repository!.startSkillDryRun!(skillId);
    setDryRun(started); setDryRunOpen(true);
    return started;
  };
  if (deleted) return <><SectionEmpty title="实验技能已删除" message={deleted.objects === "pending" ? "数据库已删除，仍有对象待清理。" : "数据库及独占对象已清理完成。"} actionLabel="返回分析技能" onAction={back} />
    {deleted.objects === "pending" && !deletionOpen ? <Button onClick={() => setDeletionOpen(true)}>继续清理对象</Button> : null}
    {deletionOpen && repository ? <SkillDeletionDialog key={skillId} skillId={skillId} repository={repository} initialStatus={deleted} onDeleted={setDeleted} onDismiss={() => setDeletionOpen(false)} onNavigate={onNavigate} /> : null}</>;
  if (loadError === "missing") return <SectionEmpty title="未找到分析技能" message="该技能不存在或不可访问。" actionLabel="返回分析技能" onAction={back} />;
  if (loadError) return <SectionError message="无法加载分析技能" onRetry={() => void refresh()} />;
  if (!skill) return <SectionSkeleton label="正在加载分析技能" />;
  const dryRunReason = pending ? "请等待当前操作完成" : dryRun?.status === "processing" ? "" : conflict ? "请先重新加载草稿"
    : !sample ? "先上传样例日志" : yamlInvalid || testsInvalid || signalsInvalid || budgetInvalid || !formatValid ? "请先修正草稿错误"
    : !repository?.startSkillDryRun || !repository?.getSkillDryRun ? "当前无法试运行" : "";
  const workspaceStatus = skill.currentRevision.status === "draft" ? "尚未发布" : skill.draft || dirty ? "有未发布更改" : `已发布 v${skill.currentRevision.number}`;
  return <div className="skill-workspace" aria-busy={pending}>
    <NavigatorWorkbench pageKey="log-skill-workspace" navigatorLabel="技能分区" taskLabel={selected.label}
      inspectorHidden={selected.inspectorHidden ?? false}
      inspectorLabel="样例日志" inspector={<SkillSamplePane key={skillId} skillId={skillId} repository={repository} apiMode={apiMode} canEdit={canEdit} onSampleChange={updateSample} highlightedLine={highlight.line} highlightRequest={highlight.request}
        selectedLine={selectedLine} onLineSelect={setSelectedLine} extractors={highlightSpec?.extractors}
        highlightPreview={currentHighlights?.preview} highlightError={currentHighlights?.error} />}
      toolbar={<header className="skill-workspace-header"><Button variant="link" asChild><a href={withOrganizationScope("/log-admin?tab=skills", new URLSearchParams(search).get("organizationId") ?? undefined)} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); back(); } }}>← 分析技能</a></Button>
        <div className="skill-workspace-identity"><h1 title={skill.name}>{skill.name}</h1><span className="badge" role="status">{workspaceStatus}</span></div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Disabled buttons cannot receive focus; the wrapper exposes their reason to keyboard users. */}
        {apiMode && canEdit ? <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="skill-dry-run-action" tabIndex={dryRunReason ? 0 : undefined}>
          <span className="sr-only" id="skill-dry-run-reason">{dryRunReason}</span><Button variant="outline" disabled={!!dryRunReason}
          aria-describedby={dryRunReason ? "skill-dry-run-reason" : undefined} onClick={() => {
            if (dryRun?.status === "processing") { setDryRunOpen(true); return; }
            void run(async () => {
              await startDryRun();
            });
          }}>{dryRun?.status === "processing" ? "查看试运行" : "试运行"}</Button></span></TooltipTrigger>
          {dryRunReason ? <TooltipContent>{dryRunReason}</TooltipContent> : null}</Tooltip></TooltipProvider> : null}
        <div className="skill-draft-actions-slot">{skill.draft || dirty ? <div className="skill-draft-bar" role="group" aria-label="未发布更改">
          {skill.currentRevision.status === "draft" && repository?.previewSkillDeletion ? <Button variant="ghost" disabled={disabled} onClick={() => setDeletionOpen(true)}>彻底删除…</Button> : <Button variant="ghost" disabled={disabled || (skill.currentRevision.status === "draft" && !dirty)} onClick={() => ask("放弃草稿？", skill.currentRevision.status === "draft" ? "将放弃未保存的更改，保留已导入的首个草稿。" : skill.draft ? "将删除已保存的草稿并放弃未保存的更改，当前发布版本不受影响。" : "将放弃未保存的更改，当前发布版本不受影响。", () => {
            if (skill.currentRevision.status === "draft") { setSpec(structuredClone((skill.draft ?? skill.currentRevision).spec)); setProcedureEdited(false); setParsingYamlDraft(null); setFormatValid(true); setEditorReset((value) => value + 1); setEditReset((generation) => generation + 1); return; }
            if (!skill.draft) { setSpec(structuredClone(skill.currentRevision.spec)); setProcedureEdited(false); setParsingYamlDraft(null); setFormatValid(true); setEditorReset((value) => value + 1); setEditReset((generation) => generation + 1); return; }
            void run(async () => { await repository!.discardSkillDraft!(skillId, skill.draft!.id); await refresh(); });
          }, "放弃草稿")}>放弃草稿</Button>}
          <Button variant="outline" disabled={disabled || conflict || !dirty || yamlInvalid || budgetInvalid || testsInvalid || signalsInvalid || !formatValid} onClick={() => void run(async () => { await save(); })}>保存草稿</Button>
          <Button disabled={disabled || conflict || yamlInvalid || budgetInvalid || testsInvalid || signalsInvalid || !formatValid} onClick={() => { setPublishOpen(true); if (repository?.runSkillParseTests) void run(executeTests); }}>发布</Button>
        </div> : null}</div></header>}
      context={!apiMode || !canEdit ? <p>{!apiMode ? "演示技能仅供查看；请在 API 模式下编辑。" : "仅供查看；编辑需要技能管理权限。"}</p> : undefined}
      notice={conflict ? <div className="status-banner" data-tone="warning" role="alert"><p>草稿已被其他人更新</p><Button variant="outline" disabled={pending} onClick={() => ask("重新加载草稿？", "将丢弃本地更改并加载服务器上的最新草稿。", () => void run(refresh), "重新加载")}>重新加载</Button></div>
        : error ? <div className="status-banner" data-tone="danger" role="alert"><p>{error}</p></div> : undefined}
      navigator={<nav aria-label="技能分区导航">{skillSections.map((s) => <Button key={s.id} variant="ghost" disabled={!s.component || pending}
        aria-current={s.id === selected.id ? "page" : undefined} title={!s.component ? "即将推出" : undefined} onClick={() => switchSection(s.id)}>
        {s.label}{!s.component ? <small>即将推出</small> : null}</Button>)}</nav>}>
      {skillSections.filter((section) => section.id === selected.id || retainedSections.includes(section.id)).map((section) => {
        const Section = section.component!;
        return <div key={section.id} hidden={section.id !== selected.id}><Section key={section.id === "tests" || section.id === "procedure" ? `${section.id}:${skillId}:${editReset}` : section.id === "parsing" ? `parsing-${editorReset}` : `${section.id}:${skillId}`} skill={skill} spec={spec} setSpec={(next) => { if (section.id === "procedure") setProcedureEdited(true); setSpec(next); setFieldErrors({}); }} disabled={disabled} stats={stats} revisions={revisions} fieldErrors={{ ...fieldErrors, ...budgetErrors }}
        onSectionChange={switchSection} procedureEdited={procedureEdited}
        testTab={new URLSearchParams(search).get("tab") === "cases" ? "cases" : "parse"} onTestTabChange={(tab) => switchSection("tests", tab)}
        sample={sample?.skillId === skillId ? sample : null} selectedLine={selectedLine} onLineSelect={setSelectedLine} onProfileValidityChange={setFormatValid}
        parseTestRun={parseTestRun} testsRunning={testsRunning} testRunDisabled={yamlInvalid || testsInvalid || signalsInvalid || !formatValid} parseTestError={parseTestError} onRunTests={() => void run(executeTests)} onTestValidityChange={setTestsEditorInvalid}
        onSignalHit={(line) => setHighlight((value) => ({ line, request: value.request + 1 }))}
        parsingYaml={parsingYaml} onParsingYamlChange={(text) => {
          setParsingYamlDraft(text);
          const parsed = parseParsingYaml(text);
          const validated = parsingSpecSchema.safeParse(parsed.value);
          if (!parsed.error && validated.success) setSpec({ ...spec, parsing: validated.data });
        }}
        repository={repository} apiMode={apiMode} canEdit={canEdit} dirty={dirty} onBusyChange={setPending} onWebhookDirtyChange={setWebhookDirty} onNavigate={onNavigate}
        beforeCaseRun={async () => {
          if (pending || yamlInvalid || testsInvalid || !formatValid || conflict) throw new Error("请先修正草稿错误再运行用例。");
          if ((dirty || !skill.draft) && !await run(async () => { await save(); })) throw new Error("草稿保存失败，请重试后再运行用例。");
        }}
        knowledgeRepository={knowledgeRepository} knowledgeCapability={knowledgeCapability} canOpenKnowledge={canOpenKnowledge} organizationId={new URLSearchParams(search).get("organizationId") ?? undefined}
        onSkillUpdated={(updated) => { setSkill(updated); if (updated.currentRevision !== skill.currentRevision || updated.draft !== skill.draft) setSpec(structuredClone((updated.draft ?? updated.currentRevision).spec));
          setRevisions((history) => [...(updated.draft ? [updated.draft] : []), ...history.filter((revision) => revision.status !== "draft")]); }}
        onRestore={(revision) => {
          ask(`回滚到 v${revision.number}？`, "回滚将替换当前未发布的草稿，并放弃本地未保存的更改。此版本将发布为新的版本，历史记录保持不变。", () => void run(async () => {
            const restored = await repository!.restoreSkillRevision!(skillId, revision.id); setRetainedSections((ids) => ids.filter((id) => id !== "integration")); setWebhookDirty(false); onPublished(`已发布 v${restored.currentRevision.number}`); await refresh();
          })); }} /></div>;
      })}
    </NavigatorWorkbench>
    {dryRun && apiMode && canEdit ? <SkillDryRunDrawer key={dryRun.id} skillId={skillId} run={dryRun} repository={repository!}
      open={dryRunOpen} onClose={() => setDryRunOpen(false)} onRunChange={setDryRun} onRetry={async () => {
        let started!: SkillDryRun;
        if (!await run(async () => { started = await startDryRun(); })) throw new Error("无法开始试运行，请检查草稿后重试。");
        return started;
      }} retryDisabled={!!dryRunReason} /> : null}
    <ModalDialog open={publishOpen} onDismiss={pending ? undefined : () => setPublishOpen(false)} className="skill-publish-dialog modal-card--lg">
      {({ titleId }) => <><h2 id={titleId}>发布技能</h2>
        <section className="skill-publish-test-summary" aria-label="发布前测试"><h3>发布前测试</h3>
          <section aria-label="发布前解析测试" aria-busy={testsRunning}>
          <p role="status"><strong>{testsRunning ? "解析测试：运行中…" : parseTestRun ? `解析测试：通过 ${parseTestRun.passed} / ${parseTestRun.total}` : "解析测试：未运行"}</strong></p>
          {!testsRunning && parseTestRun?.failed ? <><p>失败测试：{parseTestRun.results.filter((test) => !test.passed).map((test) => test.name).join("、")}</p>
            <Button variant="link" onClick={() => { setPublishOpen(false); switchSection("tests", "parse"); }}>查看失败测试</Button></> : null}
          {parseTestError ? <p role="alert">{parseTestError}</p> : null}
          </section>
          <AnalysisCasePublishSummary skillId={skillId} draftId={skill.draft?.id} dirty={dirty} repository={repository}
            onRun={() => { setPublishOpen(false); switchSection("tests", "cases"); }} />
          <p>测试结果仅供参考，不阻止发布。</p>
        </section>
        <SkillSpecDiff before={skill.currentRevision.status === "draft" ? { schemaVersion: "skill/v1" } : skill.currentRevision.spec} after={spec} />
        <div className="dialog-actions"><Button variant="outline" disabled={pending} onClick={() => setPublishOpen(false)}>取消</Button>
          <Button disabled={disabled || conflict || yamlInvalid || budgetInvalid || testsInvalid || signalsInvalid || !formatValid} aria-busy={pending} onClick={() => void run(async () => {
            const draft = dirty ? await save() : skill.draft!;
            const published = await repository!.publishSkill!(skillId, draft.id); setPublishOpen(false);
            onPublished(`已发布 v${published.currentRevision.number}`); await refresh();
          })}>{testsRunning ? "测试运行中…" : pending ? "发布中…" : "发布"}</Button></div></>}
    </ModalDialog>
    <ConfirmDialog open={!!confirm} title={confirm?.title ?? "确认"} description={confirm?.description ?? ""} confirmLabel={confirm?.confirmLabel ?? "确认"} tone={confirm?.tone} pending={pending}
      onCancel={() => { leaveDecision.current?.resolve(false); leaveDecision.current = null; setConfirm(null); }} onConfirm={() => { const action = confirm?.action; setConfirm(null); action?.(); }} />
    {deletionOpen && repository ? <SkillDeletionDialog key={skillId} skillId={skillId} repository={repository} onDeleted={setDeleted} onDismiss={() => setDeletionOpen(false)} onNavigate={onNavigate} /> : null}
  </div>;
}
