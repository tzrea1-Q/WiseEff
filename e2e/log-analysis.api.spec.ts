import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { expect, test, type Locator, type Page } from "playwright/test";
import { apiRoute, smokeHeaders } from "./acceptance/helpers/runtime";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
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

async function cleanupM2E2ELogs(client: Client) {
  const logs = await client.query<{ id: string; file_object_id: string }>(
    `
    select id, file_object_id
    from log_records
    where project_id = $1
      and (
        analysis_question = $2
        or file_name in ($3, $4)
      )
    `,
    [projectId, analysisQuestion, supportedFileName, unsupportedFileName]
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
}

async function seedM2AdminUser(client: Client) {
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
    values ('e2e-u-xu-yun-admin', 'u-xu-yun', 'org-chargelab', null, 'admin')
    on conflict (id) do update set
      project_id = excluded.project_id,
      role_id = excluded.role_id
    `
  );
}

async function latestLogByFile(page: Page, fileName: string) {
  const response = await page.request.get(
    apiRoute(`/api/v1/logs?projectId=${projectId}&includeArchived=true`),
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

async function uploadLogThroughUi(page: Page, filePath: string, question?: string) {
  await page.getByRole("button", { name: /上传新日志/ }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="file"]').setInputFiles(filePath);
  if (question) {
    await dialog.locator("#upload-analysis-question").fill(question);
  }
  await dialog.locator(".upload-dialog__actions .button.primary, .upload-dialog__actions .button.danger").click();
  await expect(dialog).not.toBeVisible({ timeout: 70_000 });
}

function historyItem(page: Page, fileName: string): Locator {
  return page.locator(".history-item").filter({ hasText: fileName }).first();
}

test.beforeAll(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the M2 log analysis API E2E smoke.");
  }

  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  runNpmScript("db:seed:m2");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await cleanupM2E2ELogs(client);
    await seedM2AdminUser(client);
  } finally {
    await client.end();
  }
});

test("M2 log analysis upload, evidence, feedback, archive, and unsupported failure loop", async ({ page }) => {
  await page.goto(`/logs?project=${projectId}`);

  await uploadLogThroughUi(page, supportedFixture, analysisQuestion);

  const completedLog = await latestLogByFile(page, supportedFileName);
  await expect
    .poll(async () => (await latestLogByFile(page, supportedFileName)).status, { timeout: 70_000 })
    .toBe("complete");
  await historyItem(page, supportedFileName).click();
  await expect(page.locator("#log-conclusion-title")).toContainText(/thermal|foldback/i);

  const evidenceCard = page.locator(".evidence-card").filter({ hasText: /thermal|foldback/i }).first();
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

  await page.locator('button:has(svg[class*="lucide-archive"])').click();
  await expect
    .poll(async () => (await latestLogByFile(page, supportedFileName)).archiveState)
    .toBe("archived");

  await page.goto(`/logs?project=${projectId}`);
  await page.reload();
  await expect(historyItem(page, supportedFileName)).toHaveCount(0);
  const activeLogs = await page.request.get(apiRoute(`/api/v1/logs?projectId=${projectId}`), {
    headers: smokeHeaders()
  });
  const activeBody = (await activeLogs.json()) as { items: Array<{ fileName: string }> };
  expect(activeBody.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ fileName: supportedFileName })]));

  await uploadLogThroughUi(page, unsupportedFixture);
  await expect
    .poll(async () => {
      const log = await latestLogByFile(page, unsupportedFileName);
      return `${log.status}:${log.failureReason ?? ""}`;
    }, { timeout: 30_000 })
    .toMatch(/^failed:.*unsupported/i);
  const unsupportedHistoryItem = historyItem(page, unsupportedFileName);
  await expect(unsupportedHistoryItem).toBeVisible();
});
