import { expect, test, type Page, type Request } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 }, trace: "off", screenshot: "off", video: "off" });
useBrowserDiagnostics(test);

function readKind(path: string) {
  if (path === "/api/v2/catalog") return "catalog";
  if (path === "/api/v2/catalog/subjects") return "subjects";
  if (path === "/api/v2/catalog/definitions") return "definitions";
  if (path.endsWith("/subject-registrations")) return "registrations";
  if (path === "/api/v2/catalog/publication-surface") return "publication-surface";
  if (path.includes("/publication-jobs/")) return "publication-job";
  if (path.endsWith("/driver-compatible-discovery")) return "discovery";
  if (path === "/api/v2/parameter-modules/driver-registry") return "driver-registry";
  if (path === "/api/v2/parameter-modules") return "module-registry";
  if (path.startsWith("/api/v1/parameter-modules/")) return "module";
}

async function switchAwayAndBack(page: Page, headed: boolean) {
  if (!headed) {
    // Chromium's headless shell treats every page as focused.
    await page.evaluate(() => {
      window.dispatchEvent(new FocusEvent("blur"));
      window.dispatchEvent(new FocusEvent("focus"));
    });
    return;
  }
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  const other = await page.context().newPage();
  const otherSession = await page.context().newCDPSession(other);
  await otherSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await other.close();
  await session.detach();
}

