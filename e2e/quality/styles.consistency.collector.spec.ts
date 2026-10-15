import { expect, test, type Locator, type Page } from "playwright/test";
import { signInBrowserAsRole } from "../acceptance/helpers/bearerAuth";
import { installConsistencyReadGuard } from "./consistency";
import { expectUsablePage, prepareInteractionSurface, waitForFontsAndNextPaint } from "./helpers";
import { parseQualityLane, shouldRegisterConsistencyFixture } from "./quality-partition";

const qualityLane = parseQualityLane(process.env.WISEEFF_QUALITY_LANE);

function styleTest(title: string, body: (fixtures: { page: Page; baseURL: string | undefined }) => Promise<void>) {
  if (shouldRegisterConsistencyFixture(qualityLane, title)) test(title, body);
}

async function renderFixture(page: Page, baseURL: string | undefined, markup: string, sheets: string[] = []) {
  if (!baseURL) throw new Error("The stylesheet regressions require the quality frontend runtime.");
  await test.step("quality:navigation", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const url = new URL("/__quality-style-fixture", baseURL).href;
    await page.route(url, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: markup }));
    await page.goto(url);
    await page.unroute(url);
    for (const sheet of ["src/styles.css", ...sheets]) {
      await page.addStyleTag({ url: new URL(`/${sheet}?direct`, baseURL).href });
    }
  });
  await test.step("quality:readiness", () => page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)));
  }));
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const rect = await test.step("quality:capture", () => locator.boundingBox());
  if (!rect) throw new Error("Missing rendered fixture geometry.");
  return { ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height };
}

async function expectScrollable(locator: Locator) {
  const scrolling = await test.step("quality:capture", () => locator.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { overflow: element.scrollHeight > element.clientHeight, moved: element.scrollTop > 0 };
  }));
  expect(scrolling).toEqual({ overflow: true, moved: true });
}

async function expectFits(locator: Locator) {
  const size = await test.step("quality:capture", () => locator.evaluate((element) => ({
    client: element.clientWidth, scroll: element.scrollWidth
  })));
  expect(size.client).toBeGreaterThan(0);
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

async function expectFooterPlacement(footer: Locator, body: Locator, card: Locator) {
  const footerRect = await bounds(footer);
  const bodyRect = await bounds(body);
  const cardRect = await bounds(card);
  expect(footerRect.y).toBeGreaterThanOrEqual(bodyRect.bottom - 2);
  expect(footerRect.bottom).toBeLessThanOrEqual(cardRect.bottom + 2);
  expect(footerRect.bottom).toBeLessThanOrEqual(footer.page().viewportSize()!.height + 2);
  return footerRect;
}

styleTest("topbar search fits its control and the compact project selector fits its parent", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="topbar"><label class="searchbox"><input aria-label="Search"></label></div>
    <div style="width: 260px"><select class="topbar-project-select" aria-label="Project"><option>Project</option></select></div>`);
  expect((await bounds(page.locator(".searchbox"))).height).toBe(32);
  expect((await bounds(page.getByRole("textbox"))).height).toBe(30);
  await page.setViewportSize({ width: 900, height: 900 });
  const select = await bounds(page.getByRole("combobox"));
  expect(select.width).toBe(260);
});

styleTest("Bridge readiness wraps without overflow and stacks at the existing narrow breakpoint", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<section style="width: min(600px, 100vw)">
    <div class="local-device-bridge-panel__readiness"><span class="local-device-bridge-panel__readiness-status">Bridge ready</span>
    <button class="button">Open connection guide with a long action label</button></div></section>`);
  const row = page.locator(".local-device-bridge-panel__readiness");
  const copy = row.locator("span");
  const action = row.getByRole("button");
  const desktopCopy = await bounds(copy);
  const desktopAction = await bounds(action);
  expect(desktopCopy.right).toBeLessThanOrEqual(desktopAction.x);
  expect(Math.abs(desktopCopy.y + desktopCopy.height / 2 - desktopAction.y - desktopAction.height / 2)).toBeLessThan(1);
  await page.setViewportSize({ width: 480, height: 900 });
  const stackedCopy = await bounds(copy);
  const stackedAction = await bounds(action);
  expect(stackedAction.y).toBeGreaterThanOrEqual(stackedCopy.bottom);
  expect(stackedAction.width).toBeCloseTo((await bounds(row)).width, 0);
  expect(stackedCopy.width).toBeCloseTo(stackedAction.width, 0);
});

styleTest("Bridge guide is a right-edge scrollable drawer without an opaque workbench scrim", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="modal-backdrop local-device-bridge-panel__guide-backdrop">
    <section class="local-device-bridge-panel__guide-drawer"><h2>Guide</h2>${"<p>Installation step</p>".repeat(100)}</section></div>`);
  const drawer = page.locator(".local-device-bridge-panel__guide-drawer");
  const rect = await bounds(drawer);
  expect(rect.right).toBe(1440);
  expect(rect.height).toBeLessThanOrEqual(900);
  await expect(page.locator(".local-device-bridge-panel__guide-backdrop")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expectScrollable(drawer);
});

styleTest("debugging installation context and multiline values cannot push task rows out of view", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="debugging-workbench-content"><div class="navigator-workbench__context">${"<p>Bridge installation step</p>".repeat(50)}</div></div>
    <div class="node-debugging-page" style="width: 240px"><div class="debug-value-preview">${"0123456789abcdef".repeat(100)}\nsecond line</div></div>`);
  const context = page.locator(".navigator-workbench__context");
  expect((await bounds(context)).height).toBeLessThanOrEqual(192);
  await expectScrollable(context);
  const preview = page.locator(".debug-value-preview");
  const geometry = await preview.evaluate((element) => ({ height: element.getBoundingClientRect().height,
    width: element.getBoundingClientRect().width, scrollHeight: element.scrollHeight, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) }));
  expect(geometry.width).toBeLessThanOrEqual(240);
  expect(geometry.height).toBeGreaterThan(geometry.lineHeight);
  expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 4 + 1);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
});

