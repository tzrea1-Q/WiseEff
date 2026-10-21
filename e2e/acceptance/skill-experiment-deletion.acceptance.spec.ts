import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import type { AnalysisSkill } from "../../src/features/log-skills/types";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/log-skills", status: 503 }] });

test("creates an unpublished skill and deletes a clean buffer by keyboard, preserving confirmation after failure", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin"); const name = `可删除实验-${Date.now().toString(36)}`;
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=skills"); await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "新建技能", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建技能", exact: true });
  await expect(create.getByText("新技能先保存为未发布草稿，可编辑、测试，发布后用于分析。")).toBeVisible();
  await create.getByLabel("名称", { exact: true }).fill(name);
  const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/log-skills");
  await create.getByRole("button", { name: "创建技能", exact: true }).click();
  const skill = (await (await response).json() as { item: AnalysisSkill }).item;
  expect(skill.currentRevision.status).toBe("draft");
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const remove = page.getByRole("button", { name: "删除实验技能", exact: true });
  await expect(remove).toBeEnabled(); await remove.focus(); await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "删除实验技能", exact: true });
  await expect(dialog.getByRole("button", { name: "永久删除实验技能" })).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await remove.click(); dialog = page.getByRole("dialog", { name: "删除实验技能", exact: true });
  await expect(dialog.getByRole("button", { name: "永久删除实验技能" })).toBeEnabled();
  await page.route(`**/api/v1/log-skills/${skill.id}/purge`, route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "技能删除暂时不可用" } }) }), { times: 1 });
  await dialog.getByRole("button", { name: "永久删除实验技能" }).click();
  await expect(dialog.getByRole("alert")).toContainText("请重试");
  await expect(dialog.getByText(/初始草稿及解析测试：1/)).toBeVisible();
  const image = testInfo.outputPath("skill-experiment-deletion-failure-1440.png"); await page.screenshot({ path: image, animations: "disabled" });
  await testInfo.attach("skill-experiment-deletion-failure-1440", { path: image, contentType: "image/png" });
  await dialog.getByRole("button", { name: "永久删除实验技能" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByText("数据库及独占对象已清理完成。共享对象保留。" )).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回分析技能", exact: true }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeHidden();
  const again = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name, status: "draft" } }); expect(again.status()).toBe(201);
  const recreated = (await again.json() as { item: AnalysisSkill }).item; expect(recreated.id).not.toBe(skill.id); expect(recreated.skillKey).toBe(skill.skillKey);
});

test("shows published-history blockers and uses the existing archive action", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix(); const headers = authHeadersForRole("admin"); const name = `应归档技能-${Date.now().toString(36)}`;
  const created = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name } }); expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=skills"); await prepareInteractionSurface(page);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await row.getByRole("button", { name: `${name}：更多`, exact: true }).click(); await page.getByRole("menuitem", { name: "删除实验技能", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除实验技能", exact: true });
  await expect(dialog.getByText(/曾发布的技能修订：1 项/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "永久删除实验技能" })).toHaveCount(0);
  const image = testInfo.outputPath("skill-experiment-deletion-blocked-1440.png"); await page.screenshot({ path: image, animations: "disabled" });
  await testInfo.attach("skill-experiment-deletion-blocked-1440", { path: image, contentType: "image/png" });
  await dialog.getByRole("button", { name: "归档技能", exact: true }).click(); await expect(dialog).toBeHidden();
  const saved = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers }); expect(saved.status()).toBe(200);
  expect((await saved.json() as { item: AnalysisSkill }).item).toMatchObject({ id: skill.id, status: "archived", currentRevision: { id: skill.currentRevision.id } });
});
