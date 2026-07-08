import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const ALL_PROJECTS_VALUE = "__all__";

type ProjectOption = { value: string; label: string };

type AnalysisContextControlsProps = {
  window: DashboardWindow;
  dimension: HotspotDimension;
  projectScope: string | null;
  projectOptions: ProjectOption[];
  onWindowChange: (window: DashboardWindow) => void;
  onDimensionChange: (dimension: HotspotDimension) => void;
  onProjectChange: (projectId: string | null) => void;
};

export function AnalysisContextControls({
  window,
  dimension,
  projectScope,
  projectOptions,
  onWindowChange,
  onDimensionChange,
  onProjectChange
}: AnalysisContextControlsProps) {
  return (
    <div className="parameter-home__context-controls">
      <div className="parameter-home__context-group">
        <span className="parameter-home__context-label">项目范围</span>
        <Select
          value={projectScope ?? ALL_PROJECTS_VALUE}
          onValueChange={(nextValue) =>
            onProjectChange(nextValue === ALL_PROJECTS_VALUE ? null : nextValue)
          }
        >
          <SelectTrigger aria-label="项目范围" size="sm" className="parameter-home__context-select">
            <SelectValue placeholder="全部项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS_VALUE}>全部项目</SelectItem>
            {projectOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
