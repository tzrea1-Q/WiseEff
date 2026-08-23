import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";

import { runNpmScript, withPgClient } from "./helpers/database";
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
// Reload distillation needs the /dts-reload page (hardware-committer) plus the
// debugging:dts-reload read gate, so KB-DISTILL-002 runs as a committer user.
const committerUserId = "acceptance-kb-reload-editor";
const committerEmail = "kb.reload.acceptance@chargelab.cn";
const committerName = "KB Reload Acceptance Committer";
const committerRoleBindingId = "acceptance-kb-reload-editor-hardware-committer";
const titlePrefix = "KB-ACCEPT";
const reloadRunIdPrefix = "kb-acceptance-reload-";
const runStamp = Date.now();

type KnowledgeEntryApiItem = {
  id: string;
  title: string;
  contentForm: "markdown" | "file";
  status: "draft" | "published" | "archived";
  tags: string[];
  sourceType: "human" | "agent";
  sourceSessionId: string | null;
  sourceLogId: string | null;
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

function editorHeaders() {
  return authHeadersForUser(editorUserId, editorEmail, editorName);
}

async function seedKnowledgeAcceptanceUser() {
  await withPgClient(async (client) => {
    for (const [userId, name, email, bindingId, roleId] of [
      [editorUserId, editorName, editorEmail, editorRoleBindingId, "hardware-user"],
      [committerUserId, committerName, committerEmail, committerRoleBindingId, "hardware-committer"]
    ] as const) {
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
        [userId, organizationId, name, email]
      );
      await client.query(
        `
        insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, $2, $3, null, $4)
        on conflict (id) do update set
          project_id = excluded.project_id,
          role_id = excluded.role_id
        `,
        [bindingId, userId, organizationId, roleId]
      );
    }
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

    // KB-XREF fixtures: seeded parameter definitions (reference rows cascade
    // with their entries above, so only the catalog rows remain).
    await client.query(`delete from knowledge_parameter_references where parameter_spec_id like 'pspec:kb-xref-%'`);
    await client.query(`delete from parameter_spec_versions where parameter_spec_id like 'pspec:kb-xref-%'`);
    await client.query(`delete from parameter_specs where id like 'pspec:kb-xref-%'`);
    await client.query(`delete from attribution_subjects where id like 'asub:kb-xref-%'`);

    // Distillation-source fixtures: seeded completed log analyses (KB-DISTILL/KB-ADMIN).
    const logs = await client.query<{ id: string }>(`select id from log_records where file_name like 'kb-acceptance-distill-%'`);
    const logIds = logs.rows.map((row) => row.id);
    if (logIds.length > 0) {
      await client.query("update log_records set current_run_id = null where id = any($1::text[])", [logIds]);
      await client.query("delete from log_evidence where log_record_id = any($1::text[])", [logIds]);
      await client.query("delete from log_analysis_reports where log_record_id = any($1::text[])", [logIds]);
      await client.query("delete from log_analysis_runs where log_record_id = any($1::text[])", [logIds]);
      await client.query("delete from log_records where id = any($1::text[])", [logIds]);
      await client.query("delete from log_file_objects where file_name like 'kb-acceptance-distill-%'");
    }

    // Reload-distillation fixtures (KB-DISTILL-002): entries distilled from
    // seeded terminal reload runs plus the runs themselves.
    const reloadEntries = await client.query<{ id: string }>(
      `select id from knowledge_entries where source_reload_run_id like $1`,
      [`${reloadRunIdPrefix}%`]
    );
    const reloadEntryIds = reloadEntries.rows.map((row) => row.id);
    if (reloadEntryIds.length > 0) {
      await client.query("delete from audit_events where app = 'knowledge' and target_id = any($1::text[])", [reloadEntryIds]);
      await client.query("update knowledge_entries set head_revision_id = null where id = any($1::uuid[])", [reloadEntryIds]);
      await client.query("delete from knowledge_entries where id = any($1::uuid[])", [reloadEntryIds]);
    }
    await client.query("delete from dts_reload_runs where id like $1", [`${reloadRunIdPrefix}%`]);
  });
}

type SeededCompletedLog = { logId: string; fileName: string; conclusion: string; keyword: string };

type SeededParameterSpec = { specId: string; propertyKey: string; displayName: string; subjectName: string };

/**
 * Seeds a parameter definition the way the catalog stores it (spec row +
 * attribution subject + active version) so knowledge entries can reference
 * the `parameter_specs.id` surrogate.
 */