for (const kind of ["detail", "compare"] as const) {
  styleTest(`portaled DTS ${kind} card keeps its footer visible while the body scrolls`, async ({ page, baseURL }) => {
    await renderFixture(page, baseURL, `<div class="modal-backdrop dts-binding-${kind}-dialog__overlay">
      <section class="dts-binding-${kind}-dialog" role="dialog" aria-label="Binding">
      <header class="dts-binding-${kind}-dialog__header"><h2>Binding</h2></header>
      <div class="dts-binding-${kind}-dialog__content">${"<p>Long binding history</p>".repeat(100)}</div>
      <footer class="dts-binding-${kind}-dialog__footer"><button class="button primary">Confirm</button></footer></section></div>`);
    const card = page.getByRole("dialog");
    const rect = await bounds(card);
    expect(rect.height).toBeLessThanOrEqual(852);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(900);
    await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(card).not.toHaveCSS("box-shadow", "none");
    const action = page.getByRole("button", { name: "Confirm" });
    const body = page.locator(`.dts-binding-${kind}-dialog__content`);
    const footer = page.locator(`.dts-binding-${kind}-dialog__footer`);
    const footerBefore = await expectFooterPlacement(footer, body, card);
    expect((await bounds(action)).right).toBeGreaterThan(rect.x + rect.width / 2);
    await expectScrollable(body);
    const footerAfter = await expectFooterPlacement(footer, body, card);
    expect(Math.abs(footerAfter.y - footerBefore.y)).toBeLessThanOrEqual(2);
    await expect(action).toBeInViewport();
    if (kind === "detail") {
      await page.locator(".modal-backdrop").evaluate((element) => element.classList.add("is-suspended"));
      await expect(card).toBeHidden();
    }
  });
}

styleTest("portaled governance confirmation has visible actions, separated content and a pinned footer (TD-084)", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="modal-backdrop param-admin-modal-backdrop"><section class="confirm-dialog governance-confirm-dialog" role="dialog">
    <h2>Confirm change</h2><div class="confirm-dialog__scroll">${"<p>Review item</p>".repeat(100)}</div>
    <footer class="dialog-actions"><button class="button subtle">Cancel</button><button class="button primary">Confirm</button></footer></section></div>`);
  const card = await bounds(page.getByRole("dialog"));
  const heading = await bounds(page.getByRole("heading"));
  const scroll = await bounds(page.locator(".confirm-dialog__scroll"));
  expect(card.height).toBeLessThanOrEqual(852);
  expect(scroll.y).toBeGreaterThan(heading.bottom);
  const actions = page.locator(".dialog-actions");
  const body = page.locator(".confirm-dialog__scroll");
  const before = await expectFooterPlacement(actions, body, page.getByRole("dialog"));
  expect(before.y - scroll.bottom).toBeGreaterThan(0);
  for (const button of await actions.getByRole("button").all()) {
    expect((await bounds(button)).height).toBeGreaterThanOrEqual(28);
    await expect(button).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await page.getByRole("button", { name: "Confirm", exact: true }).focus();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeFocused();
  await expectScrollable(body);
  const after = await expectFooterPlacement(actions, body, page.getByRole("dialog"));
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeInViewport();
});

styleTest("history diff uses the large dialog tier and readable title at desktop and compact widths", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<section class="parameter-history-diff-dialog"><header class="parameter-history-diff-dialog__head"><h2>History</h2></header></section>`);
  expect((await bounds(page.locator(".parameter-history-diff-dialog"))).width).toBe(720);
  await expect(page.getByRole("heading")).toHaveCSS("font-size", "16px");
  await page.setViewportSize({ width: 640, height: 900 });
  expect((await bounds(page.locator(".parameter-history-diff-dialog"))).width).toBe(592);
});

styleTest("module editing sections are separated and driver fields fill two columns then stack", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<section class="param-admin-module-edit-dialog"><div class="param-admin-module-edit-body">
    <section class="module-edit-section"><div class="module-edit-placement-controls"><button class="module-tree-trigger">Category</button></div></section>
    <section class="module-edit-section"><div class="organization-driver-schema-dialog__field-grid">
    <label>First<select><option>Long property</option></select></label><label>Second<select><option>Another property</option></select></label>
    </div></section></div></section>`);
  const sections = page.locator(".module-edit-section");
  expect((await bounds(sections.nth(1))).y).toBeGreaterThan((await bounds(sections.nth(0))).bottom);
  await expect(sections.first()).not.toHaveCSS("border-top-width", "0px");
  const picker = page.getByRole("button", { name: "Category" });
  await expect(picker).not.toHaveCSS("border-top-width", "0px");
  await expect(picker).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const fields = page.locator(".organization-driver-schema-dialog__field-grid > label");
  const first = await bounds(fields.first());
  const second = await bounds(fields.nth(1));
  expect(first.y).toBe(second.y);
  expect(first.right).toBeLessThan(second.x);
  expect((await bounds(fields.first().getByRole("combobox"))).width).toBeCloseTo(first.width, 0);
  await page.setViewportSize({ width: 640, height: 900 });
  expect((await bounds(fields.nth(1))).y).toBeGreaterThan((await bounds(fields.first())).bottom);
});

styleTest("the portaled module menu stays on top and its items do not wrap", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="param-admin-module-dialog"><div class="dropdown-menu"><button class="dropdown-item">Inline action</button></div></div>
    <div class="param-admin-module-more-menu-list" style="top: 200px; left: 200px"><button class="dropdown-item">Portaled action with a long label</button></div>`);
  const menu = page.locator(".param-admin-module-more-menu-list");
  await expect(menu).toHaveCSS("position", "fixed");
  const action = menu.getByRole("button");
  const rect = await bounds(action);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".dropdown-item")?.textContent,
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  expect(hit).toBe("Portaled action with a long label");
  await expect(action).toHaveCSS("white-space", "nowrap");
  await expect(page.locator(".param-admin-module-dialog .dropdown-menu")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

styleTest("reload candidate operation track stays compact and centers its action", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<table class="dts-reload-candidate-table__grid" style="width: 900px"><thead><tr><th>Candidate</th><th>Action</th></tr></thead>
    <tbody><tr><td>Candidate</td><td><button class="button">Apply</button></td></tr></tbody></table>`, ["src/features/dts-reload/dts-reload-candidate-table.css"]);
  const header = await bounds(page.locator("th:last-child"));
  const cell = await bounds(page.locator("td:last-child"));
  const action = await bounds(page.getByRole("button"));
  expect(header.width).toBe(96);
  expect(cell.width).toBe(96);
  expect(Math.abs(action.x + action.width / 2 - cell.x - cell.width / 2)).toBeLessThan(1);
});

styleTest("shared table scrollports keep readable floors and portaled filters escape clipping", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main style="width: 360px">
    <div class="data-table-scroll"><table><tr><td>Data</td><td>Action</td></tr></table></div>
    <div class="binding-property-table"><table><tr><td>Binding</td><td>Action</td></tr></table></div>
    <div class="dts-reload-candidate-table"><div class="data-table-scroll"><table><tr><td>Reload</td></tr></table></div></div>
    <div class="parameters-column-filter__menu parameters-column-filter__menu--fixed" style="top: 200px; left: 400px">
      <div class="parameters-column-filter__menu-head"><strong>Filter</strong></div><div class="parameters-column-filter__options"><label><input type="checkbox">Option</label></div>
    </div></main>`, ["src/features/dts-reload/dts-reload-candidate-table.css"]);
  for (const viewport of [1440, 900]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const [selector, minimum] of [["main > .data-table-scroll", 720], [".binding-property-table", 640], [".dts-reload-candidate-table > .data-table-scroll", 720]] as const) {
      const scroll = page.locator(selector);
      expect((await bounds(scroll.locator("table"))).width).toBeGreaterThanOrEqual(minimum);
      const moved = await scroll.evaluate((element) => { element.scrollLeft = 100; return element.scrollLeft; });
      expect(moved).toBeGreaterThan(0);
    }
    const menu = page.locator(".parameters-column-filter__menu");
    await expect(menu).not.toHaveCSS("box-shadow", "none");
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("checkbox")).toBeChecked();
  }
});

