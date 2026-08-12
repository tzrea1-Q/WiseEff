import "dotenv/config";
import { expect, test, type Page } from "playwright/test";

import { runNpmScript, withPgClient } from "./helpers/database";
import { authHeadersForUser, signInBrowserAsUser } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

// Browser acceptance artifacts for this spec are written by Playwright to:
// - test-results/acceptance
// - playwright-report/acceptance/index.html
// - test-results/acceptance-operation-evidence/*.json and *.png
// Manual playwright-cli evidence, when captured outside the automated run, should live under work/ui-checks/knowledge-*.

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const editorUserId = "acceptance-knowledge-editor";
const editorEmail = "kb.acceptance@chargelab.cn";
const editorName = "KB Acceptance Editor";
const editorRoleBindingId = "acceptance-knowledge-editor-hardware-user";
const titlePrefix = "KB-ACCEPT";
const runStamp = Date.now();

type KnowledgeEntryApiItem = {
  id: string;
  title: string;
  contentForm: "markdown" | "file";
  status: "draft" | "published" | "archived";
  tags: string[];
  headRevisionNumber: number;
  createdByUserId: string;
  contentMarkdown: string | null;
  file: { id: string; fileName: string; extractionStatus: "pending" | "succeeded" | "failed"; extractionError: string | null } | null;
};

type KnowledgeSearchApiItem = { entryId: string; title: string; excerpt: string };

type AuditApiItem = {
  id?: string;
  kind: string;
  action: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

function editorHeaders() {
  return authHeadersForUser(editorUserId, editorEmail, editorName);
}

async function seedKnowledgeAcceptanceUser() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, $3, $4, 'Knowledge Beta Editor', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [editorUserId, organizationId, editorName, editorEmail]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, null, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [editorRoleBindingId, editorUserId, organizationId]
    );
  });
}

async function cleanupKnowledgeAcceptanceRows() {
  await withPgClient(async (client) => {
    const entries = await client.query<{ id: string }>(
      `select id from knowledge_entries where title like $1`,
      [`${titlePrefix}%`]
    );
    const entryIds = entries.rows.map((row) => row.id);

    if (entryIds.length > 0) {
      await client.query("delete from audit_events where app = 'knowledge' and target_id = any($1::text[])", [entryIds]);
      await client.query("update knowledge_entries set head_revision_id = null where id = any($1::uuid[])", [entryIds]);
      await client.query("delete from knowledge_entries where id = any($1::uuid[])", [entryIds]);
    }
  });
}