async function seedParameterSpec(input: {
  slug: string;
  propertyKey: string;
  displayName: string;
  subjectName: string;
}): Promise<SeededParameterSpec> {
  const specId = `pspec:kb-xref-${input.slug}-${runStamp}`;
  const subjectId = `asub:kb-xref-${input.slug}-${runStamp}`;
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
      values ($1, $2, 'driver-registration', $3, $1)
      on conflict (id) do nothing
      `,
      [subjectId, organizationId, input.subjectName]
    );
    await client.query(
      `
      insert into parameter_specs (id, organization_id, source_kind, specification_key, property_key, attribution_subject_id, definition_lifecycle)
      values ($1, $2, 'manual', $3, $4, $5, 'active')
      on conflict (id) do nothing
      `,
      [specId, organizationId, `manual/${specId}/${input.propertyKey}`, input.propertyKey, subjectId]
    );
    await client.query(
      `
      insert into parameter_spec_versions (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
      values ($1, $2, 1, $3, '', '{"kind":"int32"}'::jsonb, 'active', 'active')
      on conflict (id) do nothing
      `,
      [`${specId}:v1`, specId, input.displayName]
    );
  });
  return { specId, propertyKey: input.propertyKey, displayName: input.displayName, subjectName: input.subjectName };
}

/**
 * Seeds a COMPLETED log-analysis record directly (record + succeeded run +
 * report + evidence) so distillation does not depend on the async analysis
 * worker. Coupled only to the stored analysis-record shape, like the API.
 */
async function seedCompletedLogAnalysis(): Promise<SeededCompletedLog> {
  const logId = randomUUID();
  const runId = randomUUID();
  const fileObjectId = randomUUID();
  const fileName = `kb-acceptance-distill-${runStamp}-${logId.slice(0, 8)}.log`;
  const keyword = `温控降流阈值${logId.slice(0, 8)}`;
  const conclusion = `${titlePrefix} 快充后段降频源于电池温度超过 45 度(${keyword})`;

  await withPgClient(async (client) => {
    await client.query(
      `
      insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256, uploaded_by_user_id)
      values ($1, $2, $3, $4, 'text/plain', 2048, 'kb-acceptance-checksum', $5)
      `,
      [fileObjectId, organizationId, `acceptance/${fileObjectId}`, fileName, editorUserId]
    );
    await client.query(
      `
      insert into log_records (id, organization_id, file_object_id, file_name, source, status, analysis_question, submitted_by_user_id)
      values ($1, $2, $3, $4, 'upload', 'complete', '为什么充电后段降频?', $5)
      `,
      [logId, organizationId, fileObjectId, fileName, editorUserId]
    );
    await client.query(
      `
      insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage, progress)
      values ($1, $2, $3, 'succeeded', 'report', 100)
      `,
      [runId, organizationId, logId]
    );
    await client.query(`update log_records set current_run_id = $2 where id = $1`, [logId, runId]);
    await client.query(
      `
      insert into log_analysis_reports (id, organization_id, log_record_id, run_id, confidence, conclusion, impact, severity, suggested_actions, raw_lines)
      values ($1, $2, $3, $4, 87, $5, '夜间快充整体时长增加约 25 分钟。', 'Critical', $6, $7)
      `,
      [
        `report-${runId}`,
        organizationId,
        logId,
        runId,
        conclusion,
        JSON.stringify(["下调快充电流", "复核 NTC 采样间隔"]),
        JSON.stringify(["boot ok", "temp=45.2C stage up", "current step down 0.5A"])
      ]
    );
    await client.query(
      `
      insert into log_evidence (id, organization_id, log_record_id, run_id, stage, line_numbers, inference, suggested_action, rule_hit)
      values ($1, $2, $3, $4, 'rootcause', $5, 'NTC 采样显示温度台阶式上升。', '按 0.5A 步长下调快充电流。', null)
      `,
      [`evidence-${runId}-0`, organizationId, logId, runId, [2, 3]]
    );
  });

  return { logId, fileName, conclusion, keyword };
}

type SeededTerminalReloadRun = { runId: string; propertyKey: string; deviceId: string; targetRef: string };

/**
 * Seeds a TERMINAL (unverifiable) reload run with snapshot evidence directly,
 * the same seeding approach as the dts-reload acceptance specs: the run row is
 * the stored evidence subject, so distillation needs no bridge or deploy.
 * Targets reference a real project binding (FK) from the M1 seed catalog.
 */
async function seedTerminalReloadRun(): Promise<SeededTerminalReloadRun> {
  const runId = `${reloadRunIdPrefix}${runStamp}-${randomUUID().slice(0, 8)}`;
  const propertyKey = `kb_reload_watchdog_${runStamp}`;
  const deviceId = "bridge:kb-acceptance";
  const targetRef = "KB-ACCEPT-01";

  await withPgClient(async (client) => {
    const binding = await client.query<{ id: string; project_id: string }>(
      `select id, project_id from project_parameter_bindings where organization_id = $1 order by id limit 1`,
      [organizationId]
    );
    const bindingRow = binding.rows[0];
    if (!bindingRow) {
      throw new Error("No project_parameter_bindings available; run db:seed:m1 before KB-DISTILL-002.");
    }

    const snapshot = {
      libraryBaselines: [
        { bindingId: bindingRow.id, propertyKey, nodePath: "/amba/i2c@FF120000/charger@6E", baselineValue: "<6000>" }
      ],
      artifactDigest: { sha256: "kb-acceptance-art-sha", onDeviceDigest: "kb-acceptance-art-sha", integrityCheck: "sha256" },
      kernelSignal: {
        command: "dmesg",
        captureStatus: "obtained",
        captureError: null,
        rawText: `kernel: ${propertyKey} applied\nkernel: overlay reload ok\n`,
        truncated: false,
        matchedByParameter: [
          { parameterName: propertyKey, bindingId: bindingRow.id, lines: [`kernel: ${propertyKey} applied`] }
        ],
        excerpt: null
      },
      behaviouralVerification: {
        outcomes: [
          {
            bindingId: bindingRow.id,
            propertyKey,
            outcome: "unbound",
            debugNodeId: null,
            nodePath: null,
            expectedValue: "<7000>",
            readValue: null,
            reason: "No readable debug-node binding for this parameter and protocol."
          }
        ]
      }
    };

    await client.query(
      `
      insert into dts_reload_runs (
        id, organization_id, project_id, status, purpose, failure_code, steps, diagnostics, tool_versions,
        device_id, bridge_id, bridge_machine_label, target_ref, protocol, integrity_check, reload_snapshot,
        overlay_artifact_sha256, created_by_user_id, completed_at
      ) values (
        $1, $2, $3, 'unverifiable', 'ordinary', null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        $4, 'kb-acceptance-bridge', 'KB Acceptance Bridge', $5, 'hdc', 'sha256', $6::jsonb,
        'kb-acceptance-art-sha', $7, now()
      )
      `,
      [runId, organizationId, bindingRow.project_id, deviceId, targetRef, JSON.stringify(snapshot), committerUserId]
    );
    await client.query(
      `
      insert into dts_reload_run_targets (
        id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value, sort_order
      ) values ($1, $2, $3, '/amba/i2c@FF120000/charger@6E', $4, '<6000>', '<7000>', 0)
      `,
      [randomUUID(), runId, bindingRow.id, propertyKey]
    );
  });

  return { runId, propertyKey, deviceId, targetRef };
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

function readSseInterruptValue(responseBody: string): Record<string, unknown> | undefined {
  const interrupt = readSseCustomEventValue<Record<string, unknown>>(responseBody, "on_interrupt");
  if (interrupt) {
    return interrupt;
  }
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      const payload = JSON.parse(dataLine.slice(5).trim()) as {
        type?: string;
        outcome?: { interrupts?: Array<{ metadata?: Record<string, unknown> }> };
      };
      if (payload.type === "RUN_FINISHED" && payload.outcome?.interrupts?.[0]?.metadata) {
        return payload.outcome.interrupts[0].metadata;
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
    await expect(row.locator('[data-index-status="succeeded"]')).toBeVisible();

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

  test("distils a completed log analysis into a pre-filled draft and publishes it after review", async ({ page }, testInfo) => {
    // @acceptance KB-DISTILL-001
    // @operation KB-DISTILL-001
    const seeded = await seedCompletedLogAnalysis();

    await signInBrowserAsUser(page, editorUserId, editorEmail, editorName, "/logs");
    const history = page.getByRole("complementary", { name: "历史日志记录" });
    await history.getByRole("button", { name: new RegExp(seeded.fileName.slice(0, 40)) }).click();

    // Distil the conclusion into a knowledge draft and hand off to /knowledge.
    const distilButton = page.getByRole("button", { name: "沉淀为知识" });
    await expect(distilButton).toBeEnabled();
    await distilButton.click();
    await page.waitForURL(/\/knowledge\?entryId=/);
    const entryId = new URL(page.url()).searchParams.get("entryId")!;
    expect(entryId).toBeTruthy();

    // The deep link opens the pre-filled draft: title from the conclusion,
    // seeded tags, and the assembled markdown body.
    const detail = page.getByRole("dialog", { name: /快充后段降频源于电池温度超过 45 度/ });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="draft"]')).toBeVisible();
    await expect(detail.getByText("日志分析", { exact: true })).toBeVisible();
    await expect(detail.getByText(/由日志分析记录沉淀/)).toBeVisible();
    await expect(detail.getByText(/NTC 采样显示温度台阶式上升/)).toBeVisible();

    // Drafts stay out of retrieval until published.
    const beforePublish = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(seeded.keyword)}`),
      { headers: editorHeaders() }
    );
    expect(beforePublish.ok()).toBe(true);
    expect(((await beforePublish.json()) as { items: KnowledgeSearchApiItem[] }).items).toHaveLength(0);

    // Publish the reviewed draft from the detail dialog.
    await detail.getByRole("button", { name: "发布", exact: true }).click();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();

    const afterPublish = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(seeded.keyword)}`),
      { headers: editorHeaders() }
    );
    const afterBody = (await afterPublish.json()) as { items: KnowledgeSearchApiItem[] };
    expect(afterBody.items.map((item) => item.entryId)).toContain(entryId);

    // Source linkage is stored on the entry.
    const entryResponse = await page.request.get(apiRoute(`/api/v1/knowledge/entries/${entryId}`), {
      headers: editorHeaders()
    });
    expect(entryResponse.ok()).toBe(true);
    const entryBody = (await entryResponse.json()) as { item: KnowledgeEntryApiItem };
    expect(entryBody.item).toMatchObject({ sourceType: "human", sourceLogId: seeded.logId, status: "published" });

    const dbSummary = await knowledgeEntryDbSummary(entryId);
    expect(dbSummary.observed).toContain("status=published");

    const audit = await knowledgeAuditSummaries(entryId);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "knowledge-entry-distill", action: "distill" }),
        expect.objectContaining({ kind: "knowledge-entry-publish", action: "publish" })
      ])
    );

    await recordOperationEvidence({
      operationId: "KB-DISTILL-001",
      title: "distil log conclusion into pre-filled draft and publish",
      status: "passed",
      role: "Hardware User",
      route: "/logs",
      page,
      testInfo,
      api: [
        summarizeApiResponse(entryResponse, {
          method: "GET",
          path: "/api/v1/knowledge/entries/:entryId",
          responseSummary: `entry=${entryId}; sourceLogId=${seeded.logId}`
        })
      ],
      db: [dbSummary],
      audit
    });
  });

  test("distils a terminal reload run into a pre-filled draft with honest outcome wording and publishes it", async ({ page }, testInfo) => {
    // @acceptance KB-DISTILL-002
    // @operation KB-DISTILL-002
    const seeded = await seedTerminalReloadRun();
    const committerHeaders = authHeadersForUser(committerUserId, committerEmail, committerName);

    // The /dts-reload?runId= deep link opens the seeded terminal run's detail.
    await signInBrowserAsUser(
      page,
      committerUserId,
      committerEmail,
      committerName,
      `/dts-reload?runId=${encodeURIComponent(seeded.runId)}`
    );
    const runResult = page.getByLabel("运行摘要");
    await expect(runResult).toBeVisible();
    // The status pill also appears in the collapsed history list, so scope to the first (run result header).
    await expect(page.getByText("不可验证的重载").first()).toBeVisible();

    // Distil the terminal run into a knowledge draft and hand off to /knowledge.
    const distilButton = page.getByRole("button", { name: "沉淀为知识" });
    await expect(distilButton).toBeVisible();
    await distilButton.click();
    await page.waitForURL(/\/knowledge\?entryId=/);
    const entryId = new URL(page.url()).searchParams.get("entryId")!;
    expect(entryId).toBeTruthy();

    // The deep link opens the pre-filled draft: title from purpose + device
    // context, seeded tags, and the honest terminal-state wording.
    const detail = page.getByRole("dialog", { name: /参数调试重载/ });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="draft"]')).toBeVisible();
    await expect(detail.getByText("参数调试", { exact: true })).toBeVisible();
    await expect(detail.getByText("DTS重载", { exact: true })).toBeVisible();
    await expect(detail.getByText("不可验证", { exact: true })).toBeVisible();
    await expect(detail.getByText(/由 DTS 重载运行沉淀/)).toBeVisible();
    await expect(detail.getByText(/平台无法确认驱动观察到了新值/)).toBeVisible();
    await expect(detail.getByText(/这不等于成功/)).toBeVisible();
    // The reload-run source link renders exactly like the log source link.
    await expect(detail.getByRole("button", { name: "查看重载运行" })).toBeVisible();

    // Drafts stay out of retrieval until published.
    const beforePublish = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(seeded.propertyKey)}`),
      { headers: committerHeaders }
    );
    expect(beforePublish.ok()).toBe(true);
    expect(((await beforePublish.json()) as { items: KnowledgeSearchApiItem[] }).items).toHaveLength(0);

    // Publish the reviewed draft from the detail dialog.
    await detail.getByRole("button", { name: "发布", exact: true }).click();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();

    const afterPublish = await page.request.get(
      apiRoute(`/api/v1/knowledge/search?q=${encodeURIComponent(seeded.propertyKey)}`),
      { headers: committerHeaders }
    );
    const afterBody = (await afterPublish.json()) as { items: KnowledgeSearchApiItem[] };
    expect(afterBody.items.map((item) => item.entryId)).toContain(entryId);

    // Reload-run source linkage is stored on the entry.
    const entryResponse = await page.request.get(apiRoute(`/api/v1/knowledge/entries/${entryId}`), {
      headers: committerHeaders
    });
    expect(entryResponse.ok()).toBe(true);
    const entryBody = (await entryResponse.json()) as {
      item: KnowledgeEntryApiItem & { sourceReloadRunId: string | null };
    };
    expect(entryBody.item).toMatchObject({
      sourceType: "human",
      sourceLogId: null,
      sourceReloadRunId: seeded.runId,
      status: "published"
    });

    const dbSummary = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; source_reload_run_id: string | null }>(
        `select status, source_reload_run_id from knowledge_entries where id = $1`,
        [entryId]
      );
      const row = result.rows[0];
      return {
        table: "knowledge_entries",
        predicate: `entryId=${entryId}`,
        observed: row ? `status=${row.status}; sourceReloadRunId=${row.source_reload_run_id}` : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(dbSummary.observed).toContain("status=published");
    expect(dbSummary.observed).toContain(`sourceReloadRunId=${seeded.runId}`);

    const audit = await knowledgeAuditSummaries(entryId);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "knowledge-entry-distill", action: "distill" }),
        expect.objectContaining({ kind: "knowledge-entry-publish", action: "publish" })
      ])
    );

    await recordOperationEvidence({
      operationId: "KB-DISTILL-002",
      title: "distil terminal reload run into pre-filled draft with honest outcome and publish",
      status: "passed",
      role: "Hardware Committer",
      route: "/dts-reload",
      page,
      testInfo,
      api: [
        summarizeApiResponse(entryResponse, {
          method: "GET",
          path: "/api/v1/knowledge/entries/:entryId",
          responseSummary: `entry=${entryId}; sourceReloadRunId=${seeded.runId}`
        })
      ],
      db: [dbSummary],
      audit
    });
  });

  test("shows related published knowledge on a completed analysis with a deep link; drafts and archived never appear", async ({ page }, testInfo) => {
    // @acceptance KB-REC-001
    // @operation KB-REC-001
    const seeded = await seedCompletedLogAnalysis();

    // Three entries carry the same conclusion-derived content; only the
    // published one may be recommended (published-only invariant).
    const relatedTitle = `${titlePrefix} 相关知识已发布 ${runStamp}`;
    const draftTitle = `${titlePrefix} 相关知识草稿 ${runStamp}`;
    const archivedTitle = `${titlePrefix} 相关知识已归档 ${runStamp}`;
    const relatedBody = `处置经验:${seeded.conclusion}。夜间快充整体时长增加约 25 分钟,按 0.5A 步长下调快充电流并复核 NTC 采样间隔。`;

    const published = await createMarkdownEntryViaApi(page, { title: relatedTitle, tags: ["快充"], contentMarkdown: relatedBody });
    await publishEntryViaApi(page, published.id);
    const draft = await createMarkdownEntryViaApi(page, { title: draftTitle, tags: [], contentMarkdown: relatedBody });
    const archived = await createMarkdownEntryViaApi(page, { title: archivedTitle, tags: [], contentMarkdown: relatedBody });
    await publishEntryViaApi(page, archived.id);
    const archiveResponse = await page.request.post(apiRoute(`/api/v1/knowledge/entries/${archived.id}/archive`), {
      headers: editorHeaders(),
      data: {}
    });
    expect(archiveResponse.status()).toBe(200);

    // API level: the recommendation returns related published entries only and
    // reports the retrieval mode that actually ran.
    const apiResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/related-to-log?logId=${encodeURIComponent(seeded.logId)}`),
      { headers: editorHeaders() }
    );
    expect(apiResponse.status()).toBe(200);
    const apiBody = (await apiResponse.json()) as {
      items: KnowledgeSearchApiItem[];
      retrieval: { mode: string; vectorAvailable: boolean; embeddingConfigured: boolean };
    };
    const apiIds = apiBody.items.map((item) => item.entryId);
    expect(apiIds).toContain(published.id);
    expect(apiIds).not.toContain(draft.id);
    expect(apiIds).not.toContain(archived.id);
    expect(["fts_only", "semantic_fts"]).toContain(apiBody.retrieval.mode);

    // Browser: the completed analysis shows the related-knowledge section with
    // the honest retrieval caption; draft and archived titles never render.
    await signInBrowserAsUser(page, editorUserId, editorEmail, editorName, "/logs");
    const history = page.getByRole("complementary", { name: "历史日志记录" });
    await history.getByRole("button", { name: new RegExp(seeded.fileName.slice(0, 40)) }).click();

    const section = page.getByRole("region", { name: "相关知识" });
    await expect(section).toBeVisible();
    await expect(section.getByText(/检索模式:/)).toBeVisible();
    const entryLink = section.getByRole("button", { name: relatedTitle });
    await expect(entryLink).toBeVisible();
    await expect(section.getByText(draftTitle)).toHaveCount(0);
    await expect(section.getByText(archivedTitle)).toHaveCount(0);

    // The citation deep link lands on /knowledge with the published entry open.
    await entryLink.click();
    await page.waitForURL((url) => url.pathname === "/knowledge" && url.searchParams.get("entryId") === published.id);
    const detail = page.getByRole("dialog", { name: relatedTitle });
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-status="published"]')).toBeVisible();

    const dbSummary = await knowledgeEntryDbSummary(published.id);
    expect(dbSummary.observed).toContain("status=published");

    await recordOperationEvidence({
      operationId: "KB-REC-001",
      title: "related published knowledge on completed analysis with deep link",
      status: "passed",
      role: "Hardware User",
      route: "/logs",
      page,
      testInfo,
      api: [
        summarizeApiResponse(apiResponse, {
          method: "GET",
          path: "/api/v1/knowledge/related-to-log",
          responseSummary: `logId=${seeded.logId}; recommended=${published.id}; mode=${apiBody.retrieval.mode}; draftExcluded=${!apiIds.includes(draft.id)}; archivedExcluded=${!apiIds.includes(archived.id)}`
        })
      ],
      db: [dbSummary]
    });
  });

  test("manages structural definition references on an entry; the definition detail lists the published entry only and deprecation keeps the chip", async ({ page }, testInfo) => {
    // @acceptance KB-XREF-001
    // @operation KB-XREF-001
    const spec = await seedParameterSpec({
      slug: "ratio",
      propertyKey: `charge_pump_ratio_${runStamp}`,
      displayName: "充电泵比率",
      subjectName: "SC8562"
    });
    const pickerSpec = await seedParameterSpec({
      slug: "limit",
      propertyKey: `fast_charge_limit_${runStamp}`,
      displayName: "快充限流",
      subjectName: "SC8562"
    });

    const publishedTitle = `${titlePrefix} 引用已发布条目 ${runStamp}`;
    const draftTitle = `${titlePrefix} 引用草稿条目 ${runStamp}`;
    const published = await createMarkdownEntryViaApi(page, {
      title: publishedTitle,
      tags: ["快充"],
      contentMarkdown: "当充电泵比率切换异常时,先复核 NTC 采样间隔。"
    });
    await publishEntryViaApi(page, published.id);
    const draft = await createMarkdownEntryViaApi(page, {
      title: draftTitle,
      tags: [],
      contentMarkdown: "草稿:比率切换阈值仍需实验数据。"
    });

    // API: audited reference edits bind to the parameter_specs.id surrogate.
    const addResponse = await page.request.put(
      apiRoute(`/api/v1/knowledge/entries/${published.id}/parameter-references/${encodeURIComponent(spec.specId)}`),
      { headers: editorHeaders(), data: {} }
    );
    expect(addResponse.status()).toBe(200);
    const addBody = (await addResponse.json()) as {
      item: KnowledgeEntryApiItem & {
        parameterReferences: Array<{ specId: string; propertyKey: string; driverModule: string | null; lifecycle: string }>;
      };
    };
    expect(addBody.item.parameterReferences).toHaveLength(1);
    expect(addBody.item.parameterReferences[0]).toMatchObject({
      specId: spec.specId,
      propertyKey: spec.propertyKey,
      driverModule: spec.subjectName,
      lifecycle: "active"
    });

    const draftAddResponse = await page.request.put(
      apiRoute(`/api/v1/knowledge/entries/${draft.id}/parameter-references/${encodeURIComponent(spec.specId)}`),
      { headers: editorHeaders(), data: {} }
    );
    expect(draftAddResponse.status()).toBe(200);

    // Parameter side (API): published-only — the draft never appears.
    const relatedResponse = await page.request.get(
      apiRoute(`/api/v1/knowledge/related-to-spec?specId=${encodeURIComponent(spec.specId)}`),
      { headers: editorHeaders() }
    );
    expect(relatedResponse.status()).toBe(200);
    const relatedBody = (await relatedResponse.json()) as { items: KnowledgeSearchApiItem[] };
    expect(relatedBody.items.map((item) => item.entryId)).toEqual([published.id]);

    // Browser (knowledge side): chips on the detail, picker in the editor.
    await openKnowledgePage(page);
    const table = page.getByRole("table", { name: "知识条目列表" });
    await table.getByText(publishedTitle).click();
    const detail = page.getByRole("dialog", { name: new RegExp(publishedTitle) });
    await expect(detail).toBeVisible();
    const chips = detail.getByTestId("knowledge-parameter-references");
    await expect(chips.getByText(`充电泵比率 · ${spec.subjectName}`)).toBeVisible();
    await expect(chips.getByText("已启用")).toBeVisible();

    // Editor picker: search the catalog and add a second reference from the UI.
    await detail.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑知识条目" });
    const picker = editor.getByTestId("knowledge-reference-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("textbox", { name: "检索参数定义" }).fill(pickerSpec.propertyKey);
    await picker.getByRole("button", { name: "检索定义" }).click();
    const results = picker.getByRole("list", { name: "参数定义检索结果" });
    await results
      .locator("li", { hasText: pickerSpec.propertyKey })
      .getByRole("button", { name: "关联", exact: true })
      .click();
    // The chip renders the definition's display name (server reference DTO).
    const pickerChipLabel = `${pickerSpec.displayName} · ${pickerSpec.subjectName}`;
    await expect(picker.getByText(pickerChipLabel)).toBeVisible();

    // Remove the picker-added reference again from the editor (audited).
    await picker.getByRole("button", { name: `移除引用 ${pickerSpec.displayName}` }).click();
    await expect(picker.getByText(pickerChipLabel)).toHaveCount(0);
    await editor.getByRole("button", { name: "取消" }).click();

    // Deprecation is soft retirement (ADR-0011): the reference SURVIVES and
    // the chip states 已废弃 honestly.
    await withPgClient(async (client) => {
      await client.query(`update parameter_specs set definition_lifecycle = 'deprecated' where id = $1`, [spec.specId]);
      await client.query(`update parameter_spec_versions set lifecycle = 'deprecated' where parameter_spec_id = $1`, [
        spec.specId
      ]);
    });
    await page.reload();
    await expect(page.getByRole("table", { name: "知识条目列表" })).toBeVisible();
    await table.getByText(publishedTitle).click();
    const detailAfter = page.getByRole("dialog", { name: new RegExp(publishedTitle) });
    const chipsAfter = detailAfter.getByTestId("knowledge-parameter-references");
    await expect(chipsAfter.getByText(`充电泵比率 · ${spec.subjectName}`)).toBeVisible();
    await expect(chipsAfter.getByText("已废弃")).toBeVisible();

    // Browser (parameter side): the definition detail lists the published
    // entry under 相关知识 and never the draft; the entry deep-links back.
    await signInBrowserAsRole(page, "admin", `/parameter-admin?spec=${encodeURIComponent(spec.specId)}`);
    const relatedSection = page.getByTestId("spec-related-knowledge");
    await expect(relatedSection).toBeVisible();
    const publishedRelatedItem = relatedSection.getByRole("button", { name: new RegExp(publishedTitle) });
    await expect(publishedRelatedItem).toBeVisible();
    await expect(relatedSection.getByText(draftTitle)).toHaveCount(0);
    await publishedRelatedItem.click();
    await page.waitForURL((url) => url.pathname === "/knowledge" && url.searchParams.get("entryId") === published.id);
    await expect(page.getByRole("dialog", { name: new RegExp(publishedTitle) })).toBeVisible();

    // DB + audit evidence.
    const referenceRows = await withPgClient(async (client) => {
      const result = await client.query<{ entry_id: string; parameter_spec_id: string }>(
        `select entry_id, parameter_spec_id from knowledge_parameter_references where parameter_spec_id = $1 order by created_at asc`,
        [spec.specId]
      );
      return result.rows;
    });
    expect(referenceRows.map((row) => row.entry_id).sort()).toEqual([published.id, draft.id].sort());

    const audits = await knowledgeAuditSummaries(published.id);
    expect(audits.some((audit) => audit.kind === "knowledge-parameter-reference-add")).toBe(true);
    expect(audits.some((audit) => audit.kind === "knowledge-parameter-reference-remove")).toBe(true);

    await recordOperationEvidence({
      operationId: "KB-XREF-001",
      title: "structural definition references with published-only parameter side and deprecation survival",
      status: "passed",
      role: "Hardware User",
      route: "/knowledge",
      page,
      testInfo,
      api: [
        summarizeApiResponse(addResponse, {
          method: "PUT",
          path: "/api/v1/knowledge/entries/:entryId/parameter-references/:specId",
          responseSummary: `entry=${published.id}; spec=${spec.specId}; lifecycle=active`
        }),
        summarizeApiResponse(relatedResponse, {
          method: "GET",
          path: "/api/v1/knowledge/related-to-spec",
          responseSummary: `spec=${spec.specId}; published=${published.id} only; draftExcluded=${!relatedBody.items.some((item) => item.entryId === draft.id)}`
        })
      ],
      db: [
        {
          table: "knowledge_parameter_references",
          predicate: `parameterSpecId=${spec.specId}`,
          observed: `rows=${referenceRows.length} (published+draft); survives deprecation`,
          rowCount: referenceRows.length
        }
      ],
      audit: audits.filter((audit) => audit.kind.startsWith("knowledge-parameter-reference"))
    });
  });

  test("agent knowledge draft flows through approval into the admin publish queue for publish and reject", async ({ page }, testInfo) => {
    // @acceptance KB-ADMIN-001
    // @operation KB-ADMIN-001
    const seeded = await seedCompletedLogAnalysis();
    const publishTitle = `${titlePrefix} Agent沉淀待发布 ${runStamp}`;
    const rejectTitle = `${titlePrefix} Agent沉淀待拒绝 ${runStamp}`;
    const sseHeaders = { ...editorHeaders(), Accept: "text/event-stream" };

    async function agentDraftCountByTitle(title: string) {
      return withPgClient(async (client) => {
        const result = await client.query<{ n: string }>(
          `select count(*)::text as n from knowledge_entries where title = $1 and source_type = 'agent'`,
          [title]
        );
        return Number(result.rows[0].n);
      });
    }

    async function createAgentDraftViaApproval(input: { title: string; sourceLogId?: string; threadId: string }) {
      const message = input.sourceLogId
        ? `创建知识草稿:${input.title} 来源日志:${input.sourceLogId}`
        : `创建知识草稿:${input.title}`;
      const started = await page.request.post(apiRoute("/api/v1/agent/xiaoze"), {
        headers: sseHeaders,
        data: {
          threadId: input.threadId,
          runId: `run-${input.threadId}`,
          messages: [{ id: `m-user-${input.threadId}`, role: "user", content: message }],
          context: [{ description: "wiseeff.page", value: { pageKey: "logs", path: "/logs" } }]
        }
      });
      expect(started.status()).toBe(200);
      const interruptValue = readSseInterruptValue(await started.text());
      expect(interruptValue?.approvalId).toBeTruthy();
      // The approval interrupt paused BEFORE any write (draft-only tool included).
      expect(await agentDraftCountByTitle(input.title)).toBe(0);

      const resumed = await page.request.post(apiRoute("/api/v1/agent/xiaoze"), {
        headers: sseHeaders,
        data: {
          threadId: input.threadId,
          runId: `run-resume-${input.threadId}`,
          messages: [{ id: `m-resume-${input.threadId}`, role: "user", content: "approve" }],
          forwardedProps: {
            command: { resume: { decision: "approve" }, interruptEvent: interruptValue }
          }
        }
      });
      expect(resumed.status()).toBe(200);
      expect(await agentDraftCountByTitle(input.title)).toBe(1);
      return { started, resumed, approvalId: String(interruptValue!.approvalId) };
    }

    const publishFlow = await createAgentDraftViaApproval({
      title: publishTitle,
      sourceLogId: seeded.logId,
      threadId: `kb-admin-publish-${runStamp}`
    });
    await createAgentDraftViaApproval({ title: rejectTitle, threadId: `kb-admin-reject-${runStamp}` });

    // Agent audit trail: actorType=agent on the draft-create event.
    const agentAudit = await withPgClient(async (client) => {
      const result = await client.query<{ actor_type: string; metadata: Record<string, unknown> }>(
        `select actor_type, metadata from audit_events where kind = 'knowledge-entry-agent-draft' and metadata->>'title' = $1`,
        [publishTitle]
      );
      return result.rows[0];
    });
    expect(agentAudit).toMatchObject({ actor_type: "agent" });
    expect(agentAudit.metadata).toMatchObject({ sessionId: `kb-admin-publish-${runStamp}`, sourceLogId: seeded.logId });

    // Review the queue on /knowledge-admin as the knowledge manager.
    await signInBrowserAsRole(page, "admin", "/knowledge-admin");
    const queue = page.getByRole("table", { name: "Agent 知识草稿队列" });
    await expect(queue).toBeVisible();

    const publishRow = queue.locator("tr", { hasText: publishTitle }).first();
    await expect(publishRow).toBeVisible();
    await expect(publishRow.getByText(new RegExp(`创建人 ${editorUserId}`))).toBeVisible();
    await expect(publishRow.getByText(`kb-admin-publish-${runStamp}`)).toBeVisible();
    await expect(publishRow.getByRole("button", { name: "查看日志分析" })).toBeVisible();

    // Publish one draft from the queue.
    await publishRow.getByRole("button", { name: "发布", exact: true }).click();
    await expect(queue.locator("tr", { hasText: publishTitle })).toHaveCount(0);

    // Archive-reject the other.
    const rejectRow = queue.locator("tr", { hasText: rejectTitle }).first();
    await rejectRow.getByRole("button", { name: "拒绝归档" }).click();
    const confirm = page.getByRole("dialog", { name: /拒绝并归档/ });
    await confirm.getByRole("button", { name: "拒绝归档" }).click();
    await expect(queue.locator("tr", { hasText: rejectTitle })).toHaveCount(0);

    const statuses = await withPgClient(async (client) => {
      const result = await client.query<{ title: string; status: string; source_session_id: string; source_log_id: string | null }>(
        `select title, status, source_session_id, source_log_id from knowledge_entries where title = any($1::text[]) order by title`,
        [[publishTitle, rejectTitle]]
      );
      return result.rows;
    });
    expect(statuses.find((row) => row.title === publishTitle)).toMatchObject({
      status: "published",
      source_session_id: `kb-admin-publish-${runStamp}`,
      source_log_id: seeded.logId
    });
    expect(statuses.find((row) => row.title === rejectTitle)).toMatchObject({ status: "archived" });

    const publishedEntryId = await withPgClient(async (client) => {
      const result = await client.query<{ id: string }>(`select id from knowledge_entries where title = $1`, [publishTitle]);
      return result.rows[0].id;
    });
    const rejectedEntryId = await withPgClient(async (client) => {
      const result = await client.query<{ id: string }>(`select id from knowledge_entries where title = $1`, [rejectTitle]);
      return result.rows[0].id;
    });
    const publishAudit = await knowledgeAuditSummaries(publishedEntryId);
    expect(publishAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "knowledge-entry-agent-draft", action: "agent-draft-create" }),
        expect.objectContaining({ kind: "knowledge-entry-publish", action: "publish" })
      ])
    );
    const rejectAudit = await knowledgeAuditSummaries(rejectedEntryId);
    expect(rejectAudit).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "knowledge-entry-reject", action: "reject" })])
    );

    await recordOperationEvidence({
      operationId: "KB-ADMIN-001",
      title: "agent draft approval into admin publish queue with publish and reject",
      status: "passed",
      role: "Admin",
      route: "/knowledge-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(publishFlow.started, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: `interrupt approvalId=${publishFlow.approvalId}`
        }),
        summarizeApiResponse(publishFlow.resumed, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "approved -> agent draft created"
        })
      ],
      db: [
        {
          table: "knowledge_entries",
          predicate: `title in (${publishTitle}, ${rejectTitle})`,
          observed: statuses.map((row) => `${row.title}=${row.status}`).join("; "),
          rowCount: statuses.length
        }
      ],
      audit: [...publishAudit, ...rejectAudit]
    });
  });
});