styleTest("parameter table fits desktop, pins identity columns on scroll and wraps long names and values", async ({ page, baseURL }) => {
  const longValue = "0123456789abcdef".repeat(40);
  await renderFixture(page, baseURL, `<section class="parameters-table--column-filters" style="width: 1000px"><div class="parameters-table-scroll"><table class="parameters-table-grid">
    <thead><tr><th>Select</th><th><div class="parameters-table-head-cell"><span>Name</span><button class="parameters-column-filter__trigger">Filter</button></div></th>${"<th>Data</th>".repeat(6)}<th>Action</th></tr></thead>
    <tbody><tr><td data-label="Select">1</td><td data-label="Name"><strong>${longValue}</strong><small>${longValue}</small></td>
    <td data-label="Value"><div class="parameter-value-diff"><span>${longValue}\nsecond line</span><strong>${longValue}</strong></div></td>${"<td data-label=Data>Data</td>".repeat(5)}<td data-label="Action"><button>Details</button></td></tr></tbody></table></div></section>`);
  const scroll = page.locator(".parameters-table-scroll");
  await expectFits(scroll);
  const name = page.locator("tbody td:nth-child(2)");
  await expectFits(name);
  const value = page.locator(".parameter-value-diff");
  await expectFits(value);
  expect((await bounds(value)).height).toBeGreaterThan(40);
  const label = await bounds(page.locator(".parameters-table-head-cell > span"));
  const filter = await bounds(page.getByRole("button", { name: "Filter" }));
  expect(filter.x - label.right).toBeLessThanOrEqual(5);
  await page.locator("table").evaluate((element) => { element.style.width = "1400px"; });
  const scrollRect = await bounds(scroll);
  for (const distance of [150, 250]) {
    const offset = await scroll.evaluate((element, amount) => { element.scrollLeft = amount; return element.scrollLeft; }, distance);
    expect(offset).toBeGreaterThan(0);
    for (const cell of ["th", "td"]) {
      const selection = await bounds(page.locator(`${cell}:first-child`).first());
      const identity = await bounds(page.locator(`${cell}:nth-child(2)`).first());
      expect(Math.abs(selection.x - scrollRect.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(identity.x - scrollRect.x - 48)).toBeLessThanOrEqual(2);
      expect(Math.abs(identity.x - selection.x - 48)).toBeLessThanOrEqual(2);
    }
  }
  await page.locator("table").evaluate((element) => { element.style.removeProperty("width"); });
  await page.locator("section").evaluate((element) => { element.style.width = "100%"; });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator("thead")).toBeHidden();
  await expectFits(page.locator("section"));
  await expectFits(name);
  await expect(name).toHaveCSS("position", "static");
  await expect(page.locator("tbody td:first-child")).toHaveCSS("position", "static");
});

styleTest("admin list preserves its gutter, action space, desktop rail and narrow card labels", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main style="width: min(1100px, 100vw)"><section class="admin-list-page">
    <header class="admin-list-page__header"><h1>Projects</h1><div class="search-field"><input aria-label="Search projects"></div></header>
    <div class="data-table-scroll"><table><thead><tr><th>Name</th><th>State</th><th>Action</th></tr></thead><tbody><tr>
    <td data-label="Name">${"Very long project name ".repeat(20)}</td><td data-label="State">Active</td><td data-label="操作"><button class="button">Manage project</button></td>
    </tr></tbody></table></div><div class="horizontal-drag-scroll-rail" role="scrollbar" tabindex="0" aria-label="Horizontal scroll"><div class="horizontal-drag-scroll-rail__thumb"></div></div>
    </section><section class="parameter-module-mapping-panel"><div class="module-attribution-tree__row"><div>Identity</div><div>Mapping</div></div></section></main>`, ["src/components/layout/admin-list-page.css"]);
  const root = await bounds(page.locator(".admin-list-page"));
  expect(root.x).toBe((await bounds(page.locator("main"))).x);
  const mapping = page.locator(".parameter-module-mapping-panel");
  expect((await bounds(mapping)).x).toBe(root.x);
  const mappingFields = mapping.locator(".module-attribution-tree__row > div");
  expect((await bounds(mappingFields.nth(1))).y).toBeGreaterThanOrEqual((await bounds(mappingFields.first())).bottom);
  const name = page.locator("td:first-child");
  await expect(name).toHaveCSS("white-space", "nowrap");
  await expect(name).toHaveCSS("text-overflow", "ellipsis");
  expect((await bounds(page.getByRole("button"))).width).toBeLessThanOrEqual((await bounds(page.locator("td:last-child"))).width);
  const rail = page.getByRole("scrollbar");
  expect((await bounds(rail)).height).toBe(16);
  await rail.focus();
  await expect(rail).not.toHaveCSS("outline-style", "none");
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(rail).toBeHidden();
  await expectFits(page.locator(".admin-list-page"));
  await expect(name).toHaveCSS("white-space", "normal");
  const label = await name.evaluate((element) => getComputedStyle(element, "::before").content);
  expect(label).toBe('"Name"');
});

styleTest("wizard keeps long tables readable inside its scrolling main and leaves footer actions visible", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<section class="project-init-wizard" style="height: 700px; width: 1100px">
    <main class="project-init-main"><section class="project-init-step-panel project-init-step-panel--scope"><div class="project-init-table"><table>
    <thead><tr><th>Name</th><th>Source</th></tr></thead><tbody>${`<tr><td class="project-init-table__parameter">${"Long parameter ".repeat(20)}</td><td class="project-init-table__source">${"Source project ".repeat(20)}</td></tr>`.repeat(50)}</tbody></table></div>${"<p>Scope review instructions</p>".repeat(24)}</section></main>
    <footer class="project-init-footer"><button class="button subtle">Back</button><button class="button primary">Continue</button></footer></section>`);
  const wizard = page.locator(".project-init-wizard");
  const footer = page.locator(".project-init-footer");
  const main = page.locator(".project-init-main");
  const before = await expectFooterPlacement(footer, main, wizard);
  expect((await bounds(page.locator("table"))).width).toBeGreaterThanOrEqual(860);
  await expect(page.locator(".project-init-table__parameter").first()).toHaveCSS("text-overflow", "ellipsis");
  await expect(page.locator(".project-init-table__source").first()).toHaveCSS("white-space", "nowrap");
  await expectScrollable(page.locator(".project-init-table"));
  await expectScrollable(main);
  const after = await expectFooterPlacement(footer, main, wizard);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  await expect(footer.getByRole("button", { name: "Continue" })).toBeInViewport();
  for (const button of await footer.getByRole("button").all()) expect((await bounds(button)).width).toBeGreaterThanOrEqual(96);
});