async function createMarkdownEntryViaApi(page: Page, input: { title: string; tags: string[]; contentMarkdown: string }) {
  const response = await page.request.post(apiRoute("/api/v1/knowledge/entries"), {
    headers: editorHeaders(),
    data: { contentForm: "markdown", ...input }
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { item: KnowledgeEntryApiItem };
  return body.item;
}

async function publishEntryViaApi(page: Page, entryId: string) {
  const response = await page.request.post(apiRoute(`/api/v1/knowledge/entries/${entryId}/publish`), {
    headers: editorHeaders(),
    data: {}
  });
  expect(response.status()).toBe(200);
}

async function knowledgeEntryDbSummary(entryId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      status: string;
      head_revision_number: number;
      revision_count: string;
      extraction_status: string | null;
    }>(
      `
      select
        entry.status,
        entry.head_revision_number,
        (select count(*)::text from knowledge_revisions where entry_id = entry.id) as revision_count,
        (
          select files.extraction_status
          from knowledge_revisions revisions
          join knowledge_files files on files.id = revisions.file_id
          where revisions.id = entry.head_revision_id
        ) as extraction_status
      from knowledge_entries entry
      where entry.id = $1
      `,
      [entryId]
    );
    const row = result.rows[0];

    return {
      table: "knowledge_entries,knowledge_revisions,knowledge_files",
      predicate: `entryId=${entryId}`,
      observed: row
        ? `status=${row.status}; headRevision=${row.head_revision_number}; revisions=${row.revision_count}; extraction=${row.extraction_status ?? "n/a"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function knowledgeAuditSummaries(entryId: string) {
  const response = await fetch(apiRoute("/api/v1/audit-events"), {
    headers: { Accept: "application/json", ...smokeHeaders() }
  });
  expect(response.ok).toBe(true);
  const body = (await response.json()) as { items: AuditApiItem[] };
  return body.items
    .filter((item) => item.targetId === entryId && item.kind.startsWith("knowledge-"))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      action: item.action,
      targetId: item.targetId,
      requestId: item.traceId,
      metadataSummary: Object.keys(item.metadata ?? {}).sort().join(",")
    }));
}

async function openKnowledgePage(page: Page) {
  await signInBrowserAsUser(page, editorUserId, editorEmail, editorName, "/knowledge");
  await expect(page.getByRole("table", { name: "知识条目列表" })).toBeVisible();
}

test.describe("Knowledge base browser acceptance", () => {
  test.beforeAll(async () => {
    // First-time db:seed:m1 ingests the full DTS seed catalog and can exceed the default hook timeout.
    test.setTimeout(420_000);
    runNpmScript("db:migrate");
    runNpmScript("db:seed:m0");
    // The app shell loads the active project's initialization status, so the
    // acceptance database needs the M1 project seed like other browser specs.
    runNpmScript("db:seed:m1");
    await seedKnowledgeAcceptanceUser();
    await cleanupKnowledgeAcceptanceRows();
  });

  test.afterAll(async () => {
    await cleanupKnowledgeAcceptanceRows();
  });

  test("lists knowledge entries, searches published entries only, and reads a published detail", async ({ page }, testInfo) => {
    // @acceptance KB-READ-001
    // @operation KB-READ-001
    const publishedTitle = `${titlePrefix} 快充温控检索条目 ${runStamp}`;
    const draftTitle = `${titlePrefix} 草稿条目 ${runStamp}`;
    const publishedKeyword = `温控降流阈值${runStamp}`;
    const draftKeyword = `草稿独占关键词${runStamp}`;

    const published = await createMarkdownEntryViaApi(page, {
      title: publishedTitle,
      tags: ["project-aurora", "快充"],
      contentMarkdown: `当电池温度超过 45 度时降低快充电流。${publishedKeyword}`
    });
    await publishEntryViaApi(page, published.id);
    const draft = await createMarkdownEntryViaApi(page, {
      title: draftTitle,
      tags: ["草稿"],
      contentMarkdown: `尚未发布的内容。${draftKeyword}`
    });

    await openKnowledgePage(page);
    const table = page.getByRole("table", { name: "知识条目列表" });
    await expect(table.getByText(publishedTitle)).toBeVisible();
    await expect(table.getByText(draftTitle)).toBeVisible();

    // Search hits the published entry.
    await page.getByRole("searchbox", { name: "检索知识库" }).fill(publishedKeyword);
    await page.getByRole("button", { name: "检索", exact: true }).click();
    const results = page.getByLabel("检索结果");
    await expect(results.getByText(publishedTitle)).toBeVisible();

    // The draft keyword returns nothing: drafts never appear in search results.
    await page.getByRole("searchbox", { name: "检索知识库" }).fill(draftKeyword);
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await expect(page.getByText("没有命中已发布的知识条目。")).toBeVisible();

    const searchResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(draftKeyword)}`),
      { headers: editorHeaders() }
    );
    expect(searchResponse.ok()).toBe(true);
    const searchBody = (await searchResponse.json()) as { items: KnowledgeSearchApiItem[] };
    expect(searchBody.items).toHaveLength(0);

    // Read the published entry detail from the search results.
    await page.getByRole("searchbox", { name: "检索知识库" }).fill(publishedKeyword);
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await results.getByText(publishedTitle).click();
    const detail = page.getByRole("dialog", { name: new RegExp(publishedTitle) });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();
    await expect(detail.getByText(/当电池温度超过 45 度/)).toBeVisible();

    const dbSummary = await knowledgeEntryDbSummary(published.id);
    expect(dbSummary.observed).toContain("status=published");

    await recordOperationEvidence({
      operationId: "KB-READ-001",
      title: "knowledge list search published only and read detail",
      status: "passed",
      role: "Hardware User",
      route: "/knowledge",
      page,
      testInfo,
      api: [
        summarizeApiResponse(searchResponse, {
          method: "GET",
          path: "/api/v1/knowledge/search",
          responseSummary: `draft keyword hits=${searchBody.items.length} (expected 0)`
        })
      ],
      db: [dbSummary, await knowledgeEntryDbSummary(draft.id)]
    });
  });

  test("creates, publishes, revises, and restores a markdown entry with revisions and audit", async ({ page }, testInfo) => {
    // @acceptance KB-EDIT-001
    // @operation KB-EDIT-001
    const title = `${titlePrefix} 编辑生命周期 ${runStamp}`;

    await openKnowledgePage(page);

    // Create a markdown draft through the split editor.
    await page.getByRole("button", { name: "新建条目" }).click();
    const editor = page.getByRole("dialog", { name: "新建 Markdown 条目" });
    await editor.getByLabel("条目标题").fill(title);
    await editor.getByLabel("标签(逗号分隔)").fill("project-aurora, 调参");
    await editor.getByLabel("Markdown 内容").fill("# 初版\n\n第一版正文。");
    await expect(editor.getByLabel("预览").locator("h1")).toHaveText("初版");
    await editor.getByRole("button", { name: "创建草稿" }).click();

    const detail = page.getByRole("dialog", { name: new RegExp(title) });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="draft"]')).toBeVisible();

    // Publish it into retrieval.
    await detail.getByRole("button", { name: "发布", exact: true }).click();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();

    // Edit the published entry in place: a new immutable revision.
    await detail.getByRole("button", { name: "编辑", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "编辑知识条目" });
    await editDialog.getByLabel("Markdown 内容").fill("# 第二版\n\n发布后的就地修订。");
    await editDialog.getByRole("button", { name: "保存为新修订" }).click();
    await expect(editDialog).not.toBeVisible();
    await expect(detail.getByText("修订 #2", { exact: false })).toBeVisible();

    // Restore revision 1 as a new revision 3.
    await detail.getByRole("button", { name: "修订历史" }).click();
    const revisions = page.getByRole("dialog", { name: /修订历史/ });
    await expect(revisions.getByText("修订 #2")).toBeVisible();
    await revisions
      .locator("li", { hasText: "修订 #1" })
      .getByRole("button", { name: "恢复此版本" })
      .click();
    const confirm = page.getByRole("dialog", { name: /恢复修订 #1/ });
    await confirm.getByRole("button", { name: "恢复为新修订" }).click();
    await expect(revisions).not.toBeVisible();
    await expect(detail.getByText("修订 #3", { exact: false })).toBeVisible();

    // API + DB + audit assertions.
    const listResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/entries?q=${encodeURIComponent(title)}`),
      { headers: editorHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: KnowledgeEntryApiItem[] };
    const entry = listBody.items.find((item) => item.title === title);
    expect(entry).toBeTruthy();
    expect(entry).toMatchObject({ status: "published", headRevisionNumber: 3 });
    expect(entry!.contentMarkdown).toContain("初版");

    const dbSummary = await knowledgeEntryDbSummary(entry!.id);
    expect(dbSummary.observed).toContain("headRevision=3");
    expect(dbSummary.observed).toContain("revisions=3");

    const audit = await knowledgeAuditSummaries(entry!.id);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "knowledge-entry-create", action: "create" }),
        expect.objectContaining({ kind: "knowledge-entry-publish", action: "publish" }),
        expect.objectContaining({ kind: "knowledge-entry-update", action: "update" }),
        expect.objectContaining({ kind: "knowledge-revision-restore", action: "restore-revision" })
      ])
    );

    await recordOperationEvidence({
      operationId: "KB-EDIT-001",
      title: "markdown entry create publish revise restore",
      status: "passed",
      role: "Hardware User",
      route: "/knowledge",
      page,
      testInfo,
      api: [
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/knowledge/entries",
          responseSummary: `entry=${entry!.id}; headRevision=${entry!.headRevisionNumber}`
        })
      ],
      db: [dbSummary],
      audit
    });
  });

  test("uploads a file entry and sees its extraction status", async ({ page }, testInfo) => {
    // @acceptance KB-FILE-001
    // @operation KB-FILE-001
    const title = `${titlePrefix} 文件条目 ${runStamp}`;
    const extractedKeyword = `充电泵手册关键词${runStamp}`;

    await openKnowledgePage(page);

    await page.getByRole("button", { name: "上传文件条目" }).click();
    const upload = page.getByRole("dialog", { name: "上传文件条目" });
    await upload.getByLabel("条目标题").fill(title);
    await upload.getByLabel("标签(逗号分隔)").fill("硬件手册");
    await upload.getByLabel("选择文件").setInputFiles({
      name: "kb-acceptance-manual.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`SC8562 charge pump manual excerpt. ${extractedKeyword}`, "utf8")
    });
    await upload.getByRole("button", { name: "上传并创建草稿" }).click();

    // The detail dialog opens with the visible extraction status.
    const detail = page.getByRole("dialog", { name: new RegExp(title) });
    await expect(detail).toBeVisible();
    await expect(detail.getByText("提取成功")).toBeVisible();
    await expect(detail.getByText("kb-acceptance-manual.txt")).toBeVisible();

    // Extraction status is also visible in the entry list column.
    await detail.getByRole("button", { name: "关闭" }).click();
    const table = page.getByRole("table", { name: "知识条目列表" });
    await expect(table.locator("tr", { hasText: title }).getByText("提取成功")).toBeVisible();

    const listResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/entries?q=${encodeURIComponent(title)}`),
      { headers: editorHeaders() }
    );
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: KnowledgeEntryApiItem[] };
    const entry = listBody.items.find((item) => item.title === title);
    expect(entry).toBeTruthy();
    expect(entry!.file).toMatchObject({ fileName: "kb-acceptance-manual.txt", extractionStatus: "succeeded" });

    // Publish and prove the extracted text is retrievable (published-only gate).
    await publishEntryViaApi(page, entry!.id);
    const searchResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(extractedKeyword)}`),
      { headers: editorHeaders() }
    );
    expect(searchResponse.ok()).toBe(true);
    const searchBody = (await searchResponse.json()) as { items: KnowledgeSearchApiItem[] };
    expect(searchBody.items.map((item) => item.entryId)).toContain(entry!.id);

    const dbSummary = await knowledgeEntryDbSummary(entry!.id);
    expect(dbSummary.observed).toContain("extraction=succeeded");

    const audit = await knowledgeAuditSummaries(entry!.id);
    expect(audit).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "knowledge-entry-create", action: "create" })])
    );

    await recordOperationEvidence({
      operationId: "KB-FILE-001",
      title: "file entry upload with visible extraction status",
      status: "passed",
      role: "Hardware User",
      route: "/knowledge",
      page,
      testInfo,
      api: [
        summarizeApiResponse(searchResponse, {
          method: "GET",
          path: "/api/v1/knowledge/search",
          responseSummary: `extracted keyword hits entry=${entry!.id}`
        })
      ],
      db: [dbSummary],
      audit
    });
  });
});
