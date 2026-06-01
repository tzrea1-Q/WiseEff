import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const projectId = "aurora";
const parameterName = "fast_charge_current_limit_ma";
const parameterValueId = `${projectId}-fast-charge-current`;
const actorUserId = "u-xu-yun";
const reasonPrefix = "M5.5 browser acceptance";

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

async function cleanupM55ParameterState() {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select cr.id, cr.submission_round_id
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where psi.reason like $1
      `,
      [`${reasonPrefix}%`]
    );
    const requestIds = requests.rows.map((row) => row.id);
    const roundIds = Array.from(
      new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
    );

    if (requestIds.length > 0) {
      await client.query("delete from parameter_review_decisions where request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_submission_items where change_request_id = any($1::text[])", [requestIds]);
      await client.query("delete from parameter_change_requests where id = any($1::text[])", [requestIds]);
    }
    if (roundIds.length > 0) {
      await client.query("delete from parameter_submission_rounds where id = any($1::text[])", [roundIds]);
    }

    await client.query(
      `
      delete from parameter_drafts
      where project_id = $1
        and user_id = $2
        and project_parameter_value_id = $3
      `,
      [projectId, actorUserId, parameterValueId]
    );
  });
}

async function prepareParameterNegativeAcceptanceState() {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  await cleanupM55ParameterState();
}

function searchTable(page: Page) {
  return page.locator(".parameters-table").filter({ hasText: parameterName }).first();
}

async function openParameterDraftDialog(page: Page, targetValue: string) {
  await page.goto(`/parameters?project=${projectId}`);
  await expect(searchTable(page)).toContainText(parameterName);
  await searchTable(page).locator(".view-row-button").first().click();
  await page.locator(".parameter-detail-dialog__actions .button.primary").click();

  const draftDialog = page.locator(".parameter-draft-dialog");
  await expect(draftDialog).toBeVisible();
  await draftDialog.locator(".parameter-target-editor").fill(targetValue);

  return draftDialog;
}

async function createOneValidDraft(page: Page, targetValue: string, reason: string) {
  const draftDialog = await openParameterDraftDialog(page, targetValue);
  await draftDialog.locator("textarea").last().fill(reason);
  await draftDialog.locator(".parameter-detail-dialog__actions .button.primary").click();
  await expect(draftDialog).not.toBeVisible();
}

async function openSubmitDialog(page: Page) {
  await page.locator(".modified-parameters-section .button.primary").click();
  const submitDialog = page.locator(".submission-dialog");
  await expect(submitDialog).toBeVisible();

  return submitDialog;
}

function optionTexts(select: ReturnType<Page["locator"]>) {
  return select.locator("option").evaluateAll((options) => options.map((option) => option.textContent?.trim() ?? ""));
}

test.describe("M5.5 parameter negative-path browser acceptance", () => {
  test.beforeAll(async () => {
    await prepareParameterNegativeAcceptanceState();
  });

  test("blocks blank draft reasons before API submission", async ({ page }) => {
    // @acceptance PARAM-REASON-001
    const draftDialog = await openParameterDraftDialog(page, "3100");

    await draftDialog.locator("textarea").last().fill("   ");
    await expect(draftDialog.locator(".parameter-detail-dialog__actions .button.primary")).toBeDisabled();
  });

  test("defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users", async ({ page }) => {
    // @acceptance PARAM-ASSIGNEE-001
    // @acceptance PARAM-ASSIGNEE-002
    await createOneValidDraft(page, "3101", `${reasonPrefix} valid assignee coverage`);
    const submitDialog = await openSubmitDialog(page);

    const hardwareSelect = submitDialog.getByLabel("硬件 MDE");
    const softwareCommitterSelect = submitDialog.getByLabel("软件 MDE");
    const softwareUserSelect = submitDialog.getByLabel("软件开发");

    await expect(hardwareSelect).not.toHaveValue("");
    await expect(softwareCommitterSelect).not.toHaveValue("");
    await expect(softwareUserSelect).not.toHaveValue("");

    await expect.poll(() => optionTexts(hardwareSelect)).toEqual(["Wang Jie", "Li Peng"]);
    await expect.poll(() => optionTexts(softwareCommitterSelect)).toEqual(["Sun Mei"]);
    await expect.poll(() => optionTexts(softwareUserSelect)).toEqual(["Liu Min", "Chen Na", "Sun Mei"]);

    for (const select of [hardwareSelect, softwareCommitterSelect, softwareUserSelect]) {
      await expect(select).not.toContainText("Xu Yun");
      await expect(select).not.toContainText("Tao Lin");
    }
  });

  test("rejects forced invalid workflow assignees at the API boundary", async ({ page }) => {
    // @acceptance PARAM-ASSIGNEE-003
    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: parameterValueId,
            targetValue: "3102",
            reason: `${reasonPrefix} invalid assignee guard`
          }
        ],
        reason: `${reasonPrefix} invalid assignee guard`,
        assignees: {
          hardwareCommitterId: "u-xu-yun",
          softwareCommitterId: "u-xu-yun",
          softwareUserId: "u-xu-yun"
        }
      }
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });
});
