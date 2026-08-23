import "./helpers/loadAcceptanceEnvironment";
import { spawnSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { dismissXiaozeToggleHint, prepareInteractionSurface } from "./helpers/interactionSurface";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const analysisQuestion = "Why did fast charging fold back?";
const supportedFixture = path.resolve("test-fixtures/logs/charging-foldback.log");
const unsupportedFixture = path.resolve("test-fixtures/logs/unsupported.bin");
const providerOutageFixture = path.resolve("test-fixtures/logs/provider-outage.log");
const supportedFileName = "charging-foldback.log";
const unsupportedFileName = "unsupported.bin";
const providerOutageFileName = "provider-outage.log";
const archiveFileName = "charging-foldback.log.gz";
const acceptanceLogDomainName = "acceptance-charging-power";
const acceptanceWebhookDomainName = "acceptance-webhook-domain";
const acceptanceModelDomainName = "acceptance-model-override-domain";
const acceptanceModelOverride = "acceptance-domain-model-x";
const acceptanceWebhookSecret = "acceptance-webhook-secret-0123456789";
const acceptanceKnowledgeTitlePrefix = "acceptance-log-domain-knowledge";

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
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}

async function cleanupAcceptanceLogs() {
  await withPgClient(async (client) => {
    const logs = await client.query<{ id: string; file_object_id: string }>(
      `
      select id, file_object_id
      from log_records
      where organization_id = $1
        and (
          analysis_question = $2
          or file_name in ($3, $4, $5, $6)
        )
      `,
      [organizationId, analysisQuestion, supportedFileName, unsupportedFileName, providerOutageFileName, archiveFileName]
    );
    const logIds = logs.rows.map((row) => row.id);
    const fileObjectIds = logs.rows.map((row) => row.file_object_id);
    let runIds: string[] = [];

    if (logIds.length > 0) {
      const runs = await client.query<{ id: string }>(
        "select id from log_analysis_runs where log_record_id = any($1::text[])",
        [logIds]
      );
      runIds = runs.rows.map((row) => row.id);
    }

    if (runIds.length > 0) {
      await client.query("delete from log_evidence where run_id = any($1::text[])", [runIds]);
      await client.query("delete from log_analysis_stages where run_id = any($1::text[])", [runIds]);
      await client.query("delete from log_analysis_reports where run_id = any($1::text[])", [runIds]);
      await client.query("delete from jobs where kind = 'log-analysis' and target_id = any($1::text[])", [runIds]);
    }
    if (logIds.length > 0) {
      await client.query("delete from log_feedback where log_record_id = any($1::text[])", [logIds]);
      await client.query("update log_records set current_run_id = null where id = any($1::text[])", [logIds]);
      if (runIds.length > 0) {
        await client.query("delete from log_analysis_runs where id = any($1::text[])", [runIds]);
      }
      await client.query("delete from audit_events where app = 'log-analysis' and target_id = any($1::text[])", [logIds]);
      await client.query("delete from log_records where id = any($1::text[])", [logIds]);
    }
    if (fileObjectIds.length > 0) {
      await client.query(
        `
        delete from log_file_objects
        where id = any($1::text[])
          and not exists (
            select 1
            from log_records
            where log_records.file_object_id = log_file_objects.id
          )
        `,
        [fileObjectIds]
      );
    }
  });
}

async function cleanupAcceptanceLogDomains() {
  await withPgClient(async (client) => {
    const domains = await client.query<{ id: string }>(
      "select id from log_domains where organization_id = $1 and name = any($2::text[])",
      [organizationId, [acceptanceLogDomainName, acceptanceWebhookDomainName, acceptanceModelDomainName]]
    );
    const domainIds = domains.rows.map((row) => row.id);
    if (domainIds.length === 0) {
      return;
    }
    await client.query("update log_records set log_domain_id = null where log_domain_id = any($1::text[])", [domainIds]);
    // log_webhook_deliveries cascade with the domain rows.
    await client.query("delete from audit_events where target_type = 'log-domain' and target_id = any($1::text[])", [domainIds]);
    await client.query("delete from log_domains where id = any($1::text[])", [domainIds]);
  });
}

async function cleanupAcceptanceKnowledgeEntries() {
  await withPgClient(async (client) => {
    const entries = await client.query<{ id: string }>(
      "select id from knowledge_entries where organization_id = $1 and title like $2",
      [organizationId, `${acceptanceKnowledgeTitlePrefix}%`]
    );
    const entryIds = entries.rows.map((row) => row.id);
    if (entryIds.length === 0) {
      return;
    }
    await client.query("update knowledge_entries set head_revision_id = null where id = any($1::uuid[])", [entryIds]);
    await client.query("delete from audit_events where target_type = 'knowledge-entry' and target_id = any($1::text[])", [entryIds]);
    // Revisions, chunks, index status, and log-domain links all cascade from the entry rows.
    await client.query("delete from knowledge_entries where id = any($1::uuid[])", [entryIds]);
  });
}

