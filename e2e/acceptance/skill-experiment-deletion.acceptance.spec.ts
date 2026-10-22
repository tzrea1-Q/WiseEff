import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import type { AnalysisSkill } from "../../src/features/log-skills/types";
import type { SkillDeletionPreview } from "../../server/modules/contracts/dtoSchemas/skillDeletion";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/log-skills", status: 503 }] });

test("deletes an unpublished clean buffer directly by keyboard, preserving confirmation after failure", async ({ page, request }, testInfo) => {
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
  await page.goto("/log-admin?tab=skills");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await row.getByRole("button", { name: `${name}：更多`, exact: true }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "彻底删除…", exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "彻底删除技能", exact: true });
  await expect(dialog.getByRole("button", { name: "彻底删除", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /归档/ })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await row.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const remove = page.getByRole("button", { name: "彻底删除…", exact: true });
  await remove.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "彻底删除", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await remove.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "彻底删除", exact: true })).toBeEnabled();
  await page.route(`**/api/v1/log-skills/${skill.id}/purge`, route => route.fulfill({ status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "技能删除暂时不可用" } }) }), { times: 1 });
  await dialog.getByRole("button", { name: "彻底删除", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("请重试");
  await expect(dialog.getByText("版本、草稿及解析测试：1", { exact: true })).toBeVisible();
  const image = testInfo.outputPath("skill-experiment-deletion-failure-1440.png"); await page.screenshot({ path: image, animations: "disabled" });
  await testInfo.attach("skill-experiment-deletion-failure-1440", { path: image, contentType: "image/png" });
  await dialog.getByRole("button", { name: "彻底删除", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByText("数据库及独占对象已清理完成。共享对象保留。" )).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回分析技能", exact: true }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeHidden();
  const again = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name, status: "draft" } }); expect(again.status()).toBe(201);
  const recreated = (await again.json() as { item: AnalysisSkill }).item; expect(recreated.id).not.toBe(skill.id); expect(recreated.skillKey).toBe(skill.skillKey);
});

test("archives and purges a published skill, blocks unfinished analysis and retains plain-text history snapshots", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix(); const headers = authHeadersForRole("admin"); const name = `应归档技能-${Date.now().toString(36)}`;
  const created = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name } }); expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  expect(skill.currentRevision.status).toBe("published");
  const upload = await request.post(apiRoute("/api/v1/log-files"), { headers, data: { fileName: `${name}.log`, contentType: "text/plain",
    skillId: skill.id, contentBase64: Buffer.from("INFO boot\nERROR historical skill analysis\n").toString("base64") } });
  expect(upload.status()).toBe(201);
  const { log } = await upload.json() as { log: { id: string } };
  await expect.poll(async () => {
    const report = await request.get(apiRoute(`/api/v1/logs/${log.id}`), { headers });
    expect(report.status()).toBe(200);
    return (await report.json() as { item: { status: string } }).item.status;
  }, { timeout: 60_000 }).toBe("complete");
  await signInBrowserAsRole(page, "admin", "/log-admin?tab=skills"); await prepareInteractionSurface(page);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  const more = row.getByRole("button", { name: `${name}：更多`, exact: true });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "彻底删除…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "归档", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "恢复", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  const archive = page.getByRole("dialog", { name: `归档「${name}」`, exact: true });
  await archive.getByRole("button", { name: "归档技能", exact: true }).click(); await expect(archive).toBeHidden();
  const saved = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers }); expect(saved.status()).toBe(200);
  expect((await saved.json() as { item: AnalysisSkill }).item).toMatchObject({ id: skill.id, status: "archived", currentRevision: { id: skill.currentRevision.id } });
  await expect(row).toContainText("已归档");
  // Unscheduled fixture run: the lane worker cannot finish it before the blocker assertions.
  const unfinishedRunId = randomUUID();
  await withPgClient(async client => {
    const inserted = await client.query(`insert into log_analysis_runs(id,organization_id,log_record_id,status,current_stage,progress,skill_revision_id)
      select $1,organization_id,id,'queued','parse',0,$3 from log_records where id=$2`, [unfinishedRunId, log.id, skill.currentRevision.id]);
    expect(inserted.rowCount).toBe(1);
  });
  const dialog = page.getByRole("dialog", { name: "彻底删除技能", exact: true });
  try {
    await more.click();
    await expect(page.getByRole("menuitem", { name: "归档", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "彻底删除…", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("有 1 个分析仍在进行，完成后再删除。");
    await expect(dialog.getByRole("button", { name: "彻底删除", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    const preview = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}/deletion-preview`), { headers });
    expect(preview.status()).toBe(200);
    const { item } = await preview.json() as { item: SkillDeletionPreview };
    expect(item.blockers).toContainEqual({ code: "analyses-in-progress", count: 1, message: "有 1 个分析仍在进行，完成后再删除。" });
    const refused = await request.post(apiRoute(`/api/v1/log-skills/${skill.id}/purge`), { headers, data: { version: item.version } });
    expect(refused.status()).toBe(409);
    const image = testInfo.outputPath("skill-deletion-unfinished-1440.png"); await page.screenshot({ path: image, animations: "disabled" });
    await testInfo.attach("skill-deletion-unfinished-1440", { path: image, contentType: "image/png" });
  } finally {
    await withPgClient(client => client.query("delete from log_analysis_runs where id=$1 and log_record_id=$2", [unfinishedRunId, log.id]));
  }
  await dialog.getByRole("button", { name: "刷新预览", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "彻底删除", exact: true })).toBeEnabled();
  await expect(dialog.getByText("历史日志（技能名称快照）：1", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "彻底删除", exact: true }).click();
  await expect(dialog.getByText("数据库及独占对象已清理完成。共享对象保留。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(row).toBeHidden();
  const retained = await request.get(apiRoute(`/api/v1/logs/${log.id}`), { headers });
  expect(retained.status()).toBe(200);
  expect((await retained.json() as { item: { status: string; skillNameSnapshot: string; skillRevisionNumberSnapshot: number } }).item)
    .toMatchObject({ status: "complete", skillNameSnapshot: name, skillRevisionNumberSnapshot: skill.currentRevision.number });
  await page.goto(`/logs?logId=${encodeURIComponent(log.id)}`); await prepareInteractionSurface(page);
  const provenance = page.getByTestId("analysis-provenance");
  const snapshotLabel = `技能：${name} v${skill.currentRevision.number}`;
  await expect(provenance.getByText(snapshotLabel, { exact: true })).toBeVisible();
  await expect(provenance.getByRole("link", { name: snapshotLabel, exact: true })).toHaveCount(0);
  await expect(provenance.locator("a", { hasText: name })).toHaveCount(0);
  const image = testInfo.outputPath("skill-deletion-history-snapshot-1440.png"); await page.screenshot({ path: image, animations: "disabled" });
  await testInfo.attach("skill-deletion-history-snapshot-1440", { path: image, contentType: "image/png" });
});
