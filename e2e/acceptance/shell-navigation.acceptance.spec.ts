import { expect, test, type Page, type TestInfo } from "playwright/test";
import { signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";

// @acceptance SHELL-DIAG-001
// @operation SHELL-DIAG-001
// @acceptance SHELL-FOOTER-001
// @operation SHELL-FOOTER-001
useBrowserDiagnostics(test, {
  expectedApiFailures: [
    { method: "POST", path: "/api/v1/debugging/targets/detect", status: 409 },
    { method: "GET", path: "/api/v2/organizations/org-chargelab/parameter-review-items", status: 403 },
    { method: "GET", path: "/api/v2/organizations/org-chargelab/parameter-review-items", status: 410 },
    { method: "GET", path: "/api/v2/catalog/legacy-identifiers/project-parameter-binding/unknown-shell-1075", status: 404 }
  ]
});

const routes = [
  "/",
  "/parameter-home",
  "/parameters",
  "/parameter-submissions",
  "/parameter-comparison",
  "/parameter-review",
  "/parameter-admin",
  "/parameter-admin/projects",
  "/parameter-admin/specs/identity-mapping",
  "/log-admin?tab=records",
  "/logs",
  "/log-admin",
  "/knowledge",
  "/knowledge-admin",
  "/debugging",
  "/node-debugging",
  "/dts-reload",
  "/debugging-admin",
  "/debugging-admin/nodes",
  "/organization",
  "/organization/members",
  "/feedback-admin",
  "/audit",
  "/parameter-admin/projects/footer-acceptance/configuration"
] as const;

async function expectUsableShell(page: Page, testInfo: TestInfo, route: string) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("main, .main-content").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Application error|Cannot read properties|ReferenceError|TypeError|Unhandled Runtime Error|vite\/client|failed to fetch/i
  );

  if (route === "/") {
    const home = page.getByRole("main", { name: "雷泽首页" });
    await expect(home.getByRole("heading", { name: "一条可审阅工作流，四种场景接入" })).toBeVisible();
    await expect(home.getByRole("link", { name: /进入知识库/ })).toHaveAttribute("href", "/knowledge");
    await expect(home.getByRole("tab", { name: "知识库", exact: true })).toBeVisible();
    await expect(home.getByText("上传并整理组织自己的调参经验、故障案例、硬件手册与流程规范。")).toBeVisible();
    await expect(page.locator('.linear-nav a[href="/knowledge"]')).toBeVisible();
    await expect(page.locator('.linear-footer a[href="/knowledge"]')).toBeVisible();
    await expect(home.getByRole("link", { name: /进入日志分析/ })).toHaveAttribute("href", "/logs");
    await expect(home.getByRole("tab", { name: "日志分析" })).toBeVisible();
    await expect(page.locator("footer.linear-footer")).toHaveCount(1);
    await expect(page.locator("footer.app-footer")).toHaveCount(0);
    await expect(page.locator("footer.linear-footer .app-footer")).toContainText("版本 v");
    await testInfo.attach("shell-home", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png"
    });
  } else if (route.endsWith("/configuration")) {
    await expect(page.locator('footer[aria-label="页脚信息"]')).toHaveCount(0);
  } else if (["/parameter-review", "/parameter-submissions"].includes(route)) {
    await expect(page.locator('footer[aria-label="页脚信息"]')).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "主导航侧边栏" })
      .getByRole("button", { name: "问题反馈", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /打开用户菜单$/ }).click();
    const menu = page.locator(".topbar-user-menu");
    await expect(menu).toContainText("©");
    await expect(menu).toContainText("版本 v");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  } else {
    const footer = page.locator('footer[aria-label="页脚信息"]');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("©");
    await expect(footer).toContainText("版本 v");
    await expect(footer.getByRole("button", { name: "问题反馈" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "联系我们" })).toHaveCount(0);

    if (route === "/parameter-home") {
      await footer.getByRole("button", { name: "问题反馈" }).click();
      const dialog = page.getByRole("dialog", { name: "问题反馈" });
      await expect(dialog).toContainText("/parameter-home");
      await dialog.getByRole("button", { name: "关闭" }).last().click();
    }
  }
}