async function domainKnowledgeLinkDbSummary(domainId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ knowledge_entry_id: string; entry_title: string }>(
      `
      select link.knowledge_entry_id::text as knowledge_entry_id, entry.title as entry_title
      from log_domain_knowledge_links link
      inner join knowledge_entries entry on entry.id = link.knowledge_entry_id
      where link.organization_id = $1
        and link.log_domain_id = $2
      order by entry.title asc
      `,
      [organizationId, domainId]
    );

    return {
      table: "log_domain_knowledge_links",
      predicate: `organization_id=${organizationId}; log_domain_id=${domainId}`,
      observed:
        result.rows.length > 0
          ? result.rows.map((row) => `${row.entry_title} (${row.knowledge_entry_id})`).join("; ")
          : "no links",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function seedLogAdminUser() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ('u-xu-yun', 'org-chargelab', 'Xu Yun', 'xu@chargelab.cn', 'Platform Owner', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ('acceptance-u-xu-yun-admin', 'u-xu-yun', 'org-chargelab', null, 'admin')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `
    );
  });
}

async function latestLogByFile(page: Page, fileName: string) {
  const response = await page.request.get(
    apiRoute("/api/v1/logs?includeArchived=true"),
    { headers: smokeHeaders() }
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: Array<{
      id: string;
      fileName: string;
      status: string;
      confidence: number;
      archiveState?: string;
      failureReason?: string | null;
      logDomainId?: string;
      logDomainName?: string;
      analysisSource?: string;
      degradedReason?: string;
    }>;
  };
  const matches = body.items.filter((item) => item.fileName === fileName);
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

async function logRuns(page: Page, logId: string) {
  const response = await page.request.get(apiRoute(`/api/v1/logs/${encodeURIComponent(logId)}/runs`), {
    headers: smokeHeaders()
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: Array<{ id: string; status: string; progress: number; jobId?: string | null }>;
  };
  return body.items;
}

async function logRecordDbSummary(logId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ status: string; archive_state: string; current_run_id: string | null }>(
      `
      select status, archive_state, current_run_id
      from log_records
      where id = $1
      `,
      [logId]
    );
    const row = result.rows[0];

    return {
      table: "log_records",
      predicate: `id=${logId}`,
      observed: row
        ? `status=${row.status}; archiveState=${row.archive_state}; currentRunId=${row.current_run_id ?? "none"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function logRunDbSummary(runId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ status: string; progress: number; job_id: string | null }>(
      `
      select lar.status, lar.progress, jobs.id as job_id
      from log_analysis_runs lar
      left join jobs on jobs.target_id = lar.id
      where lar.id = $1
      `,
      [runId]
    );
    const row = result.rows[0];

    return {
      table: "log_analysis_runs",
      predicate: `id=${runId}`,
      observed: row ? `status=${row.status}; progress=${row.progress}; jobId=${row.job_id ?? "none"}` : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function logReportDbSummary(logId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ analysis_source: string | null; degraded_reason: string | null; prompt_version: string | null; model: string | null }>(
      `
      select report.analysis_source, report.degraded_reason, report.prompt_version, report.model
      from log_records lr
      inner join log_analysis_reports report on report.run_id = lr.current_run_id
      where lr.id = $1
      `,
      [logId]
    );
    const row = result.rows[0];

    return {
      table: "log_analysis_reports",
      predicate: `log_record_id=${logId} (current run)`,
      observed: row
        ? `analysisSource=${row.analysis_source ?? "none"}; degradedReason=${row.degraded_reason ?? "none"}; promptVersion=${row.prompt_version ?? "none"}; model=${row.model ?? "none"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function logFeedbackDbSummary(logId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ rating: string }>(
      `
      select rating
      from log_feedback
      where organization_id = $1
        and log_record_id = $2
      order by created_at asc, id asc
      `,
      [organizationId, logId]
    );

    return {
      table: "log_feedback",
      predicate: `organization_id=${organizationId}; log_record_id=${logId}`,
      observed: result.rows.length > 0 ? result.rows.map((row) => row.rating).join("; ") : "no feedback",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function logDomainDbSummary(domainName: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ id: string; status: string }>(
      "select id, status from log_domains where organization_id = $1 and name = $2",
      [organizationId, domainName]
    );
    const row = result.rows[0];

    return {
      table: "log_domains",
      predicate: `organization_id=${organizationId}; name=${domainName}`,
      observed: row ? `id=${row.id}; status=${row.status}` : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function webhookDeliveryDbSummary(domainId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ kind: string; attempt: number; status: string; http_status: number | null }>(
      `
      select kind, attempt, status, http_status
      from log_webhook_deliveries
      where organization_id = $1
        and log_domain_id = $2
      order by created_at desc, id desc
      `,
      [organizationId, domainId]
    );

    return {
      table: "log_webhook_deliveries",
      predicate: `organization_id=${organizationId}; log_domain_id=${domainId}`,
      observed:
        result.rows.length > 0
          ? result.rows.map((row) => `${row.kind}#${row.attempt}=${row.status}(${row.http_status ?? "-"})`).join("; ")
          : "no deliveries",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function domainWebhookConfigDbSummary(domainId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ webhook_url: string | null; webhook_enabled: boolean; secret_len: number | null; model_override: string | null }>(
      `
      select webhook_url, webhook_enabled, length(webhook_secret) as secret_len, model_override
      from log_domains
      where organization_id = $1
        and id = $2
      `,
      [organizationId, domainId]
    );
    const row = result.rows[0];

    return {
      table: "log_domains",
      predicate: `organization_id=${organizationId}; id=${domainId}`,
      observed: row
        ? `webhookUrl=${row.webhook_url ?? "none"}; enabled=${row.webhook_enabled}; secretLength=${row.secret_len ?? 0}; modelOverride=${row.model_override ?? "none"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function reportModelDbSummary(logId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ model: string | null; analysis_source: string | null }>(
      `
      select report.model, report.analysis_source
      from log_records lr
      inner join log_analysis_reports report on report.run_id = lr.current_run_id
      where lr.id = $1
      `,
      [logId]
    );
    const row = result.rows[0];

    return {
      table: "log_analysis_reports",
      predicate: `log_record_id=${logId} (current run)`,
      observed: row ? `model=${row.model ?? "none"}; analysisSource=${row.analysis_source ?? "none"}` : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

type ReceivedWebhookDelivery = {
  body: string;
  signature?: string;
  timestamp?: string;
};

/** Loopback receiver for LOG-DOMAIN-WEBHOOK-001 (server runs with LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true). */
async function startWebhookReceiver(): Promise<{ url: string; received: ReceivedWebhookDelivery[]; close: () => Promise<void> }> {
  const received: ReceivedWebhookDelivery[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      received.push({
        body,
        signature: request.headers["x-wiseeff-signature"]?.toString(),
        timestamp: request.headers["x-wiseeff-timestamp"]?.toString()
      });
      response.statusCode = 200;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/wiseeff-hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

/** Receiver-side verification mirrored from docs/api/log-analysis-integration.md. */
function verifyWebhookSignature(delivery: ReceivedWebhookDelivery, secret: string): boolean {
  const timestamp = Number(delivery.timestamp);
  if (!Number.isFinite(timestamp) || !delivery.signature) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${delivery.body}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(delivery.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function auditSummaryFor(
  items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>,
  match: { kind: string; targetId: string }
) {
  const item = items.find((candidate) => candidate.kind === match.kind && candidate.targetId === match.targetId);
  expect(item).toBeTruthy();

  return {
    id: item?.id,
    kind: item!.kind,
    action: item!.action,
    targetId: item!.targetId,
    requestId: item?.traceId,
    metadataSummary: item?.metadata ? Object.keys(item.metadata).sort().join(",") : undefined
  };
}

async function uploadLogThroughUi(page: Page, filePath: string, question?: string, domainName?: string) {
  await prepareInteractionSurface(page);
  await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
  const dialog = page.getByRole("dialog", { name: "上传日志" });
  if (domainName) {
    await expect(dialog.locator("#upload-log-domain option", { hasText: domainName })).toHaveCount(1, { timeout: 10_000 });
    await dialog.locator("#upload-log-domain").selectOption({ label: domainName });
  }
  await dialog.getByLabel("选择日志文件").setInputFiles(filePath);
  if (question) {
    await dialog.locator("#upload-analysis-question").fill(question);
  }
  await dialog.getByRole("button", { name: question ? "确认上传" : "仍然上传" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 70_000 });
}

function historyItem(page: Page, fileName: string): Locator {
  return page.locator(".history-item").filter({ hasText: fileName }).first();
}

test.describe("M5.4 manual flow D - log analysis browser acceptance", () => {
  test.beforeAll(async () => {
    runNpmScript("db:migrate");
    runNpmScript("db:seed:m0");
    runNpmScript("db:seed:m1");
    runNpmScript("db:seed:m2");
    await cleanupAcceptanceLogs();
    await seedLogAdminUser();
  });

  test("uploads, completes, links evidence, audits feedback, archives, and records unsupported upload failure", async ({ page }, testInfo) => {
    // @acceptance LOG-HAPPY-001
    // @acceptance LOG-CONFIDENCE-PERCENT-001
    // @operation LOG-HAPPY-001
    await page.goto("/logs");
    await prepareInteractionSurface(page);

    await uploadLogThroughUi(page, supportedFixture, analysisQuestion);

    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");
    // Capture the record only after the run completed: the upload dialog closes on
    // the POST response, long before the analysis report writes confidence.
    const completedLog = await latestLogByFile(page, supportedFileName);
    await historyItem(page, supportedFileName).click();
    await expect(page.locator("#log-conclusion-title")).toContainText(/thermal|foldback/i);

    // LOG-CONFIDENCE-PERCENT-001: the server stores confidence as 0-1; the UI
    // confidence bar must render the normalized percentage (e.g. 85%), never "0.85%".
    expect(completedLog.confidence).toBeGreaterThan(0);
    const confidencePercent =
      completedLog.confidence <= 1 ? Math.round(completedLog.confidence * 100) : Math.round(completedLog.confidence);
    const confidenceBar = page.locator(".confidence-bar").first();
    await expect(confidenceBar.locator("strong")).toHaveText(`${confidencePercent}%`);
    await expect(confidenceBar.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", String(confidencePercent));

    const evidenceCard = page.locator(".evidence-card").filter({ hasText: /thermal|foldback/i }).first();
    await expect(evidenceCard).toContainText(/thermal|foldback/i);
    await evidenceCard.click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          [3, 4].some((lineNumber) =>
            document.querySelector(`[data-testid="rawlog-line-${lineNumber}"]`)?.classList.contains("rawlog-line--anchor-focus")
          )
        )
      )
      .toBe(true);

    await page.goto("/log-dashboard");
    await page.goto("/log-admin");
    // The Xiaoze toggle hint floats over the detail panel's corner actions.
    await dismissXiaozeToggleHint(page);
    await page.locator('input[type="search"]').fill(supportedFileName);
    await page.getByRole("row").filter({ hasText: supportedFileName }).first().click();
    await page.locator('button:has(svg[class*="lucide-thumbs-up"])').click();
    await expect
      .poll(async () => {
        const response = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
        const body = (await response.json()) as { items: Array<{ kind: string; targetId: string | null }> };
        return body.items.some((item) => item.kind === "log-feedback" && item.targetId === completedLog.id);
      })
      .toBe(true);

    const archiveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/logs/${completedLog.id}/archive`)
    );
    await page.locator('button:has(svg[class*="lucide-archive"])').click();
    const archiveResponse = await archiveResponsePromise;
    expect(archiveResponse.ok()).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: supportedFileName })).toBeVisible();
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).archiveState)
      .toBe("archived");

    await page.goto("/logs");
    await page.reload();
    await expect(historyItem(page, supportedFileName)).toHaveCount(0);
    const activeLogs = await page.request.get(apiRoute("/api/v1/logs"), { headers: smokeHeaders() });
    const activeBody = (await activeLogs.json()) as { items: Array<{ fileName: string }> };
    expect(activeBody.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ fileName: supportedFileName })]));

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
    };

    await uploadLogThroughUi(page, unsupportedFixture);
    await expect
      .poll(async () => {
        const log = await latestLogByFile(page, unsupportedFileName);
        return `${log.status}:${log.failureReason ?? ""}`;
      }, { timeout: 30_000 })
      .toMatch(/^failed:.*unsupported/i);
    const unsupportedHistoryItem = historyItem(page, unsupportedFileName);
    await expect(unsupportedHistoryItem).toBeVisible();

    // P2 localization contract: the failure card renders the fixed Chinese title
    // plus the presentError mapping of the English backend failureReason exactly
    // once — no raw English backend prose reaches the workbench.
    await unsupportedHistoryItem.click();
    const failureAlert = page.getByRole("alert").filter({ hasText: "日志处理失败" });
    await expect(failureAlert).toBeVisible();
    await expect(failureAlert).toContainText("暂不支持该日志格式");
    await expect(failureAlert).not.toContainText("Unsupported log format");
    await expect(failureAlert.getByRole("button", { name: "重新上传" })).toBeVisible();

    await recordOperationEvidence({
      operationId: "LOG-HAPPY-001",
      title: "log upload complete evidence feedback archive unsupported",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(archiveResponse, {
          method: "POST",
          path: `/api/v1/logs/${completedLog.id}/archive`,
          responseSummary: `archiveState=${(await latestLogByFile(page, supportedFileName)).archiveState ?? "unknown"}`
        }),
        summarizeApiResponse(activeLogs, {
          method: "GET",
          path: "/api/v1/logs",
          responseSummary: `active logs=${activeBody.items.length}; archived log hidden`
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit events=${auditBody.items.length}`
        })
      ],
      db: [await logRecordDbSummary(completedLog.id)],
      audit: [
        auditSummaryFor(auditBody.items, { kind: "log-feedback", targetId: completedLog.id }),
        auditSummaryFor(auditBody.items, { kind: "log-archive", targetId: completedLog.id })
      ],
      notes: `Log ${completedLog.id} completed analysis, linked evidence, recorded feedback, archived successfully, and rejected unsupported upload with a readable failure.`
    });
  });

  test("reruns a completed log and records run, job progress, audit, and operation evidence", async ({ page }, testInfo) => {
    // @acceptance LOG-REANALYZE-001
    // @operation LOG-REANALYZE-001
    await cleanupAcceptanceLogs();

    await page.goto("/logs");
    await uploadLogThroughUi(page, supportedFixture, analysisQuestion);
    const completedLog = await latestLogByFile(page, supportedFileName);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");
    const initialRuns = await logRuns(page, completedLog.id);
    expect(initialRuns.length).toBeGreaterThanOrEqual(1);

    await page.goto("/log-admin");
    await dismissXiaozeToggleHint(page);
    await page.locator('input[type="search"]').fill(supportedFileName);
    await page.getByRole("row").filter({ hasText: supportedFileName }).first().click();
    const rerunResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/logs/${completedLog.id}/rerun`)
    );
    await page.getByRole("button", { name: /重新分析/ }).click();
    const rerunResponse = await rerunResponsePromise;
    expect(rerunResponse.ok()).toBe(true);

    await expect
      .poll(async () => {
        const runs = await logRuns(page, completedLog.id);
        return runs.length;
      }, { timeout: 30_000 })
      .toBeGreaterThan(initialRuns.length);

    const rerunRuns = await logRuns(page, completedLog.id);
    const latestRun = rerunRuns.find((run) => !initialRuns.some((initialRun) => initialRun.id === run.id));
    expect(latestRun).toBeTruthy();
    expect(latestRun).toEqual(expect.objectContaining({ status: expect.any(String), progress: expect.any(Number) }));
    expect(latestRun!.progress).toBeGreaterThanOrEqual(0);
    expect(latestRun!.progress).toBeLessThanOrEqual(100);
    await expect
      .poll(async () => {
        const currentRun = (await logRuns(page, completedLog.id)).find((run) => run.id === latestRun!.id);
        return currentRun?.status ?? "missing";
      }, { timeout: 70_000 })
      .toBe("complete");

    await page.goto("/logs");
    await expect(historyItem(page, supportedFileName)).toBeVisible();
    await historyItem(page, supportedFileName).click();
    await expect(page.locator("#log-conclusion-title")).toContainText(/AI 正在分析|thermal|foldback/i, { timeout: 30_000 });

    await expect
      .poll(async () => {
        const response = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
        const body = (await response.json()) as {
          items: Array<{ kind: string; targetId: string | null; metadata?: { runId?: string; jobId?: string } }>;
        };
        return body.items.some(
          (item) =>
            item.kind === "log-rerun" &&
            item.targetId === completedLog.id &&
            item.metadata?.runId === latestRun!.id &&
            typeof item.metadata?.jobId === "string"
        );
      }, { timeout: 30_000 })
      .toBe(true);

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
    };

    await recordOperationEvidence({
      operationId: "LOG-REANALYZE-001",
      title: "completed log reanalysis creates rerun job progress and audit",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(rerunResponse, {
          method: "POST",
          path: `/api/v1/logs/${completedLog.id}/rerun`,
          responseSummary: `created run=${latestRun!.id}`
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit events=${auditBody.items.length}`
        })
      ],
      db: [await logRecordDbSummary(completedLog.id), await logRunDbSummary(latestRun!.id)],
      audit: [auditSummaryFor(auditBody.items, { kind: "log-rerun", targetId: completedLog.id })],
      notes: `Log ${completedLog.id} created rerun ${latestRun!.id}; UI refreshed the log workbench and audit recorded log-rerun with job metadata.`
    });
  });

  test("registers a log domain in /log-admin and binds an upload to it", async ({ page }, testInfo) => {
    // @acceptance LOG-DOMAIN-001
    // @operation LOG-DOMAIN-001
    await cleanupAcceptanceLogs();
    await cleanupAcceptanceLogDomains();

    await page.goto("/log-admin");
    await prepareInteractionSurface(page);

    const governance = page.getByTestId("log-domain-governance");
    await governance.getByRole("button", { name: "新建业务域" }).click();
    await page.getByLabel(/名称/).fill(acceptanceLogDomainName);
    await page.getByLabel(/描述/).fill("Acceptance charging/power subsystem log domain");
    await page.getByLabel(/格式画像 JSON/).fill('{"severityMap": {"error": ["E_THERMAL_FOLDBACK"]}}');
    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v1/log-domains")
    );
    await page.getByRole("button", { name: "创建业务域" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok()).toBe(true);
    await expect(governance.getByRole("table", { name: "业务域列表" }).getByText(acceptanceLogDomainName)).toBeVisible();

    const domainsResponse = await page.request.get(apiRoute("/api/v1/log-domains"), { headers: smokeHeaders() });
    expect(domainsResponse.ok()).toBe(true);
    const domainsBody = (await domainsResponse.json()) as { items: Array<{ id: string; name: string; status: string }> };
    const createdDomain = domainsBody.items.find((item) => item.name === acceptanceLogDomainName);
    expect(createdDomain).toBeTruthy();

    await page.goto("/logs");
    await uploadLogThroughUi(page, supportedFixture, analysisQuestion, acceptanceLogDomainName);
    const boundLog = await latestLogByFile(page, supportedFileName);
    expect(boundLog.logDomainId).toBe(createdDomain!.id);
    expect(boundLog.logDomainName).toBe(acceptanceLogDomainName);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");
    await historyItem(page, supportedFileName).click();
    await expect(page.getByTestId("analysis-provenance")).toContainText(`业务域 · ${acceptanceLogDomainName}`);

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
    };

    await recordOperationEvidence({
      operationId: "LOG-DOMAIN-001",
      title: "log domain registered in governance and upload bound to it",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(createResponse, {
          method: "POST",
          path: "/api/v1/log-domains",
          responseSummary: `created domain=${createdDomain!.id}`
        }),
        summarizeApiResponse(domainsResponse, {
          method: "GET",
          path: "/api/v1/log-domains",
          responseSummary: `domains=${domainsBody.items.length}; contains ${acceptanceLogDomainName}`
        })
      ],
      db: [await logDomainDbSummary(acceptanceLogDomainName), await logRecordDbSummary(boundLog.id)],
      audit: [auditSummaryFor(auditBody.items, { kind: "log-domain-create", targetId: createdDomain!.id })],
      notes: `Domain ${createdDomain!.id} was registered through /log-admin governance and upload ${boundLog.id} bound to it; the conclusion card shows the domain provenance chip.`
    });
  });

  test("links published knowledge entries to a log domain with published-only selection and audit", async ({ page }, testInfo) => {
    // @acceptance LOG-DOMAIN-KNOWLEDGE-001
    // @operation LOG-DOMAIN-KNOWLEDGE-001
    await cleanupAcceptanceLogs();
    await cleanupAcceptanceLogDomains();
    await cleanupAcceptanceKnowledgeEntries();

    const domainResponse = await page.request.post(apiRoute("/api/v1/log-domains"), {
      headers: smokeHeaders(),
      data: { name: acceptanceLogDomainName, description: "Acceptance domain for knowledge links" }
    });
    expect(domainResponse.status()).toBe(201);
    const domain = ((await domainResponse.json()) as { item: { id: string } }).item;

    const publishedTitle = `${acceptanceKnowledgeTitlePrefix} published handbook`;
    const draftTitle = `${acceptanceKnowledgeTitlePrefix} draft note`;
    const createPublished = await page.request.post(apiRoute("/api/v1/knowledge/entries"), {
      headers: smokeHeaders(),
      data: {
        contentForm: "markdown",
        title: publishedTitle,
        tags: ["charging"],
        contentMarkdown: "E_THERMAL_FOLDBACK 表示热保护降流；先检查散热路径与阈值配置。"
      }
    });
    expect(createPublished.status()).toBe(201);
    const publishedEntry = ((await createPublished.json()) as { item: { id: string } }).item;
    const publishResponse = await page.request.post(
      apiRoute(`/api/v1/knowledge/entries/${publishedEntry.id}/publish`),
      { headers: smokeHeaders(), data: {} }
    );
    expect(publishResponse.ok()).toBe(true);

    const createDraft = await page.request.post(apiRoute("/api/v1/knowledge/entries"), {
      headers: smokeHeaders(),
      data: {
        contentForm: "markdown",
        title: draftTitle,
        tags: [],
        contentMarkdown: "草稿内容不得进入检索或关联。"
      }
    });
    expect(createDraft.status()).toBe(201);

    await page.goto("/log-admin");
    await prepareInteractionSurface(page);
    const governance = page.getByTestId("log-domain-governance");
    const domainsTable = governance.getByRole("table", { name: "业务域列表" });
    await domainsTable
      .getByRole("row")
      .filter({ hasText: acceptanceLogDomainName })
      .getByRole("button", { name: "知识条目" })
      .click();

    const editor = page.getByTestId("domain-knowledge-links-editor");
    await expect(editor).toBeVisible();
    const publishedCheckbox = editor.getByRole("checkbox", { name: `关联知识条目 ${publishedTitle}` });
    await expect(publishedCheckbox).toBeVisible({ timeout: 10_000 });
    // Published-only invariant: the draft entry never appears as a selectable link.
    await expect(editor.getByRole("checkbox", { name: `关联知识条目 ${draftTitle}` })).toHaveCount(0);

    await publishedCheckbox.check();
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/v1/log-domains/${domain.id}/knowledge-links`)
    );
    await editor.getByRole("button", { name: "保存关联" }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBe(true);
    await expect(editor.getByRole("status")).toHaveText(/已保存/);

    const linksResponse = await page.request.get(
      apiRoute(`/api/v1/log-domains/${domain.id}/knowledge-links`),
      { headers: smokeHeaders() }
    );
    expect(linksResponse.ok()).toBe(true);
    const linksBody = (await linksResponse.json()) as {
      items: Array<{ knowledgeEntryId: string; entryTitle: string; entryStatus: string }>;
    };
    expect(linksBody.items).toEqual([
      expect.objectContaining({ knowledgeEntryId: publishedEntry.id, entryStatus: "published" })
    ]);

    await expect
      .poll(async () => {
        const response = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
        const body = (await response.json()) as { items: Array<{ kind: string; targetId: string | null }> };
        return body.items.some(
          (item) => item.kind === "log-domain-knowledge-links-update" && item.targetId === domain.id
        );
      })
      .toBe(true);

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
    };

    await recordOperationEvidence({
      operationId: "LOG-DOMAIN-KNOWLEDGE-001",
      title: "log domain linked to published knowledge entries with audit",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(saveResponse, {
          method: "PUT",
          path: `/api/v1/log-domains/${domain.id}/knowledge-links`,
          responseSummary: `linked entries=[${publishedEntry.id}]`
        }),
        summarizeApiResponse(linksResponse, {
          method: "GET",
          path: `/api/v1/log-domains/${domain.id}/knowledge-links`,
          responseSummary: `links=${linksBody.items.length}; first=${linksBody.items[0]?.entryTitle ?? "none"} (${linksBody.items[0]?.entryStatus ?? "-"})`
        })
      ],
      db: [await logDomainDbSummary(acceptanceLogDomainName), await domainKnowledgeLinkDbSummary(domain.id)],
      audit: [auditSummaryFor(auditBody.items, { kind: "log-domain-knowledge-links-update", targetId: domain.id })],
      notes: `Domain ${domain.id} was linked to published knowledge entry ${publishedEntry.id} through the /log-admin governance editor; the draft entry stayed unselectable (published-only invariant) and the replace-set save was audited.`
    });
  });

  test("marks a degraded rules-fallback analysis visibly after a provider outage", async ({ page }, testInfo) => {
    // @acceptance LOG-DEGRADED-001
    // @operation LOG-DEGRADED-001
    await cleanupAcceptanceLogs();

    await page.goto("/logs");
    await uploadLogThroughUi(page, providerOutageFixture, "为什么分析发生降级？");
    await expect
      .poll(async () => (await latestLogByFile(page, providerOutageFileName)).status, { timeout: 90_000 })
      .toBe("complete");

    const degradedLogsResponse = await page.request.get(
      apiRoute("/api/v1/logs?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    expect(degradedLogsResponse.ok()).toBe(true);
    const degradedLogsBody = (await degradedLogsResponse.json()) as {
      items: Array<{
        id: string;
        fileName: string;
        status: string;
        analysisSource?: string;
        degradedReason?: string;
      }>;
    };
    const degradedLog = degradedLogsBody.items.find((item) => item.fileName === providerOutageFileName)!;
    expect(degradedLog).toBeTruthy();
    expect(degradedLog.analysisSource).toBe("rules-fallback");
    expect(degradedLog.degradedReason).toBe("provider-unavailable");

    await historyItem(page, providerOutageFileName).click();
    const provenance = page.getByTestId("analysis-provenance");
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText("降级分析 · 规则回退");
    await expect(provenance).toContainText("AI 分析服务不可用");

    await recordOperationEvidence({
      operationId: "LOG-DEGRADED-001",
      title: "provider outage degrades honestly to marked rules fallback",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(degradedLogsResponse, {
          method: "GET",
          path: "/api/v1/logs?includeArchived=true",
          responseSummary: `log ${degradedLog.id} status=${degradedLog.status}; analysisSource=${degradedLog.analysisSource}; degradedReason=${degradedLog.degradedReason}`
        })
      ],
      db: [await logRecordDbSummary(degradedLog.id), await logReportDbSummary(degradedLog.id)],
      audit: [],
      notes: `Log ${degradedLog.id} completed as an honestly marked degraded analysis (rules-fallback / provider-unavailable) after the simulated provider outage; the conclusion card shows the prominent degraded badge instead of impersonating a full analysis.`
    });
  });

  test("aggregates feedback helpful rate into the /log-admin analysis-quality section", async ({ page }, testInfo) => {
    // @acceptance LOG-FEEDBACK-INSIGHTS-001
    // @operation LOG-FEEDBACK-INSIGHTS-001
    await cleanupAcceptanceLogs();

    await page.goto("/logs");
    await uploadLogThroughUi(page, supportedFixture, analysisQuestion);
    const completedLog = await latestLogByFile(page, supportedFileName);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");

    const helpfulResponse = await page.request.post(apiRoute(`/api/v1/logs/${completedLog.id}/feedback`), {
      headers: smokeHeaders(),
      data: { rating: "helpful", note: "Insights acceptance: matched the incident." }
    });
    expect(helpfulResponse.ok()).toBe(true);
    const notHelpfulResponse = await page.request.post(apiRoute(`/api/v1/logs/${completedLog.id}/feedback`), {
      headers: smokeHeaders(),
      data: { rating: "not_helpful" }
    });
    expect(notHelpfulResponse.ok()).toBe(true);

    const insightsResponse = await page.request.get(
      apiRoute("/api/v1/logs/feedback-insights?timeWindow=today"),
      { headers: smokeHeaders() }
    );
    expect(insightsResponse.ok()).toBe(true);
    const insightsBody = (await insightsResponse.json()) as {
      items: Array<{
        logDomainName: string | null;
        analysisSource: string | null;
        promptVersion: string | null;
        totalCount: number;
        helpfulCount: number;
        helpfulRate: number;
      }>;
    };
    const insightRow = insightsBody.items.find((item) => item.totalCount >= 2);
    expect(insightRow).toBeTruthy();
    expect(insightRow!.helpfulCount).toBe(1);

    await page.goto("/log-admin");
    await prepareInteractionSurface(page);
    const insightsSection = page.getByTestId("feedback-quality-insights");
    await expect(insightsSection).toBeVisible();
    const insightsTable = insightsSection.getByRole("table", { name: "分析质量反馈聚合" });
    await expect(insightsTable).toContainText("50%（1/2）");
    await expect(insightsTable).toContainText(/未分类/);

    await recordOperationEvidence({
      operationId: "LOG-FEEDBACK-INSIGHTS-001",
      title: "feedback aggregates into the analysis quality dashboard",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(helpfulResponse, {
          method: "POST",
          path: `/api/v1/logs/${completedLog.id}/feedback`,
          responseSummary: "rating=helpful recorded"
        }),
        summarizeApiResponse(insightsResponse, {
          method: "GET",
          path: "/api/v1/logs/feedback-insights?timeWindow=today",
          responseSummary: `rows=${insightsBody.items.length}; top row total=${insightRow!.totalCount} helpful=${insightRow!.helpfulCount} rate=${insightRow!.helpfulRate}`
        })
      ],
      db: [await logFeedbackDbSummary(completedLog.id)],
      audit: [],
      notes: `Two feedback entries (helpful + not_helpful) on log ${completedLog.id} aggregate to a 50% (1/2) helpful-rate row in the /log-admin 分析质量 section for the today window, grouped by domain x analysis source x prompt version.`
    });
  });

  test("exports an eval-case annotation draft with the de-identification checklist from the record drawer", async ({ page }, testInfo) => {
    // @acceptance LOG-EVAL-DRAFT-001
    // @operation LOG-EVAL-DRAFT-001
    await cleanupAcceptanceLogs();

    await page.goto("/logs");
    await uploadLogThroughUi(page, supportedFixture, analysisQuestion);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");

    await page.goto("/log-admin");
    await prepareInteractionSurface(page);
    await page.locator('input[type="search"]').fill(supportedFileName);
    await page.getByRole("row").filter({ hasText: supportedFileName }).first().click();

    await page.getByRole("button", { name: "导出评测案例草稿" }).click();
    const dialog = page.getByTestId("export-eval-case-draft-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("eval-cases/logs/uncategorized/");
    await expect(dialog).toContainText("无个人姓名、电话、邮箱或账号标识");
    await expect(dialog).toContainText(/把 deIdentified 改为 true/);
    await expect(dialog).toContainText("无法完全脱敏的案例不得进入仓库");

    const caseYamlDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载 case.yaml 草稿" }).click();
    const caseYamlDownload = await caseYamlDownloadPromise;
    expect(caseYamlDownload.suggestedFilename()).toMatch(/case\.yaml$/);
    const caseYaml = readFileSync((await caseYamlDownload.path())!, "utf8");
    expect(caseYaml).toContain("domain: uncategorized");
    expect(caseYaml).toContain("realLog: true");
    expect(caseYaml).toContain("deIdentified: false");
    expect(caseYaml).toContain("rootCauseCategory: TODO");
    expect(caseYaml).toContain(`analysisQuestion: ${JSON.stringify(analysisQuestion)}`);

    const logTxtDownloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载 log.txt" }).click();
    const logTxtDownload = await logTxtDownloadPromise;
    expect(logTxtDownload.suggestedFilename()).toMatch(/log\.txt$/);
    const logText = readFileSync((await logTxtDownload.path())!, "utf8");
    expect(logText).toContain("charger session started device=PACK-A01");

    await recordOperationEvidence({
      operationId: "LOG-EVAL-DRAFT-001",
      title: "eval case draft export shows checklist and downloads draft files",
      status: "passed",
      page,
      testInfo,
      notes:
        "The drawer's 导出评测案例草稿 action opened the de-identification checklist dialog and downloaded a schema-aligned case.yaml draft (realLog: true, deIdentified: false, rootCauseCategory TODO, prefilled evidence/actions/question) plus log.txt; no repository write or auto-commit happens by design."
    });
  });

  test("unpacks a .gz upload server-side and completes analysis end to end", async ({ page }, testInfo) => {
    // @acceptance LOG-ARCHIVE-UPLOAD-001
    // @operation LOG-ARCHIVE-UPLOAD-001
    await cleanupAcceptanceLogs();

    const gzBuffer = gzipSync(readFileSync(supportedFixture));
    await page.goto("/logs");
    await prepareInteractionSurface(page);
    await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
    const uploadDialog = page.getByRole("dialog", { name: "上传日志" });
    await expect(uploadDialog).toContainText(/\.gz、单条目 \.zip 压缩包/);
    await uploadDialog.getByLabel("选择日志文件").setInputFiles({
      name: archiveFileName,
      mimeType: "application/gzip",
      buffer: gzBuffer
    });
    await uploadDialog.locator("#upload-analysis-question").fill(analysisQuestion);
    await uploadDialog.getByRole("button", { name: "确认上传" }).click();
    await expect(uploadDialog).not.toBeVisible({ timeout: 70_000 });

    const archiveLog = await latestLogByFile(page, archiveFileName);
    await expect
      .poll(async () => (await latestLogByFile(page, archiveFileName)).status, { timeout: 70_000 })
      .toBe("complete");
    await historyItem(page, archiveFileName).click();
    await expect(page.locator("#log-conclusion-title")).toContainText(/thermal|foldback/i, { timeout: 30_000 });

    const archiveLogsResponse = await page.request.get(apiRoute("/api/v1/logs"), { headers: smokeHeaders() });
    expect(archiveLogsResponse.ok()).toBe(true);
    const archiveLogsBody = (await archiveLogsResponse.json()) as {
      items: Array<{ id: string; fileName: string; status: string }>;
    };
    expect(archiveLogsBody.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ fileName: archiveFileName, status: "complete" })])
    );

    await recordOperationEvidence({
      operationId: "LOG-ARCHIVE-UPLOAD-001",
      title: "gz upload unpacked server-side completes analysis",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(archiveLogsResponse, {
          method: "GET",
          path: "/api/v1/logs",
          responseSummary: `log ${archiveLog.id} fileName=${archiveFileName} status=complete after server-side unpack`
        })
      ],
      db: [await logRecordDbSummary(archiveLog.id)],
      audit: [],
      notes: `A gzip-compressed charging log uploaded as ${archiveFileName} was unpacked at intake, analyzed end to end, and produced the same thermal-foldback conclusion as the plain-text fixture; the upload dialog states archive support.`
    });
  });

  test("configures a domain result webhook and delivers a signed payload after a domain-bound analysis", async ({ page }, testInfo) => {
    // @acceptance LOG-DOMAIN-WEBHOOK-001
    // @operation LOG-DOMAIN-WEBHOOK-001
    await cleanupAcceptanceLogs();
    await cleanupAcceptanceLogDomains();

    const receiver = await startWebhookReceiver();
    try {
      const domainResponse = await page.request.post(apiRoute("/api/v1/log-domains"), {
        headers: smokeHeaders(),
        data: { name: acceptanceWebhookDomainName, description: "Acceptance domain for result webhooks" }
      });
      expect(domainResponse.status()).toBe(201);
      const domain = ((await domainResponse.json()) as { item: { id: string } }).item;

      await page.goto("/log-admin");
      await prepareInteractionSurface(page);
      const governance = page.getByTestId("log-domain-governance");
      await governance
        .getByRole("table", { name: "业务域列表" })
        .getByRole("row")
        .filter({ hasText: acceptanceWebhookDomainName })
        .getByRole("button", { name: "结果回调" })
        .click();

      const editor = page.getByTestId("domain-webhook-editor");
      await expect(editor).toBeVisible();
      await editor.getByLabel(/Webhook URL/).fill(receiver.url);
      await editor.getByLabel(/签名密钥/).fill(acceptanceWebhookSecret);
      await editor.getByRole("checkbox", { name: "启用结果回调" }).check();
      const saveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          response.url().includes(`/api/v1/log-domains/${domain.id}/webhook`)
      );
      await editor.getByRole("button", { name: "保存配置" }).click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.ok()).toBe(true);
      const savedDomain = ((await saveResponse.json()) as {
        item: { webhook: { enabled: boolean; secretConfigured: boolean; secretLastFour?: string } };
      }).item;
      // Write-only secret: the API reports configured-state + last four, never the value.
      expect(savedDomain.webhook).toMatchObject({ enabled: true, secretConfigured: true });
      expect(JSON.stringify(savedDomain)).not.toContain(acceptanceWebhookSecret);
      await expect(editor).toContainText(`已配置 · 末四位 ${acceptanceWebhookSecret.slice(-4)}`);

      await page.goto("/logs");
      await uploadLogThroughUi(page, supportedFixture, analysisQuestion, acceptanceWebhookDomainName);
      const boundLog = await latestLogByFile(page, supportedFileName);
      await expect
        .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
        .toBe("complete");

      // Delivery is best-effort and asynchronous; poll the loopback receiver.
      await expect.poll(() => receiver.received.length, { timeout: 30_000 }).toBeGreaterThan(0);
      const delivery = receiver.received[0];
      expect(verifyWebhookSignature(delivery, acceptanceWebhookSecret)).toBe(true);
      const payload = JSON.parse(delivery.body) as Record<string, unknown>;
      expect(payload).toMatchObject({
        event: "log-analysis.completed",
        recordId: boundLog.id,
        logDomainId: domain.id,
        status: "complete",
        fileName: supportedFileName
      });
      // Compact summary only — raw log content and evidence text never leave the system.
      expect(payload).not.toHaveProperty("rawLines");
      expect(payload).not.toHaveProperty("evidence");
      expect(delivery.body).not.toContain("charger session started device=PACK-A01");

      const deliveriesResponse = await page.request.get(
        apiRoute(`/api/v1/log-domains/${domain.id}/webhook-deliveries`),
        { headers: smokeHeaders() }
      );
      expect(deliveriesResponse.ok()).toBe(true);
      const deliveriesBody = (await deliveriesResponse.json()) as {
        items: Array<{ kind: string; attempt: number; status: string; httpStatus?: number }>;
      };
      expect(deliveriesBody.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "result", status: "delivered", httpStatus: 200 })])
      );

      await page.goto("/log-admin");
      await prepareInteractionSurface(page);
      await page
        .getByTestId("log-domain-governance")
        .getByRole("table", { name: "业务域列表" })
        .getByRole("row")
        .filter({ hasText: acceptanceWebhookDomainName })
        .getByRole("button", { name: "结果回调" })
        .click();
      const deliveriesList = page.getByTestId("domain-webhook-deliveries");
      await expect(deliveriesList).toBeVisible();
      await expect(deliveriesList).toContainText("已送达");
      await expect(deliveriesList).toContainText("HTTP 200");

      const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
      expect(auditResponse.ok()).toBe(true);
      const auditBody = (await auditResponse.json()) as {
        items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
      };

      await recordOperationEvidence({
        operationId: "LOG-DOMAIN-WEBHOOK-001",
        title: "domain result webhook configured and signed delivery received",
        status: "passed",
        page,
        testInfo,
        api: [
          summarizeApiResponse(saveResponse, {
            method: "PUT",
            path: `/api/v1/log-domains/${domain.id}/webhook`,
            responseSummary: `enabled=true; secretConfigured=true; secret never echoed`
          }),
          summarizeApiResponse(deliveriesResponse, {
            method: "GET",
            path: `/api/v1/log-domains/${domain.id}/webhook-deliveries`,
            responseSummary: `deliveries=${deliveriesBody.items.length}; first=${deliveriesBody.items[0]?.status} (HTTP ${deliveriesBody.items[0]?.httpStatus ?? "-"})`
          })
        ],
        db: [await domainWebhookConfigDbSummary(domain.id), await webhookDeliveryDbSummary(domain.id)],
        audit: [auditSummaryFor(auditBody.items, { kind: "log-domain-webhook-config", targetId: domain.id })],
        notes: `Domain ${domain.id} was configured with a result webhook through /log-admin governance; completing analysis ${boundLog.id} delivered an HMAC-signed compact payload (signature verified against the configured secret, no raw log content) to the loopback receiver, and the delivered attempt appeared in the recent-deliveries list, API, and delivery table.`
      });
    } finally {
      await receiver.close();
    }
  });

  test("sets a per-domain model override that persists and lands in the report's model provenance", async ({ page }, testInfo) => {
    // @acceptance LOG-DOMAIN-MODEL-001
    // @operation LOG-DOMAIN-MODEL-001
    await cleanupAcceptanceLogs();
    await cleanupAcceptanceLogDomains();

    await page.goto("/log-admin");
    await prepareInteractionSurface(page);
    const governance = page.getByTestId("log-domain-governance");
    await governance.getByRole("button", { name: "新建业务域" }).click();
    await page.getByLabel(/名称/).fill(acceptanceModelDomainName);
    await page.getByLabel(/描述/).fill("Acceptance domain for the per-domain model override");
    const overrideInput = page.getByLabel(/模型覆盖/);
    await expect(overrideInput).toHaveAttribute("placeholder", "留空使用全局模型");
    await overrideInput.fill(acceptanceModelOverride);
    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v1/log-domains")
    );
    const overridePatchPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && response.url().includes("/api/v1/log-domains/")
    );
    await page.getByRole("button", { name: "创建业务域" }).click();
    expect((await createResponsePromise).ok()).toBe(true);
    const overridePatchResponse = await overridePatchPromise;
    expect(overridePatchResponse.ok()).toBe(true);

    const domainsResponse = await page.request.get(apiRoute("/api/v1/log-domains"), { headers: smokeHeaders() });
    expect(domainsResponse.ok()).toBe(true);
    const domainsBody = (await domainsResponse.json()) as {
      items: Array<{ id: string; name: string; modelOverride?: string }>;
    };
    const createdDomain = domainsBody.items.find((item) => item.name === acceptanceModelDomainName);
    expect(createdDomain).toBeTruthy();
    expect(createdDomain!.modelOverride).toBe(acceptanceModelOverride);
    await expect(page.getByTestId(`domain-model-${createdDomain!.id}`)).toHaveText(acceptanceModelOverride);

    await page.goto("/logs");
    await uploadLogThroughUi(page, supportedFixture, analysisQuestion, acceptanceModelDomainName);
    const boundLog = await latestLogByFile(page, supportedFileName);
    expect(boundLog.logDomainId).toBe(createdDomain!.id);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");

    // The override replaces only the model NAME; the report's provenance records it.
    await expect
      .poll(async () => (await reportModelDbSummary(boundLog.id)).observed, { timeout: 30_000 })
      .toContain(`model=${acceptanceModelOverride}`);

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as {
      items: Array<{ id?: string; kind: string; action?: string; targetId: string | null; traceId?: string; metadata?: Record<string, unknown> }>;
    };
    const overrideAudit = auditBody.items.find(
      (item) =>
        item.kind === "log-domain-update" &&
        item.targetId === createdDomain!.id &&
        item.metadata?.modelOverride === acceptanceModelOverride
    );
    expect(overrideAudit).toBeTruthy();

    await recordOperationEvidence({
      operationId: "LOG-DOMAIN-MODEL-001",
      title: "per-domain model override persists and reaches report provenance",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(overridePatchResponse, {
          method: "PATCH",
          path: `/api/v1/log-domains/${createdDomain!.id}`,
          responseSummary: `modelOverride=${acceptanceModelOverride}`
        }),
        summarizeApiResponse(domainsResponse, {
          method: "GET",
          path: "/api/v1/log-domains",
          responseSummary: `domain ${createdDomain!.id} carries modelOverride=${createdDomain!.modelOverride}`
        })
      ],
      db: [await domainWebhookConfigDbSummary(createdDomain!.id), await reportModelDbSummary(boundLog.id)],
      audit: [auditSummaryFor(auditBody.items, { kind: "log-domain-update", targetId: createdDomain!.id })],
      notes: `Domain ${createdDomain!.id} saved 模型覆盖=${acceptanceModelOverride} through the /log-admin form (placeholder states blank = global model); the bound analysis ${boundLog.id} recorded the override as the report's model provenance while endpoint/key/budget stayed global.`
    });
  });
});
