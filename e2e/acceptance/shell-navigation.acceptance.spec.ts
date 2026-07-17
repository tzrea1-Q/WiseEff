import { expect, test, type Page, type TestInfo } from "playwright/test";
import { signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

// @acceptance SHELL-DIAG-001
// @operation SHELL-DIAG-001
useBrowserDiagnostics(test, {
  expectedApiFailures: [
    { method: "POST", path: "/api/v1/debugging/targets/detect", status: 409 }
  ]
});

const routes = [
  "/",
  "/parameter-home",
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
    });
  }
});
