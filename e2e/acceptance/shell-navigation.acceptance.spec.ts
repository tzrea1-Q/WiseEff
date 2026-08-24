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
    { method: "POST", path: "/api/v1/debugging/targets/detect", status: 409 }
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
  "/log-dashboard",
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
  "/platform-console",
  "/parameter-admin/projects/footer-acceptance/configuration"
] as const;

async function expectUsableShell(page: Page, testInfo: TestInfo, route: string) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("main, .main-content").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Application error|Cannot read properties|ReferenceError|TypeError|Unhandled Runtime Error|vite\/client|failed to fetch/i
  );

  if (route === "/") {
    await expect(page.locator("footer.linear-footer")).toHaveCount(1);
    await expect(page.locator("footer.app-footer")).toHaveCount(0);
    await expect(page.locator("footer.linear-footer .app-footer")).toContainText("版本 v");
    await testInfo.attach("shell-home", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png"
    });
  } else if (route.endsWith("/configuration")) {
    await expect(page.locator('footer[aria-label="页脚信息"]')).toHaveCount(0);
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

  for (const route of routes) {
    test(
      `loads ${route} without a runtime crash`,
      { tag: route === "/" ? ["@ci-smoke"] : [] },
      async ({ page }, testInfo) => {
        await signInBrowserAsRole(page, "admin", route);
        await expectUsableShell(page, testInfo, route);

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
              : "The normal shell route ends with one compact footer and a current-page feedback trigger."
        });
      }
    );
  }

  test("keeps the compact footer around a permission-denied result", async ({ page }, testInfo) => {
    await signInBrowserAsRole(page, "guest", "/log-admin");

    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
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
});
