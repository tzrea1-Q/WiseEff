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
  const control = (element: Element) => ({
    dom: signature(element), role: role(element), height: element.getBoundingClientRect().height,
    compactControl: element.getAttribute("data-compact-control")
  });
  const viewSwitchElements = elements([
    '[role="tab"]', '[role="radiogroup"] [role="radio"]', '[role="group"][aria-label*="视图"] button[aria-pressed]',
    'nav:has([aria-current]) button', 'nav:has([aria-current]) a', 'nav button[aria-pressed]',
    ".view-switch__item", ".parameter-admin-scope-nav__tab", ".parameter-admin-subnav__tab",
    ".protocol-switch-button", ".user-permissions-workspace-tab", ".logs-aux-tabs button",
    ".parameter-home__view-switcher-item", ".parameter-home__toggle-item",
    ".review-view-tabs button", ".param-admin-audit-filters .chip",
    ".dts-parameter-workbench__header-actions button[aria-pressed]",
    ".local-device-bridge-wizard__steps li"
  ].join(","));
  const viewSwitches = [...new Set([
    ...viewSwitchElements,
    ...document.querySelectorAll(".topbar .view-switch__item, .topbar .parameter-home__view-switcher-item")
  ])].filter(visible).map((element) => {
    const style = getComputedStyle(element);
    const group = element.closest('nav,[role="tablist"],[role="radiogroup"],.protocol-switch,.review-view-tabs,.local-device-bridge-wizard__steps')
      ?? element.parentElement!;
    return {
      dom: signature(element), group: signature(group), role: role(element), groupRole: role(group),
      height: element.getBoundingClientRect().height,
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].join(" "),
      fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, background: style.backgroundColor,
      selected: element.matches('[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],[aria-current]:not([aria-current="false"]),[data-state="on"],[data-active="true"],.is-active,.active,.chip-active')
    };
  });
  const switchProbe = document.createElement("span");
  switchProbe.style.cssText = "all: initial; position: absolute; visibility: hidden; pointer-events: none; display: block; width: 0";
  document.documentElement.append(switchProbe);
  const viewSwitchSignatures = [
    { variant: "section", role: "button", groupRole: "navigation", height: "var(--space-10)", radius: "var(--radius-full)", fontSize: "var(--text-md)", lineHeight: "var(--leading-md)", background: "var(--surface)", selectedBackground: "var(--nav-selected)" },
    { variant: "tabs", role: "tab", groupRole: "tablist", height: "var(--space-8)", radius: "var(--radius-md)", fontSize: "var(--text-base)", lineHeight: "var(--leading-base)", background: "var(--surface)", selectedBackground: "var(--accent-soft)" },
    { variant: "toggle", role: "radio", groupRole: "radiogroup", height: "calc(var(--space-6) + var(--space-1))", radius: "var(--radius-sm)", fontSize: "var(--text-sm)", lineHeight: "var(--leading-sm)", background: "var(--surface-sunken)", selectedBackground: "var(--surface)" }
  ].map((tier) => {
    switchProbe.style.height = tier.height;
    switchProbe.style.borderRadius = tier.radius;
    switchProbe.style.fontSize = tier.fontSize;
    switchProbe.style.lineHeight = tier.lineHeight;
    switchProbe.style.fontWeight = "var(--view-switch-font-weight)";
    switchProbe.style.backgroundColor = tier.background;
    const style = getComputedStyle(switchProbe);
    const resolved = {
      ...tier, height: switchProbe.getBoundingClientRect().height,
      radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].join(" "),
      fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, background: style.backgroundColor
    };
    switchProbe.style.backgroundColor = tier.selectedBackground;
    return { ...resolved, selectedBackground: getComputedStyle(switchProbe).backgroundColor };
  });
  switchProbe.remove();
  const primaryToken = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  const primaryProbe = document.createElement("span");
  primaryProbe.style.cssText = "position: absolute; visibility: hidden; pointer-events: none";
  primaryProbe.style.setProperty("background-color", primaryToken, "important");
  document.body.append(primaryProbe);
  const primaryColor = primaryToken ? getComputedStyle(primaryProbe).backgroundColor : "";
  primaryProbe.remove();
  const primaryActions = [...document.querySelectorAll([
    ".button.primary", ".button.is-primary", ".local-device-bridge-panel__install-cta",
    'button.bg-primary', 'a.bg-primary', '[data-slot="button"][data-variant="default"]',
    ".primary-nav-action", ".auth-submit", ".profile-dialog__button--primary", ".debugging-deploy-button",
    ".permission-denied-action.primary", ".user-permissions-primary-action", ".user-permissions-modal-action--primary", ".insight-action--primary"
  ].join(","))].filter(visible)
    .map((element) => ({ ...control(element), background: getComputedStyle(element).backgroundColor, primaryColor,
      disabled: element.matches(':disabled,[aria-disabled="true"]') }));
  const actionCells = new Set(elements('.dts-parameter-workbench-table__actions,td[data-label="操作"],[data-catalog-row-action]')
    .map((element) => element.closest('td,[role="cell"]') ?? element));
  const rowActions = [...actionCells].flatMap((element) => {
    const row = element.closest('tr,[role="row"]');
    if (!row) return [];
    let left = 0, right = innerWidth, scrollLeft = 0;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(ancestor).overflowX)) {
        const rect = ancestor.getBoundingClientRect();
        left = Math.max(left, rect.left + ancestor.clientLeft);
        right = Math.min(right, rect.left + ancestor.clientLeft + ancestor.clientWidth);
        scrollLeft = Math.max(scrollLeft, Math.abs(ancestor.scrollLeft));
      }
    }
    return [{
      dom: signature(element), cell: bounds(element), row: bounds(row), clip: { left, right }, scrollLeft,
      actions: [...element.querySelectorAll('button,a,[role="button"]')].filter(visible).map(geometry),
      statuses: [...row.querySelectorAll('[data-label="重要性"],.parameter-catalog__lifecycle')].filter(visible).map(geometry)
    }];
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
  const clippedGeometry = (element: Element) => {
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
  };
  const tableScrollports = [...scrollports].flatMap(clippedGeometry);
  const stickyActionAreas = elements("*").filter((element) =>
    ["sticky", "fixed"].includes(getComputedStyle(element).position)
    && (element.matches('td,th,[role="cell"],[role="columnheader"],[data-sticky-action-area]')
      || element.querySelector('button,a[href],[role="button"]'))
  ).flatMap(clippedGeometry);
  const moduleTreeLabels = elements(".dts-topology-navigator__label,.parameter-catalog__tree-label").map((element) => {
    const treeItem = element.closest('[role="treeitem"]');
    let depth = Number(treeItem?.getAttribute("aria-level")) || 0;
    if (!depth) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.matches('.parameter-catalog__tree-node,[role="treeitem"]')) depth++;
      }
    }
    return { dom: signature(element), tree: signature(element.closest('[role="tree"],.parameter-catalog__tree') ?? element.parentElement!), depth, left: element.getBoundingClientRect().left };
  });
  const paginationControls = elements('[data-compact-control="pagination"]').map(control);
  const sortControls = elements('[data-compact-control="sort"]').map(control);
  const filterControls = elements('[data-compact-control="filter"]').map(control);
  return {
    viewSwitches, viewSwitchSignatures, primaryActions, rowActions, xiaozeLaunchers, xiaozeHints, tableScrollports, stickyActionAreas,
    moduleTreeLabels, filterControls, sortControls, paginationControls
  };
}

