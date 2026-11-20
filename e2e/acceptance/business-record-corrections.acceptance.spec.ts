import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { acceptanceUserIdForRole, authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);
test.beforeAll(async () => { await seedAcceptanceRoleMatrix(); });

async function createOrganization() {
  const id = `corrections-${randomUUID().slice(0, 8)}`;
  const name = `纠错验收组织 ${id}`;
  await withPgClient((client) => client.query("insert into organizations(id,name) values($1,$2)", [id, name]));
  return { id, name, query: `organizationId=${id}` };
}

test("[route:feedback-admin] corrects a submitted category and keeps the original in the selected organization", async ({ page }, testInfo) => {
  // @acceptance PFB-CATEGORY-CORRECTION-001
  // @operation PFB-CATEGORY-CORRECTION-001
  const target = await createOrganization();
  const submitterId = `${target.id}-submitter`, email = `${submitterId}@example.test`;
  const submitter = authHeadersForUser(submitterId, email, "Feedback Submitter", target.id);
  await withPgClient(async (client) => {
    await client.query("insert into users(id,organization_id,name,email,title,is_active) values($1,$2,'Feedback Submitter',$3,'Member',true)", [submitterId, target.id, email]);
    await client.query("insert into user_role_bindings(id,organization_id,user_id,role_id) values($1,$2,$1,'hardware-user')", [submitterId, target.id]);
  });
  const admin = authHeadersForRole("platform-admin");
  const me = await page.request.get(apiRoute("/api/v1/me"), { headers: admin });
  expect(me.status(), await me.text()).toBe(200);
  expect((await me.json()).roles).toEqual([expect.objectContaining({ roleId: "platform-admin", projectId: null })]);
  const feedbackPath = "/api/v1/product-feedback";
  const description = "分类更正前的反馈原文";
  const submitted = await page.request.post(apiRoute(feedbackPath), { headers: submitter, data: {
    pagePath: "/knowledge", pageTitle: "知识库", feedbackType: "experience", description
  } });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const { item: original } = await submitted.json();
  const detail = `${feedbackPath}/${original.id}?${target.query}`;
  const patch = { effectiveFeedbackType: "data" };
  expect((await page.request.patch(apiRoute(detail), { headers: submitter, data: patch })).status()).toBe(403);

  await signInBrowserAsRole(page, "platform-admin", `/feedback-admin?${target.query}`);
  await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(target.name);
  await page.getByRole("row").filter({ hasText: description }).getByRole("button", { name: "查看" }).click();
  const record = page.getByRole("article", { name: description });
  await expect(record.getByText("提交分类：体验问题")).toBeVisible();
  await record.getByRole("button", { name: "编辑", exact: true }).click();
  const select = record.getByRole("combobox", { name: "处理分类", exact: true });
  await select.focus();
  await select.press("Space");
  await page.getByRole("option", { name: "数据问题", exact: true }).click();
  const saving = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `${feedbackPath}/${original.id}`);
  await record.getByRole("button", { name: "保存安排" }).click();
  const saved = await saving;
  expect(new URL(saved.url()).searchParams.get("organizationId")).toBe(target.id);
  expect(saved.status(), await saved.text()).toBe(200);
  const { item: corrected } = await saved.json();
  expect(corrected).toMatchObject({ feedbackType: "experience", effectiveFeedbackType: "data", description, submittedAt: original.submittedAt, status: original.status });
  await expect(record.getByText("处理安排已保存。")).toBeVisible();
  await expect(record.getByText("提交分类：体验问题")).toBeVisible();
  await expect(record.getByText("数据问题", { exact: true })).toBeVisible();
  const screenshot = testInfo.outputPath("feedback-category-1440.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });

  await record.getByRole("button", { name: "返回反馈列表" }).click();
  const filter = page.getByRole("combobox", { name: "处理分类筛选" });
  await filter.click();
  await page.getByRole("option", { name: "体验问题 (0)", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: description })).toHaveCount(0);
  await filter.click();
  await page.getByRole("option", { name: "数据问题 (1)", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: description })).toBeVisible();
  const repeat = await page.request.patch(apiRoute(detail), { headers: admin, data: patch });
  expect(repeat.status(), await repeat.text()).toBe(200);
  expect((await repeat.json()).item).toEqual(corrected);
  const audit = await page.request.get(apiRoute(`/api/v1/audit-events?${target.query}&kind=product-feedback-update&targetId=${original.id}`), { headers: admin });
  expect((await audit.json()).items).toMatchObject([{ actorUserId: acceptanceUserIdForRole("platform-admin"), metadata: { previousFeedbackType: "experience", nextFeedbackType: "data" } }]);
  await recordOperationEvidence({
    testInfo, operationId: "PFB-CATEGORY-CORRECTION-001", title: "Feedback category correction", status: "passed", artifacts: [screenshot],
    api: [summarizeApiResponse(saved, { method: "PATCH", path: detail })],
    audit: [{ kind: "product-feedback-update", targetId: original.id, metadataSummary: "One selected-organization classification correction retained the original submission." }]
  });
});

