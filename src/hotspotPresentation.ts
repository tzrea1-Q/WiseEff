// Hotspot presentation-layer derivations used by the current leaderboard.
// Pure functions only; no React imports.

import type { PrototypeState } from "@/domain/prototype/types";
import type { DashboardHotspot } from "@/domain/parameters/dashboardTypes";
import { formatAuditRelativeTime } from "@/domain/audit/formatAuditTime";

export function computeEyebrow(
  hotspot: Pick<DashboardHotspot, "module" | "projectCode"> &
    Partial<Pick<DashboardHotspot, "kind" | "lastChangedAt">>,
  state: Pick<PrototypeState, "parameters">
): string {
  if (hotspot.kind === "parameter") {
    return `${hotspot.projectCode} · ${hotspot.module}`;
  }

  if (hotspot.module !== "项目参数") {
    const projectCount = new Set(
      state.parameters.filter((parameter) => parameter.module === hotspot.module).map((parameter) => parameter.projectId)
    ).size;

    return `${hotspot.projectCode} · ${projectCount} 项目`;
  }

  return hotspot.lastChangedAt ? `最近变更 ${formatHotspotLastChangedAt(hotspot.lastChangedAt)}` : "多次变更";
}

function formatHotspotLastChangedAt(lastChangedAt: string): string {
  const parsed = new Date(lastChangedAt).getTime();
  if (Number.isFinite(parsed)) {
    return formatAuditRelativeTime(lastChangedAt);
  }

  return lastChangedAt;
}