styleTest("feedback dialog keeps two usable columns, its header close slot and bounded screenshot previews", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="modal-backdrop"><section class="feedback-dialog" role="dialog"><form>
    <div class="feedback-dialog-header"><h2>Feedback</h2><button type="button" aria-label="Close feedback">Close</button></div><div class="feedback-context">Context</div>
    <div class="feedback-layout"><section class="feedback-section"><textarea data-slot="textarea" aria-label="Feedback">${"Long description\n".repeat(40)}</textarea></section>
    <section class="feedback-section"><div class="feedback-screenshot-preview"><img alt="Screenshot" width="1600" height="1200" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='1200'/%3E"></div></section></div>
    <footer class="dialog-actions"><button class="button primary">Send</button></footer></form></section></div>`);
  const dialog = await bounds(page.getByRole("dialog"));
  expect(dialog.width).toBe(900);
  expect(dialog.height).toBeLessThanOrEqual(820);
  const sections = page.locator(".feedback-section");
  const first = await bounds(sections.first());
  const second = await bounds(sections.nth(1));
  expect(first.width).toBeGreaterThanOrEqual(300);
  expect(second.width).toBeGreaterThanOrEqual(280);
  expect(second.x).toBeGreaterThan(first.right);
  const textarea = await bounds(page.getByRole("textbox"));
  expect(textarea.height).toBeGreaterThanOrEqual(156);
  const close = await bounds(page.getByRole("button", { name: "Close feedback" }));
  expect(close.x).toBeGreaterThan((await bounds(page.getByRole("heading"))).right);
  expect((await bounds(page.getByRole("img"))).width).toBeLessThanOrEqual(second.width);
  await expectFits(page.locator(".feedback-layout"));
  await page.setViewportSize({ width: 760, height: 900 });
  const compactFirst = await bounds(sections.first());
  expect((await bounds(sections.nth(1))).y).toBeGreaterThan(compactFirst.bottom);
});

styleTest("auth registration and structured editors retain scroll, wrapping and visible validation affordances", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="auth-screen"><div class="auth-card">${"<p>Registration field</p>".repeat(100)}</div></div>`);
  await expectScrollable(page.locator(".auth-screen"));
  await renderFixture(page, baseURL, `<div class="structured-value-editor" style="width: 400px"><input aria-label="Value"><button>Add cell</button><input aria-label="Invalid value" aria-invalid="true"></div>
    <div class="project-topology-workspace__panes" style="width: 320px"><div><header class="binding-detail-panel__header"><p>${"long-binding-identity/".repeat(30)}</p></header>
    <div class="topology-tree__item"><code>${"long-locator/".repeat(30)}</code></div></div></div>`);
  const input = page.getByRole("textbox", { name: "Value", exact: true });
  await expect(input).not.toHaveCSS("border-top-width", "0px");
  const add = page.getByRole("button");
  await expect(add).not.toHaveCSS("border-top-width", "0px");
  expect((await bounds(add)).height).toBeGreaterThanOrEqual(30);
  const normalBorder = await input.evaluate((element) => getComputedStyle(element).borderColor);
  await expect(page.getByRole("textbox", { name: "Invalid value" })).not.toHaveCSS("border-color", normalBorder);
  await expectFits(page.locator(".project-topology-workspace__panes > div"));
});

styleTest("Xiaoze hints leave footer actions clickable while dialogs are open (TD-091)", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main class="main-content">Workbench</main><div data-xiaoze-launcher-anchor class="xiaoze-chat-toggle-anchor" data-xiaoze-hint-side="right" style="position: fixed; left: 24px; bottom: 24px">
    <button class="xiaoze-chat-toggle">Chat</button><div class="xiaoze-toggle-hint" data-testid="xiaoze-toggle-hint" role="status" aria-live="polite">
    <button type="button" class="xiaoze-toggle-hint__body">有问题？点这里问小泽</button><button type="button" class="xiaoze-toggle-hint__dismiss" aria-label="不再提示">×</button></div></div>
    <div class="xiaoze-welcome"><p class="xiaoze-welcome__subtitle">${"Welcome ".repeat(30)}</p></div>`);
  const hint = page.getByTestId("xiaoze-toggle-hint");
  await expect(hint.getByRole("button", { name: "有问题？点这里问小泽" })).toBeVisible();
  expect((await bounds(hint)).x).toBeGreaterThan((await bounds(page.getByRole("button", { name: "Chat", exact: true }))).right);
  expect((await bounds(page.locator(".xiaoze-welcome__subtitle"))).width).toBeLessThanOrEqual(270);
  await page.locator("body").evaluate((element) => element.insertAdjacentHTML("beforeend", '<div role="dialog"><button id="footer-action" style="position: fixed; left: 100px; bottom: 24px" onclick="this.textContent=\'Saved\'">Save</button></div>'));
  await expect(hint).toBeHidden();
  await expect(hint).toHaveCSS("pointer-events", "none");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.getByRole("dialog").evaluate((element) => element.remove());
  await expect(hint).toBeVisible();
});

styleTest("approval content is hit-testable above the modeless popup and business modal", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="xiaoze-popup" style="position: fixed; inset: 0; z-index: var(--z-xiaoze-popup)">Chat</div>
    <div class="modal-backdrop">Business modal</div><div data-slot="alert-dialog-overlay" style="position: fixed; inset: 0"></div>
    <section data-testid="xiaoze-approval-card" style="position: fixed; inset: 100px"><button>Approve</button></section>`);
  const approval = page.getByTestId("xiaoze-approval-card");
  const rect = await bounds(approval);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="xiaoze-approval-card"]') !== null,
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).toBe(true);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
});

