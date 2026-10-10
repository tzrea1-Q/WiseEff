import { Flame, LayoutDashboard } from "lucide-react";
import type { SectionStatus } from "@/application/parameters/dashboardState";
import { ViewSwitch } from "@/components/ui/view-switch";
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
    <ViewSwitch
      variant="toggle"
      ariaLabel="工作台视图"
      value={page}
      onValueChange={(nextValue) => onPageChange(nextValue as WorkbenchPage)}
      items={[
        { value: "overview", label: <>
          {isBar ? <LayoutDashboard aria-hidden size={15} strokeWidth={2.2} /> : null}
          {isBar ? "概览" : "工作台"}
        </> },
        { value: "hotspots", label: <>
          {isBar ? <Flame aria-hidden size={15} strokeWidth={2.2} /> : null}
          热榜
          {hotspotCountLabel ? (
            <span className={isBar ? "parameter-home__view-switcher-count" : "parameter-home__workbench-page-toggle-count"} aria-hidden="true">
              {hotspotCountLabel}
            </span>
          ) : null}
        </> }
      ]}
    />
  );
}
