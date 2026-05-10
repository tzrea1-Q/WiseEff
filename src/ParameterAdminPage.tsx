import { FileText, History, Info, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppAction, PageProps, ParameterEditorDraft, ParameterValueDraft } from "./App";
import { AgentInsightBar, type Insight } from "./components/AgentInsightBar";
import { KpiStrip, type KpiItem } from "./components/KpiStrip";
import { ParameterLibraryList } from "./components/ParameterLibraryList";
import { useParamAdminSearch } from "./hooks/useParamAdminSearch";
import type { RiskLevel } from "./mockData";
import { getCoverage } from "./parameterAdminAnalytics";
import { serializePowerManagementConfig } from "./powerManagementConfig";

export function ParameterAdminPage({ state, dispatch, search: rawSearch }: PageProps) {
  const [selectedParameterId, setSelectedParameterId] = useState(state.configDraft.parameterLibrary[0]?.id ?? "");
  const urlSearch = useParamAdminSearch();
  const search = rawSearch ? parseParamAdminSearch(rawSearch) : urlSearch.search;
  const updateSearch = urlSearch.updateSearch;
  const selectedParameter =
    state.configDraft.parameterLibrary.find((parameter) => parameter.id === selectedParameterId) ?? state.configDraft.parameterLibrary[0];
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);
  const library = state.configDraft.parameterLibrary;
  const projects = state.configDraft.projects;
  const highRiskCount = library.filter((parameter) => parameter.risk === "High").length;
  const orphanCount = library.filter((parameter) => getCoverage(parameter, projects) === "orphan").length;
  const highRiskOrphans = library.filter((parameter) => parameter.risk === "High" && getCoverage(parameter, projects) === "orphan");
  const todayChanges = state.auditEvents.filter((event) => isWithinHours(event.time, 24)).length;
  const lastImport = state.auditEvents.find((event) => event.kind === "batch-import");
  const insights: Insight[] =
    highRiskOrphans.length > 0
      ? [
          {
            id: "high-risk-orphans",
            tone: "warning",
            headline: `参数库里有 ${highRiskOrphans.length} 个高风险孤儿参数，建议复核`,
            meta: `孤儿合计 ${orphanCount} · 其中高风险 ${highRiskOrphans.length}`,
            actions: [
              { id: "view-orphans", label: "查看孤儿参数", onClick: () => updateSearch({ coverage: "orphan" }) },
              {
                id: "draft-cleanup",
                label: "生成清理建议",
                onClick: () =>
                  dispatch({
                    type: "AGENT_ACTION_EXECUTED",
                    actionId: "draft-cleanup",
                    metadata: { orphanIds: highRiskOrphans.map((parameter) => parameter.id) }
                  })
              }
            ]
          }
        ]
      : [];
  const kpiItems: KpiItem[] = [
    { id: "shared", label: "共享参数", value: library.length },
    {
      id: "high",
      label: "高风险",
      value: highRiskCount,
      interactive: highRiskCount > 0,
      tone: "warning",
      onClick: () => updateSearch({ risk: "high" })
    },
    {
      id: "today",
      label: "今日变更",
      value: todayChanges,
      interactive: todayChanges > 0,
      onClick: () => updateSearch({ audit: "open" })
    },
    {
      id: "orphan",
      label: "孤儿参数",
      value: orphanCount,
      interactive: orphanCount > 0,
      tone: "warning",
      onClick: () => updateSearch({ coverage: "orphan" })
    },
    {
      id: "last-import",
      label: "最近导入",
      value: lastImport ? formatRelativeTime(lastImport.time) : "—",
      interactive: Boolean(lastImport),
      onClick: () => updateSearch({ audit: "open" })
    }
  ];

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
    <div className="param-admin-shell" data-audit={search.audit === "open" ? "open" : "closed"}>
      <header className="param-admin-header">
        <div className="param-admin-header-text">
          <nav className="breadcrumb" aria-label="面包屑">
            <span>参数管理</span>
            <span aria-hidden="true">›</span>
            <span aria-current="page">项目参数管理后台</span>
          </nav>
          <h1>项目参数管理后台</h1>
          <p className="subtitle">电池与充电参数数据库 · 批量导入 · 权限和审计管理</p>
        </div>
        <div className="param-admin-header-actions" role="toolbar" aria-label="管理后台动作">
          <button className="button primary" type="button" onClick={() => console.info("m2: open import wizard")}>
            <Upload size={16} />
            批量导入
          </button>
          <button className="button subtle" type="button" onClick={() => console.info("m2: export menu")}>
            导出 JSON
          </button>
          <button className="button subtle" type="button" onClick={() => console.info("m2: open permissions")}>
            <ShieldCheck size={16} />
            权限
          </button>
          <button
            className="button ghost"
            type="button"
            aria-pressed={search.audit === "open"}
            onClick={() => updateSearch({ audit: search.audit === "open" ? undefined : "open" })}
          >
            <History size={16} />
            审计
          </button>
        </div>
      </header>
      <KpiStrip items={kpiItems} />
      <AgentInsightBar
        dismissedIds={state.insightDismissedIds}
        items={insights}
        persistKey="parameter-admin-insights"
        onDismiss={(insightId) => dispatch({ type: "DISMISS_INSIGHT", insightId })}
      />
      <main className="param-admin-grid">
        <div className="library-column">
          <ParameterLibraryList
            parameters={state.configDraft.parameterLibrary}
            projects={state.configDraft.projects}
            search={search}
            selectedId={selectedParameter?.id}
            onSelect={setSelectedParameterId}
            onUpdateSearch={updateSearch}
          />
          <div className="library-admin-actions">
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
          </div>
        </div>

        <section className="detail-column config-editor-panel project-config-editor">
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
          <ConfigExportPanel configJson={configJson} />
        </section>

        <aside className="audit-column" hidden={search.audit !== "open"} aria-label="审计抽屉">
          <div className="audit-drawer-placeholder">
            <PanelHeader title="审计抽屉" meta="m2 完整视图" />
            <p>审计事件筛选、批次展开和反向跳转将在下一阶段接入。</p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function parseParamAdminSearch(raw: string) {
  const params = new URLSearchParams(raw);
  const risk = params.get("risk");
  const coverage = params.get("coverage");
  const modules = params.get("module");

  return {
    q: params.get("q") ?? "",
    risk: risk === "high" || risk === "medium" || risk === "low" ? risk : ("all" as const),
    modules: modules ? modules.split(",").filter(Boolean) : [],
    coverage: coverage === "full" || coverage === "partial" || coverage === "orphan" ? coverage : ("all" as const),
    sort: params.get("sort") ?? "updatedAt-desc",
    id: params.get("id") ?? undefined,
    audit: params.get("audit") === "open" ? ("open" as const) : undefined,
    import: undefined,
    permissions: undefined
  };
}

function isWithinHours(iso: string, hours: number) {
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= hours * 3600 * 1000;
}

function formatRelativeTime(iso: string) {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  const diffMs = Math.max(Date.now() - parsed, 0);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
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

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const labels: Record<RiskLevel, string> = {
    High: "高",
    Medium: "中",
    Low: "低"
  };

  return <span className={`risk-badge ${risk.toLowerCase()}`}>{labels[risk]}</span>;
}

function PanelHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
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

export type ParameterAdminDispatch = React.Dispatch<AppAction>;
