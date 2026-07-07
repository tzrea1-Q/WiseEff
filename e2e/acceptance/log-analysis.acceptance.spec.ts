import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const analysisQuestion = "Why did fast charging fold back?";
const supportedFixture = path.resolve("test-fixtures/logs/charging-foldback.log");
const unsupportedFixture = path.resolve("test-fixtures/logs/unsupported.bin");
const supportedFileName = "charging-foldback.log";
const unsupportedFileName = "unsupported.bin";

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
          or file_name in ($3, $4)
        )
      `,
      [organizationId, analysisQuestion, supportedFileName, unsupportedFileName]
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
    items: Array<{ id: string; fileName: string; status: string; archiveState?: string; failureReason?: string | null }>;
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

async function uploadLogThroughUi(page: Page, filePath: string, question?: string) {
  await page.getByRole("toolbar", { name: /日志(?:分析工作台|智能分析)页面操作/ }).getByRole("button", { name: "上传新日志" }).click();
  const dialog = page.getByRole("dialog", { name: "上传日志" });
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
    // @operation LOG-HAPPY-001
    await page.goto("/logs");

    await uploadLogThroughUi(page, supportedFixture, analysisQuestion);

    const completedLog = await latestLogByFile(page, supportedFileName);
    await expect
      .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
      .toBe("complete");
    await historyItem(page, supportedFileName).click();
    await expect(page.locator("#log-conclusion-title")).toContainText(/thermal|foldback/i);

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
});
