import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/parameters/admin/projects", status: 503 }] });
test.use({ viewport: { width: 1440, height: 900 } });
const adminHeaders = () => authHeadersForRole("admin");

test("previews canonical project deletion read-only, retries failures and refreshes by keyboard at PC 1440x900", async ({ page, request }, testInfo) => {
    await seedAcceptanceRoleMatrix();
    const list = await request.get(apiRoute("/api/v1/parameters/admin/projects"), { headers: adminHeaders() });
    expect(list.status()).toBe(200);
    const project = (await list.json()).items.find((item: { canonicalOwned: boolean }) => item.canonicalOwned);
    expect(project).toBeTruthy();
    const target = `/api/v1/parameters/admin/projects/${encodeURIComponent(project.id)}/deletion-preview`;
    const writes: string[] = [];
    page.on("request", (browserRequest) => {
      if (browserRequest.url().includes(`/parameters/admin/projects/${project.id}`) && browserRequest.method() !== "GET") writes.push(browserRequest.method());
    });
    await signInBrowserAsRole(page, "admin", `/parameter-admin/projects?q=${encodeURIComponent(project.name)}`);
    const dismiss = page.getByRole("button", { name: "不再提示" });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click({ force: true });
    const row = page.getByRole("row").filter({ hasText: project.name }).first();
    await row.getByRole("button", { name: `${project.name}操作：更多`, exact: true }).click();
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**${target}`, async (route) => { await hold; await route.continue(); }, { times: 1 });
    await page.getByRole("menuitem", { name: `删除影响预览 ${project.name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /项目删除影响预览/ });
    await expect(dialog.getByRole("status")).toContainText("正在检查");
    release();
    await expect(dialog.getByRole("region", { name: "项目专属数据：计划清理" })).toBeVisible();
    await expect(dialog).toContainText("平台共享参数定义");
    await expect(dialog).toContainText("共享保留");
    await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toHaveCount(0);
    await page.route(`**${target}`, (route) => route.fulfill({ status: 503,
      contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "预览服务暂时不可用" } }) }), { times: 1 });
    await dialog.getByRole("button", { name: "刷新预览" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "重试预览" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("region", { name: "项目专属数据：计划清理" })).toBeVisible();
    expect(writes).toEqual([]);
    const screenshot = testInfo.outputPath("project-deletion-preview-1440.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("project-deletion-preview-1440", { path: screenshot, contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const detail = await request.get(apiRoute(`/api/v1/parameters/admin/projects/${encodeURIComponent(project.id)}`), { headers: adminHeaders() });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).item).toMatchObject({ id: project.id, canonicalOwned: true, parameterCount: project.parameterCount });
  });
