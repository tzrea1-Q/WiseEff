import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import type { AnalysisSkill } from "../../src/features/log-skills/types";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "PATCH", path: "/api/v1/log-domains", status: 409 },
  { method: "PATCH", path: "/api/v1/log-domains", status: 503 },
] });

test("renames and restores a skill by keyboard, preserves failed input and reloads the same identity and versions", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const headers = authHeadersForRole("admin");
  const suffix = Date.now().toString(36);
  const original = `技能生命周期-${suffix}`;
  const occupied = `已占用技能-${suffix}`;
  const renamed = `已修改技能-${suffix}`;
  const created = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name: original } });
  expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  expect((await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name: occupied } })).status()).toBe(201);
  const history = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}/revisions`), { headers });
  const revisions = await history.json();
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=skills");
  await prepareInteractionSurface(page);
  const row = (name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  const menu = async (name: string) => row(name).getByRole("button", { name: `${name}：更多`, exact: true }).click();
  await menu(original);
  await page.getByRole("menuitem", { name: "改名", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "修改技能名称" });
  const name = dialog.getByLabel("名称", { exact: true });
  await expect(name).toBeFocused();
  await name.fill(occupied); await name.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("已被现有技能占用");
  await expect(name).toHaveValue(occupied);
  await expect(dialog.getByRole("link", { name: `查看占用技能「${occupied}」` })).toBeVisible();
  const conflictImage = testInfo.outputPath("skill-rename-conflict-1440.png");
  await page.screenshot({ path: conflictImage, animations: "disabled" });
  await testInfo.attach("skill-rename-conflict-1440", { path: conflictImage, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(row(original)).toBeVisible();

  await menu(original); await page.getByRole("menuitem", { name: "改名", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "修改技能名称" });
  const endpoint = `/api/v1/log-domains/${skill.id}`;
  const failOnce = () => page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "技能服务暂时不可用" } }) }), { times: 1 });
  await failOnce();
  await dialog.getByLabel("名称", { exact: true }).fill(renamed);
  await dialog.getByLabel("名称", { exact: true }).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("请重试");
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(renamed);
  await dialog.getByLabel("名称", { exact: true }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(row(renamed).getByRole("link", { name: renamed, exact: true })).toHaveAttribute("href", `/log-admin/skills/${skill.id}`);
  await page.reload(); await prepareInteractionSurface(page);
  await menu(renamed); await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "归档技能", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(row(renamed)).toContainText("已归档");
  await menu(renamed); await page.getByRole("menuitem", { name: "恢复", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "恢复技能", exact: true });
  await expect(dialog).toContainText("已吊销的集成凭据不会重新启用");
  await failOnce();
  await dialog.getByLabel("名称", { exact: true }).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("请重试");
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(renamed);
  await page.keyboard.press("Escape");
  const archived = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  expect((await archived.json()).item.status).toBe("archived");
  await menu(renamed); await page.getByRole("menuitem", { name: "恢复", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "恢复技能", exact: true });
  await dialog.getByRole("button", { name: "恢复技能", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await page.reload(); await prepareInteractionSurface(page);
  await expect(row(renamed)).toContainText(`已发布 v${skill.currentRevision.number}`);
  const current = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  expect((await current.json()).item).toMatchObject({ id: skill.id, name: renamed, status: "active", currentRevision: { id: skill.currentRevision.id } });
  expect(await (await request.get(apiRoute(`/api/v1/log-skills/${skill.id}/revisions`), { headers })).json()).toEqual(revisions);
  const restoredImage = testInfo.outputPath("skill-restored-1440.png");
  await page.screenshot({ path: restoredImage, animations: "disabled" });
  await testInfo.attach("skill-restored-1440", { path: restoredImage, contentType: "image/png" });
});