test("module governance stays in place while idle and on focus, and refreshes after an edit or on demand", async ({ page, request }, info) => {
  let phase = "initial";
  const headed = info.project.use.headless === false;
  const cursors = new Map<string, number>();
  const responses: { phase: string; method: string; kind: string; lifecycle: string; cursor: number; status?: number }[] = [];
  const byRequest = new Map<Request, typeof responses[number]>();
  page.on("request", request => {
    const url = new URL(request.url());
    const kind = request.resourceType() === "document" && url.pathname === "/parameter-admin/modules"
      ? "document" : readKind(url.pathname);
    if (!kind) return;
    const cursor = url.searchParams.get("cursor");
    if (cursor && !cursors.has(cursor)) cursors.set(cursor, cursors.size + 1);
    const entry = { phase, method: request.method(), kind, lifecycle: url.searchParams.get("lifecycle") ?? "default", cursor: cursor ? cursors.get(cursor)! : 0 };
    byRequest.set(request, entry);
    responses.push(entry);
  });
  page.on("response", response => {
    const entry = byRequest.get(response.request());
    if (entry) entry.status = response.status();
  });
  await page.addInitScript(() => {
    const events = { focus: 0, blur: 0, trustedFocus: 0, loading: 0 };
    Object.assign(window, { moduleRefreshEvents: events });
    window.addEventListener("focus", event => { events.focus++; if (event.isTrusted) events.trustedFocus++; });
    window.addEventListener("blur", () => { events.blur++; });
    let loading = false;
    new MutationObserver(() => {
      const next = !!document.querySelector("#canonical-subject-placement")?.textContent?.includes("正在加载规范主体…");
      if (next && !loading) events.loading++;
      loading = next;
    }).observe(document, { childList: true, subtree: true });
  });
  const events = () => page.evaluate(() => (window as typeof window & {
    moduleRefreshEvents: { focus: number; blur: number; trustedFocus: number; loading: number }
  }).moduleRefreshEvents);
  const observations: Record<string, Awaited<ReturnType<typeof events>>> = {};
  const reads = (step: string, kind?: string) => responses.filter(item =>
    item.phase === step && item.method === "GET" && (!kind || item.kind === kind));
  const catalog = page.getByRole("region", { name: "规范主体归属" });
  const ready = () => expect(catalog).toContainText(/\d+ 个有效主体/);
  const route = "/parameter-admin/modules?moduleId=pmod-seed-13e6ce04391cd558&subjectQ=direct_charger";
  const filter = page.getByRole("searchbox", { name: "筛选规范主体" });
  const row = catalog.getByRole("listitem").filter({ hasText: "huawei,direct_charger" }).first();
  const refresh = page.getByRole("button", { name: "刷新规范数据", exact: true });
  const editTrigger = page.getByRole("button", { name: "修改模块 Direct Charging", exact: true });

  let restore: { path: string; description: string } | undefined;
  await page.bringToFront();
  try {
    await signInBrowserAsRole(page, "admin", route);
    await ready();
    await expect(row).toBeVisible();
    observations.initial = await events();
    expect(reads("initial", "document")).toHaveLength(1);
    expect(reads("initial", "subjects").map(item => item.lifecycle).sort()).toEqual(["default", "retired"]);
    for (const kind of ["catalog", "module-registry", "driver-registry", "registrations", "publication-surface"]) {
      expect(reads("initial", kind)).toHaveLength(1);
    }

    phase = "idle";
    // Observe a settled, task-free page across multiple publication polling periods.
    await page.waitForTimeout(3_200);
    observations.idle = await events();
    expect.soft(reads(phase)).toHaveLength(0);
    expect.soft(observations.idle.loading).toBe(observations.initial.loading);

    phase = "expand";
    await row.getByRole("button", { name: "查看参数", exact: true }).click();
    await expect(row.getByRole("region", { name: "huawei,direct_charger 的有效参数" }).getByText("resist_para", { exact: true })).toBeVisible();
    const selectedUrl = page.url();
    observations.expand = await events();

    phase = "refocus";
    await switchAwayAndBack(page, headed);
    await page.waitForTimeout(650);
    observations.refocus = await events();
    expect(observations.refocus.focus).toBeGreaterThan(observations.expand.focus);
    expect(observations.refocus.blur).toBeGreaterThan(observations.expand.blur);
    if (headed) expect(observations.refocus.trustedFocus).toBeGreaterThan(observations.expand.trustedFocus);
    expect.soft(reads(phase)).toHaveLength(0);
    expect.soft(observations.refocus.loading).toBe(observations.expand.loading);
    await ready();
    await expect(page).toHaveURL(selectedUrl);
    await expect(filter).toHaveValue("direct_charger");
    await expect(row.getByRole("button", { name: "收起参数", exact: true })).toBeVisible();

    phase = "open-edit";
    await editTrigger.click();
    const edit = page.getByRole("dialog", { name: "Direct Charging", exact: true });
    const description = edit.getByRole("textbox", { name: "模块展示描述" });
    const originalDescription = await description.inputValue();
    const updated = `Refresh ordering acceptance ${Date.now()}`;
    await description.fill(updated);
    observations["open-edit"] = await events();
    expect.soft(reads(phase)).toHaveLength(0);

    phase = "refocus-draft";
    await switchAwayAndBack(page, headed);
    await page.waitForTimeout(650);
    observations["refocus-draft"] = await events();
    await expect(description).toHaveValue(updated);
    expect.soft(reads(phase)).toHaveLength(0);
    expect.soft(observations["refocus-draft"].loading).toBe(observations["open-edit"].loading);

    phase = "submit";
    const saved = page.waitForResponse(response => response.request().method() === "PATCH"
      && readKind(new URL(response.url()).pathname) === "module");
    const refreshed = page.waitForResponse(response => response.request().method() === "GET"
      && readKind(new URL(response.url()).pathname) === "registrations");
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    restore = { path: new URL(response.url()).pathname, description: originalDescription };
    expect((await refreshed).ok()).toBe(true);
    await expect(edit).toBeHidden();
    await expect(page.getByText(updated, { exact: true })).toBeVisible();
    await expect(refresh).toBeEnabled();
    await ready();
    observations.submit = await events();
    expect.soft(observations.submit.loading).toBe(observations["refocus-draft"].loading);

    phase = "on-demand";
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await ready();
    await expect(page.getByText(updated, { exact: true })).toBeVisible();
    expect(reads(phase, "catalog")).toHaveLength(1);
    expect(reads(phase, "document")).toHaveLength(0);
    observations["on-demand"] = await events();
    expect.soft(observations["on-demand"].loading).toBe(observations.submit.loading);
    await expect(page).toHaveURL(selectedUrl);
    await expect(filter).toHaveValue("direct_charger");
    await expect(row.getByRole("button", { name: "收起参数", exact: true })).toBeVisible();

    phase = "browser-reload";
    await page.reload();
    await ready();
    await expect(page.getByText(updated, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(selectedUrl);
    await expect(row.getByRole("button", { name: "收起参数", exact: true })).toBeVisible();
    expect(reads(phase, "document")).toHaveLength(1);
    observations["browser-reload"] = await events();
  } finally {
    await info.attach("module-refresh-observations", {
      body: JSON.stringify({ observations, responses }, null, 2),
      contentType: "application/json"
    });
    if (restore) {
      const restored = await request.patch(apiRoute(restore.path), {
        headers: authHeadersForRole("admin"), data: { description: restore.description }
      });
      expect(restored.ok()).toBe(true);
    }
  }
});

test("keeps a scrolled subject list in place and scopes refreshes to the active module view", async ({ page }, info) => {
  await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
  const catalog = page.getByRole("region", { name: "规范主体归属" });
  await expect(catalog).toContainText(/\d+ 个有效主体/);
  const task = page.locator('[data-workbench-page="module-governance"] .navigator-workbench__task');
  const refresh = catalog.getByRole("button", { name: "刷新规范数据" });
  await refresh.evaluate(button => button.focus({ preventScroll: true }));
  const scroll = await task.evaluate(node => { node.scrollTop = 100; return node.scrollTop; });
  expect(scroll).toBeGreaterThan(0);
  const refreshed = page.waitForResponse(response => readKind(new URL(response.url()).pathname) === "registrations");
  await page.keyboard.press("Enter");
  expect((await refreshed).ok()).toBe(true);
  await expect(refresh).toBeEnabled();
  expect(await task.evaluate(node => node.scrollTop)).toBe(scroll);

  for (const [tab, refreshLabel, kind] of [
    ["来源识别", "刷新发现", "discovery"],
    ["历史注册表", "刷新历史注册表", "driver-registry"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const button = page.getByRole("button", { name: refreshLabel, exact: true });
    await expect(button).toBeEnabled();
    const reads: string[] = [];
    const recordRequest = (request: Request) => {
      const read = readKind(new URL(request.url()).pathname);
      if (read && request.method() === "GET") reads.push(read);
    };
    page.on("request", recordRequest);
    await switchAwayAndBack(page, info.project.use.headless === false);
    const fetched = page.waitForResponse(response => readKind(new URL(response.url()).pathname) === kind);
    await button.click();
    expect((await fetched).ok()).toBe(true);
    await expect(button).toBeEnabled();
    page.off("request", recordRequest);
    expect(reads).toEqual([kind]);
  }
});