test("[route:knowledge-admin] corrects archived Catalog links without opening retrieval", async ({ page }, testInfo) => {
  // @acceptance KB-ARCHIVED-REFERENCE-CORRECTION-001
  // @operation KB-ARCHIVED-REFERENCE-CORRECTION-001
  const target = await createOrganization();
  const admin = authHeadersForRole("platform-admin");
  const definitions = await page.request.get(apiRoute(`/api/v2/catalog/definitions?${target.query}&lifecycle=active&limit=30`), { headers: admin });
  expect(definitions.status(), await definitions.text()).toBe(200);
  const { items } = await definitions.json() as { items: Array<{ id: string; propertyKey: string; currentRevision: { displayName: string } }> };
  const [old, next] = items.filter((definition, index) => items.findIndex((candidate) => candidate.propertyKey === definition.propertyKey) === index);
  expect(old?.id).toBeTruthy();
  expect(next?.id).toBeTruthy();
  const title = "归档内容及修订保留";
  const entries = "/api/v1/knowledge/entries";
  const created = await page.request.post(apiRoute(`${entries}?${target.query}`), { headers: admin,
    data: { title, contentForm: "markdown", tags: [], contentMarkdown: "archivedcorrectionbrowser" } });
  expect(created.status(), await created.text()).toBe(201);
  const { item: entry } = await created.json();
  const base = `${entries}/${entry.id}`;
  const link = (id: string) => `${base}/definition-references/${id}`;
  for (const [method, path] of [["PUT", link(old.id)], ["POST", `${base}/publish`], ["POST", `${base}/archive`]]) {
    const response = await page.request.fetch(apiRoute(`${path}?${target.query}`), { headers: admin, method });
    expect(response.status(), await response.text()).toBe(200);
  }
  const denied = await page.request.put(apiRoute(`${link(next.id)}?${target.query}`), { headers: authHeadersForRole("hardware-user") });
  expect(denied.status()).toBe(403);
  const historical = await page.request.get(apiRoute(`${base}?${target.query}`), { headers: admin });
  const { item: archived } = await historical.json();

  await signInBrowserAsRole(page, "platform-admin", `/knowledge-admin?${target.query}`);
  await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(target.name);
  await page.getByRole("tab", { name: "已归档条目" }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "更正参数关联" }).click();
  const dialog = page.getByRole("dialog", { name: "更正参数关联" });
  await expect(dialog).toContainText("保持归档，仍不进入知识检索");
  const query = dialog.getByRole("searchbox", { name: "检索参数定义" });
  await query.fill(next.propertyKey);
  await query.press("Enter");
  const option = dialog.getByRole("list", { name: "参数定义检索结果" }).getByRole("listitem").filter({ hasText: next.currentRevision.displayName || next.propertyKey }).first();
  const adding = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === link(next.id));
  await option.getByRole("button", { name: "关联", exact: true }).click();
  const added = await adding;
  expect(added.status(), await added.text()).toBe(200);
  expect(new URL(added.url()).searchParams.get("organizationId")).toBe(target.id);
  const oldChip = dialog.locator(`[data-definition-id="${old.id}"]`);
  const removing = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === link(old.id));
  await oldChip.getByRole("button", { name: /移除引用/ }).click();
  const removed = await removing;
  expect(removed.status(), await removed.text()).toBe(200);
  expect(new URL(removed.url()).searchParams.get("organizationId")).toBe(target.id);
  await expect(oldChip).toHaveCount(0);
  await expect(dialog.locator(`[data-definition-id="${next.id}"]`)).toBeVisible();
  const screenshot = testInfo.outputPath("archived-knowledge-links-1440.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(row).toBeVisible();

  const repeat = await page.request.delete(apiRoute(`${link(old.id)}?${target.query}`), { headers: admin });
  expect(repeat.status(), await repeat.text()).toBe(200);
  expect((await repeat.json()).item).toMatchObject({ status: "archived", archivedAt: archived.archivedAt, headRevisionId: archived.headRevisionId, contentMarkdown: archived.contentMarkdown,
    parameterReferences: [expect.objectContaining({ definitionId: next.id })] });
  const search = await page.request.get(apiRoute(`/api/v1/knowledge/search?${target.query}&q=archivedcorrectionbrowser`), { headers: admin });
  expect((await search.json()).items).toEqual([]);
  const audit = await page.request.get(apiRoute(`/api/v1/audit-events?${target.query}&kind=knowledge-definition-reference-remove&targetId=${entry.id}`), { headers: admin });
  expect((await audit.json()).items).toMatchObject([{ actorUserId: acceptanceUserIdForRole("platform-admin"), metadata: { previousDefinitionId: old.id, nextDefinitionId: null } }]);
  await recordOperationEvidence({
    testInfo, operationId: "KB-ARCHIVED-REFERENCE-CORRECTION-001", title: "Archived knowledge reference correction", status: "passed", artifacts: [screenshot],
    api: [summarizeApiResponse(added, { method: "PUT", path: `${link(next.id)}?${target.query}` }),
      summarizeApiResponse(removed, { method: "DELETE", path: `${link(old.id)}?${target.query}` })],
    audit: [{ kind: "knowledge-definition-reference-remove", targetId: entry.id, metadataSummary: "One scoped removal retained the previous exact Definition ID." }]
  });
});
