import type { ConsistencyMeasurements, ConsistencyCategory } from "./consistency-collector";
import { consistencyRoutes } from "./consistency-routes";

export function requireOverviewGeometry(overviews: ConsistencyMeasurements["overviewPages"], routePath: string) {
  requireMeasuredCategories({ overviewPages: overviews }, ["overviewPages"], routePath);
  for (const overview of overviews) {
    const { root, summary, content, actions, gap } = overview;
    if (!summary || !content || !overview.tiles.length || !overview.items.length) {
      throw new Error(`${routePath}: missing overview summary, tiles or content`);
    }
    if (![root, summary, content, ...(actions ? [actions] : []), ...overview.tiles.map((tile) => tile.rect), ...overview.items]
      .flatMap((rect) => Object.values(rect)).every(Number.isFinite)
      || !Number.isFinite(gap) || gap <= 0 || !Number.isFinite(overview.pageOverflow)
      || !Number.isFinite(overview.viewportHeight) || overview.viewportHeight <= 0) {
      throw new Error(`${routePath}: invalid overview geometry or gap token`);
    }
    for (const slot of [summary, content, ...(actions ? [actions] : [])]) {
      if (Math.abs(slot.left - root.left) > 1 || Math.abs(slot.right - root.right) > 1) {
        throw new Error(`${routePath}: overview slot does not align with the page gutter`);
      }
    }
    if (Math.abs(content.top - summary.bottom - gap) > 1
      || (actions && Math.abs(actions.top - content.bottom - gap) > 1) || overview.pageOverflow > 1) {
      throw new Error(`${routePath}: overview gap or page overflow differs from the contract`);
    }
    if (overview.items[0].top >= overview.viewportHeight) {
      throw new Error(`${routePath}: first section must be visible in the PC viewport`);
    }
    for (const item of overview.items) {
      if (item.width <= 0 || item.left < content.left - 1 || item.right > content.right + 1) {
        throw new Error(`${routePath}: overview content escapes its grid`);
      }
    }
    for (const tile of overview.tiles) {
      if (tile.rect.width <= 0 || tile.rect.left < summary.left - 1 || tile.rect.right > summary.right + 1
        || (!tile.hasSamples && (tile.value !== "暂无样本" || tile.trendCount !== 0))) {
        throw new Error(`${routePath}: overview tile geometry or no-sample policy violated`);
      }
    }
    if (overview.verdicts.some((verdict) => !verdict.hasSamples && verdict.text !== "暂无样本，无法判断")) {
      throw new Error(`${routePath}: unsupported overview verdict without samples`);
    }
  }
}

export function requireRetiredNotice(notices: ConsistencyMeasurements["retiredNotices"], routePath: string) {
  requireMeasuredCategories({ retiredNotices: notices }, ["retiredNotices"], routePath);
  const replacement = routePath === "/debugging" ? "/node-debugging" : "/parameters";
  for (const notice of notices) {
    if (!Object.values(notice.root).every(Number.isFinite) || notice.root.width <= 0
      || notice.titleCount !== 1 || notice.descriptionCount !== 1 || notice.linkCount !== 1
      || !notice.primary || notice.href !== replacement) {
      throw new Error(`${routePath}: retired notice must have one title, explanation and primary replacement link`);
    }
  }
}

export function requireSettingsFormPresentation(forms: ConsistencyMeasurements["settingsForms"], routePath: string) {
  if (forms.length !== 1) throw new Error(`${routePath}: settings form measurement must cover exactly one form`);
  const form = forms[0];
  if (!Number.isFinite(form.widthToken) || form.widthToken <= 0 || form.maxWidth !== form.widthToken
    || !Number.isFinite(form.rect.width) || form.rect.width <= 0 || form.rect.width > form.widthToken + 1
    || form.direction !== "column" || form.sectionCount === 0
    || form.titledSections !== form.sectionCount || form.helpedSections !== form.sectionCount) {
    throw new Error(`${routePath}: settings form must use the max-width token and a single column of titled, explained sections`);
  }
  if (form.saveBars.length !== (form.dirty ? 1 : 0)) throw new Error(`${routePath}: settings form save bar must appear only while dirty`);
  for (const bar of form.saveBars) {
    if (bar.position !== "sticky" || !Number.isFinite(bar.bottom) || bar.bottom < 0 || bar.primaryCount !== 1
      || !["保存", "保存中…"].includes(bar.saveLabel) || bar.discardLabel !== "放弃") {
      throw new Error(`${routePath}: settings form requires sticky 保存 and 放弃 actions with one primary`);
    }
  }
}

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
