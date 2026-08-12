import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";

import { withPgClient } from "./helpers/database";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsRole, signInBrowserAsUser } from "./helpers/bearerAuth";
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

type KnowledgeSearchApiItem = { entryId: string; title: string; excerpt: string; revisionId?: string | null };

type KnowledgeIndexStatusApiItem = {
  entryId: string;
  title: string;
  entryStatus: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  error: string | null;
  indexedRevisionNumber: number | null;
  chunkCount: number;
};

type KnowledgeIndexHealthApiBody = {
  retrieval: { mode: string; vectorAvailable: boolean; embeddingConfigured: boolean };
  items: KnowledgeIndexStatusApiItem[];
};

type XiaozeCitationApiItem = { type: string; id: string; label: string; href?: string };

type AuditApiItem = {
  id?: string;
  kind: string;
  action: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

function runNpmScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [`npm run ${script} failed with exit code ${result.status}.`, stdout, stderr, errorDetails].filter(Boolean).join("\n")
    );
  }
}

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

async function fetchIndexHealth(page: Page): Promise<KnowledgeIndexHealthApiBody> {
  const response = await page.request.get(apiRoute("/api/v1/knowledge/index/status"), {
    headers: authHeadersForRole("admin")
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as KnowledgeIndexHealthApiBody;
}

async function waitForIndexStatus(
  page: Page,
  entryId: string,
  predicate: (item: KnowledgeIndexStatusApiItem) => boolean,
  timeoutMs = 30_000
): Promise<KnowledgeIndexStatusApiItem> {
  const deadline = Date.now() + timeoutMs;
  let last: KnowledgeIndexStatusApiItem | undefined;
  while (Date.now() < deadline) {
    const health = await fetchIndexHealth(page);
    last = health.items.find((item) => item.entryId === entryId);
    if (last && predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Index status for ${entryId} did not reach the expected state: ${JSON.stringify(last)}`);
}

function readSseCustomEventValue<T>(responseBody: string, eventName: string): T | undefined {
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; name?: string; value?: T };
      if (payload.type === "CUSTOM" && payload.name === eventName && payload.value !== undefined) {
        return payload.value;
      }
    } catch {
      // Ignore non-JSON keepalive frames.
    }
  }
  return undefined;
}

function readSseAnswerText(responseBody: string) {
  const chunks: string[] = [];
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: string; delta?: string; message?: string };
      if (payload.type === "TEXT_MESSAGE_CONTENT" && payload.delta) {
        chunks.push(payload.delta);
      }
      if (payload.type === "RUN_ERROR" && payload.message) {
        chunks.push(payload.message);
      }
    } catch {
      // Ignore non-JSON keepalive frames.
    }
  }
  return chunks.join("");
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

  test("asks the knowledge base through the Xiaoze entry with citation deep links", async ({ page }, testInfo) => {
    // @acceptance KB-ASK-001
    // @operation KB-ASK-001
    const title = `${titlePrefix} 快充温控问答条目 ${runStamp}`;
    const entry = await createMarkdownEntryViaApi(page, {
      title,
      tags: ["快充"],
      contentMarkdown: `当电池温度超过 45 度时,按 0.5A 步长下调快充电流。问答关键词${runStamp}`
    });
    await publishEntryViaApi(page, entry.id);

    // Browser part: the API-mode ask entry opens Xiaoze on /knowledge.
    await openKnowledgePage(page);
    const askButton = page.getByRole("button", { name: /问知识库/ });
    await expect(askButton).toBeVisible();
    await askButton.click();
    await expect(page.getByTestId("xiaoze-popup-layer")).toBeVisible();

    // Grounding loop: deterministic Xiaoze run calls knowledge.search and the
    // turn reply carries knowledge citations with /knowledge deep links (the
    // full Xiaoze browser loop has no deterministic browser acceptance today,
    // so this is asserted at the SSE API level like XIAOZE-PERCEPTION-001).
    const sseResponse = await page.request.post(apiRoute("/api/v1/agent/xiaoze"), {
      headers: { ...editorHeaders(), Accept: "text/event-stream" },
      data: {
        threadId: `kb-ask-${runStamp}`,
        runId: `run-kb-ask-${runStamp}`,
        messages: [{ id: "m-user-kb-ask", role: "user", content: `知识库检索:快充温控问答条目 ${runStamp}` }],
        context: [
          {
            description: "wiseeff.page",
            value: { pageKey: "knowledge", path: "/knowledge" }
          }
        ]
      }
    });
    expect(sseResponse.status()).toBe(200);
    const sseBody = await sseResponse.text();
    const answer = readSseAnswerText(sseBody);
    expect(answer).toContain("[citation:knowledge]");

    const turnReply = readSseCustomEventValue<{ citations?: XiaozeCitationApiItem[] }>(sseBody, "xiaoze_turn_reply");
    expect(turnReply?.citations?.length ?? 0).toBeGreaterThan(0);
    const citation = turnReply!.citations!.find((item) => item.id === entry.id);
    expect(citation).toMatchObject({ type: "knowledge", label: title, href: `/knowledge?entryId=${entry.id}` });

    // The citation deep link opens the published entry detail on /knowledge.
    await page.goto(`/knowledge?entryId=${entry.id}`, { waitUntil: "domcontentloaded" });
    const detail = page.getByRole("dialog", { name: new RegExp(title) });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();

    await recordOperationEvidence({
      operationId: "KB-ASK-001",
      title: "ask the knowledge base via Xiaoze with citation deep link",
      status: "passed",
      role: "Hardware User",
      route: "/knowledge",
      page,
      testInfo,
      api: [
        summarizeApiResponse(sseResponse, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: `answer="${answer.slice(0, 120)}"; citation=${citation?.href ?? "missing"}`
        })
      ]
    });
  });

  test("shows index health with retry and rebuild on /knowledge-admin", async ({ page }, testInfo) => {
    // @acceptance KB-INDEX-001
    // @operation KB-INDEX-001
    const title = `${titlePrefix} 索引健康条目 ${runStamp}`;
    const entry = await createMarkdownEntryViaApi(page, {
      title,
      tags: [],
      contentMarkdown: `索引健康验证内容。${runStamp}`
    });
    await publishEntryViaApi(page, entry.id);

    // The in-process polling worker indexes the published entry.
    const indexed = await waitForIndexStatus(page, entry.id, (item) => item.status === "succeeded");
    expect(indexed.indexedRevisionNumber).toBe(1);
    expect(indexed.chunkCount).toBeGreaterThan(0);

    await signInBrowserAsRole(page, "admin", "/knowledge-admin");
    const banner = page.getByLabel("检索模式");
    await expect(banner).toBeVisible();
    // Honest retrieval-mode banner: this local/CI PostgreSQL has no pgvector.
    const health = await fetchIndexHealth(page);
    if (health.retrieval.mode === "fts_only") {
      await expect(banner).toContainText("仅全文检索");
    } else {
      await expect(banner).toContainText("语义 + 全文混合检索");
    }

    const indexTable = page.getByRole("table", { name: "知识索引状态" });
    const row = indexTable.locator("tr", { hasText: title }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("已索引")).toBeVisible();

    // Retry re-enqueues the entry and the worker converges back to succeeded.
    await row.getByRole("button", { name: "重试" }).click();
    await waitForIndexStatus(page, entry.id, (item) => item.status === "succeeded");

    // Rebuild-all enqueues every published entry.
    await page.getByRole("button", { name: "全量重建索引" }).click();
    await expect(page.getByText(/已重新入队 \d+ 条已发布条目/)).toBeVisible();
    await waitForIndexStatus(page, entry.id, (item) => item.status === "succeeded");

    const dbSummary = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; chunk_count: number; indexed_revision_number: number }>(
        `select status, chunk_count, indexed_revision_number from knowledge_index_status where entry_id = $1`,
        [entry.id]
      );
      const chunkResult = await client.query<{ n: string }>(
        `select count(*)::text as n from knowledge_chunks where entry_id = $1`,
        [entry.id]
      );
      const row0 = result.rows[0];
      return {
        table: "knowledge_index_status,knowledge_chunks",
        predicate: `entryId=${entry.id}`,
        observed: row0
          ? `status=${row0.status}; chunkCount=${row0.chunk_count}; indexedRevision=${row0.indexed_revision_number}; chunkRows=${chunkResult.rows[0].n}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(dbSummary.observed).toContain("status=succeeded");

    await recordOperationEvidence({
      operationId: "KB-INDEX-001",
      title: "knowledge index health with retry and rebuild",
      status: "passed",
      role: "Admin",
      route: "/knowledge-admin",
      page,
      testInfo,
      api: [
        {
          method: "GET",
          path: "/api/v1/knowledge/index/status",
          status: 200,
          responseSummary: `mode=${health.retrieval.mode}; vectorAvailable=${health.retrieval.vectorAvailable}`
        }
      ],
      db: [dbSummary]
    });
  });
});