test.describe("M5.4 manual flow A - shell navigation", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("contains unavailable historical reads while showing current canonical parameters", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const historicalReads: string[] = [];
    await page.route(/\/api\/v1\/parameters\?/, async (route) => {
      historicalReads.push(route.request().url());
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL_ERROR","message":"Historical read unavailable"}}' });
    });
    const route = "/parameters?project=aurora&parameter=unknown-shell-1075";
    const canonicalRead = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v2/projects/aurora/parameter-bindings"
      && response.request().method() === "GET"
    );
    await signInBrowserAsRole(page, "admin", route);
    const response = await canonicalRead;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item: { id: string }) => item.id.startsWith("pbind_"))).toBe(true);
    await expect(page.getByText("旧参数链接仅供历史参考")).toBeVisible();
    await expect(page.getByText(/不会按名称猜测或载入旧参数数据/)).toBeVisible();
    await expect(page.locator(".api-runtime-error-banner")).toHaveCount(0);
    await expect(page.getByLabel("DTS 参数工作台")).toBeVisible();
    await expect(page.getByRole("table", { name: "DTS 参数列表" })).toBeVisible();
    await expect(page.getByRole("table", { name: "DTS 参数列表" }).getByRole("row").filter({ hasText: "gpio_int" }).first()).toBeVisible();
    expect(historicalReads).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await expectUsableShell(page, testInfo, "/parameters");
    await recordOperationEvidence({
      operationId: "SHELL-DIAG-001", title: "canonical shell with unavailable historical read",
      status: "passed", role: "Admin", route, assertions: ["ui"], page, testInfo,
      notes: "Current canonical Bindings remain visible; no historical semantic list is requested; unresolved old links are visibly historical."
    });
    await testInfo.attach("shell-canonical-historical-notice-1075", {
      body: await page.screenshot({ fullPage: true }), contentType: "image/png"
    });
  });

  for (const route of routes) {
    test(
      `loads ${route} without a runtime crash`,
      { tag: route === "/" ? ["@ci-smoke"] : [] },
      async ({ page }, testInfo) => {
        await signInBrowserAsRole(page, "admin", route);
        await expectUsableShell(page, testInfo, route);
        if (route !== "/") {
          const sidebar = page.getByRole("complementary", { name: "主导航侧边栏" });
          const logGroup = sidebar.locator(".nav-group").filter({ has: page.locator(".nav-group-label", { hasText: /^日志分析$/ }) });
          await expect(logGroup.getByRole("button")).toHaveText(["智能分析", "日志后台"]);
          const knowledgeGroup = sidebar.locator(".nav-group").filter({ has: page.locator(".nav-group-label", { hasText: /^知识库$/ }) });
          await expect(knowledgeGroup.getByRole("button")).toHaveText(["知识库", "知识后台"]);
        }

        await recordOperationEvidence({
          operationId: "SHELL-DIAG-001",
          title: `shell route ${route === "/" ? "home" : route.slice(1).replace(/\//g, "-")}`,
          status: "passed",
          page,
          testInfo,
          notes: `Route ${route} loaded without visible runtime crash or browser diagnostic failures.`
        });
        await recordOperationEvidence({
          operationId: "SHELL-FOOTER-001",
          title: `footer route ${route === "/" ? "home" : route.slice(1).replace(/\//g, "-")}`,
          status: "passed",
          role: "Admin",
          route,
          page,
          testInfo,
          notes: route === "/"
            ? "The rich homepage footer contains one metadata row without a nested footer landmark."
            : route.endsWith("/configuration")
              ? "The full-height project configuration workbench remains free of the compact footer."
              : ["/parameter-review", "/parameter-submissions"].includes(route)
                ? "Review workspaces keep metadata in the user menu and feedback in the sidebar without a compact footer."
              : "The normal shell route ends with one compact footer and a current-page feedback trigger."
        });
      }
    );
  }

  test("offers log and knowledge workflows without administration to hardware users", async ({ page }) => {
    await signInBrowserAsRole(page, "hardware-user", "/parameter-home");
    const sidebar = page.getByRole("complementary", { name: "主导航侧边栏" });
    await expect(sidebar.getByRole("button", { name: "智能分析", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "日志后台", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "知识库", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "知识后台", exact: true })).toHaveCount(0);
    await sidebar.getByRole("button", { name: "智能分析", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/logs");
    await sidebar.getByRole("button", { name: "知识库", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/knowledge");
    await expect(page.getByRole("table", { name: "知识条目列表" })).toBeVisible();
  });

  test("keeps the compact footer around a permission-denied result", async ({ page }, testInfo) => {
    await signInBrowserAsRole(page, "guest", "/log-admin");

    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    const sidebar = page.getByRole("complementary", { name: "主导航侧边栏" });
    await expect(sidebar.getByRole("button", { name: "智能分析", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "日志后台", exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "知识库", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "知识后台", exact: true })).toHaveCount(0);
    await expectUsableShell(page, testInfo, "/log-admin");
    await recordOperationEvidence({
      operationId: "SHELL-FOOTER-001",
      title: "footer permission denied",
      status: "passed",
      role: "Guest",
      route: "/log-admin",
      page,
      testInfo,
      notes: "A permission-denied result still ends inside the normal shell footer boundary."
    });
  });

  test("redirects the legacy log dashboard bookmark to the back-office overview", async ({ page }, testInfo) => {
    await signInBrowserAsRole(page, "admin", "/log-dashboard");
    await expect(page).toHaveURL((url) => url.pathname === "/log-admin" && !url.searchParams.has("tab"));
    await expect(page.getByRole("tab", { name: "概览", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("log-admin-overview")).toBeVisible();
    await expectUsableShell(page, testInfo, "/log-admin");
  });
});