styleTest("shared navigator bounds long labels, preserves counts and gives the task the remaining width", async ({ page, baseURL }) => {
  const longLabel = "Long module name ".repeat(25);
  await renderFixture(page, baseURL, `<main style="width: min(1100px, 100vw)"><div class="navigator-workbench"><div class="navigator-workbench__body">
    <section class="navigator-workbench__navigator"><div class="navigator-workbench__navigation"><div class="dts-topology-navigator">
      <div class="dts-topology-navigator__item"><button class="dts-topology-navigator__disclosure">+</button><span class="dts-topology-navigator__label">${longLabel}</span><span class="dts-topology-navigator__meta"><span class="dts-topology-navigator__count">12345</span></span></div>
    </div></div></section><section class="navigator-workbench__task"><p>First task row</p>${"<p>Task row</p>".repeat(100)}</section>
    </div></div></main>`, ["src/components/layout/navigator-workbench.css"]);
  const navigation = page.locator(".navigator-workbench__navigator");
  const task = page.locator(".navigator-workbench__task");
  const label = page.locator(".dts-topology-navigator__label");
  const count = page.locator(".dts-topology-navigator__count");
  const navRect = await bounds(navigation);
  const taskRect = await bounds(task);
  expect(navRect.width).toBeLessThanOrEqual(288);
  expect(taskRect.x).toBeGreaterThan(navRect.right);
  expect(taskRect.width).toBeGreaterThan(navRect.width);
  expect(navRect.height).toBeLessThan(100);
  expect((await bounds(count)).right).toBeLessThanOrEqual(navRect.right);
  expect((await bounds(count)).x).toBeGreaterThanOrEqual((await bounds(label)).right);
  await expect(label).toHaveCSS("text-overflow", "ellipsis");
  expect((await bounds(page.locator(".dts-topology-navigator__disclosure"))).width).toBe(28);
  expect(taskRect.height).toBeLessThanOrEqual(670);
  await expectScrollable(task);
  await page.setViewportSize({ width: 820, height: 900 });
  const stackedNav = await bounds(navigation);
  expect((await bounds(task)).y).toBeGreaterThan(stackedNav.bottom);
  expect(stackedNav.width).toBeCloseTo((await bounds(page.locator("main"))).width, 0);
  await expectFits(page.locator("main"));
});

styleTest("catalog selection does not shift labels and compact tables keep status and actions inside the task", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main class="parameter-catalog" style="width: 1000px"><div class="navigator-workbench"><div class="navigator-workbench__body">
    <section class="navigator-workbench__navigator"><div class="parameter-catalog__tree-row"><button class="parameter-catalog__tree-select">Module</button></div></section>
    <section class="navigator-workbench__task"><table class="parameter-catalog__table"><thead><tr><th>Name</th><th>State</th><th>Action</th></tr></thead><tbody><tr>
    <td>${"Long definition ".repeat(50)}</td><td class="parameter-catalog__lifecycle">Active</td><td data-label="操作"><button>Details</button></td></tr></tbody></table>
    <p class="parameter-catalog__identity">${"long-identity/".repeat(40)}</p></section></div></div></main>`, ["src/components/layout/navigator-workbench.css", "src/features/parameter-catalog/parameter-catalog.css"]);
  const selection = page.locator(".parameter-catalog__tree-select");
  const before = await bounds(selection);
  expect(before.height).toBeGreaterThanOrEqual(28);
  await page.locator(".parameter-catalog__tree-row").evaluate((element) => element.classList.add("is-selected"));
  expect(await bounds(selection)).toEqual(before);
  const task = page.locator(".navigator-workbench__task");
  await expectFits(task);
  await expect(page.locator("td:first-child")).toHaveCSS("text-overflow", "ellipsis");
  expect((await bounds(page.getByRole("button", { name: "Details" }))).right).toBeLessThan((await bounds(task)).right);
  await page.locator("main").evaluate((element) => { element.style.width = "100%"; });
  await page.setViewportSize({ width: 820, height: 900 });
  await expectFits(page.locator("main"));
  await expectFits(page.locator(".parameter-catalog__identity"));
});

styleTest("DTS table panes scroll independently, bound identity groups and use cards below their breakpoint", async ({ page, baseURL }) => {
  const row = `<div class="dts-parameter-workbench-table__row"><div class="dts-parameter-workbench-table__property">
    <div class="dts-parameter-workbench-table__property-primary"><strong>${"Long parameter ".repeat(20)}</strong><code>vendor,key</code></div>
    <div class="dts-parameter-workbench-table__property-secondary"><code>${"vendor,long-key-".repeat(20)}</code><span class="dts-parameter-workbench-table__enablement-notice">Unavailable</span></div></div>${"<div>Value</div>".repeat(5)}</div>`;
  await renderFixture(page, baseURL, `<div class="dts-parameter-workbench navigator-workbench" style="width: 600px"><section class="navigator-workbench__task dts-workbench-list">
    <div class="dts-workbench-list__scroll-x"><div class="dts-workbench-list__scroll-y"><div class="dts-parameter-workbench-table dts-parameter-workbench-table--surface-mvp">
    <div class="dts-parameter-workbench-table__head">Table header</div>${row.repeat(40)}</div></div></div>
    <div class="dts-workbench-list__h-rail"><div class="dts-workbench-list__h-rail-spacer"></div></div></section></div>`, ["src/components/layout/navigator-workbench.css"]);
  const scroll = page.locator(".dts-workbench-list__scroll-x");
  const moved = await scroll.evaluate((element) => { element.scrollLeft = 100; return element.scrollLeft; });
  expect(moved).toBeGreaterThan(0);
  expect((await bounds(page.locator(".dts-parameter-workbench-table"))).width).toBeGreaterThanOrEqual(680);
  for (const selector of [".dts-parameter-workbench-table__property-primary > strong", ".dts-parameter-workbench-table__property-secondary > code"]) {
    await expect(page.locator(selector).first()).toHaveCSS("text-overflow", "ellipsis");
    await expect(page.locator(selector).first()).toHaveCSS("white-space", "nowrap");
  }
  await expect(page.locator(".dts-parameter-workbench-table__head")).toHaveCSS("position", "sticky");
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator(".dts-parameter-workbench-table__head")).toBeHidden();
  await expectFits(page.locator(".dts-parameter-workbench-table"));
});

styleTest("configuration panes fill the routed wrapper and switch inspector between overlay and persistent placement", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main class="main-content" style="height: 700px"><div class="page-content"><div class="param-admin-shell param-admin-shell--configuration-workbench">
    <div class="project-admin-layout--configuration-workbench"><div class="configuration-workbench"><div class="navigator-workbench">
    <div class="configuration-workbench__toolbar-content"><div class="configuration-workbench__command"><button style="margin-left: auto">Run</button></div></div><div>Context</div><div class="navigator-workbench__body"><section class="navigator-workbench__navigator">Navigation</section>
    <section class="navigator-workbench__task"><div class="configuration-workbench__source"><pre class="configuration-workbench__code">${"source line\n".repeat(100)}</pre></div></section>
    </div></div><aside class="configuration-workbench__inspector">Inspector</aside></div></div></div></div></main>`, ["src/components/layout/navigator-workbench.css", "src/components/project-configuration-workbench/configuration-workbench.css"]);
  const workbench = page.locator(".configuration-workbench");
  const rect = await bounds(workbench);
  expect(rect.height).toBeGreaterThan(400);
  const command = await bounds(page.locator(".configuration-workbench__command"));
  expect((await bounds(page.getByRole("button", { name: "Run" }))).right).toBeCloseTo(command.right, 0);
  expect(rect.bottom).toBeLessThanOrEqual((await bounds(page.locator("main"))).bottom);
  const inspector = page.locator(".configuration-workbench__inspector");
  const overlay = await bounds(inspector);
  expect(overlay.width).toBeCloseTo(rect.width, 0);
  expect(overlay.height).toBeCloseTo(rect.height, 0);
  await expect(inspector).toHaveCSS("position", "absolute");
  await inspector.evaluate((element) => element.classList.add("is-persistent"));
  await expect(inspector).toHaveCSS("position", "relative");
  await expectFits(workbench);
});

