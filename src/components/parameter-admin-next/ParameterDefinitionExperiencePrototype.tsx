/**
 * PROTOTYPE ONLY — throwaway evidence for the Wayfinder decision
 * "Prototype the single-page parameter-definition experience".
 *
 * Final A+B+C composition on `/parameter-admin/specs`, enabled only with
 * `?variant=Final`. Static in-memory fixtures deliberately avoid production
 * mutations and expose target concepts rather than current storage projections.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Database,
  FileText,
  FolderTree,
  History,
  Inbox,
  Link as LinkIcon,
  ListChecks,
  Menu,
  Network,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import "./ParameterDefinitionExperiencePrototype.css";

type VariantKey = "Final" | "A" | "B" | "C";
type ScenarioKey = "ready" | "unregistered" | "empty" | "loading" | "error";
type SubjectKind = "Driver" | "NodeType";
type DetailTab = "overview" | "history";
type MobilePane = "subjects" | "definitions" | "detail" | "matching";
type FinalWorkspace = "catalog" | "queue";
type SubjectFilter = "all" | SubjectKind;

type Subject = {
  id: string;
  kind: SubjectKind;
  name: string;
  identity: string;
  placement: string[];
  registered: boolean;
  definitionCount: number;
  pendingMatches: number;
};

type Definition = {
  id: string;
  subjectId: string;
  propertyKey: string;
  displayName: string;
  valueType: string;
  revision: string;
  lifecycle: "当前" | "已停用";
  references: number;
  policyCount: number;
  projectCount: number;
  description: string;
  constraints: string[];
};

type MatchTask = {
  id: string;
  observedKey: string;
  sourcePath: string;
  evidence: string;
  projectCount: number;
  candidateIds: string[];
  confidence: "需确认" | "未知";
};

const FINAL_VARIANT = {
  key: "Final" as const,
  name: "最终组合",
  note: "目录骨架 + 登记与位置 + 审阅队列",
};

const SCENARIOS: Array<{ key: ScenarioKey; label: string }> = [
  { key: "ready", label: "典型数据" },
  { key: "unregistered", label: "对象未登记" },
  { key: "empty", label: "暂无定义" },
  { key: "loading", label: "加载中" },
  { key: "error", label: "局部加载失败" },
];

const SUBJECTS: Subject[] = [
  {
    id: "driver:bq25890",
    kind: "Driver",
    name: "BQ25890 充电芯片",
    identity: "ti,bq25890",
    placement: ["充电与供电", "充电控制"],
    registered: true,
    definitionCount: 4,
    pendingMatches: 2,
  },
  {
    id: "driver:sc8562",
    kind: "Driver",
    name: "SC8562 电荷泵",
    identity: "southchip,sc8562",
    placement: ["充电与供电", "电荷泵"],
    registered: true,
    definitionCount: 3,
    pendingMatches: 0,
  },
  {
    id: "nodetype:thermal-zone",
    kind: "NodeType",
    name: "温控区域",
    identity: "thermal-zones",
    placement: ["热管理", "温控"],
    registered: true,
    definitionCount: 2,
    pendingMatches: 1,
  },
  {
    id: "driver:fan-controller",
    kind: "Driver",
    name: "风扇控制器",
    identity: "acme,fan-controller",
    placement: ["尚未登记"],
    registered: false,
    definitionCount: 0,
    pendingMatches: 3,
  },
];

const DEFINITIONS: Definition[] = [
  {
    id: "def:input-current-limit",
    subjectId: "driver:bq25890",
    propertyKey: "input-current-limit-microamp",
    displayName: "输入电流上限",
    valueType: "u32 · μA",
    revision: "r4",
    lifecycle: "当前",
    references: 18,
    policyCount: 2,
    projectCount: 6,
    description: "限制充电器从输入电源吸取的最大电流。",
    constraints: ["最小 100000", "最大 3250000", "步进 50000"],
  },
  {
    id: "def:charge-current",
    subjectId: "driver:bq25890",
    propertyKey: "charge-current-microamp",
    displayName: "充电电流",
    valueType: "u32 · μA",
    revision: "r7",
    lifecycle: "当前",
    references: 24,
    policyCount: 3,
    projectCount: 8,
    description: "定义主充电阶段允许的目标电流范围。",
    constraints: ["最小 0", "最大 5056000", "步进 64000"],
  },
  {
    id: "def:watchdog-timeout",
    subjectId: "driver:bq25890",
    propertyKey: "watchdog-timeout-ms",
    displayName: "看门狗超时",
    valueType: "enum · ms",
    revision: "r2",
    lifecycle: "当前",
    references: 9,
    policyCount: 1,
    projectCount: 4,
    description: "选择充电看门狗的超时时间。",
    constraints: ["允许 0 / 40000 / 80000 / 160000"],
  },
  {
    id: "def:boost-voltage",
    subjectId: "driver:bq25890",
    propertyKey: "boost-voltage-microvolt",
    displayName: "升压输出电压",
    valueType: "u32 · μV",
    revision: "r3",
    lifecycle: "当前",
    references: 5,
    policyCount: 1,
    projectCount: 2,
    description: "设置 OTG 升压模式的输出电压。",
    constraints: ["最小 4550000", "最大 5510000", "步进 64000"],
  },
  {
    id: "def:sc8562-gpio-int",
    subjectId: "driver:sc8562",
    propertyKey: "gpio-int",
    displayName: "中断 GPIO",
    valueType: "phandle-array",
    revision: "r5",
    lifecycle: "当前",
    references: 12,
    policyCount: 0,
    projectCount: 5,
    description: "标识电荷泵故障与状态中断线。",
    constraints: ["必须引用 gpio-controller", "单个中断线"],
  },
  {
    id: "def:polling-delay",
    subjectId: "nodetype:thermal-zone",
    propertyKey: "polling-delay",
    displayName: "轮询间隔",
    valueType: "u32 · ms",
    revision: "r3",
    lifecycle: "当前",
    references: 31,
    policyCount: 2,
    projectCount: 11,
    description: "定义温控区域在非被动状态下的轮询间隔。",
    constraints: ["最小 0", "最大 60000"],
  },
];

const MATCH_TASKS: MatchTask[] = [
  {
    id: "match:voltage-limit",
    observedKey: "input-voltage-limit-microvolt",
    sourcePath: "chargeboard-v3 / charger@6b",
    evidence: "DTS 属性键一致，但两个平台定义的兼容范围均可覆盖。",
    projectCount: 2,
    candidateIds: ["def:input-current-limit", "def:charge-current"],
    confidence: "需确认",
  },
  {
    id: "match:watchdog",
    observedKey: "watchdog-timeout",
    sourcePath: "gateway-pro / power@1",
    evidence: "属性名接近，但单位未在 DTS 中声明。",
    projectCount: 1,
    candidateIds: ["def:watchdog-timeout"],
    confidence: "需确认",
  },
  {
    id: "match:fan-pulses",
    observedKey: "pulses-per-revolution",
    sourcePath: "cooling-rack / fan@0",
    evidence: "未识别的 compatible；只保留观察证据，不创建定义。",
    projectCount: 3,
    candidateIds: [],
    confidence: "未知",
  },
];

function normalizeSearch(search: string) {
  return search.startsWith("?") ? search.slice(1) : search;
}

function readVariant(): VariantKey {
  return "Final";
}

function readScenario(search: string): ScenarioKey {
  const value = new URLSearchParams(normalizeSearch(search)).get("scenario");
  return SCENARIOS.some((scenario) => scenario.key === value)
    ? (value as ScenarioKey)
    : "ready";
}

export function isParameterDefinitionPrototypeSearch(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(normalizeSearch(search)).has("variant");
}

function kindLabel(kind: SubjectKind) {
  return kind === "Driver" ? "Driver" : "NodeType";
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  return <span className={`pd-proto-pill is-${tone}`}>{children}</span>;
}

function PrototypeNotice({ actionNote }: { actionNote: string | null }) {
  return (
    <div className="pd-proto-notice" role="status">
      <Database size={16} aria-hidden="true" />
      <span>
        {actionNote ?? "一次性决策原型：使用静态数据，所有操作只在内存中演示。"}
      </span>
    </div>
  );
}

function SearchField() {
  return (
    <label className="pd-proto-search">
      <Search size={16} aria-hidden="true" />
      <input aria-label="搜索对象或定义" placeholder="搜索对象或属性键" />
    </label>
  );
}

function SubjectButton({
  subject,
  selected,
  compact = false,
  onSelect,
}: {
  subject: Subject;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`pd-proto-subject${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="pd-proto-subject__icon" aria-hidden="true">
        {subject.kind === "Driver" ? <Network size={16} /> : <Box size={16} />}
      </span>
      <span className="pd-proto-subject__copy">
        <strong>{subject.name}</strong>
        <small>
          {kindLabel(subject.kind)} · {subject.identity}
        </small>
      </span>
      <span className="pd-proto-subject__counts">
        {subject.registered ? subject.definitionCount : "未登记"}
        {subject.pendingMatches > 0 ? <em>{subject.pendingMatches}</em> : null}
      </span>
    </button>
  );
}

function DefinitionButton({
  definition,
  selected,
  onSelect,
}: {
  definition: Definition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`pd-proto-definition-row${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span>
        <strong>{definition.propertyKey}</strong>
        <small>{definition.displayName}</small>
      </span>
      <span className="pd-proto-definition-row__meta">
        <small>{definition.valueType}</small>
        <StatusPill tone="good">
          {definition.lifecycle} · {definition.revision}
        </StatusPill>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function ScenarioState({
  scenario,
  subject,
  onRetry,
  onRegister,
}: {
  scenario: ScenarioKey;
  subject: Subject;
  onRetry: () => void;
  onRegister: () => void;
}) {
  if (scenario === "loading") {
    return (
      <div className="pd-proto-state is-loading" aria-label="正在加载当前定义">
        <RefreshCw size={24} aria-hidden="true" />
        <strong>正在加载当前定义</strong>
        <p>对象导航和审阅队列保持可用，定义列表加载完成后原位呈现。</p>
        <div className="pd-proto-loading-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (scenario === "error") {
    return (
      <div className="pd-proto-state" role="alert">
        <AlertTriangle size={24} aria-hidden="true" />
        <strong>当前定义暂时无法加载</strong>
        <p>对象导航和待处理计数仍可使用，上次成功数据不会被伪装成空列表。</p>
        <button type="button" className="button subtle" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" /> 重试
        </button>
      </div>
    );
  }
  if (scenario === "unregistered" || !subject.registered) {
    return (
      <div className="pd-proto-state">
        <Network size={24} aria-hidden="true" />
        <strong>此 Driver 尚未登记到组织</strong>
        <p>
          登记会采用唯一的平台对象，并把其定义继承到“热管理 /
          风扇控制”位置；不会复制定义。
        </p>
        <button type="button" className="button primary" onClick={onRegister}>
          预览登记
        </button>
      </div>
    );
  }
  return (
    <div className="pd-proto-state">
      <Inbox size={24} aria-hidden="true" />
      <strong>这个对象暂无当前定义</strong>
      <p>
        定义只来自平台 schema
        catalog。这里不提供组织覆盖；可查看待处理观察或提交平台目录变更。
      </p>
      <button type="button" className="button subtle" onClick={onRetry}>
        查看待处理匹配
      </button>
    </div>
  );
}

function DetailContent({
  definition,
  subject,
  tab,
  onTabChange,
  onAction,
}: {
  definition: Definition | null;
  subject: Subject;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onAction: (message: string) => void;
}) {
  if (!definition) {
    return (
      <div className="pd-proto-state is-detail-empty">
        <FileText size={24} aria-hidden="true" />
        <strong>选择一个定义查看详情</strong>
        <p>详情同时承载当前修订、策略与项目值链接，以及修订/审计历史。</p>
      </div>
    );
  }

  return (
    <div className="pd-proto-detail">
      <header className="pd-proto-detail__header">
        <div>
          <span className="pd-proto-eyebrow">
            {kindLabel(subject.kind)} · {subject.name}
          </span>
          <h3>{definition.propertyKey}</h3>
          <p>{definition.displayName}</p>
        </div>
        <StatusPill tone="good">当前修订 {definition.revision}</StatusPill>
      </header>
      <div
        className="pd-proto-detail__tabs"
        role="tablist"
        aria-label="定义详情"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "overview"}
          onClick={() => onTabChange("overview")}
        >
          定义
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          onClick={() => onTabChange("history")}
        >
          修订与审计
        </button>
      </div>
      {tab === "overview" ? (
        <div className="pd-proto-detail__body">
          <p>{definition.description}</p>
          <dl className="pd-proto-definition-facts">
            <div>
              <dt>正式所有者</dt>
              <dd>
                {kindLabel(subject.kind)} · {subject.identity}
              </dd>
            </div>
            <div>
              <dt>组织位置</dt>
              <dd>{subject.placement.join(" / ")}</dd>
            </div>
            <div>
              <dt>值类型</dt>
              <dd>{definition.valueType}</dd>
            </div>
            <div>
              <dt>当前引用</dt>
              <dd>{definition.references} 个绑定</dd>
            </div>
          </dl>
          <section className="pd-proto-detail__section">
            <h4>登记与位置</h4>
            <dl className="pd-proto-registration-placement">
              <div>
                <dt>组织登记</dt>
                <dd>
                  <StatusPill tone={subject.registered ? "good" : "warn"}>
                    {subject.registered ? "已登记" : "待登记"}
                  </StatusPill>
                </dd>
              </div>
              <div>
                <dt>登记方式</dt>
                <dd>{subject.registered ? "显式选择平台对象" : "尚未建立"}</dd>
              </div>
              <div>
                <dt>权威位置</dt>
                <dd>{subject.placement.join(" / ")}</dd>
              </div>
              <div>
                <dt>继承范围</dt>
                <dd>{subject.definitionCount} 个当前定义</dd>
              </div>
            </dl>
          </section>
          <section className="pd-proto-detail__section">
            <h4>约束</h4>
            <ul>
              {definition.constraints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <div className="pd-proto-link-grid">
            <button
              type="button"
              onClick={() =>
                onAction(
                  `将打开 ${definition.policyCount} 条相关策略（原型不跳转）`,
                )
              }
            >
              <Settings2 size={18} aria-hidden="true" />
              <span>
                <strong>{definition.policyCount} 条策略</strong>
                <small>查看使用此定义的策略</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() =>
                onAction(
                  `将打开 ${definition.projectCount} 个项目的当前值（原型不跳转）`,
                )
              }
            >
              <LinkIcon size={18} aria-hidden="true" />
              <span>
                <strong>{definition.projectCount} 个项目值</strong>
                <small>进入只读值分布</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <aside className="pd-proto-diagnostics-boundary">
            <Database size={16} aria-hidden="true" />
            <span>
              <strong>迁移边界</strong> ·
              旧标识已映射到当前定义；原始行与迁移诊断只进入内部升级报告，不进入本页日常视图。
            </span>
          </aside>
        </div>
      ) : (
        <ol className="pd-proto-timeline">
          <li>
            <span className="pd-proto-timeline__dot">
              <CircleCheck size={14} aria-hidden="true" />
            </span>
            <div>
              <strong>{definition.revision} 成为当前修订</strong>
              <p>林晓 · 调整输入范围并补充硬件依据</p>
              <time>2026-08-26 15:42</time>
            </div>
          </li>
          <li>
            <span className="pd-proto-timeline__dot">
              <History size={14} aria-hidden="true" />
            </span>
            <div>
              <strong>r3 被 r4 取代</strong>
              <p>系统 · 保留 18 个绑定的引用连续性</p>
              <time>2026-08-26 15:42</time>
            </div>
          </li>
          <li>
            <span className="pd-proto-timeline__dot">
              <BookOpen size={14} aria-hidden="true" />
            </span>
            <div>
              <strong>r3 发布</strong>
              <p>陈远 · 依据 BQ25890 数据手册校正单位</p>
              <time>2026-07-18 10:16</time>
            </div>
          </li>
        </ol>
      )}
    </div>
  );
}

function MatchTaskCard({
  task,
  definitions,
  onPick,
}: {
  task: MatchTask;
  definitions: Definition[];
  onPick: (message: string) => void;
}) {
  const candidates = task.candidateIds
    .map((id) => definitions.find((definition) => definition.id === id))
    .filter((item): item is Definition => Boolean(item));
  return (
    <article className="pd-proto-match-card">
      <header>
        <div>
          <span className="pd-proto-eyebrow">
            观察证据 · {task.projectCount} 个项目
          </span>
          <h4>{task.observedKey}</h4>
          <p>{task.sourcePath}</p>
        </div>
        <StatusPill tone="warn">{task.confidence}</StatusPill>
      </header>
      <p>{task.evidence}</p>
      {candidates.length > 0 ? (
        <div className="pd-proto-match-card__candidates">
          <span>候选当前定义</span>
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() =>
                onPick(
                  `已暂存“${task.observedKey} → ${candidate.propertyKey}”，未写入任何数据。`,
                )
              }
            >
              <span>
                <strong>{candidate.propertyKey}</strong>
                <small>{candidate.displayName}</small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="pd-proto-match-card__unknown">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>没有可信候选。保留观察，不创建临时定义或已识别绑定。</span>
        </div>
      )}
    </article>
  );
}

function FinalSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="pd-proto-search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="搜索对象、属性键或观测证据"
        placeholder="搜索对象、属性键或观测证据"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function FinalSubjectSummary({
  subject,
  onAction,
}: {
  subject: Subject;
  onAction: (message: string) => void;
}) {
  return (
    <section
      className="pd-proto-final-subject-summary"
      aria-label="对象登记与位置摘要"
    >
      <div className="pd-proto-final-subject-summary__identity">
        <span
          className="pd-proto-final-subject-summary__icon"
          aria-hidden="true"
        >
          {subject.kind === "Driver" ? (
            <Network size={20} />
          ) : (
            <Box size={20} />
          )}
        </span>
        <div>
          <span className="pd-proto-eyebrow">
            正式所有者 · {kindLabel(subject.kind)}
          </span>
          <strong>{subject.name}</strong>
          <code>{subject.identity}</code>
        </div>
      </div>
      <dl>
        <div>
          <dt>组织登记</dt>
          <dd>
            <StatusPill tone={subject.registered ? "good" : "warn"}>
              {subject.registered ? "已登记" : "待登记"}
            </StatusPill>
          </dd>
        </div>
        <div>
          <dt>登记方式</dt>
          <dd>{subject.registered ? "显式选择平台对象" : "尚未建立"}</dd>
        </div>
        <div>
          <dt>权威位置</dt>
          <dd>{subject.placement.join(" / ")}</dd>
        </div>
        <div>
          <dt>定义继承</dt>
          <dd>{subject.definitionCount} 个当前定义</dd>
        </div>
      </dl>
      <button
        type="button"
        className="button subtle"
        onClick={() =>
          onAction(
            subject.registered
              ? "已打开登记与位置影响预览；原型不执行写入。"
              : "已打开组织登记预览；原型不执行写入。",
          )
        }
      >
        {subject.registered ? "查看登记与位置" : "预览登记"}
      </button>
    </section>
  );
}

function FinalDefinitionRow({
  definition,
  subject,
  selected,
  onSelect,
}: {
  definition: Definition;
  subject: Subject;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`pd-proto-final-definition-row${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="pd-proto-final-definition-row__definition">
        <strong>{definition.propertyKey}</strong>
        <small>
          {definition.displayName} · {definition.valueType}
        </small>
      </span>
      <span className="pd-proto-final-definition-row__governance">
        <small>
          <CircleCheck size={13} aria-hidden="true" />
          组织登记：{subject.registered ? "已登记" : "待登记"}
        </small>
        <small>
          <FolderTree size={13} aria-hidden="true" />
          权威位置：{subject.placement.join(" / ")}
        </small>
      </span>
      <span className="pd-proto-final-definition-row__revision">
        <StatusPill tone="good">
          {definition.lifecycle} · {definition.revision}
        </StatusPill>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

type FinalVariantProps = VariantProps & {
  query: string;
  subjectFilter: SubjectFilter;
  workspace: FinalWorkspace;
  onQuery: (value: string) => void;
  onSubjectFilter: (value: SubjectFilter) => void;
  onWorkspace: (value: FinalWorkspace) => void;
};

function FinalCombined({
  scenario,
  subject,
  subjects,
  definitions,
  selectedDefinition,
  detailTab,
  mobilePane,
  query,
  subjectFilter,
  workspace,
  onSelectSubject,
  onSelectDefinition,
  onDetailTab,
  onMobilePane,
  onQuery,
  onSubjectFilter,
  onWorkspace,
  onAction,
}: FinalVariantProps) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const subjectMatchesQuery = (item: Subject) => {
    if (!normalizedQuery) return true;
    const ownText = [item.name, item.identity, item.kind, ...item.placement]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    const definitionText = DEFINITIONS.filter(
      (definition) => definition.subjectId === item.id,
    )
      .flatMap((definition) => [
        definition.propertyKey,
        definition.displayName,
        definition.description,
      ])
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return (
      ownText.includes(normalizedQuery) ||
      definitionText.includes(normalizedQuery)
    );
  };
  const visibleSubjects = subjects.filter(
    (item) =>
      (subjectFilter === "all" || item.kind === subjectFilter) &&
      subjectMatchesQuery(item),
  );
  const visibleDefinitions = definitions.filter((definition) => {
    if (!normalizedQuery) return true;
    return [
      definition.propertyKey,
      definition.displayName,
      definition.description,
      definition.valueType,
    ]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery);
  });
  const visibleTasks = MATCH_TASKS.filter((task) => {
    if (!normalizedQuery) return true;
    return [task.observedKey, task.sourcePath, task.evidence, task.confidence]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery);
  });
  const showDefinitions =
    scenario === "ready" && visibleDefinitions.length > 0 && subject.registered;

  const selectFilter = (nextFilter: SubjectFilter) => {
    onSubjectFilter(nextFilter);
    if (nextFilter === "all" || subject.kind === nextFilter) return;
    const nextSubject = subjects.find((item) => item.kind === nextFilter);
    if (nextSubject) onSelectSubject(nextSubject.id);
  };

  return (
    <div className="pd-proto-final">
      <header className="pd-proto-final-intro">
        <div>
          <span className="pd-proto-eyebrow">
            最终组合原型 · 单一参数定义页面
          </span>
          <strong>平台定义、组织使用上下文与观测审阅共用一个工作面</strong>
          <p>目录负责稳定浏览；登记与位置贴近定义；待处理证据进入审阅队列。</p>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={() => onAction("将创建平台目录变更提案；原型不执行写入。")}
        >
          提出目录变更
        </button>
      </header>

      <nav className="pd-proto-final-area-tabs" aria-label="参数定义页面区域">
        <button
          type="button"
          aria-current={workspace === "catalog" ? "page" : undefined}
          onClick={() => onWorkspace("catalog")}
        >
          <FileText size={17} aria-hidden="true" />
          <span>
            <strong>当前定义</strong>
            <small>按 Driver / NodeType 与模块浏览</small>
          </span>
          <StatusPill>{DEFINITIONS.length}</StatusPill>
        </button>
        <button
          type="button"
          aria-current={workspace === "queue" ? "page" : undefined}
          onClick={() => {
            onWorkspace("queue");
            onMobilePane("matching");
          }}
        >
          <ListChecks size={17} aria-hidden="true" />
          <span>
            <strong>审阅队列</strong>
            <small>匹配与观测证据</small>
          </span>
          <StatusPill tone="warn">{MATCH_TASKS.length}</StatusPill>
        </button>
        <FinalSearchField value={query} onChange={onQuery} />
      </nav>

      {workspace === "queue" ? (
        <section className="pd-proto-final-queue" aria-label="审阅队列">
          <header>
            <div>
              <span className="pd-proto-eyebrow">同页辅助区域</span>
              <h3>审阅队列</h3>
              <p>未知或歧义观测只保留证据；确认前不创建定义或识别绑定。</p>
            </div>
            <button
              type="button"
              className="button subtle"
              onClick={() => onWorkspace("catalog")}
            >
              返回当前定义
            </button>
          </header>
          {visibleTasks.length > 0 ? (
            <div className="pd-proto-final-queue__grid">
              {visibleTasks.map((task) => (
                <MatchTaskCard
                  key={task.id}
                  task={task}
                  definitions={DEFINITIONS}
                  onPick={onAction}
                />
              ))}
            </div>
          ) : (
            <div className="pd-proto-state">
              <Search size={24} aria-hidden="true" />
              <strong>没有匹配的观测证据</strong>
              <p>清除搜索条件后查看全部待处理项目。</p>
            </div>
          )}
        </section>
      ) : (
        <>
          <FinalSubjectSummary subject={subject} onAction={onAction} />
          <div
            className="pd-proto-mobile-panes pd-proto-final-mobile-panes"
            role="tablist"
            aria-label="移动端目录区域"
          >
            {(["subjects", "definitions", "detail"] as MobilePane[]).map(
              (pane) => (
                <button
                  key={pane}
                  type="button"
                  role="tab"
                  aria-selected={mobilePane === pane}
                  onClick={() => onMobilePane(pane)}
                >
                  {pane === "subjects"
                    ? "对象"
                    : pane === "definitions"
                      ? "定义"
                      : "详情"}
                </button>
              ),
            )}
          </div>
          <div className="pd-proto-three-pane pd-proto-final-three-pane">
            <aside
              className={`pd-proto-pane pd-proto-pane--subjects${mobilePane === "subjects" ? " is-mobile-active" : ""}`}
            >
              <div className="pd-proto-pane__head">
                <div>
                  <FolderTree size={17} aria-hidden="true" />
                  <span>
                    <strong>对象与模块</strong>
                    <small>正式所有者与权威位置</small>
                  </span>
                </div>
                <span>{visibleSubjects.length}</span>
              </div>
              <div className="pd-proto-final-filters" aria-label="对象类型筛选">
                {(
                  [
                    ["all", "全部"],
                    ["Driver", "Driver"],
                    ["NodeType", "NodeType"],
                  ] as Array<[SubjectFilter, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={subjectFilter === value}
                    onClick={() => selectFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visibleSubjects.length > 0 ? (
                ["充电与供电", "热管理", "尚未登记"].map((placement) => {
                  const placementSubjects = visibleSubjects.filter(
                    (item) => item.placement[0] === placement,
                  );
                  if (placementSubjects.length === 0) return null;
                  return (
                    <div className="pd-proto-tree-group" key={placement}>
                      <div className="pd-proto-tree-group__label">
                        <ChevronDown size={15} aria-hidden="true" />
                        {placement} <span>{placementSubjects.length}</span>
                      </div>
                      {placementSubjects.map((item) => (
                        <SubjectButton
                          key={item.id}
                          subject={item}
                          selected={item.id === subject.id}
                          compact
                          onSelect={() => onSelectSubject(item.id)}
                        />
                      ))}
                    </div>
                  );
                })
              ) : (
                <div className="pd-proto-state is-compact">
                  <Search size={20} aria-hidden="true" />
                  <strong>没有匹配的对象</strong>
                  <p>清除搜索或类型筛选后重试。</p>
                </div>
              )}
            </aside>
            <section
              className={`pd-proto-pane pd-proto-pane--definitions${mobilePane === "definitions" ? " is-mobile-active" : ""}`}
            >
              <div className="pd-proto-pane__head">
                <div>
                  <FileText size={17} aria-hidden="true" />
                  <span>
                    <strong>当前定义</strong>
                    <small>{subject.name}</small>
                  </span>
                </div>
                <button
                  type="button"
                  className="pd-proto-queue-link"
                  onClick={() => onWorkspace("queue")}
                >
                  <ListChecks size={15} aria-hidden="true" />
                  审阅队列 {MATCH_TASKS.length}
                </button>
              </div>
              {showDefinitions ? (
                visibleDefinitions.map((definition) => (
                  <FinalDefinitionRow
                    key={definition.id}
                    definition={definition}
                    subject={subject}
                    selected={selectedDefinition?.id === definition.id}
                    onSelect={() => {
                      onSelectDefinition(definition.id);
                      onMobilePane("detail");
                    }}
                  />
                ))
              ) : scenario === "ready" && definitions.length > 0 ? (
                <div className="pd-proto-state">
                  <Search size={24} aria-hidden="true" />
                  <strong>没有匹配的当前定义</strong>
                  <p>调整搜索条件，或从左侧选择其他正式对象。</p>
                </div>
              ) : (
                <ScenarioState
                  scenario={scenario}
                  subject={subject}
                  onRetry={() =>
                    onAction(
                      scenario === "error"
                        ? "正在模拟重新加载…"
                        : "已打开审阅队列。",
                    )
                  }
                  onRegister={() =>
                    onAction("登记预览：只建立组织登记与一个权威位置。")
                  }
                />
              )}
            </section>
            <aside
              className={`pd-proto-pane pd-proto-pane--detail${mobilePane === "detail" ? " is-mobile-active" : ""}`}
            >
              <DetailContent
                definition={selectedDefinition}
                subject={subject}
                tab={detailTab}
                onTabChange={onDetailTab}
                onAction={onAction}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function VariantA({
  scenario,
  subject,
  subjects,
  definitions,
  selectedDefinition,
  detailTab,
  mobilePane,
  onSelectSubject,
  onSelectDefinition,
  onDetailTab,
  onMobilePane,
  onAction,
}: VariantProps) {
  const showDefinitions =
    scenario === "ready" && definitions.length > 0 && subject.registered;
  return (
    <div className="pd-proto-variant-a">
      <header className="pd-proto-page-header">
        <div>
          <span className="pd-proto-eyebrow">方案 A · 目录工作台</span>
          <h2>参数定义</h2>
          <p>按正式对象定位当前定义；匹配工作在同一页处理。</p>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={() =>
            onAction("将创建平台 catalog 变更提案；本原型不执行写入。")
          }
        >
          提出目录变更
        </button>
      </header>
      <div
        className="pd-proto-mobile-panes"
        role="tablist"
        aria-label="移动端工作区"
      >
        {(["subjects", "definitions", "detail"] as MobilePane[]).map((pane) => (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={mobilePane === pane}
            onClick={() => onMobilePane(pane)}
          >
            {pane === "subjects"
              ? "对象"
              : pane === "definitions"
                ? "定义"
                : "详情"}
          </button>
        ))}
      </div>
      <div className="pd-proto-three-pane">
        <aside
          className={`pd-proto-pane pd-proto-pane--subjects${mobilePane === "subjects" ? " is-mobile-active" : ""}`}
        >
          <div className="pd-proto-pane__head">
            <div>
              <FolderTree size={17} aria-hidden="true" />
              <strong>对象与位置</strong>
            </div>
            <span>{subjects.length}</span>
          </div>
          <SearchField />
          <div className="pd-proto-tree-group">
            <button type="button" className="pd-proto-tree-group__label">
              <ChevronDown size={15} aria-hidden="true" />
              充电与供电 <span>7</span>
            </button>
            {subjects
              .filter((item) => item.placement[0] === "充电与供电")
              .map((item) => (
                <SubjectButton
                  key={item.id}
                  subject={item}
                  selected={item.id === subject.id}
                  compact
                  onSelect={() => onSelectSubject(item.id)}
                />
              ))}
          </div>
          <div className="pd-proto-tree-group">
            <button type="button" className="pd-proto-tree-group__label">
              <ChevronDown size={15} aria-hidden="true" />
              热管理 <span>2</span>
            </button>
            {subjects
              .filter((item) => item.placement[0] === "热管理")
              .map((item) => (
                <SubjectButton
                  key={item.id}
                  subject={item}
                  selected={item.id === subject.id}
                  compact
                  onSelect={() => onSelectSubject(item.id)}
                />
              ))}
          </div>
          <div className="pd-proto-tree-group">
            <button type="button" className="pd-proto-tree-group__label">
              <ChevronRight size={15} aria-hidden="true" />
              待登记对象 <span>1</span>
            </button>
            {subjects
              .filter((item) => !item.registered)
              .map((item) => (
                <SubjectButton
                  key={item.id}
                  subject={item}
                  selected={item.id === subject.id}
                  compact
                  onSelect={() => onSelectSubject(item.id)}
                />
              ))}
          </div>
        </aside>
        <section
          className={`pd-proto-pane pd-proto-pane--definitions${mobilePane === "definitions" ? " is-mobile-active" : ""}`}
        >
          <div className="pd-proto-pane__head">
            <div>
              <FileText size={17} aria-hidden="true" />
              <span>
                <strong>当前定义</strong>
                <small>{subject.name}</small>
              </span>
            </div>
            <button
              type="button"
              className="pd-proto-queue-link"
              onClick={() => onMobilePane("matching")}
            >
              <ListChecks size={15} aria-hidden="true" />
              待匹配 {subject.pendingMatches}
            </button>
          </div>
          {showDefinitions ? (
            definitions.map((definition) => (
              <DefinitionButton
                key={definition.id}
                definition={definition}
                selected={selectedDefinition?.id === definition.id}
                onSelect={() => {
                  onSelectDefinition(definition.id);
                  onMobilePane("detail");
                }}
              />
            ))
          ) : (
            <ScenarioState
              scenario={scenario}
              subject={subject}
              onRetry={() =>
                onAction(
                  scenario === "error"
                    ? "正在模拟重新加载…"
                    : "已切换到待处理匹配。",
                )
              }
              onRegister={() =>
                onAction(
                  "登记预览：平台对象唯一，组织仅新增登记与一个权威位置。",
                )
              }
            />
          )}
        </section>
        <aside
          className={`pd-proto-pane pd-proto-pane--detail${mobilePane === "detail" ? " is-mobile-active" : ""}`}
        >
          <DetailContent
            definition={selectedDefinition}
            subject={subject}
            tab={detailTab}
            onTabChange={onDetailTab}
            onAction={onAction}
          />
        </aside>
      </div>
      <section
        className={`pd-proto-inline-matching${mobilePane === "matching" ? " is-mobile-active" : ""}`}
      >
        <header>
          <div>
            <ListChecks size={18} aria-hidden="true" />
            <span>
              <strong>待处理匹配</strong>
              <small>未知或歧义观察只进入这里</small>
            </span>
          </div>
          <StatusPill tone="warn">3 项</StatusPill>
        </header>
        <div className="pd-proto-match-strip">
          {MATCH_TASKS.slice(0, 2).map((task) => (
            <MatchTaskCard
              key={task.id}
              task={task}
              definitions={DEFINITIONS}
              onPick={onAction}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function VariantB({
  scenario,
  subject,
  subjects,
  definitions,
  selectedDefinition,
  detailTab,
  onSelectSubject,
  onSelectDefinition,
  onDetailTab,
  onAction,
}: VariantProps) {
  const showDefinitions =
    scenario === "ready" && definitions.length > 0 && subject.registered;
  return (
    <div className="pd-proto-variant-b">
      <header className="pd-proto-page-header is-centered">
        <div>
          <span className="pd-proto-eyebrow">方案 B · 对象档案</span>
          <h2>参数定义</h2>
          <p>
            定义从正式 Driver / NodeType 继承；组织只登记使用对象和其唯一位置。
          </p>
        </div>
        <SearchField />
      </header>
      <nav className="pd-proto-subject-strip" aria-label="正式对象">
        {subjects.map((item) => (
          <SubjectButton
            key={item.id}
            subject={item}
            selected={item.id === subject.id}
            onSelect={() => onSelectSubject(item.id)}
          />
        ))}
      </nav>
      <section className="pd-proto-dossier-hero">
        <div className="pd-proto-dossier-hero__identity">
          <span className="pd-proto-dossier-hero__icon">
            {subject.kind === "Driver" ? (
              <Network size={24} aria-hidden="true" />
            ) : (
              <Box size={24} aria-hidden="true" />
            )}
          </span>
          <div>
            <span className="pd-proto-eyebrow">
              正式所有者 · {kindLabel(subject.kind)}
            </span>
            <h3>{subject.name}</h3>
            <code>{subject.identity}</code>
          </div>
        </div>
        <dl>
          <div>
            <dt>组织登记</dt>
            <dd>
              <StatusPill tone={subject.registered ? "good" : "warn"}>
                {subject.registered ? "已登记" : "待登记"}
              </StatusPill>
            </dd>
          </div>
          <div>
            <dt>权威位置</dt>
            <dd>{subject.placement.join(" / ")}</dd>
          </div>
          <div>
            <dt>当前定义</dt>
            <dd>{subject.definitionCount}</dd>
          </div>
          <div>
            <dt>待处理匹配</dt>
            <dd>{subject.pendingMatches}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button subtle"
          onClick={() =>
            onAction(
              subject.registered
                ? "将打开位置变更影响预览。"
                : "将打开组织登记预览。",
            )
          }
        >
          {subject.registered ? "查看登记" : "预览登记"}
        </button>
      </section>
      <div className="pd-proto-dossier-layout">
        <section className="pd-proto-dossier-definitions">
          <header>
            <div>
              <span className="pd-proto-eyebrow">平台 schema catalog</span>
              <h3>当前定义</h3>
            </div>
            <button
              type="button"
              className="button subtle"
              onClick={() => onAction("将创建平台 catalog 变更提案。")}
            >
              提出变更
            </button>
          </header>
          {showDefinitions ? (
            <div className="pd-proto-definition-cards">
              {definitions.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  className={
                    selectedDefinition?.id === definition.id
                      ? "is-selected"
                      : ""
                  }
                  onClick={() => onSelectDefinition(definition.id)}
                >
                  <span className="pd-proto-eyebrow">
                    {definition.valueType}
                  </span>
                  <strong>{definition.propertyKey}</strong>
                  <p>{definition.description}</p>
                  <span className="pd-proto-card-meta">
                    <StatusPill tone="good">
                      {definition.revision} 当前
                    </StatusPill>
                    <small>{definition.references} 个绑定</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ScenarioState
              scenario={scenario}
              subject={subject}
              onRetry={() => onAction("已触发重试或待办跳转。")}
              onRegister={() =>
                onAction("登记预览：不复制平台定义，只建立组织登记与位置。")
              }
            />
          )}
        </section>
        <aside className="pd-proto-dossier-detail">
          <DetailContent
            definition={selectedDefinition}
            subject={subject}
            tab={detailTab}
            onTabChange={onDetailTab}
            onAction={onAction}
          />
        </aside>
      </div>
      <section className="pd-proto-dossier-matching">
        <header>
          <div>
            <span className="pd-proto-eyebrow">需要人的判断</span>
            <h3>待处理匹配</h3>
            <p>观察证据与正式定义分离，未知输入不会生成临时定义。</p>
          </div>
          <button
            type="button"
            className="button subtle"
            onClick={() => onAction("将切换到全部 3 项待办。")}
          >
            查看全部 3 项
          </button>
        </header>
        <div className="pd-proto-match-strip">
          {MATCH_TASKS.slice(0, 2).map((task) => (
            <MatchTaskCard
              key={task.id}
              task={task}
              definitions={DEFINITIONS}
              onPick={onAction}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function VariantC({
  scenario,
  subject,
  subjects,
  definitions,
  selectedDefinition,
  detailTab,
  mobilePane,
  onSelectSubject,
  onSelectDefinition,
  onDetailTab,
  onMobilePane,
  onAction,
}: VariantProps) {
  const [workspace, setWorkspace] = useState<"matching" | "catalog">(
    "matching",
  );
  const showDefinitions =
    scenario === "ready" && definitions.length > 0 && subject.registered;
  return (
    <div className="pd-proto-variant-c">
      <header className="pd-proto-page-header is-compact">
        <div>
          <span className="pd-proto-eyebrow">方案 C · 任务优先</span>
          <h2>参数定义</h2>
          <p>先清理需要判断的匹配，再回到稳定目录。</p>
        </div>
        <SearchField />
      </header>
      <nav className="pd-proto-workspace-tabs" aria-label="定义工作区">
        <button
          type="button"
          aria-current={workspace === "matching" ? "page" : undefined}
          onClick={() => {
            setWorkspace("matching");
            onMobilePane("matching");
          }}
        >
          <ListChecks size={17} aria-hidden="true" />
          <span>
            <strong>待处理匹配</strong>
            <small>3 项需要判断</small>
          </span>
          <StatusPill tone="warn">3</StatusPill>
        </button>
        <button
          type="button"
          aria-current={workspace === "catalog" ? "page" : undefined}
          onClick={() => {
            setWorkspace("catalog");
            onMobilePane("definitions");
          }}
        >
          <FileText size={17} aria-hidden="true" />
          <span>
            <strong>当前定义</strong>
            <small>按对象浏览</small>
          </span>
          <StatusPill>{DEFINITIONS.length}</StatusPill>
        </button>
      </nav>
      <div className="pd-proto-task-layout">
        <aside className="pd-proto-task-sidebar">
          <div className="pd-proto-pane__head">
            <div>
              <Menu size={17} aria-hidden="true" />
              <strong>对象筛选</strong>
            </div>
          </div>
          {subjects.map((item) => (
            <SubjectButton
              key={item.id}
              subject={item}
              selected={item.id === subject.id}
              compact
              onSelect={() => onSelectSubject(item.id)}
            />
          ))}
        </aside>
        <main
          className={`pd-proto-task-main${mobilePane === "matching" || mobilePane === "definitions" ? " is-mobile-active" : ""}`}
        >
          {workspace === "matching" ? (
            <>
              <header className="pd-proto-task-section-head">
                <div>
                  <span className="pd-proto-eyebrow">按风险与证据排序</span>
                  <h3>待处理匹配</h3>
                </div>
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => onAction("已刷新静态原型队列。")}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  刷新
                </button>
              </header>
              <div className="pd-proto-task-list">
                {MATCH_TASKS.map((task) => (
                  <MatchTaskCard
                    key={task.id}
                    task={task}
                    definitions={DEFINITIONS}
                    onPick={onAction}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <header className="pd-proto-task-section-head">
                <div>
                  <span className="pd-proto-eyebrow">{subject.name}</span>
                  <h3>当前定义</h3>
                </div>
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => onAction("将创建平台目录变更提案。")}
                >
                  提出变更
                </button>
              </header>
              {showDefinitions ? (
                definitions.map((definition) => (
                  <DefinitionButton
                    key={definition.id}
                    definition={definition}
                    selected={selectedDefinition?.id === definition.id}
                    onSelect={() => {
                      onSelectDefinition(definition.id);
                      onMobilePane("detail");
                    }}
                  />
                ))
              ) : (
                <ScenarioState
                  scenario={scenario}
                  subject={subject}
                  onRetry={() => onAction("已触发重试或待办跳转。")}
                  onRegister={() => onAction("已打开登记预览。")}
                />
              )}
            </>
          )}
        </main>
        <aside
          className={`pd-proto-task-detail${mobilePane === "detail" ? " is-mobile-active" : ""}`}
        >
          <DetailContent
            definition={selectedDefinition}
            subject={subject}
            tab={detailTab}
            onTabChange={onDetailTab}
            onAction={onAction}
          />
        </aside>
      </div>
    </div>
  );
}

type VariantProps = {
  scenario: ScenarioKey;
  subject: Subject;
  subjects: Subject[];
  definitions: Definition[];
  selectedDefinition: Definition | null;
  detailTab: DetailTab;
  mobilePane: MobilePane;
  onSelectSubject: (id: string) => void;
  onSelectDefinition: (id: string) => void;
  onDetailTab: (tab: DetailTab) => void;
  onMobilePane: (pane: MobilePane) => void;
  onAction: (message: string) => void;
};

function PrototypeSwitcher({
  search,
  variant,
  scenario,
  selectedSubjectId,
  selectedDefinitionId,
  detailTab,
  mobilePane,
  workspace,
  query,
  subjectFilter,
  onNavigate,
}: {
  search: string;
  variant: VariantKey;
  scenario: ScenarioKey;
  selectedSubjectId: string;
  selectedDefinitionId: string | null;
  detailTab: DetailTab;
  mobilePane: MobilePane;
  workspace: FinalWorkspace;
  query: string;
  subjectFilter: SubjectFilter;
  onNavigate: (path: string) => void;
}) {
  const [stateOpen, setStateOpen] = useState(false);
  const navigateWith = (patch: { scenario?: ScenarioKey }) => {
    const params = new URLSearchParams(normalizeSearch(search));
    params.set("variant", "Final");
    if (patch.scenario) params.set("scenario", patch.scenario);
    onNavigate(`/parameter-admin/specs?${params.toString()}`);
  };
  return (
    <div className="pd-proto-switcher" aria-label="最终原型场景切换器">
      {stateOpen ? (
        <pre className="pd-proto-switcher__state">
          {JSON.stringify(
            {
              variant,
              scenario,
              selectedSubjectId,
              selectedDefinitionId,
              detailTab,
              mobilePane,
              workspace,
              query,
              subjectFilter,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
      <div className="pd-proto-switcher__label">
        <strong>
          {FINAL_VARIANT.key} · {FINAL_VARIANT.name}
        </strong>
        <small>{FINAL_VARIANT.note}</small>
      </div>
      <label>
        <span>场景</span>
        <select
          aria-label="原型场景"
          value={scenario}
          onChange={(event) =>
            navigateWith({ scenario: event.target.value as ScenarioKey })
          }
        >
          {SCENARIOS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={stateOpen ? "is-active" : ""}
        aria-pressed={stateOpen}
        onClick={() => setStateOpen((open) => !open)}
      >
        {stateOpen ? <X size={16} aria-hidden="true" /> : "状态"}
      </button>
    </div>
  );
}

export function ParameterDefinitionExperiencePrototype({
  search,
  onNavigate,
}: {
  search: string;
  onNavigate: (path: string) => void;
}) {
  const variant = readVariant();
  const scenario = readScenario(search);
  const [selectedSubjectId, setSelectedSubjectId] = useState(
    scenario === "unregistered" ? "driver:fan-controller" : SUBJECTS[0].id,
  );
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<
    string | null
  >(DEFINITIONS[0].id);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [mobilePane, setMobilePane] = useState<MobilePane>("definitions");
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<FinalWorkspace>("catalog");
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>("all");

  useEffect(() => {
    setWorkspace("catalog");
    setQuery("");
    setSubjectFilter("all");
    setMobilePane("definitions");
    setActionNote(null);
  }, [scenario]);

  useEffect(() => {
    if (scenario === "unregistered") {
      setSelectedSubjectId("driver:fan-controller");
      setSelectedDefinitionId(null);
      return;
    }
    if (scenario === "ready" && selectedSubjectId === "driver:fan-controller") {
      setSelectedSubjectId(SUBJECTS[0].id);
      setSelectedDefinitionId(DEFINITIONS[0].id);
    }
  }, [scenario, selectedSubjectId]);

  const subject =
    SUBJECTS.find((item) => item.id === selectedSubjectId) ?? SUBJECTS[0];
  const subjectDefinitions = useMemo(
    () =>
      DEFINITIONS.filter((definition) => definition.subjectId === subject.id),
    [subject.id],
  );
  const selectedDefinition =
    scenario === "ready"
      ? (subjectDefinitions.find(
          (definition) => definition.id === selectedDefinitionId,
        ) ??
        subjectDefinitions[0] ??
        null)
      : null;

  const handleSubjectSelect = (id: string) => {
    const nextDefinitions = DEFINITIONS.filter(
      (definition) => definition.subjectId === id,
    );
    setSelectedSubjectId(id);
    setSelectedDefinitionId(nextDefinitions[0]?.id ?? null);
    setDetailTab("overview");
    setActionNote(null);
  };

  const variantProps: VariantProps = {
    scenario,
    subject,
    subjects: SUBJECTS,
    definitions: scenario === "empty" ? [] : subjectDefinitions,
    selectedDefinition,
    detailTab,
    mobilePane,
    onSelectSubject: handleSubjectSelect,
    onSelectDefinition: (id) => {
      setSelectedDefinitionId(id);
      setDetailTab("overview");
    },
    onDetailTab: setDetailTab,
    onMobilePane: setMobilePane,
    onAction: setActionNote,
  };

  return (
    <div className="param-admin-main pd-proto-root" data-variant={variant}>
      <PrototypeNotice actionNote={actionNote} />
      {variant === "Final" ? (
        <FinalCombined
          {...variantProps}
          query={query}
          subjectFilter={subjectFilter}
          workspace={workspace}
          onQuery={setQuery}
          onSubjectFilter={setSubjectFilter}
          onWorkspace={setWorkspace}
        />
      ) : null}
      {variant === "A" ? <VariantA {...variantProps} /> : null}
      {variant === "B" ? <VariantB {...variantProps} /> : null}
      {variant === "C" ? <VariantC {...variantProps} /> : null}
      <PrototypeSwitcher
        search={search}
        variant={variant}
        scenario={scenario}
        selectedSubjectId={subject.id}
        selectedDefinitionId={selectedDefinition?.id ?? null}
        detailTab={detailTab}
        mobilePane={mobilePane}
        workspace={workspace}
        query={query}
        subjectFilter={subjectFilter}
        onNavigate={onNavigate}
      />
    </div>
  );
}
