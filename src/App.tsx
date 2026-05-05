import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  FileSearch,
  FileText,
  Filter,
  History,
  Info,
  Lightbulb,
  ListChecks,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Network,
  Play,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createAgentPlan, getPageByPath, navigationItems, PageConfig, utilityItems } from "./appConfig";
import {
  AuditEvent,
  ChangeRequest,
  derivePowerManagementRuntimeState,
  DebugParameter,
  mockDataFingerprint,
  initialState,
  LogRecord,
  projects,
  PrototypeState,
  roles
} from "./mockData";
import {
  addDebugParameter,
  addProjectParameter,
  deleteDebugParameter,
  deleteProjectParameter,
  serializePowerManagementConfig,
  updateDebugParameter,
  updateProjectParameter,
  updateProjectParameterMetadata
} from "./powerManagementConfig";

const homeAiScenarios = [
  {
    label: "问你想问",
    title: "我想让电池在高温充电时更保守，应该改哪个参数？",
    context:
      "你可以直接描述目标，不必先知道参数名。OpsAgent 会查找参数库、知识库和历史日志，给出 fast_charge_current_limit_ma、battery_temp_target_c 等候选参数和原因。",
    evidence: ["理解目标", "检索知识库", "给出参数建议"],
    metric: "自然语言提问",
    action: "回答会说明建议依据和影响范围"
  },
  {
    label: "做你想做",
    title: "帮我连接 ChargeLab_X01，并把可调参数下发到样机",
    context:
      "用户不用逐页进入调试平台、筛模块、改输入框。OpsAgent 可以按目标连接设备、填写目标值、触发下发，并把结果写回调试操作记录。",
    evidence: ["连接样机", "填写目标值", "下发并记录"],
    metric: "代办调试下发",
    action: "越界和高风险动作仍保留确认"
  },
  {
    label: "做你想做",
    title: "把 Nebula 项目的快充电流调整到更稳妥的策略，并提交审阅",
    context:
      "你能在 Web 上点选、填写、下发和提交的操作，都可以交给 Agent 代劳。用户只说最终目标，Agent 负责跳过繁琐步骤并保留确认节点。",
    evidence: ["拆解步骤", "代填表单", "提交审阅"],
    metric: "目标驱动执行",
    action: "降低平台使用门槛，关键动作仍需确认"
  }
] as const;

const homeAiCapabilities = [
  {
    label: "问你想问",
    text: "平台里有的信息，都可以直接问"
  },
  {
    label: "做你想做",
    text: "把目标交给 Agent，繁琐步骤由它代劳"
  },
  {
    label: "放心交给它",
    text: "涉及修改、下发和审阅时保留人工确认"
  }
] as const;

type AppAction =
  | { type: "SET_PROJECT"; projectId: string }
  | { type: "SET_ROLE"; roleId: string }
  | { type: "ADD_CHANGE_REQUEST"; parameterId: string; targetValue: string; reason: string }
  | { type: "ADVANCE_REVIEW"; requestId: string }
  | { type: "REJECT_REVIEW"; requestId: string; reason: string }
  | { type: "ADVANCE_LOG"; logId: string }
  | { type: "CONNECT_DEVICE"; deviceId: string }
  | { type: "PUSH_DEBUG_VALUE"; parameterId: string }
  | { type: "PUSH_DEBUG_VALUES"; parameterIds: string[] }
  | { type: "IMPORT_PARAMETERS" }
  | { type: "ADD_NOTIFICATION"; message: string }
  | { type: "UPDATE_PROJECT_PARAMETER_METADATA"; projectId: string; parameterId: string; patch: Partial<ParameterEditorDraft> }
  | { type: "UPDATE_PROJECT_PARAMETER_VALUE"; projectId: string; parameterId: string; patch: Partial<ParameterValueDraft> }
  | { type: "UPDATE_DEBUG_PARAMETER"; parameterId: string; patch: Partial<DebugParameterEditorDraft> }
  | { type: "ADD_PROJECT_PARAMETER" }
  | { type: "DELETE_PROJECT_PARAMETER"; parameterId: string }
  | { type: "ADD_DEBUG_PARAMETER" }
  | { type: "DELETE_DEBUG_PARAMETER"; parameterId: string };

type ParameterValueDraft = {
  currentValue: string;
  recommendedValue: string;
  updatedAt: string;
};

type ParameterEditorDraft = {
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  range: string;
  unit: string;
  risk: DebugParameter["risk"];
};

type DebugParameterEditorDraft = {
  name: string;
  key: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: DebugParameter["risk"];
  status: DebugParameter["status"];
};

const riskLabels: Record<"High" | "Medium" | "Low", string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

const logStatusLabels: Record<LogRecord["status"], string> = {
  Processing: "处理中",
  Complete: "已完成",
  Failed: "失败"
};

const debugModuleLabels: Record<string, string> = {
  charger: "Charger",
  battery: "Battery",
  wireless: "Wireless",
  pmic: "PMIC"
};

function displayTag(text: string) {
  if (text in riskLabels) {
    return riskLabels[text as keyof typeof riskLabels];
  }
  if (text in logStatusLabels) {
    return logStatusLabels[text as keyof typeof logStatusLabels];
  }
  return text;
}

function getDebugModule(parameter: DebugParameter) {
  const keyPrefix = parameter.key.split(".")[0] ?? "other";
  return debugModuleLabels[keyPrefix] ?? keyPrefix.toUpperCase();
}

