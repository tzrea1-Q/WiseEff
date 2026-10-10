import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  await seedAcceptanceRoleMatrix();
});

test("Platform-only identity redirect explains Organization permission without loading Review Queue", async ({ page }, testInfo) => {
  const queueRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/parameter-review-items")) queueRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInBrowserAsRole(page, "platform-admin", "/parameter-admin/specs/identity-mapping");
  await expect(page).toHaveURL(/\/parameter-admin\/specs\?review=open$/);
  await expect(page.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", "ready");
  await expect(page.getByText("组织审核队列需要 Organization 权限；Platform 权限不能代替组织审核权限。"))
    .toBeVisible();
  await expect(page.getByRole("button", { name: /待处理工作/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "待处理工作" })).toHaveCount(0);
  await expect(page.getByText(/审核队列加载失败/)).toHaveCount(0);
  expect(queueRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  const refused = await page.request.get(apiRoute("/api/v2/organizations/org-chargelab/parameter-review-items"), {
    headers: authHeadersForRole("platform-admin")
  });
  expect(refused.status()).toBe(403);
  await page.screenshot({ path: testInfo.outputPath("platform-only-explanation.png"), fullPage: true });
});

test("Organization admin keeps the Review Queue after the identity redirect", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const loaded = page.waitForResponse((response) => response.url().includes("/parameter-review-items")
    && response.request().method() === "GET" && response.status() === 200);
  const admin = acceptanceCast.acceptanceAdmin;
  await signInBrowserAsUser(page, admin.userId, admin.email, admin.name, "/parameter-admin/specs/identity-mapping");
  await expect(page).toHaveURL(/\/parameter-admin\/specs\?review=open$/);
  const dialog = page.getByRole("dialog", { name: "待处理工作" });
  await expect(dialog.getByRole("region", { name: "待审核事项" })).toBeVisible();
  await loaded;
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(page.getByText(/审核队列加载失败/)).toHaveCount(0);
  await expect(page.getByText(/Platform 权限不能代替组织审核权限/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: /待处理工作/ }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("organization-review-queue.png"), fullPage: true });
});
