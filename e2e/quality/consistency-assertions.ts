import type { ConsistencyMeasurements, ConsistencyCategory } from "./consistency-collector";
import { consistencyRoutes } from "./consistency-routes";

export function requireModuleTreeAlignment(
  labels: ConsistencyMeasurements["moduleTreeLabels"],
  routePath: string
) {
  requireMeasuredCategories({ moduleTreeLabels: labels }, ["moduleTreeLabels"], routePath);
  const anchors = new Map<string, Map<number, { min: number; max: number }>>();
  for (const label of labels) {
    let depths = anchors.get(label.tree);
    if (!depths) {
      depths = new Map();
      anchors.set(label.tree, depths);
    }
    const range = depths.get(label.depth) ?? { min: label.left, max: label.left };
    range.min = Math.min(range.min, label.left);
    range.max = Math.max(range.max, label.left);
    depths.set(label.depth, range);
    if (range.max - range.min > 1) {
      throw new Error(`${routePath}: module tree ${label.tree} depth ${label.depth} label anchors differ by ${range.max - range.min}px (maximum 1px)`);
    }
  }
}

export function requireRowActionVisibility(rows: ConsistencyMeasurements["rowActions"], routePath: string) {
  requireMeasuredCategories({ rowActions: rows }, ["rowActions"], routePath);
  for (const { dom, cell, row, clip, scrollLeft, actions, statuses } of rows) {
    if (cell.right > row.right + 1) throw new Error(`${routePath}: ${dom} exceeds its row`);
    if (cell.left < clip.left - 1 || cell.right > clip.right + 1) throw new Error(`${routePath}: ${dom} is clipped`);
    if (scrollLeft > 1) throw new Error(`${routePath}: requires horizontal scrolling`);
    if (!actions.length || !statuses.length) throw new Error(`${routePath}: missing action or status measurements`);
    for (const action of actions) {
      if (action.rect.left < cell.left - 1 || action.rect.right > cell.right + 1
        || action.rect.top < cell.top - 1 || action.rect.bottom > cell.bottom + 1) {
        throw new Error(`${routePath}: ${action.dom} is clipped`);
      }
    }
    for (const status of statuses) {
      if (status.rect.left < Math.max(row.left, clip.left) - 1 || status.rect.right > Math.min(row.right, clip.right) + 1) {
        throw new Error(`${routePath}: ${status.dom} is clipped`);
      }
    }
  }
}

export function requireCompactControlHeights(
  measurements: Partial<Pick<ConsistencyMeasurements, "filterControls" | "sortControls" | "paginationControls" | "unmarkedCompactControls">> | null | undefined,
  routePath: string
) {
  if (!measurements) {
    throw new Error(`${routePath}: compact control collection error: route measurements are missing`);
  }
  for (const category of ["filterControls", "sortControls", "paginationControls"] as const) {
    for (const control of measurements[category] ?? []) {
      if (control.compactControl !== "filter" && control.compactControl !== "sort" && control.compactControl !== "pagination") continue;
      if (typeof control.height !== "number" || !Number.isFinite(control.height)) {
        throw new Error(`${routePath}: compact control collection error: ${control.dom} has no finite height measurement`);
      }
      if (control.height !== 32) {
        throw new Error(`${routePath}: ${control.dom} has height ${control.height}px; expected 32px`);
      }
    }
  }
  const required = consistencyRoutes.find((route) => route.path === routePath.split("?")[0])?.required
    .filter((category) => category === "filterControls" || category === "sortControls" || category === "paginationControls") ?? [];
  if (required.length && measurements.unmarkedCompactControls?.length) {
    throw new Error(`${routePath}: unmarked compact control: ${measurements.unmarkedCompactControls[0].dom}`);
  }
  requireMeasuredCategories({
    filterControls: measurements.filterControls?.filter((control) => control.compactControl === "filter"),
    sortControls: measurements.sortControls?.filter((control) => control.compactControl === "sort"),
    paginationControls: measurements.paginationControls?.filter((control) => control.compactControl === "pagination")
  }, required, routePath);
}

export function requireMeasuredCategories(
  measurements: Partial<Record<ConsistencyCategory, readonly unknown[]>>,
  required: readonly ConsistencyCategory[],
  routePath: string
) {
  const missing = required.filter((category) => !measurements[category]?.length);
  if (missing.length) {
    throw new Error(`${routePath}: missing consistency measurements: ${missing.join(", ")}`);
  }
}

export function shouldRequireXiaozeHint({ hasDialog, viewportWidth }: { hasDialog: boolean; viewportWidth: number }) {
  return !hasDialog && viewportWidth > 640;
}

export function assertXiaozePlacement(
  measurements: Pick<ConsistencyMeasurements, "xiaozeLaunchers" | "xiaozeHints" | "tableScrollports" | "stickyActionAreas">
    & Partial<Pick<ConsistencyMeasurements, "visibleTableCount">>,
  routePath: string
) {
  if (measurements.visibleTableCount) requireMeasuredCategories(measurements, ["tableScrollports"], routePath);
  for (const overlay of [...measurements.xiaozeLaunchers, ...measurements.xiaozeHints]) {
    for (const area of [...measurements.tableScrollports, ...measurements.stickyActionAreas]) {
      if (overlay.rect.left < area.rect.right && overlay.rect.right > area.rect.left
        && overlay.rect.top < area.rect.bottom && overlay.rect.bottom > area.rect.top) {
        throw new Error(`${routePath}: ${overlay.dom} overlaps ${area.dom}`);
      }
    }
  }
}
