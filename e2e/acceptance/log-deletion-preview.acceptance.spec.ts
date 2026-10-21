import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import type { LogDeletionPreview } from "../../src/domain/logs/deletionPreview";

useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "GET", path: "/api/v1/logs", status: 500 },
  { method: "DELETE", path: "/api/v1/logs", status: 503 }] });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(seedAcceptanceRoleMatrix);

test("administrator inspects a real log's deletion scope, retained audit and failure recovery with the keyboard", async ({ page }, testInfo) => {
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
  expect(item.inventory.filter((entry) => entry.disposition === "retain" && entry.key !== "audit").every((entry) => entry.count === 0)).toBe(true);
  expect(item.inventory.find((entry) => entry.key === "audit")?.count).toBeGreaterThan(0);

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
  await expect(dialog.getByText("管理审计身份与时间（移除日志内容）")).toBeVisible();
  await expect(dialog.getByText(`${fileName} · ${log.id}`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "彻底删除" })).toBeDisabled();
  await expect(dialog.getByLabel("存储对象范围")).toContainText(`共享对象 ${item.objects.shared}`);
  await page.screenshot({ path: testInfo.outputPath("log-deletion-preview.png"), fullPage: true });
  failOnce = true;
  await dialog.getByRole("button", { name: "重新获取" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText("范围暂不可用");
  await expect(dialog.getByLabel("日志专属数据")).toHaveCount(0);
  await dialog.getByRole("button", { name: "重试" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByText("管理审计身份与时间（移除日志内容）")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect((await page.request.get(apiRoute(`/api/v1/logs/${log.id}`), { headers: authHeadersForRole("admin") })).status()).toBe(200);
  await page.reload();
  await page.getByRole("searchbox", { name: "搜索日志分析记录" }).fill(fileName);
  await expect(page.getByRole("row").filter({ hasText: fileName }).getByRole("button", { name: "删除影响预览" })).toBeVisible();
});

test("permanent deletion recovers a committed request's failed response and retains independent knowledge with its removed source", async ({ page }, testInfo) => {
  const fileName = `permanent-${randomUUID()}.log`, headers = authHeadersForRole("admin");
  const upload = await page.request.post(apiRoute("/api/v1/log-files"), { headers,
    data: { fileName, contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("ERROR failure retained in independent knowledge\n").toString("base64") } });
  expect(upload.status()).toBe(201);
  const { log } = await upload.json() as { log: { id: string } }, path = `/api/v1/logs/${log.id}`;
  await expect.poll(async () => {
    const response = await page.request.get(apiRoute(path), { headers });
    expect(response.status()).toBe(200);
    return (await response.json() as { item: { status: string } }).item.status;
  }, { timeout: 60_000 }).toBe("complete");
  const distilled = await page.request.post(apiRoute("/api/v1/knowledge/distill-from-log"), { headers, data: { logId: log.id } });
  expect(distilled.status()).toBe(201);
  const { item: knowledge } = await distilled.json() as { item: { id: string; contentMarkdown: string } };
  const revisions = await page.request.get(apiRoute(`/api/v1/knowledge/entries/${knowledge.id}/revisions`), { headers });
  const history = await revisions.json(); expect(revisions.status()).toBe(200);
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=records");
  await page.getByRole("searchbox", { name: "搜索日志分析记录" }).fill(fileName);
  const row = page.getByRole("row").filter({ hasText: fileName }), trigger = row.getByRole("button", { name: "删除影响预览" });
  await trigger.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "日志删除影响预览" });
  await expect(dialog.getByRole("button", { name: "彻底删除" })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  expect((await page.request.get(apiRoute(path), { headers })).status()).toBe(200);
  await trigger.focus(); await page.keyboard.press("Enter");
  await dialog.getByRole("checkbox", { name: /我确认永久删除/ }).focus(); await page.keyboard.press("Space");
  let sent = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "DELETE") { await route.continue(); return; }
    sent += 1;
    const committed = await route.fetch(); expect(committed.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "删除响应传输失败" } }) });
  });
  await dialog.getByRole("button", { name: "彻底删除" }).focus(); await page.keyboard.press("Enter");
  const result = page.getByRole("dialog", { name: "日志删除结果" });
  await expect(result.getByRole("status")).toContainText("日志数据库数据已永久删除。");
  await expect(result.getByRole("status")).toContainText("存储清理完成。");
  expect(sent).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("log-permanent-deletion-result.png"), fullPage: true });
  await result.getByRole("button", { name: "关闭" }).click(); await expect(row).toHaveCount(0);
  await page.reload(); await page.getByRole("searchbox", { name: "搜索日志分析记录" }).fill(fileName);
  await expect(row).toHaveCount(0);
  for (const suffix of ["", "/lines?file=" + encodeURIComponent(fileName) + "&startLine=1&endLine=1"]) {
    expect((await page.request.get(apiRoute(`${path}${suffix}`), { headers })).status()).toBe(404);
  }
  const retained = await page.request.get(apiRoute(`/api/v1/knowledge/entries/${knowledge.id}`), { headers });
  expect(retained.status()).toBe(200);
  expect((await retained.json() as { item: unknown }).item).toMatchObject({ contentMarkdown: knowledge.contentMarkdown, sourceLogId: null, sourceLogDeleted: true });
  expect(await (await page.request.get(apiRoute(`/api/v1/knowledge/entries/${knowledge.id}/revisions`), { headers })).json()).toEqual(history);
  await page.goto(`/knowledge?entryId=${knowledge.id}`);
  const entry = page.getByRole("dialog");
  await expect(entry.getByText("来源已删除", { exact: true })).toBeVisible();
  await expect(entry.getByRole("button", { name: "查看日志分析" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("knowledge-source-deleted.png"), fullPage: true });
});
