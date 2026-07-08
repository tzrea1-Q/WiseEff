import { Flame, LayoutDashboard } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { WorkbenchPage } from "../workbenchPage";

type WorkbenchPageToggleProps = {
  page: WorkbenchPage;
  hotspotCount?: number;
  onPageChange: (page: WorkbenchPage) => void;
  placement?: "default" | "bar";
};

export function WorkbenchPageToggle({
  page,
  hotspotCount = 0,
  onPageChange,
  placement = "default"
}: WorkbenchPageToggleProps) {
  const isBar = placement === "bar";

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
        {hotspotCount > 0 ? (
          <span
            className={cn(
              isBar
                ? "parameter-home__view-switcher-count"
                : "parameter-home__workbench-page-toggle-count"
            )}
            aria-hidden="true"
          >
            {hotspotCount}
          </span>
        ) : null}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