styleTest("history and review diff surfaces bound long code without moving inspector actions over it", async ({ page, baseURL }) => {
  const code = "long-value ".repeat(60);
  const diff = `<div class="history-submission-diff submission-preview-diff">${`<div class="submission-preview-diff-row" data-kind="remove"><span class="submission-preview-diff-row__marker">−</span><code>${code}</code></div><div class="submission-preview-diff-row" data-kind="add"><span class="submission-preview-diff-row__marker">+</span><code>${code}</code></div>`.repeat(30)}</div>`;
  await renderFixture(page, baseURL, `<main class="parameter-review-page"><div class="submission-history-summary"><div class="metric-card">Summary<div class="metric-bar">Count</div></div></div>
    <div class="submission-history-layout"><section class="history-panel">History</section><section class="submission-round-detail"><div class="timeline submission-timeline">${Array.from({ length: 5 }, (_, index) => `<div><span>${index + 1}</span><small>Step</small></div>`).join("")}</div>
    <div class="history-diff-list"><article class="submission-diff-card submission-diff-card--history">${diff}</article></div></section></div>
    <div class="review-inbox"><section class="review-queue"><div class="review-table-wrap"><table><colgroup><col class="review-inbox__summary-column">${["type", "project", "module", "submitter", "time", "status"].map((name) => `<col class="review-inbox__${name}-column">`).join("")}</colgroup>
    <thead><tr><th><span class="review-column-filter-head">Name<button>Filter</button></span></th>${"<th>Metadata</th>".repeat(6)}</tr></thead>
    <tbody><tr><td><span class="review-inbox__summary">${code}</span></td>${`<td><span class="review-inbox__chip">${code}</span></td>`.repeat(6)}</tr></tbody></table></div></section>
    <section class="review-detail"><div class="canonical-project-value-review"><article><header class="review-inspector__header"><div class="review-inspector__actions"><button class="button">Approve</button><button class="button">Reject</button></div></header>
    <section aria-label="Before and after"><div class="canonical-project-value-review__diff"><div><p>Before</p><pre class="canonical-project-value-review__diff-text" tabindex="0">${`${code}\n`.repeat(40)}</pre></div></div></section></article></div></section></div>
    <div class="action-panel"><label class="review-merge-link">Merge link<input></label><button class="button">Confirm merge</button></div></main>`, ["src/features/parameter-review/parameter-review.css"]);
  expect((await bounds(page.locator(".metric-card"))).height).toBeGreaterThanOrEqual(96);
  expect((await bounds(page.locator(".metric-bar"))).height).toBe(4);
  const history = await bounds(page.locator(".history-panel"));
  const detail = await bounds(page.locator(".submission-round-detail"));
  expect(history.width).toBe(320);
  expect(detail.x).toBeGreaterThan(history.right);
  const steps = await page.locator(".submission-timeline > div").all();
  const timeline = page.locator(".submission-timeline");
  const gap = await timeline.evaluate((element) => parseFloat(getComputedStyle(element).columnGap));
  const trackWidth = ((await bounds(timeline)).width - gap * 4) / 5;
  for (const step of steps) expect((await bounds(step)).width).toBeCloseTo(trackWidth, 0);
  await expectFits(timeline);
  const preview = page.locator(".history-submission-diff");
  expect((await bounds(preview)).height).toBeLessThanOrEqual(300);
  await expectScrollable(preview);
  await preview.evaluate((element) => element.parentElement!.classList.add("submission-detail-dialog"));
  expect((await bounds(preview)).height).toBeLessThanOrEqual(340);
  await expectScrollable(preview);
  await expectFits(page.locator(".submission-round-detail"));
  await expectFits(page.locator(".submission-diff-card"));
  await expectFits(page.locator(".review-table-wrap"));
  await expect(page.locator(".review-inbox__summary")).toHaveCSS("text-overflow", "ellipsis");
  const table = await bounds(page.locator(".review-inbox table"));
  for (const [index, percentage] of [13, 16, 12, 15, 12, 11].entries()) {
    expect((await bounds(page.locator(".review-inbox th").nth(index + 1))).width).toBeCloseTo(table.width * percentage / 100, 0);
  }
  const actionPanel = page.locator("main > .action-panel");
  expect((await bounds(actionPanel.getByRole("button"))).y).toBeGreaterThanOrEqual((await bounds(actionPanel.locator("label"))).bottom);
  const actions = page.locator(".review-inspector__actions");
  const inspectorCode = page.locator(".canonical-project-value-review__diff-text");
  await expect(actions).toHaveCSS("position", "static");
  expect((await bounds(actions)).bottom).toBeLessThanOrEqual((await bounds(inspectorCode)).y + 2);
  const documentScroll = await page.evaluate(() => {
    window.scrollBy(0, 200);
    return window.scrollY;
  });
  expect(documentScroll).toBeGreaterThan(0);
  await inspectorCode.scrollIntoViewIfNeeded();
  expect((await bounds(actions)).bottom).toBeLessThanOrEqual((await bounds(inspectorCode)).y + 2);
  const codeRect = await bounds(inspectorCode);
  expect(await inspectorCode.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
    { x: codeRect.x + codeRect.width / 2, y: Math.max(codeRect.y, 0) + 20 })).toBe(true);
  await page.setViewportSize({ width: 900, height: 900 });
  expect((await bounds(page.locator(".submission-round-detail"))).y).toBeGreaterThan((await bounds(page.locator(".history-panel"))).bottom);
});

