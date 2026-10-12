export function collectConsistencyMeasurements() {
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const describeElement = (element: Element) => {
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
  const geometry = (element: Element) => ({ dom: describeElement(element), rect: bounds(element) });
  const measureControl = (element: Element) => ({
    dom: describeElement(element), role: role(element), height: element.getBoundingClientRect().height,
    compactControl: element.getAttribute("data-compact-control")
  });
  const measureTypography = (element: Element) => ({
    dom: describeElement(element), fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
  });
  const titles = [...document.querySelectorAll('.topbar-title, main h1, main h2, main h3, main h4, main h5, main h6, main [role="heading"], main [class$="__title"], main [class$="-title"], [role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3')]
    .filter(visible).map((element) => ({ ...measureTypography(element), pageTitle: element.matches(".topbar-title") }));
  const buttons = [...document.querySelectorAll('button, .button, [data-slot="button"], [role="button"]')]
    .filter(visible).map(measureTypography);
  const typeProbe = document.createElement("span");
  typeProbe.style.cssText = "position: absolute; visibility: hidden; pointer-events: none";
  document.documentElement.append(typeProbe);
  const typeScale = ["xs", "sm", "base", "md", "lg", "xl", "2xl"].map((step) => {
    typeProbe.style.fontSize = `var(--text-${step})`;
    return { fontSize: Number.parseFloat(getComputedStyle(typeProbe).fontSize) };
  });
  typeProbe.remove();
  const pageEdges: { dom: string; region: string; left: number; expectedLeft: number }[] = [];
  if (main) {
    const gutterProbe = document.createElement("span");
    gutterProbe.style.cssText = "position: absolute; visibility: hidden; width: var(--page-gutter)";
    main.append(gutterProbe);
    const expectedLeft = bounds(main).left + Number.parseFloat(getComputedStyle(gutterProbe).width);
    gutterProbe.remove();
    const measureEdge = (element: Element, region: string) => ({
      dom: describeElement(element), region, expectedLeft,
      left: bounds(element).left + (Number.parseFloat(getComputedStyle(element).paddingLeft) || 0)
    });
    pageEdges.push(measureEdge(main, "shell"));
    const content = main.querySelector(":scope > .page-content");
    if (content && visible(content)) {
      pageEdges.push(measureEdge(content, "content"));
      pageEdges.push(...[...content.children].filter(visible).map((element) => measureEdge(element, "page")));
    }
    const toolbar = document.querySelector(".topbar");
    if (toolbar && visible(toolbar)) pageEdges.push(measureEdge(toolbar, "toolbar"));
    const footer = main.querySelector(":scope > .app-footer");
    if (footer && visible(footer)) pageEdges.push(measureEdge(footer, "footer"));
  }
  const viewSwitchElements = elements([
    '[role="tablist"] [role="tab"]', '[role="radiogroup"] [role="radio"]',
    'nav:has([aria-current]) button', 'nav:has([aria-current]) a', 'nav button[aria-pressed]',
    '[role="group"][aria-label="日志视图切换"] button[aria-pressed]',
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
  ])].filter((element) => visible(element)
    && !element.matches('[role="treeitem"],[class*="parameter-catalog__tree-select"]')
  ).map((element) => {
    const style = getComputedStyle(element);
    const group = element.closest('nav,[role="tablist"],[role="radiogroup"],.protocol-switch,.review-view-tabs,.local-device-bridge-wizard__steps')
      ?? element.parentElement!;
    return {
      dom: describeElement(element), group: describeElement(group), role: role(element), groupRole: role(group),
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
  const primaryActionElements = [...document.querySelectorAll([
    ".button.primary", ".button.is-primary", '[data-primary-action="true"]',
    'button.bg-primary', 'a.bg-primary', '[data-slot="button"][data-variant="default"]',
    '[data-slot="button"][data-variant="primary"]'
  ].join(","))].filter(visible);
  const primaryActions = primaryActionElements.map((element) => ({ ...measureControl(element), background: getComputedStyle(element).backgroundColor, primaryColor,
      disabled: element.matches(':disabled,[aria-disabled="true"]') }));
  const enabledPrimaryActionCount = primaryActionElements.filter((element) => !element.matches(':disabled,[aria-disabled="true"]')).length;
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
      dom: describeElement(element), cell: bounds(element), row: bounds(row), clip: { left, right }, scrollLeft,
      actions: [...element.querySelectorAll('button,a,[role="button"]')].filter(visible).map(geometry),
      statuses: [...row.querySelectorAll('[data-label="重要性"],.parameter-catalog__lifecycle')].filter(visible).map(geometry)
    }];
  });
  const overlays = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(geometry);
  const xiaozeLaunchers = overlays('[data-testid="copilot-chat-toggle"],.xiaoze-chat-toggle');
  const xiaozeHints = overlays('[data-testid="xiaoze-toggle-hint"],.xiaoze-toggle-hint');
  const scrollports = new Set<Element>();
  const visibleTables = [...new Set([
    ...elements('table,[role="table"],[role="grid"]'),
    ...document.querySelectorAll('[role="dialog"] :is(table,[role="table"],[role="grid"])')
  ])].filter(visible);
  for (const table of [...visibleTables, ...elements(".audit-workspace-list, .navigator-workbench__task .identity-mapping-review__list")]) {
    let hasScrollport = false;
    for (let ancestor: Element | null = table; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if ([style.overflowX, style.overflowY].some((overflow) => ["auto", "scroll"].includes(overflow)) && visible(ancestor)) {
        scrollports.add(ancestor);
        hasScrollport = true;
      }
    }
    if (!hasScrollport) scrollports.add(table);
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
      ? [{ dom: describeElement(element), rect: { left, top, right, bottom, width: right - left, height: bottom - top } }]
      : [];
  };
  const tableScrollports = [...scrollports].flatMap(clippedGeometry);
  const stickyActionAreas = elements("*").filter((element) =>
    ["sticky", "fixed"].includes(getComputedStyle(element).position)
    && (element.matches('td,th,[role="cell"],[role="columnheader"],[data-sticky-action-area]')
      || element.querySelector('button,a[href],[role="button"]'))
  ).flatMap(clippedGeometry);
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
    return { dom: describeElement(element), tree: `${describeElement(tree)}[${moduleTrees.indexOf(tree)}]`, depth, left: element.getBoundingClientRect().left };
  });
  const paginationControls = elements('[data-compact-control="pagination"]').map(measureControl);
  const sortControls = elements('[data-compact-control="sort"]').map(measureControl);
  const filterControls = elements('[data-compact-control="filter"]').map(measureControl);
  const unmarkedCompactControls = elements('select,[role="combobox"]:not(input):not(textarea),[data-slot="select-trigger"],[aria-haspopup="listbox"]:not(input):not(textarea)')
    .filter((element) => element.closest('[role="toolbar"],[role="search"],[class*="filter"],[class*="toolbar"],[class*="pagination"]')
      && !element.matches('[data-compact-control="filter"],[data-compact-control="sort"],[data-compact-control="pagination"]'))
    .map(measureControl);
  const navigatorWorkbenches = elements(".navigator-workbench").map((workbench) => {
    const measure = (selector: string) => {
      const element = workbench.querySelector(selector);
      return element && visible(element) ? bounds(element) : null;
    };
    const tokenWidth = (name: string) => {
      const probe = document.createElement("div");
      probe.style.cssText = `position: absolute; visibility: hidden; width: var(${name}); height: 0; padding: 0; border: 0`;
      document.documentElement.append(probe);
      const width = Number.parseFloat(getComputedStyle(probe).width);
      probe.remove();
      return width;
    };
    const firstRow = workbench.querySelector('.navigator-workbench__task tbody tr, .navigator-workbench__task [role="row"]:has([role="cell"]), .navigator-workbench__task .identity-mapping-review__item');
    return {
      pageKey: workbench.getAttribute("data-workbench-page"),
      collapsed: workbench.getAttribute("data-navigator-collapsed") === "true",
      root: bounds(workbench),
      navigator: measure(":scope > .navigator-workbench__body > .navigator-workbench__navigator"),
      task: measure(":scope > .navigator-workbench__body > .navigator-workbench__task"),
      toolbar: measure(":scope > .navigator-workbench__toolbar"),
      primaryAction: measure(".navigator-workbench__primary > button, .navigator-workbench__primary > a"),
      noticeCount: [...workbench.querySelectorAll(":scope > .navigator-workbench__notice")].filter(visible).length,
      navigatorCounts: [...workbench.querySelectorAll(".navigator-workbench__navigation .dts-topology-navigator__count, .navigator-workbench__navigation .parameter-catalog__module-count")].filter(visible).map((count) => {
        const navigation = count.closest(".navigator-workbench__navigation")!;
        const navigationRect = bounds(navigation);
        const countRect = bounds(count);
        const clip = {
          left: Math.max(0, navigationRect.left + navigation.clientLeft, countRect.left),
          right: Math.min(innerWidth, navigationRect.left + navigation.clientLeft + navigation.clientWidth, countRect.right)
        };
        const range = document.createRange();
        range.selectNodeContents(count);
        const textRect = range.getBoundingClientRect();
        return {
          text: count.textContent, clip,
          textRect: { left: textRect.left, right: textRect.right, width: textRect.width },
          clientWidth: count.clientWidth, scrollWidth: count.scrollWidth
        };
      }),
      firstRow: firstRow ? bounds(firstRow) : null,
      firstRowClip: firstRow ? clippedGeometry(firstRow)[0]?.rect ?? null : null,
      viewport: { width: innerWidth, height: innerHeight },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contract: {
        navigatorWidth: Math.min(tokenWidth("--navigator-workbench-navigator-width"), tokenWidth("--navigator-workbench-navigator-cap")),
        collapsedWidth: tokenWidth("--navigator-workbench-collapsed-width"),
        gap: tokenWidth("--navigator-workbench-gap"),
        toolbarPadding: tokenWidth("--navigator-workbench-toolbar-padding")
      }
    };
  });
  return {
    titles, buttons, typeScale, pageEdges,
    viewSwitches, viewSwitchSignatures, primaryActions, enabledPrimaryActionCount, rowActions, xiaozeLaunchers, xiaozeHints, tableScrollports, stickyActionAreas,
    moduleTreeLabels, filterControls, sortControls, paginationControls, unmarkedCompactControls, navigatorWorkbenches, visibleTableCount: visibleTables.length
  };
}

export type ConsistencyMeasurements = ReturnType<typeof collectConsistencyMeasurements>;
export type ConsistencyCategory = {
  [Category in keyof ConsistencyMeasurements]: ConsistencyMeasurements[Category] extends readonly unknown[] ? Category : never
}[keyof ConsistencyMeasurements];
