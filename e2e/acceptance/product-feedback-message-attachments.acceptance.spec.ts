import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const file = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/product-feedback/mine", status: 500 }] });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(seedAcceptanceRoleMatrix);

test("a later reply has its own allowance and preserves image grouping after failure, keyboard edits and reload", async ({ page }, testInfo) => {
  const token = randomUUID(), headers = authHeadersForRole("hardware-user");
  const created = await page.request.post(apiRoute("/api/v1/product-feedback"), { headers, data: {
    pagePath: "/settings", pageTitle: "Settings", feedbackType: "experience", description: `Attachment allowance ${token}`,
    attachments: Array.from({ length: 5 }, (_, index) => ({ fileName: `initial-${index}.png`, contentType: "image/png", contentBase64: png }))
  } });
  expect(created.status()).toBe(201);
  const { item } = await created.json() as { item: { id: string } }, path = `/api/v1/product-feedback/mine/${item.id}`;
  await signInBrowserAsRole(page, "hardware-user", `/feedback?id=${item.id}`);
  const trigger = page.getByRole("button", { name: "补充说明", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  const form = page.getByRole("form", { name: "补充反馈说明" });
  await expect(form.getByLabel("补充说明", { exact: true })).toBeFocused();
  await form.getByLabel("补充说明", { exact: true }).fill(`More evidence ${token}`);
  const input = form.getByLabel("选择补充截图");
  await input.setInputFiles(Array.from({ length: 5 }, (_, index) => file(`reply-${index}.png`)));
  await expect(form.getByText(/本次回复：5 \/ 5 张/)).toBeVisible();
  await form.getByRole("button", { name: "移除补充截图 reply-0.png" }).focus(); await page.keyboard.press("Enter");
  await expect(form.getByText(/本次回复：4 \/ 5 张/)).toBeVisible();
  await input.setInputFiles(file("replacement.png"));
  await input.setInputFiles(file("over-limit.png"));
  await expect(form.getByRole("alert")).toContainText("最多可附加 5 张");
  await form.getByRole("button", { name: "移除补充截图 reply-1.png" }).click();
  await input.setInputFiles(file("final.png"));
  await expect(form.getByRole("alert")).toHaveCount(0);
  const before = await page.request.get(apiRoute(path), { headers });
  expect((await before.json() as { item: { attachments: unknown[] } }).item.attachments).toHaveLength(5);
  let failOnce = true;
  await page.route(`**${path}/replies`, async (route) => {
    if (!failOnce) { await route.continue(); return; }
    failOnce = false;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "附件存储暂不可用，请稍后重试本次提交。" } }) });
  });
  await form.getByRole("button", { name: "发送补充" }).focus(); await page.keyboard.press("Enter");
  await expect(form.getByRole("alert")).toContainText("附件存储暂不可用");
  await expect(form.getByLabel("补充说明", { exact: true })).toHaveValue(`More evidence ${token}`);
  await expect(form.getByText(/本次回复：5 \/ 5 张/)).toBeVisible();
  await form.getByRole("button", { name: "发送补充" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("补充说明已发送。", { exact: true })).toBeVisible();
  const message = page.getByRole("listitem").filter({ hasText: `More evidence ${token}` });
  await expect(message.locator("figure")).toHaveCount(5);
  await expect(message.getByText("initial-0.png", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^放大截图 / })).toHaveCount(10);
  await expect.poll(() => page.locator("figure img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("feedback-reply-image-group.png"), fullPage: true });
  await page.reload();
  await expect(message.locator("figure")).toHaveCount(5);
  await expect(page.getByRole("button", { name: /^放大截图 / })).toHaveCount(10);
  await expect.poll(() => page.locator("figure img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const read = await page.request.get(apiRoute(path), { headers });
  expect(read.status()).toBe(200);
  const body = await read.json() as { item: { attachments: Array<{ messageId: string; fileName: string; uploadedByUserId: string | null }>; progressEvents: Array<{ id: string; publicMessage: string }> } };
  expect(body.item.attachments).toHaveLength(10);
  const event = body.item.progressEvents.find((entry) => entry.publicMessage === `More evidence ${token}`)!;
  expect(body.item.attachments.filter((attachment) => attachment.messageId === event.id).map((attachment) => attachment.fileName).sort()).toEqual(["final.png", "replacement.png", "reply-2.png", "reply-3.png", "reply-4.png"]);
  expect(body.item.attachments.every((attachment) => attachment.uploadedByUserId)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("feedback-reply-images-reloaded.png"), fullPage: true });
});
