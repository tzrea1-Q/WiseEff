import type { ConsistencyMeasurements, ConsistencyCategory } from "./consistency-collector";
import { consistencyRoutes } from "./consistency-routes";

export function requirePageGutter(pageEdges: ConsistencyMeasurements["pageEdges"], routePath: string, footerPresent: boolean) {
  requireMeasuredCategories({ pageEdges }, ["pageEdges"], routePath);
  const required = ["shell", "content", "page", "toolbar", ...(footerPresent ? ["footer"] : [])];
  for (const region of required) {
    if (!pageEdges.some((edge) => edge.region === region)) {
      throw new Error(`${routePath}: missing page-gutter region: ${region}`);
    }
  }
  for (const edge of pageEdges) {
    if (![edge.left, edge.expectedLeft].every(Number.isFinite) || Math.abs(edge.left - edge.expectedLeft) > 1) {
      throw new Error(`${routePath}: ${edge.dom} does not align with the shell-owned page gutter`);
    }
  }
}

export function requireTypographyScale(
  measurements: Pick<ConsistencyMeasurements, "titles" | "buttons" | "typeScale">,
  routePath: string
) {
  requireMeasuredCategories(measurements, ["titles", "buttons", "typeScale"], routePath);
  const scale = [11, 12, 13, 14, 16, 20, 24];
  if (measurements.typeScale.length !== scale.length
    || measurements.typeScale.some((step, index) => step.fontSize !== scale[index])) {
    throw new Error(`${routePath}: typography scale tokens differ from the documented scale`);
  }
  const pageTitles = measurements.titles.filter((title) => title.pageTitle);
  if (pageTitles.length !== 1 || pageTitles[0].fontSize !== 20) {
    throw new Error(`${routePath}: page title must use the typography page-title step (20px)`);
  }
  for (const item of [...measurements.titles, ...measurements.buttons]) {
    if (!scale.includes(item.fontSize)) {
      throw new Error(`${routePath}: ${item.dom} has off-scale typography (${item.fontSize}px)`);
    }
  }
}

export function requireWorkbenchPresentation(tables: ConsistencyMeasurements["workbenchTables"], routePath: string) {
  if (!tables.length) throw new Error(`${routePath}: missing workbench table measurements`);
  for (const table of tables) {
    const hasDescription = table.descriptions.some((text) => text !== "");
    if (table.descriptionHeaderCount !== Number(hasDescription)
      || table.descriptions.length !== (hasDescription ? table.rowCount : 0)) {
      throw new Error(`${routePath}: description column must appear only for a nonempty current result`);
    }
    if (!table.rowCount || table.keys.length !== table.rowCount || table.keys.some((key) =>
      !key.text || key.title !== key.text || key.whiteSpace !== "nowrap"
      || key.overflow !== "hidden" || key.textOverflow !== "ellipsis")) {
      throw new Error(`${routePath}: each workbench key requires a single-line ellipsis and full-key tooltip`);
    }
  }
}

export function requireReviewInboxStructure(
  measurements: Pick<ConsistencyMeasurements, "viewSwitches" | "visibleTableCount">,
  routePath: string
) {
  const tabs = measurements.viewSwitches.filter((control) => control.role === "tab");
  if (tabs.length !== 2 || tabs.some((tab) => tab.groupRole !== "tablist")
    || new Set(tabs.map((tab) => tab.group)).size !== 1
    || tabs.filter((tab) => tab.selected).length !== 1 || measurements.visibleTableCount !== 1) {
    throw new Error(`${routePath}: unified review inbox requires one two-tab view with one selected tab and one visible queue`);
  }
}

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

