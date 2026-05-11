import { migrateParameterRange } from "../parameterAdminAnalytics";
import type { PowerManagementParameterTemplate, PowerManagementProject, PowerManagementProjectId } from "../powerManagementConfig";

type ParameterValuePatch = Partial<PowerManagementParameterTemplate["values"][PowerManagementProjectId]>;

export function ProjectValueMatrix({
  parameter,
  projects,
  onValueChange
}: {
  parameter: PowerManagementParameterTemplate;
  projects: readonly PowerManagementProject[];
  onValueChange: (projectId: PowerManagementProjectId, patch: ParameterValuePatch) => void;
}) {
  const range = migrateParameterRange(parameter.range);

  return (
    <section className="project-value-matrix" aria-label="项目参数值矩阵">
      <div className="panel-header">
        <strong>项目参数值矩阵</strong>
        <span>每个项目独立取值</span>
      </div>
      <p>所有项目共用同一条参数定义，只在这里维护各项目的实际值。</p>
      <div className="pvm-table">
        <div className="pvm-header">
          <span>项目</span>
          <span>当前值</span>
          <span>偏差</span>
          <span>更新时间</span>
        </div>
        {projects.map((project) => {
          const value = parameter.values[project.id] ?? { currentValue: "", recommendedValue: "", updatedAt: "" };
          const numeric = Number(value.currentValue);
          const recommended = Number(value.recommendedValue);
          const hasNumeric = Number.isFinite(numeric);
          const belowMin = range.min !== undefined && hasNumeric && numeric < range.min;
          const aboveMax = range.max !== undefined && hasNumeric && numeric > range.max;
          const outOfRange = belowMin || aboveMax;
          const deviation = hasNumeric && Number.isFinite(recommended) && recommended !== 0 ? ((numeric - recommended) / recommended) * 100 : null;

          return (
            <div className={outOfRange ? "pvm-row out-of-range" : "pvm-row"} key={project.id}>
              <div className="pvm-project">
                <strong>{project.code}</strong>
                <small>{project.name}</small>
              </div>
              <div className="pvm-value">
                <input
                  aria-invalid={outOfRange ? "true" : "false"}
                  aria-label={`${project.code} 当前值`}
                  inputMode="decimal"
                  value={value.currentValue}
                  onChange={(event) =>
                    onValueChange(project.id, {
                      currentValue: event.target.value,
                      updatedAt: new Date().toISOString()
                    })
                  }
                />
                <span className="pvm-unit">{parameter.unit}</span>
                {outOfRange ? (
                  <span className="pvm-error">{belowMin ? `低于下限 ${range.min}` : `超过上限 ${range.max}`} · 越界</span>
                ) : (
                  <span className="pvm-hint">推荐 {value.recommendedValue || "—"}</span>
                )}
              </div>
              <div className={`pvm-deviation ${deviationClass(deviation)}`}>{formatDeviation(deviation)}</div>
              <div className="pvm-updated" title={value.updatedAt}>
                <time dateTime={value.updatedAt}>{formatRelative(value.updatedAt)}</time>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatDeviation(deviation: number | null) {
  if (deviation === null) {
    return "—";
  }
  return `${deviation >= 0 ? "+" : ""}${deviation.toFixed(1)}%`;
}

function deviationClass(deviation: number | null) {
  if (deviation === null) {
    return "deviation-na";
  }
  const abs = Math.abs(deviation);
  if (abs <= 10) {
    return "deviation-ok";
  }
  if (abs <= 25) {
    return "deviation-warn";
  }
  return "deviation-danger";
}

function formatRelative(value: string) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return value || "—";
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
