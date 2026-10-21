import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import type { LogDeletionPreview } from "../../src/domain/logs/deletionPreview";

useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/logs", status: 500 }] });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(seedAcceptanceRoleMatrix);

test("administrator inspects a real log's deletion scope, empty retention and failure recovery with the keyboard", async ({ page }, testInfo) => {
  const fileName = `preview-${randomUUID()}.log`;
  const upload = await page.request.post(apiRoute("/api/v1/log-files"), { headers: authHeadersForRole("admin"),
    data: { fileName, contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("2026-10-20 INFO deletion scope preview\n").toString("base64") } });
  expect(upload.status()).toBe(201);
  const { log } = await upload.json() as { log: { id: string } };
  const path = `/api/v1/logs/${log.id}/deletion-preview`;
  const actual = await page.request.get(apiRoute(path), { headers: authHeadersForRole("admin") });
  expect(actual.status()).toBe(200);
  const { item } = await actual.json() as { item: LogDeletionPreview };
  expect(item.inventory.find((entry) => entry.key === "records")?.count).toBe(1);
  expect(item.inventory.filter((entry) => entry.disposition === "retain").every((entry) => entry.count === 0)).toBe(true);

  await signInBrowserAsRole(page, "admin", "/log-admin?tab=records");
  await page.getByRole("searchbox", { name: "搜索日志分析记录" }).fill(fileName);
  const trigger = page.getByRole("row").filter({ hasText: fileName }).getByRole("button", { name: "删除影响预览" });
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let holdFirst = true, failOnce = false;
  await page.route(`**${path}`, async (route) => {
    if (holdFirst) { holdFirst = false; await pending; }
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "范围暂不可用" } }) });
    } else await route.continue();
  });
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "日志删除影响预览" });
  await expect(dialog.getByRole("status")).toHaveText("正在检查日志及关联数据…");
  await expect(dialog.getByRole("button", { name: "重新获取" })).toBeDisabled();
  release();
  await expect(dialog.getByText("没有关联的保留记录。")).toBeVisible();
  await expect(dialog.getByText(`${fileName} · ${log.id}`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "彻底删除" })).toHaveCount(0);
  await expect(dialog.getByLabel("存储对象范围")).toContainText(`共享对象 ${item.objects.shared}`);
  await page.screenshot({ path: testInfo.outputPath("log-deletion-preview.png"), fullPage: true });
  failOnce = true;
  await dialog.getByRole("button", { name: "重新获取" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("范围暂不可用");
  await expect(dialog.getByLabel("日志专属数据")).toHaveCount(0);
  await dialog.getByRole("button", { name: "重试" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByText("没有关联的保留记录。")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect((await page.request.get(apiRoute(`/api/v1/logs/${log.id}`), { headers: authHeadersForRole("admin") })).status()).toBe(200);
  await page.reload();
  await page.getByRole("searchbox", { name: "搜索日志分析记录" }).fill(fileName);
  await expect(page.getByRole("row").filter({ hasText: fileName }).getByRole("button", { name: "删除影响预览" })).toBeVisible();
});