styleTest("overview templates keep the shell gutter and settings controls keep their compact geometry", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main style="width: 1000px"><section class="overview-page">Overview</section><section class="retired-notice">Moved</section>
    ${["organization-page", "user-permissions-page", "audit-center-page", "param-admin-shell", "platform-console-page"].map((className) => `<section class="${className}" data-page-root><div>Content</div></section>`).join("")}
    <section class="admin-list-page"><header class="user-permissions-toolbar admin-list-page__header"><div>Members</div><button class="button">Add user</button></header>
    <div class="admin-list-page__filters"><label class="admin-list-page__filter-field"><div class="search-field"><input class="search-field__input" aria-label="Search users"></div></label><select class="compact-filter-control"><option>All</option></select></div></section>
    <div class="user-permissions-approval-item"><div class="user-permissions-approval-user"><strong>${"Long member name ".repeat(30)}</strong></div><div class="user-permissions-approval-role-change">Role change</div><div class="user-permissions-approval-actions"><button class="button">Approve role</button></div></div>
    <div class="settings-form-page"><section class="settings-form-page__section"><h2>Settings</h2><p>Explanation</p></section></div></main>
    <aside class="user-permissions-role-tooltip" style="top: 20px; left: 1100px">${"<p>Role capability</p>".repeat(100)}</aside>`, ["src/components/layout/overview-page.css", "src/components/layout/admin-list-page.css", "src/components/layout/settings-form-page.css"]);
  const main = await bounds(page.locator("main"));
  for (const selector of [".overview-page", ".retired-notice"]) {
    const rect = await bounds(page.locator(selector));
    expect(rect.x).toBe(main.x);
    expect(rect.width).toBe(main.width);
  }
  for (const root of await page.locator("[data-page-root]").all()) {
    const outer = await bounds(root);
    const inner = await bounds(root.locator(":scope > div"));
    expect(inner.x).toBe(outer.x);
    expect(inner.right).toBe(outer.right);
  }
  const header = page.locator(".admin-list-page__header");
  expect((await bounds(header.getByRole("button"))).right).toBe((await bounds(header)).right);
  const compactHeight = await page.locator(".admin-list-page").evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue("--space-8")));
  const search = page.locator(".admin-list-page .search-field");
  expect((await bounds(search)).height).toBe(compactHeight);
  const searchContentHeight = await search.evaluate((element) => element.clientHeight);
  expect((await bounds(page.getByRole("textbox"))).height).toBe(searchContentHeight);
  expect((await bounds(page.getByRole("combobox"))).height).toBe(compactHeight);
  expect((await bounds(page.locator(".settings-form-page"))).width).toBeLessThanOrEqual(960);
  const tooltip = page.locator(".user-permissions-role-tooltip");
  expect((await bounds(tooltip)).height).toBeLessThanOrEqual(868);
  await expectScrollable(tooltip);
  await expect(page.locator(".user-permissions-approval-user strong")).toHaveCSS("text-overflow", "ellipsis");
  await page.setViewportSize({ width: 1100, height: 900 });
  const user = await bounds(page.locator(".user-permissions-approval-user"));
  expect((await bounds(page.getByRole("button", { name: "Approve role" }))).y).toBeGreaterThanOrEqual(user.y);
});

styleTest("risk tooltip is an overlay and button chrome survives permission, draft and user-management contexts", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="project-risk-bar-chart" style="position: relative; height: 120px"><p>Chart</p><div class="project-risk-tooltip">Risk tooltip</div></div>
    <div class="permission-denied-page"><button class="button primary permission-denied-action">Return</button></div><div class="parameter-draft-dialog"><button class="button subtle">Save draft</button><a class="parameter-draft-dialog__submit-link" href="#submit">Submit</a></div>
    <div class="user-permissions-page"><button class="button primary">Add member</button></div><label class="search-field"><input aria-label="Focus search"></label>`);
  const chart = await bounds(page.locator(".project-risk-bar-chart"));
  const tooltip = await bounds(page.locator(".project-risk-tooltip"));
  expect(tooltip.bottom).toBe(chart.bottom);
  expect(tooltip.right).toBe(chart.right);
  await expect(page.locator(".project-risk-tooltip")).toHaveCSS("position", "absolute");
  for (const button of await page.locator(".button").all()) {
    expect((await bounds(button)).height).toBeGreaterThanOrEqual(32);
    await expect(button).not.toHaveCSS("border-top-width", "0px");
    await expect(button).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await expect(page.locator(".parameter-draft-dialog__submit-link")).toHaveCSS("display", "inline-flex");
  await expect(page.locator(".parameter-draft-dialog__submit-link")).toHaveCSS("border-top-width", "1px");
  await page.getByRole("textbox").focus();
  await expect(page.locator(".search-field")).not.toHaveCSS("box-shadow", "none");
});

styleTest("homepage keeps a light foundation, compact headline and raised entry cards", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main class="linear-template-home"><div class="linear-page-gradient"></div><section class="linear-hero"><h1>WiseEff</h1></section>
    <article class="sub-app-card" style="width: 400px; --sub-app-accent: #075cd8"><div class="sub-app-card-icon">Icon</div><h2>Parameters</h2>
    <div class="sub-app-card-ctas"><a class="sub-app-card-primary">Open</a><a class="sub-app-card-secondary">Learn more</a></div></article>
    <section class="platform-flow-section">Workflow</section><footer class="linear-footer">Footer</footer></main>`, ["src/linear-template/linear-template.css"]);
  await expect(page.locator(".linear-template-home")).toHaveCSS("background-color", "rgb(251, 252, 255)");
  await expect(page.locator(".linear-page-gradient")).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator(".platform-flow-section")).toHaveCSS("background-color", "rgb(244, 247, 255)");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveCSS("font-size", "56px");
  await expect(title).toHaveCSS("letter-spacing", /^(normal|0px)$/);
  const card = page.locator(".sub-app-card");
  const before = await bounds(card);
  const beforeDocumentTop = before.y + await page.evaluate(() => window.scrollY);
  expect(before.height).toBeGreaterThanOrEqual(328);
  await expect(card).not.toHaveCSS("box-shadow", "none");
  await expect(page.locator(".sub-app-card-icon")).not.toHaveCSS("box-shadow", "none");
  await expect(page.locator(".sub-app-card-ctas")).toHaveCSS("border-top-width", "1px");
  expect((await bounds(page.locator(".sub-app-card-secondary"))).y).toBeGreaterThanOrEqual((await bounds(page.locator(".sub-app-card-primary"))).bottom);
  await expect(page.locator(".sub-app-card-secondary")).toHaveCSS("font-weight", "600");
  await card.hover();
  await expect.poll(() => card.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)).toBeCloseTo(beforeDocumentTop - 4, 0);
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(title).toHaveCSS("font-size", "36px");
});

styleTest("wizard project information stays two-column while source and scope use the full task width", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<section class="project-init-wizard" style="width: 1100px"><main class="project-init-main">
    <section class="project-init-step-panel project-init-step-panel--project"><aside>Information</aside><div class="project-init-form-card"><div class="project-init-form-card__fields"><label>Name<input></label><label>Description<input></label></div></div></section>
    <section class="project-init-step-panel project-init-step-panel--source"><div class="project-init-source-table-wrap"><table>${"<tr><td>Source project</td></tr>".repeat(50)}</table></div></section>
    <section class="project-init-step-panel project-init-step-panel--scope"><div>Scope table</div></section></main></section>`);
  const project = await bounds(page.locator(".project-init-step-panel--project"));
  const aside = await bounds(page.locator("aside"));
  const form = await bounds(page.locator(".project-init-form-card"));
  expect(form.x).toBeGreaterThan(aside.right);
  expect(project.height).toBeGreaterThanOrEqual(360);
  await expect(page.locator(".project-init-form-card")).toHaveCSS("border-top-width", "1px");
  await expect(page.locator(".project-init-form-card")).not.toHaveCSS("box-shadow", "none");
  const labels = page.locator("label");
  expect((await bounds(labels.nth(1))).y).toBeGreaterThan((await bounds(labels.first())).bottom);
  const sources = page.locator(".project-init-source-table-wrap");
  expect((await bounds(sources)).height).toBeLessThanOrEqual(260);
  await expectScrollable(sources);
  for (const step of ["source", "scope"]) {
    const panel = page.locator(`.project-init-step-panel--${step}`);
    expect((await bounds(panel.locator(":scope > div"))).width).toBeCloseTo((await bounds(panel)).width, 0);
  }
});

