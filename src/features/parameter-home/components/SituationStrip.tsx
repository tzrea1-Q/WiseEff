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
import { OverviewTile } from "@/components/layout/OverviewPage";

type SituationStripProps = {
  status: SectionStatus;
  kpis: DashboardKpis | null;
  personalKpis: PersonalDashboardKpis | null;
  scope: OverviewScope;
  roleView: WorkbenchRoleView;
  onScopeChange: (scope: OverviewScope) => void;
  error?: string | null;
  onRetry?: () => void;
};

export function SituationStrip({
  status,
  kpis,
  personalKpis,
  scope,
  roleView,
  onScopeChange,
  error,
  onRetry
}: SituationStripProps) {
  const presentation = deriveOverviewPresentation(roleView, scope, kpis, personalKpis);
  const sourceKpis = scope === "overall" ? kpis : personalKpis;
  const hasSamples = status === "ready" && sourceKpis !== null;
  const hasActivity = hasSamples
    && Object.values(sourceKpis).some((value) => typeof value === "number" && value > 0);
  const emptyMessage =
    scope === "personal"
      ? `当前时间窗口暂无个人活动${roleView === "guest" ? "（访客只读视角）" : ""}`
      : "当前时间窗口暂无参数活动数据。";

  return (
    <Panel
      title="概览"
      subtitle={presentation.panelSubtitle}
      actions={<OverviewScopeToggle scope={scope} onScopeChange={onScopeChange} />}
      className="parameter-home__panel--situation"
    >
      {status === "loading" || status === "idle" ? <SectionSkeleton label="加载态势指标" /> : null}
      {status === "error" ? (
        <SectionError message={error ?? "态势指标加载失败"} onRetry={onRetry ?? (() => undefined)} />
      ) : null}
      {status === "ready" || status === "empty" ? (
        <dl className="overview-page__tiles">
          {presentation.kpiItems.map((item) => (
            <OverviewTile key={item.key} metricKey={item.key} label={item.label} value={item.value}
              hasSamples={hasSamples} />
          ))}
        </dl>
      ) : null}
      {(status === "ready" || status === "empty") && !hasActivity ? <p className="parameter-home__section-empty">{emptyMessage}</p> : null}
    </Panel>
  );
}
