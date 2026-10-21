import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/parameters/admin/projects", status: 503 }] });

test("confirms project purge by keyboard, retries a failed request and reloads honest cleanup status without affecting another project", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin");
  const projects = await request.get(apiRoute("/api/v1/parameters/admin/projects"), { headers });
  expect(projects.status()).toBe(200);
  const retained = (await projects.json()).items[0];
  expect(retained).toBeTruthy();
  const id = `purge-browser-${Date.now().toString(36)}`;
  const created = await request.post(apiRoute("/api/v1/parameters/admin/projects"), { headers,
    data: { id, name: id, code: `PG${Date.now().toString(36).toUpperCase()}` } });
  expect(created.status(), await created.text()).toBe(201);
  const upload = await request.post(apiRoute(`/api/v1/projects/${id}/parameter-files`), { headers,
    data: { fileName: "disposable-settings.json", contentBase64: Buffer.from('{"limit":73}').toString("base64") } });
  expect(upload.status(), await upload.text()).toBe(201);
  await signInBrowserAsRole(page, "admin", `/parameter-admin/projects?q=${id}`);
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click({ force: true });
  const row = page.getByRole("row").filter({ hasText: id }).first();
  await row.getByRole("button", { name: `${id}操作：更多`, exact: true }).click();
  await page.getByRole("menuitem", { name: `删除影响预览 ${id}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /项目删除影响预览/ });
  await expect(dialog.getByText("项目源文件", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认彻底删除" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /我确认永久删除/ }).focus();
  await page.keyboard.press("Space");
  const purgePath = `/api/v1/parameters/admin/projects/${id}/purge`;
  await page.route(`**${purgePath}`, route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "清理服务暂时不可用" } }) }), { times: 1 });
  const confirm = dialog.getByRole("button", { name: "确认彻底删除" });
  await confirm.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toBeChecked();
  await confirm.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("数据库清理：已完成");
  await expect(dialog.getByRole("status")).toContainText("项目彻底删除已完成");
  const screenshot = testInfo.outputPath("project-purge-result-1440.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("project-purge-result-1440", { path: screenshot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: `查看清理状态 ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("项目彻底删除已完成");
  const status = await request.get(apiRoute(`/api/v1/parameters/admin/projects/${id}/deletion-status`), { headers });
  expect(status.status()).toBe(200);
  expect((await status.json()).item).toMatchObject({ database: "deleted", objects: "complete", pendingObjects: 0 });
  const after = await request.get(apiRoute(`/api/v1/parameters/admin/projects/${retained.id}`), { headers });
  expect(after.status()).toBe(200);
  expect((await after.json()).item).toMatchObject({ id: retained.id, parameterCount: retained.parameterCount });
});
