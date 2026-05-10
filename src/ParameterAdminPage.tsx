import { FileText, Info, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppAction, PageProps, ParameterEditorDraft, ParameterValueDraft } from "./App";
import type { RiskLevel } from "./mockData";
import { serializePowerManagementConfig } from "./powerManagementConfig";

export function ParameterAdminPage({ state, dispatch }: PageProps) {
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
      action={
        <button className="button primary" type="button" onClick={() => dispatch({ type: "IMPORT_PARAMETERS" })}>
          <Upload size={16} />
          批量参数导入
        </button>
      }
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
