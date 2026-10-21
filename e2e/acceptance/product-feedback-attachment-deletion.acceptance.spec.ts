import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "DELETE", path: "/api/v1/product-feedback/", status: 500 }] });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(seedAcceptanceRoleMatrix);

test("owner and organization administrator remove submitted images in place, preserve message markers and reject old downloads", async ({ page }, testInfo) => {
  const images = await page.evaluate(() => ["#2463eb", "#16824a"].map((color, index) => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 160, 90);
    context.fillStyle = "white"; context.font = "20px sans-serif"; context.fillText(`Evidence ${index + 1}`, 14, 52);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  const title = `Attachment deletion ${randomUUID()}`, headers = authHeadersForRole("hardware-user");
  const created = await page.request.post(apiRoute("/api/v1/product-feedback"), { headers, data: { pagePath: "/settings", pageTitle: "Settings", feedbackType: "experience", description: title,
    attachments: images.map((contentBase64, index) => ({ fileName: `evidence-${index}.png`, contentType: "image/png", contentBase64 })) } });
  expect(created.status()).toBe(201);
  const { item } = await created.json() as { item: { id: string; attachments: Array<{ id: string; fileName: string; messageId: string }> } };
  const target = item.attachments[0], keep = item.attachments[1], path = `/api/v1/product-feedback/${item.id}/attachments/${target.id}`;
  await signInBrowserAsRole(page, "hardware-user", `/feedback?id=${item.id}`);
  await expect(page.getByRole("button", { name: /^放大截图 / })).toHaveCount(2);
  const trigger = page.getByRole("button", { name: `删除已提交截图 ${target.fileName}` });
  await trigger.focus(); await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "删除这张已提交截图？" });
  await expect(confirmation).toContainText(target.fileName);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  expect((await page.request.get(apiRoute(`/api/v1/product-feedback/mine/${item.id}/attachments/${target.id}/content`), { headers })).status()).toBe(200);
  let failOnce = true;
  await page.route(`**${path}`, async (route) => {
    if (!failOnce || route.request().method() !== "DELETE") { await route.continue(); return; }
    failOnce = false;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "删除截图失败，请稍后重试。" } }) });
  });
  await trigger.click();
  await confirmation.getByRole("button", { name: "确认删除截图" }).focus(); await page.keyboard.press("Enter");
  await expect(confirmation.getByRole("alert")).toContainText("删除截图失败");
  await confirmation.getByRole("button", { name: "确认删除截图" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("截图已删除", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: `放大截图 ${keep.fileName}` })).toBeVisible();
  await expect.poll(() => page.locator("figure img").evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("feedback-owner-deletion-marker.png"), fullPage: true });
  await page.reload(); await expect(page.getByText("截图已删除", { exact: true })).toHaveCount(1);
  const read = await page.request.get(apiRoute(`/api/v1/product-feedback/mine/${item.id}`), { headers });
  const body = await read.json() as { item: { attachments: Array<{ id: string; messageId: string; deletedAt: string | null; cleanupPending: boolean }>; progressEvents: Array<{ id: string }> } };
  expect(body.item.attachments.find((entry) => entry.id === target.id)).toMatchObject({ messageId: target.messageId, deletedAt: expect.any(String), cleanupPending: false });
  expect(body.item.progressEvents).toHaveLength(1);
  expect((await page.request.get(apiRoute(`/api/v1/product-feedback/mine/${item.id}/attachments/${target.id}/content`), { headers })).status()).toBe(404);
  await signInBrowserAsRole(page, "admin", `/feedback-admin?id=${item.id}`);
  await page.getByRole("button", { name: `删除已提交截图 ${keep.fileName}` }).click();
  await page.getByRole("dialog", { name: "删除这张已提交截图？" }).getByRole("button", { name: "确认删除截图" }).click();
  await expect(page.getByText("截图已删除", { exact: true })).toHaveCount(2);
  await page.reload(); await expect(page.getByText("截图已删除", { exact: true })).toHaveCount(2);
  expect((await page.request.get(apiRoute(`/api/v1/product-feedback/${item.id}/attachments/${keep.id}/content`), { headers: authHeadersForRole("admin") })).status()).toBe(404);
  await page.screenshot({ path: testInfo.outputPath("feedback-admin-deletion-markers.png"), fullPage: true });
});
