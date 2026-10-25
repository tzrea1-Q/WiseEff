import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { test } from "./helpers/catalogFixtureRuntime";
import { catalogJson, catalogScreenshot, dismissXiaozeHint, signInCatalogActor } from "./helpers/catalogBrowser";

test.use({ catalogRuntimeScope: import.meta.url });

test("imports and edits a shared DTSI draft, keeps stale input, and discards with the keyboard", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
  void catalogAcceptanceRuntime;
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInCatalogActor(page, "org-admin", "/parameter-admin/sources");
  await dismissXiaozeHint(page);
  await page.getByRole("button", { name: "导入资源" }).click();
  const source = '/ { battery: battery { compatible = "test,shared-battery"; status = "disabled"; }; };\n';
  await page.locator('input[type="file"]').first().setInputFiles({ name: "common-battery.dtsi", mimeType: "text/plain", buffer: Buffer.from(source) });
  await expect(page.getByLabel("资源名称")).toHaveValue("common-battery");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  const resourceId = new URL(page.url()).searchParams.get("resource")!;
  const reopened = await catalogJson(page.request, "GET", `/api/v2/shared-dtsi/${resourceId}`);
  expect(reopened.status).toBe(200);
  const draft = (reopened.body as { item: { revision: number; members: { content: string }[] } }).item;
  expect(draft.members[0]!.content).toBe(source);
  await catalogScreenshot(page, testInfo, "shared-dtsi-draft-1440");
  await page.getByLabel("资源名称").fill("My local draft");
  const updated = await catalogJson(page.request, "PUT", `/api/v2/shared-dtsi/${resourceId}/draft`, { data: {
    name: "Concurrent administrator draft", sourceName: "common-battery.dtsi", content: source, expectedRevision: draft.revision
  } });
  expect(updated.status).toBe(200);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已被更新");
  await expect(page.getByLabel("资源名称")).toHaveValue("My local draft");
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await catalogScreenshot(page, testInfo, "shared-dtsi-draft-conflict-1280");
  await page.getByRole("button", { name: "重新载入" }).click();
  const leave = page.getByRole("dialog", { name: "重新载入草稿？" });
  await leave.getByRole("button", { name: "重新载入", exact: true }).click();
  await expect(page.getByLabel("资源名称")).toHaveValue("Concurrent administrator draft");
  await page.getByRole("button", { name: "丢弃草稿", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "丢弃共享 DTSI 草稿？" });
  await discard.getByRole("button", { name: "丢弃草稿", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "共享 DTSI", exact: true })).toBeVisible();
  expect((await catalogJson(page.request, "GET", `/api/v2/shared-dtsi/${resourceId}`)).status).toBe(404);
});