function reducer(state: PrototypeState, action: AppAction): PrototypeState {
  switch (action.type) {
    case "SET_PROJECT":
      return { ...state, activeProjectId: action.projectId };
    case "SET_ROLE":
      return { ...state, activeRoleId: action.roleId };
    case "ADD_CHANGE_REQUEST": {
      const parameter = state.parameters.find((item) => item.id === action.parameterId);
      if (!parameter) {
        return state;
      }

      const request: ChangeRequest = {
        id: `PRQ-${8910 + state.changeRequests.length}`,
        parameterId: parameter.id,
        module: parameter.module,
        title: parameter.name,
        currentValue: parameter.currentValue,
        targetValue: action.targetValue,
        submitter: roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户",
        createdAt: "刚刚",
        status: "待审阅",
        aiSummary: action.reason || "OpsAgent 已生成影响摘要，建议参数管理员审阅后推进。"
      };

      return {
        ...state,
        changeRequests: [request, ...state.changeRequests],
        notifications: [`已提交 ${request.id}，等待参数管理员审阅`, ...state.notifications]
      };
    }
    case "ADVANCE_REVIEW":
      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                status:
                  request.status === "待审阅"
                    ? "自动检查通过"
                    : request.status === "自动检查通过"
                      ? "等待合入"
                      : "已合入"
              }
            : request
        ),
        notifications: [`${action.requestId} 已推进到下一流程节点`, ...state.notifications]
      };
    case "REJECT_REVIEW":
      return {
        ...state,
        changeRequests: state.changeRequests.map((request) =>
          request.id === action.requestId
            ? {
                ...request,
                status: "已打回",
                rejectReason: action.reason
              }
            : request
        ),
        notifications: [`${action.requestId} 已打回修改：${action.reason}`, ...state.notifications]
      };
    case "ADVANCE_LOG": {
      const order: LogRecord["stage"][] = ["日志解析", "模式匹配", "根因推断", "报告生成"];
      return {
        ...state,
        logs: state.logs.map((log) => {
          if (log.id !== action.logId) {
            return log;
          }
          const index = order.indexOf(log.stage);
          const nextStage = order[Math.min(index + 1, order.length - 1)];
          return {
            ...log,
            stage: nextStage,
            status: nextStage === "报告生成" ? "Complete" : "Processing",
            confidence: nextStage === "报告生成" ? 96 : Math.max(log.confidence, 92)
          };
        }),
        notifications: ["日志分析阶段已更新", ...state.notifications]
      };
    }
    case "CONNECT_DEVICE":
      return {
        ...state,
        devices: state.devices.map((device) =>
          device.id === action.deviceId ? { ...device, status: "已连接", lastSeen: "刚刚" } : device
        ),
        notifications: ["调试样机连接成功", ...state.notifications]
      };
    case "PUSH_DEBUG_VALUE":
      return {
        ...state,
        debugParameters: state.debugParameters.map((parameter) =>
          parameter.id === action.parameterId
            ? { ...parameter, currentValue: parameter.targetValue, status: "下发成功" }
            : parameter
        ),
        notifications: ["参数调试值已下发，回滚快照已准备", ...state.notifications]
      };
    case "PUSH_DEBUG_VALUES": {
      const pushIds = new Set(action.parameterIds);
      const nextDebugParameters = state.debugParameters.map((parameter) =>
        pushIds.has(parameter.id) ? { ...parameter, currentValue: parameter.targetValue, status: "下发成功" as const } : parameter
      );
      const configDraft = {
        ...state.configDraft,
        debugParameters: state.configDraft.debugParameters.map((parameter) =>
          pushIds.has(parameter.id) ? { ...parameter, currentValue: parameter.targetValue, status: "下发成功" as const } : parameter
        )
      };

      return {
        ...state,
        configDraft,
        debugParameters: nextDebugParameters,
        notifications: [`${action.parameterIds.length} 项调试值已下发，回滚快照已准备`, ...state.notifications]
      };
    }
    case "UPDATE_PROJECT_PARAMETER_METADATA": {
      const configDraft = updateProjectParameterMetadata(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_PROJECT_PARAMETER_VALUE": {
      const configDraft = updateProjectParameter(state.configDraft, action.projectId as never, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "UPDATE_DEBUG_PARAMETER": {
      const configDraft = updateDebugParameter(state.configDraft, action.parameterId, action.patch);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_PROJECT_PARAMETER": {
      const configDraft = addProjectParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_PROJECT_PARAMETER": {
      const configDraft = deleteProjectParameter(state.configDraft, action.parameterId);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "ADD_DEBUG_PARAMETER": {
      const configDraft = addDebugParameter(state.configDraft);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "DELETE_DEBUG_PARAMETER": {
      const configDraft = deleteDebugParameter(state.configDraft, action.parameterId);
      return {
        ...state,
        configDraft,
        ...derivePowerManagementRuntimeState(configDraft)
      };
    }
    case "IMPORT_PARAMETERS":
      return {
        ...state,
        notifications: ["批量参数导入完成：新增 24 项，冲突 2 项已进入审计队列", ...state.notifications]
      };
    case "ADD_NOTIFICATION":
      return { ...state, notifications: [action.message, ...state.notifications] };
    default:
      return state;
  }
}

function App() {
  return <AppShell key={mockDataFingerprint} />;
}

function AppShell() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [path, setPath] = useState(() => getPageByPath(window.location.pathname).path);
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonProjectSelection>(() => ({
    baseProjectId: state.activeProjectId,
    targetProjectId: getFallbackComparisonProjectId(state.activeProjectId)
  }));
  const page = getPageByPath(path);
  const agentPlan = useMemo(() => createAgentPlan(path), [path]);
  const isHome = page.key === "home";

  useEffect(() => {
    const syncPathFromHistory = () => {
      const nextPage = getPageByPath(window.location.pathname);
      if (nextPage.path !== window.location.pathname) {
        window.history.replaceState(null, "", nextPage.path);
      }
      setPath(nextPage.path);
    };

    syncPathFromHistory();
    window.addEventListener("popstate", syncPathFromHistory);
    return () => {
      window.removeEventListener("popstate", syncPathFromHistory);
    };
  }, []);

  useEffect(() => {
    setComparisonSelection((current) => {
      const nextTargetProjectId =
        current.targetProjectId === state.activeProjectId
          ? getFallbackComparisonProjectId(state.activeProjectId)
          : current.targetProjectId;

      if (current.baseProjectId === state.activeProjectId && current.targetProjectId === nextTargetProjectId) {
        return current;
      }

      return {
        baseProjectId: state.activeProjectId,
        targetProjectId: nextTargetProjectId
      };
    });
  }, [state.activeProjectId]);

  const navigate = (nextPath: string) => {
    if (nextPath === window.location.pathname) {
      setPath(nextPath);
      return;
    }

    window.history.pushState(null, "", nextPath);
    setPath(nextPath);
  };

  return (
    <div className={isHome ? "app-shell home-shell" : "app-shell"}>
      {!isHome ? <Sidebar activePath={page.path} onNavigate={navigate} /> : null}
      <div className={isHome ? "main-shell home-main-shell" : "main-shell"}>
        <TopBar state={state} dispatch={dispatch} page={page} />
        <main className={page.key === "home" ? "main-content home-content" : "main-content"}>
          <PageRouter
            page={page}
            state={state}
            dispatch={dispatch}
            onNavigate={navigate}
            comparisonSelection={comparisonSelection}
            onComparisonSelectionChange={setComparisonSelection}
          />
        </main>
      </div>
      <UnifiedAgent path={path} plan={agentPlan} state={state} dispatch={dispatch} comparisonSelection={comparisonSelection} />
    </div>
  );
}

type ComparisonProjectSelection = {
  baseProjectId: string;
  targetProjectId: string;
};

type PageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
};

function PageRouter({
  page,
  state,
  dispatch,
  onNavigate,
  comparisonSelection,
  onComparisonSelectionChange
}: PageProps & {
  page: PageConfig;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: React.Dispatch<React.SetStateAction<ComparisonProjectSelection>>;
}) {
  switch (page.key) {
    case "parameters":
      return <ParametersPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "parameter-comparison":
      return (
        <ParameterComparisonPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          comparisonSelection={comparisonSelection}
          onComparisonSelectionChange={onComparisonSelectionChange}
        />
      );
    case "parameter-review":
      return <ParameterReviewPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "parameter-admin":
      return <ParameterAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "logs":
      return <LogsPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "log-admin":
      return <LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "debugging":
      return <DebuggingPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    case "debugging-admin":
      return <DebuggingAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
    default:
      return <HomePage state={state} dispatch={dispatch} onNavigate={onNavigate} />;
  }
}

function Sidebar({ activePath, onNavigate }: { activePath: string; onNavigate: (path: string) => void }) {
  const groups = navigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <Network size={19} />
        </div>
        <div>
          <div className="brand-title">智效 WiseEff</div>
          <div className="brand-subtitle">AI 驱动的企业业务效率平台</div>
        </div>
      </div>
      <nav className="nav-scroll" aria-label="主导航">
        {Object.entries(groups).map(([group, items]) => (
          <div className="nav-group" key={group}>
            <div className="nav-group-label">{group}</div>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={item.path === activePath ? "nav-item active" : "nav-item"}
                  key={item.path}
                  type="button"
                  onClick={() => onNavigate(item.path)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="utility-nav">
        {utilityItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className="nav-item compact" key={item.label} type="button">
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function TopBar({ state, dispatch, page }: { state: PrototypeState; dispatch: React.Dispatch<AppAction>; page: PageConfig }) {
  const showProjectSelector =
    page.group === "参数管理" &&
    page.key !== "parameters" &&
    page.key !== "parameter-comparison" &&
    page.key !== "parameter-review" &&
    page.key !== "parameter-admin";

  return (
    <header className="topbar">
      <div className="topbar-page">
        <div className="topbar-title">{page.title}</div>
        <div className="topbar-subtitle">{page.subtitle}</div>
      </div>
      <div className="topbar-actions">
        <div className="searchbox">
          <Search size={17} />
          <input aria-label="搜索" placeholder="搜索..." />
        </div>
        {showProjectSelector ? (
          <select value={state.activeProjectId} onChange={(event) => dispatch({ type: "SET_PROJECT", projectId: event.target.value })}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}
        <button className="icon-button" type="button" aria-label="通知">
          <MessageSquareText size={18} />
          <span className="notification-dot" />
        </button>
        <div className="avatar">
          <UserRound size={17} />
        </div>
      </div>
    </header>
  );
}

function HomePage({ state, onNavigate }: PageProps) {
  const appCards = [
    {
      title: "项目参数在线管理平台",
      text: "库上参数查询、项目对比、变更提交、审阅合入和参数治理。",
      path: "/parameters",
      icon: SlidersHorizontal,
      value: `${state.changeRequests.filter((request) => request.status !== "已合入").length}`,
      label: "待流转请求"
    },
    {
      title: "日志智能分析平台",
      text: "上传日志、可视化 AI 分析阶段、根因推断和证据链追溯。",
      path: "/logs",
      icon: FileText,
      value: "无线充电日志分析",
      label: "已支持"
    },
    {
      title: "参数调试平台",
      text: "调试样机连接、实时参数下发、风险确认和回滚准备。",
      path: "/debugging",
      icon: TerminalSquare,
      value: state.devices.some((device) => device.status === "已连接") ? "在线" : "就绪",
      label: "设备状态"
    }
  ];

  return (
    <div className="home-grid">
      <section className="hero-panel">
        <div className="hero-art" />
        <div className="hero-copy">
          <h1>智效 WiseEff：AI 驱动的企业业务效率平台</h1>
          <p>
            统一连接参数、日志、调试三个高频效率场景，让 AI Agent 在同一业务上下文里辅助检索、分析、审阅、执行和治理留痕。
          </p>
          <div className="hero-actions">
            <button className="button primary" type="button" onClick={() => onNavigate("/parameters")}>
              进入工作台
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <section className="app-entry-grid">
        {appCards.map((card) => {
          const Icon = card.icon;
          return (
            <button className="entry-card" key={card.path} type="button" onClick={() => onNavigate(card.path)}>
              <div className="entry-icon">
                <Icon size={25} />
              </div>
              <ChevronRight className="entry-arrow" size={20} />
              <h2>{card.title}</h2>
              <p>{card.text}</p>
              <div className="entry-metric">
                <strong>{card.value}</strong>
                <span>{card.label}</span>
              </div>
            </button>
          );
        })}
      </section>

      <section className="dark-ai-band ai-workflow-showcase" aria-label="AI 工作流闭环">
        <div className="dark-ai-band-head">
          <div className="ai-workflow-eyebrow">
            <Sparkles size={16} />
            <span>参数 / 日志 / 调试</span>
          </div>
          <h2>
            问你想问，做你想做：让 Agent 成为<span className="text-nowrap">平台使用助手</span>
          </h2>
          <p>
            平台里有的信息，都可以直接问；你能通过 Web 交互完成的操作，也可以让 OpsAgent 代劳。用户只需要讲清楚目标，Agent 负责查知识库、找参数、填表单和推进流程。
          </p>
          <div className="ai-workflow-stats" aria-label="AI 工作流覆盖范围">
            <div>
              <strong>2 个核心能力</strong>
              <span>问你想问、做你想做</span>
            </div>
            <div>
              <strong>低门槛使用</strong>
              <span>不用先熟悉所有页面和字段</span>
            </div>
          </div>
        </div>

        <div className="ai-workflow-stage">
          <div className="ai-carousel" aria-label="AI 场景轮播">
            <div className="ai-carousel-track">
              {homeAiScenarios.map((scenario) => (
                <article className="ai-scenario-slide" key={`${scenario.label}-${scenario.title}`}>
                  <div className="ai-scenario-topline">
                    <span>{scenario.label}</span>
                    <strong>{scenario.metric}</strong>
                  </div>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.context}</p>
                  <div className="ai-evidence-chain" aria-label={`${scenario.title}证据链`}>
                    {scenario.evidence.map((item, index) => (
                      <span key={item}>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        {item}
                      </span>
                    ))}
                  </div>
                  <div className="ai-scenario-action">
                    <CheckCircle2 size={16} />
                    <span>{scenario.action}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="ai-capability-grid">
            {homeAiCapabilities.map((capability) => (
              <article className="ai-capability-card" key={capability.label}>
                <span>{capability.label}</span>
                <strong>{capability.text}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard title="已处理参数修改" value="35次" trend="较上周增长 35%" tone="teal" />
        <MetricCard title="参数合入平均闭环时长" value="20分钟" trend="较上月缩短 20%" tone="blue" />
        <MetricCard title="日志智能分析次数" value="128次" trend="累计完成日志分析" tone="purple" />
        <MetricCard title="参数调试使用次数" value="72次" trend="覆盖权限、确认、审计链路" tone="blue" />
      </section>
    </div>
  );
}

type ParameterRiskFilter = "All" | "High" | "Medium" | "Low";

function getFallbackComparisonProjectId(projectId: string) {
  return projects.find((project) => project.id !== projectId)?.id ?? projectId;
}

function createComparisonInsights(state: PrototypeState, selection: ComparisonProjectSelection) {
  const baseProject = projects.find((project) => project.id === selection.baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === selection.targetProjectId) ?? projects[1] ?? projects[0];
  const baseParameters = state.parameters.filter((parameter) => parameter.projectId === baseProject.id);
  const targetParameters = state.parameters.filter((parameter) => parameter.projectId === targetProject.id);
  const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));
  const comparisonRows = baseParameters.map((baseParameter) => {
    const targetParameter = targetByName.get(baseParameter.name);

    return {
      key: baseParameter.name,
      risk: baseParameter.risk,
      status: targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift"
    };
  });
  const driftRows = comparisonRows.filter((row) => row.status === "drift");
  const primaryInsight = driftRows.find((row) => row.risk === "High") ?? driftRows[0] ?? comparisonRows[0];
  const secondaryInsight = driftRows.find((row) => row.key !== primaryInsight?.key) ?? comparisonRows[1] ?? primaryInsight;

  return {
    baseProject,
    targetProject,
    primaryInsight,
    secondaryInsight
  };
}

function ParametersPage({ state, dispatch, onNavigate }: PageProps) {
  const [riskFilter, setRiskFilter] = useState<ParameterRiskFilter>("All");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(state.parameters[0]?.id ?? "");
  const [targetValue, setTargetValue] = useState("80");
  const [reason, setReason] = useState("参考 Agent 巡检建议，将高风险参数回落到安全阈值内。");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const projectParameters = useMemo(
    () => state.parameters.filter((parameter) => parameter.projectId === state.activeProjectId),
    [state.activeProjectId, state.parameters]
  );
  const moduleOptions = useMemo(
    () => Array.from(new Set(projectParameters.map((parameter) => parameter.module))),
    [projectParameters]
  );
  const parameters = projectParameters.filter(
    (parameter) =>
      (riskFilter === "All" || parameter.risk === riskFilter) && (moduleFilter === "All" || parameter.module === moduleFilter)
  );
  const selected = parameters.find((parameter) => parameter.id === selectedId) ?? parameters[0];

  useEffect(() => {
    setModuleFilter("All");
  }, [state.activeProjectId]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setTargetValue(selected.recommendedValue);
  }, [selected?.id, selected?.recommendedValue]);

  const submit = () => {
    if (!selected) {
      return;
    }
    dispatch({ type: "ADD_CHANGE_REQUEST", parameterId: selected.id, targetValue, reason });
    setConfirmOpen(false);
  };

  return (
    <WorkbenchLayout
      title="项目参数用户工作台"
      actions={
        <button className="button subtle" type="button" onClick={() => onNavigate("/parameter-comparison")}>
          <ArrowRight size={16} />
          跨项目对比
        </button>
      }
    >
      <aside className="filter-panel" aria-label="参数筛选">
        <SectionLabel icon={<Filter size={16} />} label="筛选条件" />
        <label className="field-label" htmlFor="parameter-project-filter">
          项目
        </label>
        <select
          id="parameter-project-filter"
          className="filter-select"
          value={state.activeProjectId}
          onChange={(event) => dispatch({ type: "SET_PROJECT", projectId: event.target.value })}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} · {project.name}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="parameter-risk-filter">
          重要性
        </label>
        <select
          id="parameter-risk-filter"
          className="filter-select"
          value={riskFilter}
          onChange={(event) => setRiskFilter(event.target.value as ParameterRiskFilter)}
        >
          {([
            ["All", "全部"],
            ["High", "高"],
            ["Medium", "中"],
            ["Low", "低"]
          ] as const).map(([risk, label]) => (
            <option key={risk} value={risk}>
              {label}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="parameter-module-filter">
          模块
        </label>
        <select
          id="parameter-module-filter"
          className="filter-select"
          value={moduleFilter}
          onChange={(event) => setModuleFilter(event.target.value)}
        >
          {["All", ...moduleOptions].map((module) => (
            <option key={module} value={module}>
              {module === "All" ? "全部" : module}
            </option>
          ))}
        </select>
      </aside>
      <section className="workbench-main">
        <DataTable
          headers={["参数名称", "模块", "当前值", "示例", "范围 / 单位", "重要性", "更新时间"]}
          rows={parameters}
          renderRow={(parameter) => (
            <tr
              className={selected?.id === parameter.id ? "selected-row" : ""}
              key={parameter.id}
              onClick={() => {
                setSelectedId(parameter.id);
                setTargetValue(parameter.recommendedValue);
              }}
            >
              <td>
                <strong>{parameter.name}</strong>
                <small>{parameter.description}</small>
              </td>
              <td>
                <Badge tone="tertiary">{parameter.module}</Badge>
              </td>
              <td className="mono">{parameter.currentValue}</td>
              <td className="mono recommended">
                <span className="value-change">
                  <ArrowRight size={14} />
                  <span>{parameter.recommendedValue}</span>
                </span>
              </td>
              <td>
                <span>{parameter.range}</span>
                <small>{parameter.unit}</small>
              </td>
              <td>
                <RiskBadge risk={parameter.risk} />
              </td>
              <td>{parameter.updatedAt}</td>
            </tr>
          )}
        />
      </section>
      <aside className="detail-panel">
        <SectionLabel icon={<Sparkles size={16} />} label="修改草稿" />
        {selected ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <div className="detail-heading">
              <strong>{selected.name}</strong>
              <RiskBadge risk={selected.risk} />
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<Info size={15} />} label="参数说明" />
              <p>{selected.explanation}</p>
            </div>
            <div className="parameter-info-card">
              <SectionLabel icon={<FileText size={15} />} label="参数配置格式" />
              <code>{selected.configFormat}</code>
            </div>
            <label className="field-label" htmlFor="target-value">
              目标值
            </label>
            <input id="target-value" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
            <label className="field-label" htmlFor="reason">
              修改原因
            </label>
            <textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={5} />
            <Timeline steps={["选择参数", "填写目标值", "提交审阅", "管理员合入"]} activeIndex={1} />
            <button className="button primary full" type="submit">
              提交参数修改请求
            </button>
          </form>
        ) : (
          <EmptyState text="请选择一条参数后提交修改。" />
        )}
      </aside>
      {confirmOpen && selected ? (
        <ConfirmDialog
          title="确认提交参数修改"
          message={`将 ${selected.name} 从 ${selected.currentValue} 修改为 ${targetValue}，提交后进入参数管理员审阅队列。`}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={submit}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function ParameterComparisonPage({
  state,
  onNavigate,
  comparisonSelection,
  onComparisonSelectionChange
}: PageProps & {
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: React.Dispatch<React.SetStateAction<ComparisonProjectSelection>>;
}) {
  const { baseProjectId, targetProjectId } = comparisonSelection;
  const [riskFilter, setRiskFilter] = useState<ParameterRiskFilter>("All");
  const [moduleFilter, setModuleFilter] = useState("All");
  const baseProject = projects.find((project) => project.id === baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === targetProjectId) ?? projects[1] ?? projects[0];

  const chooseBaseProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: projectId,
      targetProjectId: current.targetProjectId === projectId ? getFallbackComparisonProjectId(projectId) : current.targetProjectId
    }));
  };

  const chooseTargetProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: current.baseProjectId === projectId ? getFallbackComparisonProjectId(projectId) : current.baseProjectId,
      targetProjectId: projectId
    }));
  };

  const comparisonRows = useMemo(() => {
    const baseParameters = state.parameters.filter((parameter) => parameter.projectId === baseProject.id);
    const targetParameters = state.parameters.filter((parameter) => parameter.projectId === targetProject.id);
    const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));

    return baseParameters.map((baseParameter) => {
      const targetParameter = targetByName.get(baseParameter.name);
      const status = targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift";

      return {
        key: baseParameter.name,
        module: baseParameter.module,
        description: baseParameter.description,
        baseValue: `${baseParameter.currentValue} ${baseParameter.unit}`.trim(),
        targetValue: targetParameter ? `${targetParameter.currentValue} ${targetParameter.unit}`.trim() : "未配置",
        status,
        risk: baseParameter.risk
      };
    });
  }, [baseProject, state.parameters, targetProject]);
  const moduleOptions = useMemo(() => Array.from(new Set(comparisonRows.map((row) => row.module))), [comparisonRows]);
  const filteredComparisonRows = useMemo(
    () =>
      comparisonRows.filter(
        (row) =>
          (riskFilter === "All" || row.risk === riskFilter) &&
          (moduleFilter === "All" || row.module === moduleFilter)
      ),
    [comparisonRows, moduleFilter, riskFilter]
  );

  useEffect(() => {
    if (moduleFilter !== "All" && !moduleOptions.includes(moduleFilter)) {
      setModuleFilter("All");
    }
  }, [moduleFilter, moduleOptions]);

  const driftRows = comparisonRows.filter((row) => row.status === "drift");
  const comparisonTitle = `${baseProject.code} vs ${targetProject.code}`;

  return (
    <div className="comparison-page">
      <header className="page-header comparison-header">
        <div>
          <nav className="breadcrumb" aria-label="参数对比路径">
            <button type="button" onClick={() => onNavigate("/parameters")}>参数</button>
            <ChevronRight size={14} />
            <span>对比分析</span>
            <ChevronRight size={14} />
            <strong>{comparisonTitle}</strong>
          </nav>
          <h1>项目参数对比分析</h1>
          <p>{baseProject.name} 与 {targetProject.name} 的充电、电池和电源管理参数差异分析。</p>
        </div>
        <div className="page-actions">
          <button className="button subtle" type="button">
            <Upload size={16} />
            导出
          </button>
          <button className="button primary" type="button">
            <RotateCcw size={16} />
            同步选中项
          </button>
        </div>
      </header>

      <section className="comparison-controls" aria-label="项目对比选择">
        <ProjectComparisonSelect
          label="基准项目"
          selectedProjectId={baseProject.id}
          disabledProjectId={targetProject.id}
          onSelect={chooseBaseProject}
        />
        <ProjectComparisonSelect
          label="对比项目"
          selectedProjectId={targetProject.id}
          disabledProjectId={baseProject.id}
          onSelect={chooseTargetProject}
        />
      </section>

      <section className="comparison-summary" aria-label="参数对比摘要">
        <MetricCard title="对比范围" value={comparisonTitle} trend="实际项目参数对比" tone="blue" />
        <MetricCard title="漂移参数" value={`${driftRows.length}`} trend="需要审阅后同步" tone="teal" />
        <MetricCard title="高重要性差异" value={`${driftRows.filter((row) => row.risk === "High").length}`} trend="OpsAgent 已生成风险说明" tone="purple" />
      </section>

      <section className="comparison-layout">
        <div className="comparison-matrix">
          <PanelHeader title="参数差异矩阵" meta={`${filteredComparisonRows.length} / ${comparisonRows.length} 项参数`} />
          <section className="comparison-filter-bar" aria-label="参数矩阵筛选">
            <SectionLabel icon={<Filter size={16} />} label="筛选条件" />
            <div className="comparison-filter-fields">
              <label className="field-label" htmlFor="comparison-risk-filter">
                重要性
                <select
                  id="comparison-risk-filter"
                  className="filter-select"
                  value={riskFilter}
                  onChange={(event) => setRiskFilter(event.target.value as ParameterRiskFilter)}
                >
                  {([
                    ["All", "全部"],
                    ["High", "高"],
                    ["Medium", "中"],
                    ["Low", "低"]
                  ] as const).map(([risk, label]) => (
                    <option key={risk} value={risk}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label" htmlFor="comparison-module-filter">
                模块
                <select
                  id="comparison-module-filter"
                  className="filter-select"
                  value={moduleFilter}
                  onChange={(event) => setModuleFilter(event.target.value)}
                >
                  {["All", ...moduleOptions].map((module) => (
                    <option key={module} value={module}>
                      {module === "All" ? "全部" : module}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <div className="comparison-matrix-scroll">
            <div className="comparison-grid comparison-grid-head">
              <span>参数键</span>
              <span>参数含义</span>
              <span><i className="env-dot production" />{baseProject.code}</span>
              <span><i className="env-dot staging" />{targetProject.code}</span>
              <span>重要性</span>
              <span>操作</span>
            </div>
            {filteredComparisonRows.map((row) => (
              <div className={row.status === "drift" ? "comparison-grid comparison-row drift" : "comparison-grid comparison-row"} key={row.key}>
                <div className="comparison-key">
                  {row.status === "drift" ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                  <div>
                    <strong>{row.key}</strong>
                    <small>{row.module}</small>
                  </div>
                </div>
                <p className="comparison-meaning">{row.description}</p>
                <span className="comparison-value">{row.baseValue}</span>
                <span className="comparison-value staging-value">{row.targetValue}</span>
                <div className="comparison-importance">
                  <RiskBadge risk={row.risk} />
                </div>
                <div className="comparison-actions">
                  {row.status === "drift" ? (
                    <>
                      <button className="icon-button" type="button" aria-label={`同步 ${row.key}`}>
                        <ArrowRight size={17} />
                      </button>
                      <button className="icon-button danger-icon" type="button" aria-label={`忽略 ${row.key}`}>
                        <X size={17} />
                      </button>
                    </>
                  ) : (
                    <span>已同步</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProjectComparisonSelect({
  label,
  selectedProjectId,
  disabledProjectId,
  onSelect
}: {
  label: "基准项目" | "对比项目";
  selectedProjectId: string;
  disabledProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const fieldId = label === "基准项目" ? "base-project-select" : "target-project-select";

  return (
    <label className="project-select-field" htmlFor={fieldId}>
      <span>{label}</span>
      <div className="project-select-shell">
        <select id={fieldId} aria-label={label} value={selectedProjectId} onChange={(event) => onSelect(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id} disabled={project.id === disabledProjectId}>
              {project.code} · {project.name}
            </option>
          ))}
        </select>
        <ChevronRight size={18} aria-hidden="true" />
      </div>
      <small>
        当前选择 {selectedProject.code}，{selectedProject.name}
      </small>
    </label>
  );
}

function ParameterReviewPage({ state, dispatch }: PageProps) {
  const [selectedId, setSelectedId] = useState(state.changeRequests[0]?.id ?? "");
  const [rejectOpen, setRejectOpen] = useState(false);
  const selected = state.changeRequests.find((request) => request.id === selectedId) ?? state.changeRequests[0];

  const rejectSelected = (reason: string) => {
    if (!selected) {
      return;
    }
    dispatch({ type: "REJECT_REVIEW", requestId: selected.id, reason });
    setRejectOpen(false);
  };

  return (
    <WorkbenchLayout
      title="参数管理员工作台"
      subtitle="审阅参数变更队列，结合 AI 摘要和时间线推进合入上库流程。"
      actions={
        <button className="button subtle" type="button">
          <Filter size={16} />
          筛选队列
        </button>
      }
    >
      <section className="review-queue">
        <PanelHeader title="待审阅请求" meta={`${state.changeRequests.length} 项操作`} />
        <DataTable
          headers={["请求编号", "模块", "提交人", "变更", "状态"]}
          rows={state.changeRequests}
          renderRow={(request) => (
            <tr
              className={request.id === selected?.id ? "selected-row" : ""}
              key={request.id}
              onClick={() => setSelectedId(request.id)}
            >
              <td className="mono">{request.id}</td>
              <td>{request.module}</td>
              <td>{request.submitter}</td>
              <td className="change-cell">
                <span className="value-change">
                  <span className="strike">{request.currentValue}</span>
                  <ArrowRight size={14} />
                  <strong>{request.targetValue}</strong>
                </span>
              </td>
              <td>
                <StatusBadge status={request.status} />
              </td>
            </tr>
          )}
        />
      </section>
      <aside className="review-detail" aria-label="审阅详情">
        {selected ? (
          <>
            <div className="detail-card">
              <span className="eyebrow">{selected.id}</span>
              <h2>{selected.title}</h2>
              <p>
                目标模块为 <strong>{selected.module}</strong>，由 {selected.submitter} 提交。
              </p>
            </div>
            <div className="ai-summary-card">
              <SectionLabel icon={<Sparkles size={16} />} label="审阅摘要" />
              <p>{selected.aiSummary}</p>
            </div>
            {selected.rejectReason ? (
              <div className="rejection-reason-card">
                <SectionLabel icon={<CircleOff size={16} />} label="打回原因" />
                <p>{selected.rejectReason}</p>
              </div>
            ) : null}
            <div className="detail-card grow">
              <SectionLabel icon={<History size={16} />} label="变更历史" />
              <VerticalTimeline
                items={[
                  ["现在", selected.status, selected.rejectReason ?? "等待管理员确认和流程推进。"],
                  ["2 小时前", "自动检查通过", "回归检查与阈值校验通过。"],
                  ["昨天", "请求已提交", `提交人：${selected.submitter}。`]
                ]}
              />
            </div>
            <div className="action-panel">
              <button className="button primary full" type="button" onClick={() => dispatch({ type: "ADVANCE_REVIEW", requestId: selected.id })}>
                <CheckCircle2 size={17} />
                推进流程
              </button>
              <button className="button danger full" type="button" onClick={() => setRejectOpen(true)}>
                <CircleOff size={17} />
                打回修改
              </button>
            </div>
          </>
        ) : (
          <EmptyState text="当前没有待审阅请求。" />
        )}
      </aside>
      {rejectOpen && selected ? (
        <RejectReviewDialog request={selected} onCancel={() => setRejectOpen(false)} onSubmit={rejectSelected} />
      ) : null}
    </WorkbenchLayout>
  );
}

function RejectReviewDialog({
  request,
  onCancel,
  onSubmit
}: {
  request: ChangeRequest;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reject-title">
      <form
        className="confirm-dialog rejection-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedReason) {
            return;
          }
          onSubmit(trimmedReason);
        }}
      >
        <h2 id="reject-title">打回修改</h2>
        <p>
          将 {request.id} 打回给提交人，管理员需要填写明确原因，方便项目侧补充测试数据或重新调整目标值。
        </p>
        <label htmlFor="reject-reason">打回原因</label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          placeholder="说明需要补充的测试数据、风险依据或参数调整方向"
        />
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button danger" type="submit" disabled={!trimmedReason}>
            提交打回
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfigExportPanel({ configJson }: { configJson: string }) {
  const [syncMessage, setSyncMessage] = useState("导出后可手动替换 src/config/power-management.json。");
  const [saving, setSaving] = useState(false);
  const exportConfig = () => {
    const blob = new Blob([configJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "power-management.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSyncMessage("JSON 已导出，可手动同步回代码配置源。");
  };
  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(configJson);
      setSyncMessage("JSON 已复制，可手动同步回代码配置源。");
    } catch {
      setSyncMessage("当前浏览器限制剪贴板写入，可直接从预览区复制 JSON。");
    }
  };
  const saveConfig = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/power-management-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: configJson
      });
      if (!response.ok) {
        throw new Error("保存失败");
      }
      setSyncMessage("已写入 src/config/power-management.json，刷新项目后会读取最新配置。");
    } catch {
      setSyncMessage("写入失败：当前环境不支持本地保存时，请导出 JSON 后手动替换。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-preview-panel">
      <PanelHeader title="配置源预览" meta="src/config/power-management.json" />
      <pre>{configJson}</pre>
      <div className="config-actions">
        <button className="button primary" type="button" onClick={saveConfig} disabled={saving}>
          <FileText size={16} />
          {saving ? "保存中" : "保存到 JSON 文件"}
        </button>
        <button className="button subtle" type="button" onClick={exportConfig}>
          <Upload size={16} />
          导出 JSON
        </button>
        <button className="button subtle" type="button" onClick={copyConfig}>
          <FileText size={16} />
          复制 JSON
        </button>
      </div>
      <div className="config-sync-note">{syncMessage}</div>
    </div>
  );
}

function ParameterAdminPage({ state, dispatch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.parameterLibrary[0]?.id ?? "");
  const selectedParameter =
    state.configDraft.parameterLibrary.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.parameterLibrary[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);

  useEffect(() => {
    if (!state.configDraft.parameterLibrary.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.parameterLibrary[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.parameterLibrary]);

  const updateMetadata = (patch: Partial<ParameterEditorDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: state.configDraft.projects[0]?.id ?? state.activeProjectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateValue = (projectId: string, patch: Partial<ParameterValueDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({
      type: "UPDATE_PROJECT_PARAMETER_VALUE",
      projectId,
      parameterId: selectedParameter.id,
      patch
    });
  };

  const updateRecommendedValue = (recommendedValue: string) => {
    if (!selectedParameter) {
      return;
    }
    state.configDraft.projects.forEach((project) => {
      dispatch({
        type: "UPDATE_PROJECT_PARAMETER_VALUE",
        projectId: project.id,
        parameterId: selectedParameter.id,
        patch: { recommendedValue }
      });
    });
  };

  return (
    <AdminPageScaffold
      title="项目参数管理后台"
      subtitle="编辑项目内配置源，参数工作台和对比分析页会同步读取当前草稿。"
      metrics={[
        ["共享参数", `${state.configDraft.parameterLibrary.length}`, "所有项目共用一份参数库"],
        ["项目值", `${state.configDraft.projects.length} 组`, "只维护每个项目的实际取值"],
        ["配置草稿", "可写入", "可直接保存到 JSON 文件"],
        ["高重要性", `${state.configDraft.parameterLibrary.filter((parameter) => parameter.risk === "High").length}`, "需要管理员复核"]
      ]}
      action={<button className="button primary" type="button" onClick={() => dispatch({ type: "IMPORT_PARAMETERS" })}><Upload size={16} />批量参数导入</button>}
    >
      <section className="config-admin-grid">
        <div className="library-panel config-list-panel">
          <PanelHeader title="项目共享参数库" meta={`${state.configDraft.parameterLibrary.length} 项`} />
          <div className="config-list-actions">
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                dispatch({ type: "ADD_PROJECT_PARAMETER" });
                setSelectedParameterId(`new-power-parameter-${state.configDraft.parameterLibrary.length + 1}`);
              }}
            >
              新增参数
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!selectedParameter || state.configDraft.parameterLibrary.length <= 1}
              onClick={() => {
                if (!selectedParameter) {
                  return;
                }
                dispatch({ type: "DELETE_PROJECT_PARAMETER", parameterId: selectedParameter.id });
                setSelectedParameterId(state.configDraft.parameterLibrary.find((parameter) => parameter.id !== selectedParameter.id)?.id ?? "");
              }}
            >
              删除参数
            </button>
          </div>
          <div className="library-list">
            {state.configDraft.parameterLibrary.map((parameter) => (
              <button
                className={parameter.id === selectedParameter?.id ? "config-list-row selected" : "config-list-row"}
                key={parameter.id}
                type="button"
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span>
                  <strong>{parameter.name}</strong>
                  <small>{parameter.module}</small>
                </span>
                <RiskBadge risk={parameter.risk} />
              </button>
            ))}
          </div>
        </div>

        <div className="config-editor-panel project-config-editor">
          {selectedParameter ? (
            <>
              <section className="shared-definition-panel" aria-label="共享参数定义">
                <PanelHeader title="共享参数定义" meta="所有项目共用" />
                <div className="config-form-grid">
                  <label>
                    参数名称
                    <input value={selectedParameter.name} onChange={(event) => updateMetadata({ name: event.target.value })} />
                  </label>
                  <label>
                    模块
                    <input value={selectedParameter.module} onChange={(event) => updateMetadata({ module: event.target.value })} />
                  </label>
                  <label>
                    推荐值
                    <input
                      aria-label="参数推荐值"
                      value={selectedParameter.values[state.configDraft.projects[0]?.id ?? state.activeProjectId]?.recommendedValue ?? ""}
                      onChange={(event) => updateRecommendedValue(event.target.value)}
                    />
                  </label>
                  <label>
                    范围
                    <input value={selectedParameter.range} onChange={(event) => updateMetadata({ range: event.target.value })} />
                  </label>
                  <label>
                    单位
                    <input value={selectedParameter.unit} onChange={(event) => updateMetadata({ unit: event.target.value })} />
                  </label>
                  <label>
                    重要性
                    <select
                      value={selectedParameter.risk}
                      onChange={(event) => updateMetadata({ risk: event.target.value as ParameterEditorDraft["risk"] })}
                    >
                      <option value="High">高</option>
                      <option value="Medium">中</option>
                      <option value="Low">低</option>
                    </select>
                  </label>
                  <label className="wide">
                    展示描述
                    <textarea value={selectedParameter.description} onChange={(event) => updateMetadata({ description: event.target.value })} rows={3} />
                  </label>
                  <label className="wide">
                    参数解释
                    <textarea value={selectedParameter.explanation} onChange={(event) => updateMetadata({ explanation: event.target.value })} rows={4} />
                  </label>
                  <label className="wide">
                    配置格式
                    <textarea value={selectedParameter.configFormat} onChange={(event) => updateMetadata({ configFormat: event.target.value })} rows={3} />
                  </label>
                </div>
              </section>

              <section className="project-value-matrix" aria-label="项目参数值矩阵">
                <PanelHeader title="项目参数值矩阵" meta="每个项目独立取值" />
                <p>所有项目共用同一条参数定义，只在这里维护各项目的实际值。</p>
                <div className="project-value-table">
                  <div className="project-value-head">
                    <span>项目</span>
                    <span>当前值</span>
                    <span>更新时间</span>
                  </div>
                  {state.configDraft.projects.map((project) => {
                    const value = selectedParameter.values[project.id];
                    return (
                      <div className="project-value-row" key={project.id}>
                        <div>
                          <strong>{project.code}</strong>
                          <small>{project.name}</small>
                        </div>
                        <label>
                          <span>{project.code} 当前值</span>
                          <input
                            aria-label={`${project.code} 当前值`}
                            value={value.currentValue}
                            onChange={(event) => updateValue(project.id, { currentValue: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>{project.code} 更新时间</span>
                          <input
                            aria-label={`${project.code} 更新时间`}
                            value={value.updatedAt}
                            onChange={(event) => updateValue(project.id, { updatedAt: event.target.value })}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <EmptyState text="请选择一个项目参数。" />
          )}
        </div>

        <ConfigExportPanel configJson={configJson} />
      </section>
    </AdminPageScaffold>
  );
}

function inferEvidenceFinding(source: string, fallbackIndex: number) {
  if (source.includes("[CHG_THERMAL]")) {
    return "电池包温度越过 45°C 软阈值，确认热异常触发点。";
  }
  if (source.includes("[CHG_POLICY]")) {
    return "充电策略已主动降低快充电流，说明热保护链路已经介入。";
  }
  if (source.includes("[BATTERY_GAUGE]")) {
    return "SOC 增长斜率在降额后回落，佐证温升与充电体验波动有关。";
  }
  if (source.includes("SourceCap")) {
    return "适配器上报的 SourceCap 覆盖目标档位，具备稳定协商基础。";
  }
  if (source.includes("Accept profile")) {
    return "设备端接受 9V/3A 档位，确认 PD 协商链路未发生重试。";
  }
  if (source.includes("[CHARGER]")) {
    return "输入电压与电流保持在目标窗口内，充电链路进入稳定阶段。";
  }
  if (source.includes("[PARSER]")) {
    return "解析器识别到当前文件不满足文本日志要求，需要保留原件并重新导出。";
  }

  return fallbackIndex === 0 ? "日志片段已进入证据池，等待后续模式匹配。" : "日志片段已进入证据池，等待后续报告合并。";
}

function LogsPage({ state }: PageProps) {
  const [selectedLogId, setSelectedLogId] = useState(state.logs[0]?.id ?? "");
  const [unsupportedDialogOpen, setUnsupportedDialogOpen] = useState(false);
  const activeLog = state.logs.find((log) => log.id === selectedLogId) ?? state.logs[0];
  const stages: LogRecord["stage"][] = ["日志解析", "模式匹配", "根因推断", "报告生成"];
  const stageIndex = stages.indexOf(activeLog.stage);
  const evidenceInsights = activeLog.evidence.map((item, index) => {
    const action = activeLog.suggestedActions[index] ?? activeLog.suggestedActions[0] ?? "保留原始日志并进入人工复核。";

    return {
      id: `${activeLog.id}-evidence-${index}`,
      label: `证据 ${String(index + 1).padStart(2, "0")}`,
      stage: stages[Math.min(index, stages.length - 1)],
      source: item,
      inferred: inferEvidenceFinding(item, index),
      action
    };
  });

  return (
    <WorkbenchLayout title="日志智能分析" subtitle="上传日志并观察 AI 自动化分析过程、证据链和处置线索。">
      <section className="logs-left">
        <button className="upload-zone" type="button" onClick={() => setUnsupportedDialogOpen(true)}>
          <Upload size={34} />
          <strong>拖放日志文件到此处</strong>
          <span>点击模拟上传不支持格式日志</span>
        </button>
        <div className="detail-card">
          <SectionLabel
            icon={<Loader2 size={16} className={activeLog.status === "Processing" ? "spin" : ""} />}
            label={`${logStatusLabels[activeLog.status]}：${activeLog.fileName}`}
          />
          <Timeline steps={stages} activeIndex={stageIndex} />
        </div>
        <section className="analysis-card" aria-label="分析结果">
          <PanelHeader title="分析结果" meta={logStatusLabels[activeLog.status]} />
          <div className="analysis-grid">
            <div className="raw-log-panel">
              <SectionLabel icon={<FileSearch size={16} />} label="结论摘要" />
              <p className="result-copy">{activeLog.conclusion}</p>
              <SectionLabel icon={<FileText size={16} />} label="原始日志内容" />
              <div className="evidence-box">
                {activeLog.evidence.map((item, index) => (
                  <div className="raw-log-line" key={item}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <code>{item}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="evidence-chain">
              <SectionLabel icon={<ListChecks size={16} />} label="日志分析证据链" />
              <div className="evidence-chain-list">
                {evidenceInsights.map((item) => (
                  <article className="evidence-chain-item" key={item.id}>
                    <div className="evidence-chain-marker">
                      <span>{item.label}</span>
                      <strong>{item.stage}</strong>
                    </div>
                    <div className="evidence-chain-body">
                      <code>{item.source}</code>
                      <p>{item.inferred}</p>
                      <small>关联处置：{item.action}</small>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>
      <aside className="history-panel" aria-label="历史日志记录">
        <PanelHeader title="历史日志记录" />
        {state.logs.map((log) => (
          <button
            aria-pressed={log.id === activeLog.id}
            className={log.id === activeLog.id ? "history-item active" : "history-item"}
            key={log.id}
            type="button"
            onClick={() => setSelectedLogId(log.id)}
          >
            <strong>{log.fileName}</strong>
            <span>{logStatusLabels[log.status]} · {log.confidence}%</span>
          </button>
        ))}
      </aside>
      {unsupportedDialogOpen ? (
        <ConfirmDialog
          title="不支持的日志格式"
          message="system_dump.bin 无法处理，请上传 .log、.txt 或 .json。"
          cancelLabel="关闭"
          confirmLabel="知道了"
          onCancel={() => setUnsupportedDialogOpen(false)}
          onConfirm={() => setUnsupportedDialogOpen(false)}
        />
      ) : null}
    </WorkbenchLayout>
  );
}

function LogAdminPage({ state }: PageProps) {
  return (
    <AdminPageScaffold
      title="日志分析管理后台"
      subtitle="查看日志分析应用指标、处理记录、失败文件和后台权限配置。"
      metrics={[
        ["今日分析", "42", "较昨日 +18%"],
        ["平均置信度", "91%", "完成记录均值"],
        ["失败文件", `${state.logs.filter((log) => log.status === "Failed").length}`, "格式或大小异常"],
        ["吞吐峰值", "1.2GB", "nginx_access.log.gz"]
      ]}
    >
      <section className="admin-grid two">
        <LibraryPanel title="分析记录概览" items={state.logs.map((log) => [log.fileName, log.stage, log.status])} />
        <AuditPanel events={state.auditEvents.filter((event) => event.app === "logs" || event.app === "log-admin")} />
      </section>
    </AdminPageScaffold>
  );
}

function DebuggingPage({ state, dispatch }: PageProps) {
  const [moduleFilter, setModuleFilter] = useState("All");
  const [operationRecords, setOperationRecords] = useState<[string, string, string][]>([]);
  const activeDevice = state.devices.find((device) => device.projectId === state.activeProjectId) ?? state.devices[0];
  const moduleOptions = useMemo(
    () => Array.from(new Set(state.debugParameters.map((parameter) => getDebugModule(parameter)))),
    [state.debugParameters]
  );
  const debugParameters =
    moduleFilter === "All"
      ? state.debugParameters
      : state.debugParameters.filter((parameter) => getDebugModule(parameter) === moduleFilter);
  const pendingParameters = debugParameters.filter((parameter) => parameter.status === "待下发");
  const connected = activeDevice.status === "已连接";
  const timelineItems: [string, string, string][] = [
    ...operationRecords,
    ["刚刚", connected ? `${activeDevice.name} 在线` : "等待连接样机", activeDevice.firmware],
    ["10:45:02", "下发 charger.input_current_limit_ma", "值变更：3800 -> 3500，执行成功。"],
    ["10:50:11", "battery.cell_temp_limit_c 被拒绝", "越界错误，允许最大值为 46°C。"],
    ["10:52:30", "读取全量充电参数快照", "共 142 项。"]
  ];
  const updateTargetValue = (parameter: DebugParameter, targetValue: string) => {
    dispatch({
      type: "UPDATE_DEBUG_PARAMETER",
      parameterId: parameter.id,
      patch: {
        targetValue,
        status: targetValue === parameter.currentValue ? "已同步" : "待下发"
      }
    });
  };
  const pushPendingValues = () => {
    if (pendingParameters.length === 0) {
      return;
    }

    const records = pendingParameters.map(
      (parameter): [string, string, string] => [
        "刚刚",
        `下发 ${parameter.key}`,
        `值变更：${parameter.currentValue} -> ${parameter.targetValue} ${parameter.unit}，执行成功。`
      ]
    );
    setOperationRecords((items) => [...records, ...items]);
    dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingParameters.map((parameter) => parameter.id) });
  };

  return (
    <WorkbenchLayout
      title="参数调试平台"
      subtitle="连接调试样机后执行实时充电参数调节，所有下发动作都保留确认和回滚准备。"
      actions={
        <div className="device-pill">
          <span className={connected ? "live-dot" : "idle-dot"} />
          {connected ? `已连接：${activeDevice.name}` : `未连接：${activeDevice.name}`}
          <button className="link-button" type="button" onClick={() => dispatch({ type: "CONNECT_DEVICE", deviceId: activeDevice.id })}>
            连接
          </button>
        </div>
      }
    >
      <aside className="filter-panel" aria-label="参数筛选">
        <SectionLabel icon={<Filter size={16} />} label="筛选条件" />
        <label className="field-label" htmlFor="debug-module-filter">
          模块
        </label>
        <select
          id="debug-module-filter"
          className="filter-select"
          value={moduleFilter}
          onChange={(event) => setModuleFilter(event.target.value)}
        >
          {["All", ...moduleOptions].map((module) => (
            <option key={module} value={module}>
              {module === "All" ? "全部" : module}
            </option>
          ))}
        </select>
        <div className="empty-hint">
          {debugParameters.length === 0 ? "当前筛选无数据，可重置模块。" : `当前筛选命中 ${debugParameters.length} 条参数。`}
        </div>
      </aside>
      <section className="debug-table">
        <PanelHeader title="实时可调参数" meta={connected ? "设备在线" : "需要连接"} />
        <DataTable
          headers={["参数名称", "当前值", "目标设定值", "范围", "风险", "状态"]}
          rows={debugParameters}
          renderRow={(parameter) => (
            <tr key={parameter.id}>
              <td>
                <strong>{parameter.name}</strong>
                <small>{parameter.key}</small>
              </td>
              <td className="mono">{parameter.currentValue}</td>
              <td>
                <input
                  aria-label={`${parameter.key} 目标设定值`}
                  value={parameter.targetValue}
                  onChange={(event) => updateTargetValue(parameter, event.target.value)}
                />
              </td>
              <td>{parameter.range} {parameter.unit}</td>
              <td><RiskBadge risk={parameter.risk} /></td>
              <td><Badge tone={parameter.status === "待下发" ? "secondary" : "neutral"}>{parameter.status}</Badge></td>
            </tr>
          )}
        />
        <div className="table-actionbar">
          <span>{pendingParameters.length} 项参数等待应用</span>
          <div>
            <button className="button subtle" type="button">
              <RotateCcw size={16} />
              一键回滚充电策略
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!connected || pendingParameters.length === 0}
              onClick={pushPendingValues}
            >
              <Send size={16} />
              下发调试值
            </button>
          </div>
        </div>
      </section>
      <aside className="debug-timeline" aria-label="调试操作记录">
        <PanelHeader title="调试操作记录" />
        <VerticalTimeline items={timelineItems} />
      </aside>
    </WorkbenchLayout>
  );
}

function DebuggingAdminPage({ state, dispatch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.debugParameters[0]?.id ?? "");
  const selectedParameter =
    state.configDraft.debugParameters.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.debugParameters[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);

  useEffect(() => {
    if (!state.configDraft.debugParameters.some((parameter) => parameter.id === selectedParameterId)) {
      setSelectedParameterId(state.configDraft.debugParameters[0]?.id ?? "");
    }
  }, [selectedParameterId, state.configDraft.debugParameters]);

  const updateDebug = (patch: Partial<DebugParameterEditorDraft>) => {
    if (!selectedParameter) {
      return;
    }
    dispatch({ type: "UPDATE_DEBUG_PARAMETER", parameterId: selectedParameter.id, patch });
  };

  return (
    <AdminPageScaffold
      title="参数调试管理后台"
      subtitle="编辑可调参数配置源，调试平台会同步读取当前草稿。"
      metrics={[
        ["在线设备", `${state.devices.filter((device) => device.status === "已连接").length}/${state.devices.length}`, "演示样机池"],
        ["可调参数", `${state.debugParameters.length}`, "由配置源生成"],
        ["高风险策略", `${state.debugParameters.filter((parameter) => parameter.risk === "High").length}`, "需要二次确认"],
        ["配置草稿", "可写入", "可直接保存到 JSON 文件"]
      ]}
    >
      <section className="config-admin-grid">
        <div className="library-panel config-list-panel">
          <PanelHeader title="可调参数目录" meta={`${state.configDraft.debugParameters.length} 项`} />
          <div className="config-list-actions">
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                dispatch({ type: "ADD_DEBUG_PARAMETER" });
                setSelectedParameterId(`dbg-new-parameter-${state.configDraft.debugParameters.length + 1}`);
              }}
            >
              新增可调参数
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!selectedParameter || state.configDraft.debugParameters.length <= 1}
              onClick={() => {
                if (!selectedParameter) {
                  return;
                }
                dispatch({ type: "DELETE_DEBUG_PARAMETER", parameterId: selectedParameter.id });
                setSelectedParameterId(state.configDraft.debugParameters.find((parameter) => parameter.id !== selectedParameter.id)?.id ?? "");
              }}
            >
              删除可调参数
            </button>
          </div>
          <div className="library-list">
            {state.configDraft.debugParameters.map((parameter) => (
              <button
                className={parameter.id === selectedParameter?.id ? "config-list-row selected" : "config-list-row"}
                key={parameter.id}
                type="button"
                onClick={() => setSelectedParameterId(parameter.id)}
              >
                <span>
                  <strong>{parameter.name}</strong>
                  <small>{parameter.key}</small>
                </span>
                <RiskBadge risk={parameter.risk} />
              </button>
            ))}
          </div>
        </div>

        <div className="config-editor-panel">
          <PanelHeader title="调试参数编辑" meta="实时下发目录" />
          {selectedParameter ? (
            <div className="config-form-grid">
              <label>
                参数名称
                <input value={selectedParameter.name} onChange={(event) => updateDebug({ name: event.target.value })} />
              </label>
              <label>
                参数 key
                <input value={selectedParameter.key} onChange={(event) => updateDebug({ key: event.target.value })} />
              </label>
              <label>
                当前值
                <input value={selectedParameter.currentValue} onChange={(event) => updateDebug({ currentValue: event.target.value })} />
              </label>
              <label>
                目标值
                <input
                  aria-label="调试目标值"
                  value={selectedParameter.targetValue}
                  onChange={(event) => updateDebug({ targetValue: event.target.value })}
                />
              </label>
              <label>
                范围
                <input value={selectedParameter.range} onChange={(event) => updateDebug({ range: event.target.value })} />
              </label>
              <label>
                单位
                <input value={selectedParameter.unit} onChange={(event) => updateDebug({ unit: event.target.value })} />
              </label>
              <label>
                重要性
                <select
                  value={selectedParameter.risk}
                  onChange={(event) => updateDebug({ risk: event.target.value as DebugParameterEditorDraft["risk"] })}
                >
                  <option value="High">高</option>
                  <option value="Medium">中</option>
                  <option value="Low">低</option>
                </select>
              </label>
              <label>
                状态
                <select
                  value={selectedParameter.status}
                  onChange={(event) => updateDebug({ status: event.target.value as DebugParameterEditorDraft["status"] })}
                >
                  <option value="已同步">已同步</option>
                  <option value="待下发">待下发</option>
                  <option value="下发成功">下发成功</option>
                </select>
              </label>
            </div>
          ) : (
            <EmptyState text="请选择一个调试参数。" />
          )}
        </div>

        <ConfigExportPanel
          configJson={configJson}
        />
      </section>
    </AdminPageScaffold>
  );
}

function WorkbenchLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="workbench-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      <div className="workbench-grid">{children}</div>
    </div>
  );
}

function AdminPageScaffold({
  title,
  subtitle,
  metrics,
  action,
  children
}: {
  title: string;
  subtitle: string;
  metrics: [string, string, string][];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action ? <div className="page-actions">{action}</div> : null}
      </header>
      <section className="metric-grid admin-metrics">
        {metrics.map(([label, value, trend]) => (
          <MetricCard key={label} title={label} value={value} trend={trend} tone="blue" />
        ))}
      </section>
      {children}
    </div>
  );
}

const agentFabSize = 56;
const agentPanelDesktopWidth = 430;
const agentDragInset = 14;
const agentDragThreshold = 4;

type AgentPosition = {
  right: number;
  bottom: number;
};

type AgentDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  moved: boolean;
};

function clampAgentOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentFabSize - agentDragInset));
}

function clampAgentPanelOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentPanelDesktopWidth - agentDragInset));
}

function UnifiedAgent({
  path,
  plan,
  state,
  dispatch,
  comparisonSelection
}: {
  path: string;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  comparisonSelection: ComparisonProjectSelection;
}) {
  const [open, setOpen] = useState(false);
  const [agentPosition, setAgentPosition] = useState<AgentPosition>({ right: 24, bottom: 24 });
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>(["我会根据当前页面上下文给出建议。涉及状态变更的动作会先请求确认。"]);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const dragStateRef = useRef<AgentDragState | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const moveAgent = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      dragState.moved = dragState.moved || Math.hypot(deltaX, deltaY) > agentDragThreshold;

      setAgentPosition({
        right: clampAgentOffset(dragState.startRight - deltaX, window.innerWidth),
        bottom: clampAgentOffset(dragState.startBottom - deltaY, window.innerHeight)
      });
    };

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      suppressNextClickRef.current = dragState.moved;
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", moveAgent);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", moveAgent);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging]);

  useEffect(() => {
    if (path === "/parameter-comparison") {
      setOpen(true);
    }
  }, [path]);

  const executeAction = (id: string) => {
    switch (id) {
      case "filter-high-risk":
        setMessages((items) => ["已标记高风险参数：max_concurrent_sessions、risk_score_threshold。", ...items]);
        break;
      case "draft-parameter-change":
        dispatch({
          type: "ADD_CHANGE_REQUEST",
          parameterId: "p-max-session",
          targetValue: "80",
          reason: "OpsAgent 建议将会话上限调整到安全阈值内。"
        });
        setMessages((items) => ["已生成并提交参数修改草稿，进入审阅队列。", ...items]);
        break;
      case "advance-review":
        dispatch({ type: "ADVANCE_REVIEW", requestId: state.changeRequests[0]?.id ?? "PRQ-8902" });
        setMessages((items) => ["当前审阅请求已推进到下一流程节点。", ...items]);
        break;
      case "advance-log":
        dispatch({ type: "ADVANCE_LOG", logId: "log-active" });
        setMessages((items) => ["日志分析阶段已推进，证据链同步刷新。", ...items]);
        break;
      case "connect-device":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        setMessages((items) => ["推荐样机已连接，调试动作现在可用。", ...items]);
        break;
      case "push-debug-value":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        dispatch({ type: "PUSH_DEBUG_VALUE", parameterId: "dbg-pid-p" });
        setMessages((items) => ["PID 比例系数调试值已下发，已准备回滚快照。", ...items]);
        break;
      case "import-parameters":
        dispatch({ type: "IMPORT_PARAMETERS" });
        setMessages((items) => ["批量参数导入已模拟完成，冲突项进入审计队列。", ...items]);
        break;
      default:
        setMessages((items) => ["已生成当前页面治理摘要，可用于正式汇报。", ...items]);
    }
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("agentPrompt") ?? "").trim();
    if (!value) {
      return;
    }
    setMessages((items) => [`你问：${value}`, `OpsAgent：我已结合 ${plan.contextTitle} 上下文生成一组可执行建议。`, ...items]);
    event.currentTarget.reset();
  };

  const agentPositionStyle: CSSProperties = {
    right: `${agentPosition.right}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const agentPanelPositionStyle: CSSProperties = {
    right: `${clampAgentPanelOffset(agentPosition.right, window.innerWidth)}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const comparisonInsights = path === "/parameter-comparison" ? createComparisonInsights(state, comparisonSelection) : null;

  const startDraggingAgent = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: agentPosition.right,
      startBottom: agentPosition.bottom,
      moved: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const openAgent = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setOpen(true);
  };

  if (!open) {
    return (
      <button
        className={dragging ? "agent-fab dragging" : "agent-fab"}
        type="button"
        onClick={openAgent}
        onPointerDown={startDraggingAgent}
        style={agentPositionStyle}
        aria-label="打开 OpsAgent"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <div className="agent-panel" data-path={path} style={agentPanelPositionStyle}>
      <div className="agent-header">
        <div className="agent-avatar">
          <Bot size={19} />
        </div>
        <div>
          <strong>OpsAgent</strong>
          <span>{plan.contextTitle}</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="最小化 OpsAgent">
          <X size={18} />
        </button>
      </div>
      <div className="agent-body">
        <div className="agent-context">
          <SectionLabel icon={<Lightbulb size={15} />} label="上下文洞察" />
          <p>{plan.contextSummary}</p>
        </div>
        {comparisonInsights ? (
          <div className="agent-insight-stack" aria-label="OpsAgent 洞察">
            <div className="agent-insight-heading">
              <Bot size={16} />
              <strong>OpsAgent 洞察</strong>
            </div>
            <div className="agent-insight-card accent-secondary">
              <SectionLabel icon={<Info size={15} />} label="项目差异风险" />
              <p>
                <code>{comparisonInsights.primaryInsight?.key}</code> 在 {comparisonInsights.baseProject.code} 与 {comparisonInsights.targetProject.code} 间存在差异，
                建议结合充电温升与降额日志判断是否同步。
              </p>
              <button className="link-button" type="button">查看历史延迟</button>
            </div>
            <div className="agent-insight-card accent-tertiary">
              <SectionLabel icon={<ListChecks size={15} />} label="参数值对照" />
              <p>
                <code>{comparisonInsights.secondaryInsight?.key}</code> 的项目配置需要按机型定位、电池规格和区域电源策略一起复核。
              </p>
            </div>
            <div className="agent-insight-card accent-danger">
              <SectionLabel icon={<AlertTriangle size={15} />} label="风险阈值漂移" />
              <p>
                高重要性参数会直接影响充电安全、电量估算或热管理表现，同步前需要先完成参数审阅。
              </p>
            </div>
          </div>
        ) : null}
        <div className="agent-steps">
          {plan.steps.map((step, index) => (
            <div key={step}>
              <span>{index + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <div className="quick-prompts">
          {plan.prompts.map((prompt) => (
            <button key={prompt} type="button" onClick={() => setMessages((items) => [`已选择建议问题：${prompt}`, ...items])}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="agent-messages">
          {messages.slice(0, 4).map((message, index) => (
            <div className={index % 2 === 0 ? "agent-message" : "agent-message user"} key={`${message}-${index}`}>
              {message}
            </div>
          ))}
        </div>
        <div className="agent-actions">
          {plan.actions.map((action) => (
            <button
              className={action.requiresConfirm ? "requires-confirm" : ""}
              key={action.id}
              type="button"
              onClick={() => {
                if (action.requiresConfirm) {
                  setConfirmAction(action.id);
                } else {
                  executeAction(action.id);
                }
              }}
            >
              {action.requiresConfirm ? <LockKeyhole size={14} /> : <Play size={14} />}
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <form className="agent-input" onSubmit={submitPrompt}>
        <input name="agentPrompt" placeholder="询问 OpsAgent..." />
        <button type="submit" aria-label="发送">
          <Send size={17} />
        </button>
      </form>
      {confirmAction ? (
        <ConfirmDialog
          title="确认执行 Agent 动作"
          message="该动作会改变当前原型状态。为体现治理闭环，AI 不会绕过人工确认。"
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            executeAction(confirmAction);
            setConfirmAction(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MetricCard({ title, value, trend, tone }: { title: string; value: string; trend: string; tone: "blue" | "teal" | "purple" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{trend}</p>
      <div className="metric-bar">
        <i />
      </div>
    </div>
  );
}

function DataTable<T>({ headers, rows, renderRow }: { headers: string[]; rows: T[]; renderRow: (row: T) => ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
      {rows.length === 0 ? <EmptyState text="当前筛选条件下没有数据。" /> : null}
    </div>
  );
}

function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <span className={`risk-badge ${risk.toLowerCase()}`}>{riskLabels[risk]}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className="status-badge"><span />{status}</span>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tertiary" | "secondary" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="section-label">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function Timeline({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <div className="timeline">
      {steps.map((step, index) => (
        <div className={index <= activeIndex ? "done" : ""} key={step}>
          <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

function VerticalTimeline({ items }: { items: [string, string, string][] }) {
  return (
    <div className="vertical-timeline">
      {items.map(([time, title, body]) => (
        <div key={`${time}-${title}`}>
          <span className="timeline-dot" />
          <small>{time}</small>
          <strong>{title}</strong>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Info size={20} />
      {text}
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  cancelLabel = "取消",
  confirmLabel = "确认执行",
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-dialog">
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div>
          <button className="button subtle" type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className="button primary" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function LibraryPanel({ title, items }: { title: string; items: string[][] }) {
  return (
    <div className="library-panel">
      <PanelHeader title={title} meta={`${items.length} 项`} />
      <div className="library-list">
        {items.map(([main, sub, meta]) => (
          <div className="library-row" key={`${main}-${sub}`}>
            <div>
              <strong>{main}</strong>
              <span>{sub}</span>
            </div>
            <Badge tone={meta === "High" ? "secondary" : "neutral"}>{displayTag(meta)}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditPanel({ events }: { events: AuditEvent[] }) {
  return (
    <div className="library-panel">
      <PanelHeader title="审计事件" meta={`${events.length} 条事件`} />
      {events.map((event) => (
        <div className="audit-row" key={event.id}>
          <RiskBadge risk={event.severity} />
          <div>
            <strong>{event.action}</strong>
            <span>{event.actor} · {event.time}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default App;