export function requireAdminListGeometry(lists: ConsistencyMeasurements["adminLists"], routePath: string) {
  requireMeasuredCategories({ adminLists: lists }, ["adminLists"], routePath);
  for (const list of lists) {
    if (list.tableCount !== 1 || !list.header || !list.filters || !list.table || !list.primaryAction
      || [list.root, list.header, list.filters, list.table, list.primaryAction].some((slot) => Object.values(slot).some((value) => !Number.isFinite(value)))
      || Math.abs(list.primaryAction.right - list.header.right) > 1
      || list.header.bottom > list.filters.top + 1 || list.filters.bottom > list.table.top + 1
      || [list.header, list.filters, list.table].some((slot) => !Number.isFinite(slot.left) || Math.abs(slot.left - list.root.left) > 1)) {
      throw new Error(`${routePath}: admin list requires one aligned header, filter bar and table in that order`);
    }
    if (list.rows.length && !list.firstRow) {
      throw new Error(`${routePath}: admin list first row must be measured`);
    }
    if (list.firstRow && (!Number.isFinite(list.firstRow.top) || !Number.isFinite(list.firstRow.bottom)
      || list.firstRow.top < 0 || list.firstRow.bottom > 900)) {
      throw new Error(`${routePath}: admin list first row must be visible at 1440x900`);
    }
    if (!list.rows.length && list.emptyActionCount !== 1) {
      throw new Error(`${routePath}: empty admin list must offer exactly one next step`);
    }
    for (const row of list.rows) {
      if (row.actions.length > 2 || row.actions.filter((action) => action.overflow).length !== 1
        || row.actions.some((action) => !Number.isFinite(action.height) || Math.abs(action.height - 28) > 1 || action.destructive)) {
        throw new Error(`${routePath}: rows require at most one small text action plus overflow, with no visible destructive action`);
      }
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
  routePath: string,
  requiredCategories?: readonly ConsistencyCategory[]
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
  const required = (requiredCategories ?? consistencyRoutes.find((route) => route.path === routePath.split("?")[0])?.required)
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
  measurements: Partial<Record<ConsistencyCategory, readonly unknown[]>> & { visibleTableCount?: number },
  required: readonly ConsistencyCategory[],
  routePath: string
) {
  const missing = required.filter((category) =>
    !(routePath === "/logs" && category === "tableScrollports" && measurements.visibleTableCount === 0)
    && !measurements[category]?.length);
  if (missing.length) {
    throw new Error(`${routePath}: missing consistency measurements: ${missing.join(", ")}`);
  }
}

export function shouldRequireXiaozeHint({ hasDialog, viewportWidth }: { hasDialog: boolean; viewportWidth: number }) {
  return !hasDialog && viewportWidth > 640;
}

export function requireNavigatorWorkbenchGeometry(workbenches: ConsistencyMeasurements["navigatorWorkbenches"], routePath: string) {
  requireMeasuredCategories({ navigatorWorkbenches: workbenches }, ["navigatorWorkbenches"], routePath);
  for (const workbench of workbenches) {
    const { root, navigator, task, toolbar, primaryAction, firstRow, firstRowClip, contract, viewport } = workbench;
    if (!navigator || !task || !toolbar || !primaryAction || !firstRow || !firstRowClip) {
      throw new Error(`${routePath}: missing navigator-workbench region, primary action or first row`);
    }
    if (![root, navigator, task, toolbar, primaryAction, firstRow, firstRowClip, contract, viewport]
      .flatMap((measurement) => Object.values(measurement)).every(Number.isFinite)
      || !Number.isFinite(workbench.pageOverflow) || !Number.isInteger(workbench.noticeCount)
      || Object.values(contract).some((value) => value <= 0)) {
      throw new Error(`${routePath}: invalid navigator-workbench measurement or layout token`);
    }
    const width = workbench.collapsed ? contract.collapsedWidth : contract.navigatorWidth;
    const aligned = (actual: number, expected: number) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1;
    if (!aligned(navigator.left, root.left) || !aligned(navigator.width, width)
      || !aligned(task.left, root.left + width + contract.gap)) {
      throw new Error(`${routePath}: navigator-workbench pane geometry differs from the token contract`);
    }
    if (toolbar.bottom > task.top + 1 || !aligned(primaryAction.right, toolbar.right - contract.toolbarPadding - 1)
      || primaryAction.top < toolbar.top || primaryAction.bottom > toolbar.bottom || primaryAction.left < toolbar.left) {
      throw new Error(`${routePath}: navigator-workbench toolbar or primary action is misplaced`);
    }
    if (workbench.noticeCount > 1) throw new Error(`${routePath}: navigator-workbench has more than one notice`);
    if (workbench.pageOverflow > 1) throw new Error(`${routePath}: navigator-workbench causes page horizontal scrolling`);
    if (!workbench.collapsed) {
      if (!workbench.navigatorCounts.length) throw new Error(`${routePath}: missing navigator-workbench count measurements`);
      for (const count of workbench.navigatorCounts) {
        if (![count.textRect.left, count.textRect.right, count.textRect.width, count.clip.left, count.clip.right,
          count.clientWidth, count.scrollWidth].every(Number.isFinite) || count.textRect.width <= 0
          || count.scrollWidth > count.clientWidth + 1 || count.textRect.left < count.clip.left - 1
          || count.textRect.right > count.clip.right + 1) {
          throw new Error(`${routePath}: navigator-workbench count text is clipped: ${count.text}`);
        }
      }
    }
    if (firstRow.top < Math.max(0, task.top) || firstRow.bottom > Math.min(task.bottom, viewport.height) + 1
      || firstRow.left < Math.max(0, task.left) || firstRow.right > Math.min(task.right, viewport.width) + 1
      || !aligned(firstRowClip.width, firstRow.width) || !aligned(firstRowClip.height, firstRow.height)) {
      throw new Error(`${routePath}: navigator-workbench first data row is outside the initial viewport or clipped`);
    }
  }
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