styleTest("shared button sizes, view switches, destructive menus and debugging search keep usable chrome", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<main><div>${["md", "sm", "lg"].map((size) => `<button class="button ${size === "md" ? "" : size}" data-legacy="${size}">Action</button><button class="button button-size-${size}" data-shared="${size}">Action</button>`).join("")}</div>
    <div class="debugging-page"><label class="search-field"><input aria-label="Debug search"></label></div>
    <div class="view-switch view-switch--toggle"><button class="view-switch__item">Table</button></div>
    <div class="row-action-menu"><div role="menuitem" class="row-action-menu__item" data-destructive>Delete</div></div></main>`, ["src/components/ui/view-switch.css", "src/components/common/row-action-menu.css"]);
  for (const [size, height] of [["md", 32], ["sm", 28], ["lg", 36]] as const) {
    const legacy = await bounds(page.locator(`[data-legacy="${size}"]`));
    const shared = await bounds(page.locator(`[data-shared="${size}"]`));
    expect(legacy.height).toBe(height);
    expect(shared.height).toBe(legacy.height);
    expect(shared.width).toBe(legacy.width);
  }
  const option = page.locator(".view-switch__item");
  await expect(option).toHaveCSS("box-shadow", "none");
  await expect(option).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".row-action-menu__item")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const search = page.locator(".search-field");
  expect((await bounds(search)).width).toBe(260);
  const desktopHeight = (await bounds(search)).height;
  await page.setViewportSize({ width: 900, height: 900 });
  expect((await bounds(search)).height).toBe(desktopHeight);
  expect((await bounds(search)).width).toBe((await bounds(page.locator(".debugging-page"))).width);
});

styleTest("shared library rows wrap long identities, retain selection and scroll inside their task pane", async ({ page, baseURL }) => {
  await renderFixture(page, baseURL, `<div class="debug-admin-shell" style="display: flex; flex-direction: column; height: 700px"><header>Administration</header><main class="param-admin-main">
    <div class="project-parameter-library-list" style="width: 600px">${Array.from({ length: 20 }, (_, index) => `<button data-slot="button" class="project-parameter-list-row ${index === 0 ? "selected" : ""}"><strong>${"long-parameter-identity/".repeat(20)}</strong><span>Open</span></button>`).join("")}</div></main></div>`);
  const list = page.locator(".project-parameter-library-list");
  expect((await bounds(list)).height).toBeLessThanOrEqual(520);
  const row = page.locator(".project-parameter-list-row").first();
  expect((await bounds(row)).height).toBeGreaterThanOrEqual(68);
  await expect(row).toHaveCSS("transition-duration", "0s");
  await expect(row).toHaveCSS("background-color", "rgb(238, 244, 255)");
  await expectFits(row.locator("strong"));
  expect((await bounds(row.locator("span"))).x).toBeGreaterThan((await bounds(row.locator("strong"))).x);
  await expectScrollable(list);
  const shell = await bounds(page.locator(".debug-admin-shell"));
  expect((await bounds(page.locator(".param-admin-main"))).bottom).toBeLessThanOrEqual(shell.bottom);
});

styleTest("sidebar feedback stays bottom-aligned and the existing compact drawer can reveal navigation", async ({ page }) => {
  const blockedRequests = await installConsistencyReadGuard(page.context());
  await page.route("**/api/v1/agent/xiaoze/suggest", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.addInitScript(() => localStorage.setItem("wiseeff.sidebar.collapsed", "false"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await test.step("quality:navigation", () => signInBrowserAsRole(page, "software-committer", "/parameters?project=aurora"));
  await test.step("quality:readiness", () => expectUsablePage(page));
  await prepareInteractionSurface(page);
  await waitForFontsAndNextPaint(page);
  const sidebar = page.getByRole("complementary", { name: "主导航侧边栏" });
  const feedback = sidebar.getByRole("button", { name: "问题反馈" });
  await expect(sidebar).toHaveClass(/sidebar-expanded/);
  const navigation = sidebar.getByRole("navigation", { name: "主导航" });
  expect((await bounds(feedback)).y).toBeGreaterThanOrEqual((await bounds(sidebar.locator(".nav-scroll"))).bottom);
  const bottomInset = await sidebar.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect((await bounds(sidebar.locator(".utility-nav"))).bottom).toBeCloseTo((await bounds(sidebar)).bottom - bottomInset, 0);
  await expect(feedback).toHaveCSS("align-items", "flex-start");
  await sidebar.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".utility-nav")).toHaveCSS("display", "block");
  await expect(feedback).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  expect((await bounds(page.getByRole("button", { name: "打开用户菜单" }))).width).toBe(38);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(sidebar).toBeHidden();
  const openDrawer = page.getByRole("button", { name: "打开导航菜单" });
  await expect(openDrawer).toHaveAttribute("aria-expanded", "false");
  await openDrawer.click();
  await expect(page.locator(".topbar").getByRole("button", { name: "关闭导航菜单" })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toBeVisible();
  await expect.poll(async () => (await bounds(sidebar)).x).toBeCloseTo(0, 0);
  expect((await bounds(sidebar)).width).toBe(280);
  const parameterPage = navigation.getByRole("button", { name: "参数修改", exact: true });
  await expect(parameterPage).toBeInViewport();
  await parameterPage.click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("button", { name: "打开导航菜单" })).toHaveAttribute("aria-expanded", "false");
  expect(blockedRequests).toEqual([]);
});
