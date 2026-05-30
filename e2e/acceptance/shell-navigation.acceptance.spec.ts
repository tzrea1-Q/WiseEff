import { expect, test, type Page, type TestInfo } from "playwright/test";

const routes = [
  "/",
  "/parameters",
  "/parameter-review",
  "/parameter-admin",
  "/logs",
  "/log-admin",
  "/debugging",
  "/node-debugging",
  "/debugging-admin",
  "/user-permissions"
] as const;

async function expectUsableShell(page: Page, testInfo: TestInfo, route: string) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("main, .main-content").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Application error|Cannot read properties|ReferenceError|TypeError|Unhandled Runtime Error|vite\/client|failed to fetch/i
  );

  if (route === "/") {
    await testInfo.attach("shell-home", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png"
    });
  }
}

test.describe("M5.4 manual flow A - shell navigation", () => {
  for (const route of routes) {
    test(`loads ${route} without a runtime crash`, async ({ page }, testInfo) => {
      await page.goto(route);
      await expectUsableShell(page, testInfo, route);
    });
  }
});
