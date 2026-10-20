import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { apiRoute } from "./helpers/runtime";
import type { AnalysisSkill } from "../../src/features/log-skills/types";

useBrowserDiagnostics(test);

test("skill knowledge links, Markdown draft uploads, and upload permission reason at 1440x900", async ({ page }, testInfo) => {
  // @acceptance LOG-SKILL-KNOWLEDGE-001
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = randomUUID().slice(0, 8);
  const headers = authHeadersForRole("admin");
  const title = `Knowledge link ${stamp}`;
  const created = await page.request.post(apiRoute("/api/v1/knowledge/entries"), { headers,
    data: { contentForm: "markdown", title, tags: [], contentMarkdown: "# Thermal foldback\nInspect cooling before changing current limits." } });
  expect(created.status()).toBe(201);
  const knowledge = (await created.json()).item as { id: string };
  const published = await page.request.post(apiRoute(`/api/v1/knowledge/entries/${knowledge.id}/publish`), { headers });
  expect(published.ok()).toBe(true);
  const skillResponse = await page.request.post(apiRoute("/api/v1/log-skills"), { headers,
    data: { name: `Knowledge skill ${stamp}`, startingPoint: { templateId: "generic-text" } } });
  expect(skillResponse.status()).toBe(201);
  const skill = (await skillResponse.json()).item as AnalysisSkill;
  const route = `/log-admin/skills/${skill.id}?section=knowledge`;
  const saveDraft = async () => {
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
    const response = page.waitForResponse((candidate) => candidate.request().method() === "PUT"
      && new URL(candidate.url()).pathname === `/api/v1/log-skills/${skill.id}/draft`);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  };
  await signInBrowserAsRole(page, "admin", route);
  await prepareInteractionSurface(page);
  await expect(page.getByRole("heading", { name: "知识", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "链接已有条目", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "链接已有条目", exact: true });
  const searchResponse = page.waitForResponse((response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === "/api/v1/knowledge/entries" && new URL(response.url()).searchParams.get("q") === stamp);
  await picker.getByRole("searchbox", { name: "搜索已发布知识" }).fill(stamp);
  expect((await searchResponse).ok()).toBe(true);
  await picker.getByRole("button", { name: `链接 ${title}`, exact: true }).click();
  await expect(picker.getByRole("button", { name: `已链接 ${title}`, exact: true })).toBeDisabled();
  expect(await picker.locator(".data-table-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await testInfo.attach("knowledge-link-dialog-1440x900", { body: await page.screenshot(), contentType: "image/png" });
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await saveDraft();
  const saved = await page.request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  expect((await saved.json()).item.draft.spec.knowledgeEntryIds).toEqual([knowledge.id]);

  await page.getByRole("button", { name: "上传 Markdown", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "上传 Markdown", exact: true });
  const names = [`Cooling ${stamp}`, `Protocol ${stamp}`];
  const transfer = await page.evaluateHandle((fileNames) => {
    const data = new DataTransfer();
    for (const name of fileNames) data.items.add(new File([`# ${name}\nEngineering checks.`], `${name}.md`, { type: "text/markdown" }));
    return data;
  }, names);
  await upload.getByRole("region", { name: "拖放 Markdown 文件" }).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(upload.getByRole("list", { name: "待上传文件" })).toContainText(`${names[0]}.md`);
  await testInfo.attach("knowledge-markdown-drop-1440x900", { body: await page.screenshot(), contentType: "image/png" });
  await upload.getByRole("button", { name: "创建并链接", exact: true }).click();
  await expect(upload).toBeHidden();
  const linked = page.getByRole("table", { name: "已链接知识条目" });
  for (const name of names) {
    const row = linked.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("草稿");
    await expect(row).toContainText("v1");
  }
  await saveDraft();
  const withUploads = await page.request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  const draft = (await withUploads.json()).item.draft;
  expect(draft.spec.knowledgeEntryIds).toHaveLength(3);
  const dbEntries = await withPgClient(async (db) => (await db.query<{ status: string; content_form: string; title: string }>(
    "select title,status,content_form from knowledge_entries where organization_id=$1 and id=any($2::uuid[]) order by title",
    ["org-chargelab", draft.spec.knowledgeEntryIds.filter((id: string) => id !== knowledge.id)])).rows);
  expect(dbEntries).toEqual(names.map((name) => ({ title: name, status: "draft", content_form: "markdown" })));
  await testInfo.attach("knowledge-linked-drafts-1440x900", { body: await page.screenshot(), contentType: "image/png" });

  await linked.getByRole("button", { name: `取消链接 ${title}`, exact: true }).click();
  const unlinkDialog = page.getByRole("dialog", { name: "取消知识链接？", exact: true });
  await expect(unlinkDialog).toBeVisible();
  await unlinkDialog.getByRole("button", { name: "取消链接", exact: true }).click();
  await expect(unlinkDialog).toBeHidden();
  await saveDraft();
  const unlinked = await page.request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
  expect((await unlinked.json()).item.draft.spec.knowledgeEntryIds).not.toContain(knowledge.id);

  const viewerId = `knowledge-skill-viewer-${stamp}`;
  await withPgClient(async (db) => {
    await db.query("insert into users(id,organization_id,name,email,title,is_active) values($1,'org-chargelab','Skill knowledge viewer',$2,'Skill administrator',true)", [viewerId, `${viewerId}@example.test`]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$1,'org-chargelab','guest')", [viewerId]);
  });
  const emptySkill = await page.request.post(apiRoute("/api/v1/log-skills"), { headers,
    data: { name: `Knowledge permission ${stamp}`, startingPoint: { templateId: "generic-text" } } });
  expect(emptySkill.status()).toBe(201);
  const emptyId = (await emptySkill.json()).item.id;
  await signInBrowserAsUser(page, viewerId, `${viewerId}@example.test`, "Skill knowledge viewer", `/log-admin/skills/${emptyId}?section=knowledge`);
  await prepareInteractionSurface(page);
  const disabledUpload = page.getByRole("button", { name: "上传 Markdown", exact: true });
  await expect(disabledUpload).toBeDisabled();
  await expect(disabledUpload).toHaveAccessibleDescription("上传 Markdown 需要知识编辑权限。");
  await expect(page.getByRole("button", { name: "链接已有条目", exact: true })).toBeDisabled();
  await testInfo.attach("knowledge-upload-permission-1440x900", { body: await page.screenshot(), contentType: "image/png" });
});