export type ConsistencyMeasurements = ReturnType<typeof collectConsistencyMeasurements>;
export type ConsistencyCategory = keyof ConsistencyMeasurements;

export function requireRowActionVisibility(rows: ConsistencyMeasurements["rowActions"], routePath: string) {
  if (!rows.length) throw new Error(`${routePath}: missing row actions`);
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
  measurements: Partial<Pick<ConsistencyMeasurements, "filterControls" | "sortControls" | "paginationControls">> | null | undefined,
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
export const viewSwitchStyleExpectations: Readonly<Record<string, readonly ("section" | "tabs" | "toggle")[]>> = {
  "/organization": ["section"],
  "/organization/members": ["section", "tabs"],
  "/parameter-home": ["toggle"],
  "/audit": ["toggle"],
  "/logs": ["tabs"],
  "/parameters": ["tabs"],
  "/debugging-admin": ["section"],
  "/debugging-admin/nodes": ["section"],
  "/node-debugging": ["tabs"],
  "/dts-reload": ["tabs"],
  "/parameter-admin": ["section"],
  "/parameter-admin/specs": ["section"],
  "/parameter-admin/specs/identity-mapping": ["section"],
  "/parameter-admin/modules": ["section"],
  "/parameter-admin/modules/queue": ["section"],
  "/parameter-admin/modules/registry": ["section"],
  "/parameter-admin/identity-mapping": ["section"],
  "/parameter-admin/spec-review": ["section"],
  "/parameter-admin/projects": ["section"],
  "/parameter-admin/projects/aurora/review-roles": ["section"],
  "/parameter-review": ["tabs"],
  "/parameter-submissions": ["tabs"]
};
export const viewSwitchStylePaths = Object.keys(viewSwitchStyleExpectations);
const applicablePaths: Omit<Record<ConsistencyCategory, readonly string[]>, "xiaozeLaunchers" | "xiaozeHints" | "stickyActionAreas"> = {
  viewSwitches: [...viewSwitchPaths, "/log-admin"],
  viewSwitchSignatures: viewSwitchStylePaths,
  primaryActions: ["/dts-reload", "/knowledge", "/log-dashboard", "/log-admin", "/logs", "/node-debugging", "/organization/members", "/parameter-admin", "/parameter-admin/specs", "/user-permissions"],
  rowActions: [...catalogPaths, "/parameters"],
  tableScrollports: [...catalogPaths, "/parameters", "/node-debugging"],
  moduleTreeLabels: [...catalogPaths, "/parameters", "/node-debugging", "/dts-reload"],
  filterControls: ["/audit", "/debugging-admin/nodes", "/dts-reload", "/feedback-admin", "/organization/members", "/parameter-home", "/user-permissions"],
  sortControls: [],
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

export function shouldRequireXiaozeHint({ hasDialog, viewportWidth }: { hasDialog: boolean; viewportWidth: number }) {
  return !hasDialog && viewportWidth > 640;
}

export function assertXiaozePlacement(
  measurements: Pick<ConsistencyMeasurements, "xiaozeLaunchers" | "xiaozeHints" | "tableScrollports" | "stickyActionAreas">,
  routePath: string
) {
  for (const overlay of [...measurements.xiaozeLaunchers, ...measurements.xiaozeHints]) {
    for (const area of [...measurements.tableScrollports, ...measurements.stickyActionAreas]) {
      if (overlay.rect.left < area.rect.right && overlay.rect.right > area.rect.left
        && overlay.rect.top < area.rect.bottom && overlay.rect.bottom > area.rect.top) {
        throw new Error(`${routePath}: ${overlay.dom} overlaps ${area.dom}`);
      }
    }
  }
}
