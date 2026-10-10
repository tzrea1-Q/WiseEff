import type { BrowserContext } from "playwright/test";

export function collectConsistencyMeasurements() {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const signature = (element: Element) => {
    const classes = [...element.classList].slice(0, 12).join(".");
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes ? `.${classes}` : ""}`;
  };
  const role = (element: Element) => element.getAttribute("role")
    ?? (({ BUTTON: "button", A: "link", LI: "listitem", NAV: "navigation" } as Record<string, string>)[element.tagName] ?? null);
  const main = document.querySelector("main, .main-content");
  const elements = (selector: string) => [...(main?.querySelectorAll(selector) ?? [])].filter(visible);
  const bounds = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const geometry = (element: Element) => ({ dom: signature(element), rect: bounds(element) });
  const control = (element: Element) => ({ dom: signature(element), role: role(element), height: element.getBoundingClientRect().height });
  const viewSwitches = elements([
    '[role="tab"]', '[role="radiogroup"] [role="radio"]', '[role="group"][aria-label*="视图"] button[aria-pressed]',
    'nav:has([aria-current]) button', 'nav:has([aria-current]) a', 'nav button[aria-pressed]',
    ".parameter-admin-scope-nav__tab", ".parameter-admin-subnav__tab",
    ".protocol-switch-button", ".user-permissions-workspace-tab", ".logs-aux-tabs button",
    ".parameter-home__view-switcher-item", ".parameter-home__toggle-item",
    ".review-view-tabs button", ".param-admin-audit-filters .chip",
    ".dts-parameter-workbench__header-actions button[aria-pressed]",
    ".local-device-bridge-wizard__steps li"
  ].join(",")).map((element) => {
    const style = getComputedStyle(element);
    const group = element.closest('nav,[role="tablist"],[role="radiogroup"],.protocol-switch,.review-view-tabs,.local-device-bridge-wizard__steps')
      ?? element.parentElement!;
    return {
      dom: signature(element), group: signature(group), role: role(element), groupRole: role(group),
      height: element.getBoundingClientRect().height,
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].join(" "),
      fontSize: style.fontSize, background: style.backgroundColor,
      selected: element.matches('[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],[aria-current]:not([aria-current="false"]),[data-state="on"],[data-active="true"],.is-active,.active,.chip-active')
    };
  });
  const primaryActions = [...document.querySelectorAll('.button.primary,.local-device-bridge-panel__install-cta,button.bg-primary,a.bg-primary,[data-slot="button"].bg-primary')].filter(visible)
    .map((element) => ({ ...control(element), background: getComputedStyle(element).backgroundColor }));
  const actionCells = new Set(elements('.dts-parameter-workbench-table__actions,td[data-label="操作"],[data-catalog-row-action]')
    .map((element) => element.closest('td,[role="cell"]') ?? element));
  const rowActions = [...actionCells].flatMap((element) => {
    const row = element.closest('tr,[role="row"]');
    return row ? [{ dom: signature(element), cell: bounds(element), row: bounds(row) }] : [];
  });
  const overlays = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(geometry);
  const xiaozeLaunchers = overlays('[data-testid="copilot-chat-toggle"],.xiaoze-chat-toggle');
  const xiaozeHints = overlays('[data-testid="xiaoze-toggle-hint"],.xiaoze-toggle-hint');
  const scrollports = new Set<Element>();
  for (const table of elements('table,[role="table"],[role="grid"]')) {
    for (let ancestor: Element | null = table; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if ([style.overflowX, style.overflowY].some((overflow) => ["auto", "scroll"].includes(overflow)) && visible(ancestor)) {
        scrollports.add(ancestor);
      }
    }
  }
  const tableScrollports = [...scrollports].flatMap((element) => {
    const rect = bounds(element);
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clip = ancestor.getBoundingClientRect();
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right > left && bottom > top
      ? [{ dom: signature(element), rect: { left, top, right, bottom, width: right - left, height: bottom - top } }]
      : [];
  });
  const moduleTrees = elements('[role="tree"],nav > .parameter-catalog__tree');
  const moduleTreeLabels = elements(".dts-topology-navigator__label,.parameter-catalog__tree-label").map((element) => {
    const tree = element.closest('[role="tree"],nav > .parameter-catalog__tree') ?? element.parentElement!;
    const treeItem = element.closest('[role="treeitem"]');
    let depth = Number(treeItem?.getAttribute("aria-level")) || 0;
    if (!depth) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.matches('.parameter-catalog__tree-node,[role="treeitem"]')) depth++;
      }
    }
    return { dom: signature(element), tree: `${signature(tree)}[${moduleTrees.indexOf(tree)}]`, depth, left: element.getBoundingClientRect().left };
  });
  const paginationSelector = '.parameter-catalog__pagination button,.parameter-catalog__pagination select,button[aria-label="上一页"],button[aria-label="下一页"]';
  const paginationControls = elements(paginationSelector).map(control);
  const sortSelector = '.library-sort,[aria-label*="排序"],th[aria-sort] > button,.dts-parameter-workbench-table__sort';
  const sortControls = elements(sortSelector).map(control);
  const filterControls = elements('select,[role="combobox"],.parameters-column-filter__trigger')
    .filter((element) => !element.matches(`${paginationSelector},${sortSelector}`) && !element.closest('tbody,[role="cell"],[role="dialog"]'))
    .map(control);
  return {
    viewSwitches, primaryActions, rowActions, xiaozeLaunchers, xiaozeHints, tableScrollports,
    moduleTreeLabels, filterControls, sortControls, paginationControls
  };
}

export type ConsistencyMeasurements = ReturnType<typeof collectConsistencyMeasurements>;
export type ConsistencyCategory = keyof ConsistencyMeasurements;

export function requireModuleTreeAlignment(
  labels: ConsistencyMeasurements["moduleTreeLabels"],
  routePath: string
) {
  requireConsistencyMeasurements({ moduleTreeLabels: labels }, ["moduleTreeLabels"], routePath);
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

const catalogPaths = [
  "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/identity-mapping",
  "/parameter-admin/spec-review", "/parameter-admin/specs/identity-mapping", "/parameters/definitions"
];
const viewSwitchPaths = [
  "/audit", "/debugging-admin", "/debugging-admin/nodes", "/dts-reload", "/logs", "/node-debugging",
  "/organization", "/organization/members", "/parameter-admin", "/parameter-admin/identity-mapping",
  "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
  "/parameter-admin/projects", "/parameter-admin/projects/aurora/review-roles", "/parameter-admin/spec-review",
  "/parameter-admin/specs", "/parameter-admin/specs/identity-mapping", "/parameter-home", "/parameter-review",
  "/parameter-submissions", "/parameters", "/user-permissions"
];
const applicablePaths: Omit<Record<ConsistencyCategory, readonly string[]>, "xiaozeLaunchers" | "xiaozeHints"> = {
  viewSwitches: [...viewSwitchPaths, "/log-admin"],
  primaryActions: ["/dts-reload", "/knowledge", "/log-dashboard", "/log-admin", "/logs", "/node-debugging", "/organization/members", "/parameter-admin", "/parameter-admin/specs", "/user-permissions"],
  rowActions: [...catalogPaths, "/parameters"],
  tableScrollports: [...catalogPaths, "/parameters", "/node-debugging"],
  moduleTreeLabels: [...catalogPaths, "/parameters", "/node-debugging", "/dts-reload"],
  filterControls: [...catalogPaths, "/parameters", "/node-debugging", "/audit", "/debugging-admin", "/debugging-admin/nodes", "/dts-reload", "/feedback-admin", "/log-admin", "/organization/members", "/parameter-home", "/user-permissions"],
  sortControls: [...catalogPaths, "/parameters", "/debugging-admin/nodes", "/log-admin", "/parameter-admin/projects"],
  paginationControls: catalogPaths
};
const otherPhaseTwoPaths = [
  "/log-admin", "/parameter-admin/projects/aurora", "/parameter-admin/projects/aurora/config-sets",
  "/parameter-admin/projects/aurora/configuration", "/parameter-admin/projects/aurora/conflicts",
  "/parameter-admin/projects/aurora/files", "/parameter-admin/projects/aurora/structure"
];

export const consistencyRoutes = [...new Set([...Object.values(applicablePaths).flat(), ...otherPhaseTwoPaths])]
  .map((path) => ({
    path,
    required: [
      "xiaozeLaunchers",
      ...(Object.keys(applicablePaths) as (keyof typeof applicablePaths)[]).filter((category) => applicablePaths[category].includes(path))
    ] satisfies ConsistencyCategory[]
  }));

export async function installConsistencyReadGuard(context: BrowserContext) {
  const blocked: { method: string; pathname: string }[] = [];
  await context.route("**/*", async (intercepted) => {
    const request = intercepted.request();
    if (request.method() === "GET") {
      await intercepted.fallback();
      return;
    }
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/v1/device-bridges/pairing-codes") {
      await intercepted.fulfill({
        status: 201,
        json: { code: "000000", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
      });
      return;
    }
    blocked.push({ method: request.method(), pathname });
    await intercepted.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  return blocked;
}

export function requireConsistencyMeasurements(
  measurements: Partial<Record<ConsistencyCategory, readonly unknown[]>>,
  required: readonly ConsistencyCategory[],
  routePath: string
) {
  const missing = required.filter((category) => !measurements[category]?.length);
  if (missing.length) {
    throw new Error(`${routePath}: missing consistency measurements: ${missing.join(", ")}`);
  }
}
