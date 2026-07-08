import type {
  DashboardKpis,
  OverviewScope,
  PersonalDashboardKpis
} from "@/domain/parameters/dashboardTypes";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";
import { deriveOverviewPresentation } from "../overview/deriveOverviewPresentation";
import { OverviewScopeToggle } from "./OverviewScopeToggle";
import { Panel } from "./Panel";
import { SectionError, SectionSkeleton } from "./SectionState";

type SituationStripProps = {
  status: SectionStatus;
  kpis: DashboardKpis | null;
  personalKpis: PersonalDashboardKpis | null;
  scope: OverviewScope;
  roleView: WorkbenchRoleView;
  onScopeChange: (scope: OverviewScope) => void;
  error?: string | null;
  onRetry?: () => void;
  variant?: "sidebar" | "strip";
};

export function SituationStrip({
  status,
  kpis,
  personalKpis,
  scope,
  roleView,
  onScopeChange,
  error,
  onRetry,
  variant = "strip"
}: SituationStripProps) {
  const isSidebar = variant === "sidebar";
  const presentation = deriveOverviewPresentation(roleView, scope, kpis, personalKpis);
  const isPersonalEmpty =
    scope === "personal" &&
    presentation.kpiItems.length > 0 &&
    presentation.kpiItems.every((item) => item.value === 0);
  const emptyMessage =
    scope === "personal"
      ? `当前时间窗口暂无个人活动${roleView === "guest" ? "（访客只读视角）" : ""}`
      : "当前时间窗口暂无参数活动数据。";

  return (
    <Panel
      title="概览"
      subtitle={presentation.panelSubtitle}
      actions={<OverviewScopeToggle scope={scope} onScopeChange={onScopeChange} />}
      className={isSidebar ? "parameter-home__panel--situation parameter-home__panel--situation-sidebar" : "parameter-home__panel--situation"}
    >
      {status === "loading" || status === "idle" ? <SectionSkeleton label="加载态势指标" /> : null}
      {status === "error" ? (
        <SectionError message={error ?? "态势指标加载失败"} onRetry={onRetry ?? (() => undefined)} />
      ) : null}
      {status === "ready" && (kpis || personalKpis) && !isPersonalEmpty ? (
        <dl className={isSidebar ? "parameter-home__situation-stats parameter-home__situation-stats--sidebar" : "parameter-home__situation-stats"}>
          {presentation.kpiItems.map((item) => (
            <div key={item.key} className="parameter-home__situation-stat" data-kpi={item.key}>
              <dt className="parameter-home__situation-stat-label">{item.label}</dt>
              <dd className="parameter-home__situation-stat-value">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {status === "empty" || isPersonalEmpty ? <p className="parameter-home__section-empty">{emptyMessage}</p> : null}
    </Panel>
  );
}
