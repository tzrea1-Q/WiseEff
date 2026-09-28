import { Flame, LayoutDashboard } from "lucide-react";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { WorkbenchPage } from "../workbenchPage";

type WorkbenchPageToggleProps = {
  page: WorkbenchPage;
  hotspotCount?: number;
  hotspotStatus?: SectionStatus;
  onPageChange: (page: WorkbenchPage) => void;
  placement?: "default" | "bar";
};

export function WorkbenchPageToggle({
  page,
  hotspotCount = 0,
  hotspotStatus,
  onPageChange,
  placement = "default"
}: WorkbenchPageToggleProps) {
  const isBar = placement === "bar";
  const hotspotCountLabel =
    hotspotStatus === "loading" || hotspotStatus === "idle"
      ? "加载中"
      : hotspotStatus === "error"
        ? "不可用"
        : hotspotCount > 0
          ? String(hotspotCount)
          : null;

  return (
    <ToggleGroup
      aria-label="工作台视图"
      className={cn(
        isBar
          ? "parameter-home__view-switcher"
          : "parameter-home__toggle-group parameter-home__workbench-page-toggle"
      )}
      type="single"
      value={page}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onPageChange(nextValue as WorkbenchPage);
        }
      }}
    >
      <ToggleGroupItem
        className={cn(
          isBar ? "parameter-home__view-switcher-item" : "parameter-home__toggle-item"
        )}
        value="overview"
      >
        {isBar ? <LayoutDashboard aria-hidden size={15} strokeWidth={2.2} /> : null}
        {isBar ? "概览" : "工作台"}
      </ToggleGroupItem>
      <ToggleGroupItem
        className={cn(
          isBar
            ? "parameter-home__view-switcher-item parameter-home__view-switcher-item--hotspots"
            : "parameter-home__toggle-item parameter-home__workbench-page-toggle-item"
        )}
        value="hotspots"
      >
        {isBar ? <Flame aria-hidden size={15} strokeWidth={2.2} /> : null}
        热榜
        {hotspotCountLabel ? (
          <span
            className={cn(
              isBar
                ? "parameter-home__view-switcher-count"
                : "parameter-home__workbench-page-toggle-count"
            )}
            aria-hidden="true"
          >
            {hotspotCountLabel}
          </span>
        ) : null}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
