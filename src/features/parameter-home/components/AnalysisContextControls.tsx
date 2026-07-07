import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const WINDOW_OPTIONS: Array<{ value: DashboardWindow; label: string }> = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "180d", label: "近 180 天" }
];

const DIMENSION_OPTIONS: Array<{ value: HotspotDimension; label: string }> = [
  { value: "overall", label: "总榜" },
  { value: "module", label: "模块榜" },
  { value: "project", label: "项目榜" },
  { value: "parameter", label: "参数榜" }
];

type AnalysisContextControlsProps = {
  window: DashboardWindow;
  dimension: HotspotDimension;
  onWindowChange: (window: DashboardWindow) => void;
  onDimensionChange: (dimension: HotspotDimension) => void;
};

export function AnalysisContextControls({
  window,
  dimension,
  onWindowChange,
  onDimensionChange
}: AnalysisContextControlsProps) {
  return (
    <div className="parameter-home__context-controls">
      <div className="parameter-home__context-group">
        <span className="parameter-home__context-label">时间窗口</span>
        <ToggleGroup
          aria-label="时间窗口"
          className="parameter-home__toggle-group"
          type="single"
          value={window}
          onValueChange={(nextValue) => {
            if (nextValue) {
              onWindowChange(nextValue as DashboardWindow);
            }
          }}
        >
          {WINDOW_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} className="parameter-home__toggle-item" value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="parameter-home__context-group">
        <span className="parameter-home__context-label">热榜维度</span>
        <ToggleGroup
          aria-label="热榜维度"
          className="parameter-home__toggle-group"
          type="single"
          value={dimension}
          onValueChange={(nextValue) => {
            if (nextValue) {
              onDimensionChange(nextValue as HotspotDimension);
            }
          }}
        >
          {DIMENSION_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} className="parameter-home__toggle-item" value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
