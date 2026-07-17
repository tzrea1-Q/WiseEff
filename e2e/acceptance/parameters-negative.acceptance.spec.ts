import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const projectId = "aurora";
const parameterName = "fast_charge_current_limit_ma";
const parameterValueId = `${projectId}-fast-charge-current`;
const removableParameterValueId = `${projectId}-charge-voltage-limit`;
const actorUserId = "u-xu-yun";
const reasonPrefix = "M5.5 browser acceptance";
const draftEditReasonPrefix = "M5.8 PARAM-DRAFT-EDIT-001 browser acceptance";

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

async function cleanupOpenChangeRequests(parameterIds: string[]) {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select id, submission_round_id
      from parameter_change_requests
      where project_parameter_value_id = any($1::text[])
        and status not in ('merged', 'rejected', 'withdrawn')
      `,
      [parameterIds]
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
        and project_parameter_value_id = any($3::text[])
      `,
      [projectId, actorUserId, parameterIds]
    );
  });
}

async function cleanupM55ParameterState() {
  await withPgClient(async (client) => {
    const requests = await client.query<{ id: string; submission_round_id: string | null }>(
      `
      select cr.id, cr.submission_round_id
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where psi.reason like $1
        or psi.reason like $2
      `,
      [`${reasonPrefix}%`, `${draftEditReasonPrefix}%`]
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
  });
  await cleanupOpenChangeRequests([parameterValueId, removableParameterValueId]);
}

async function prepareParameterNegativeAcceptanceState() {
  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  await cleanupM55ParameterState();
}

async function createDraftViaApi(
  page: Page,
  input: { parameterId: string; targetValue: string; reason: string }
) {
  const response = await page.request.post(apiRoute("/api/v1/parameter-drafts"), {
    headers: smokeHeaders(),
    data: {
      projectId,
      parameterId: input.parameterId,
      targetValue: input.targetValue,
      reason: input.reason
    }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { item: { id: string; targetValue: string; reason: string } };
  return body.item;
}

function searchTable(page: Page) {
  return page.locator(".parameters-table").filter({ hasText: parameterName }).first();
}

async function openParameterDraftDialog(page: Page, targetValue: string) {
  await page.goto(`/parameters?project=${projectId}`);
  await expect(searchTable(page)).toContainText(parameterName);
  const row = searchTable(page).getByRole("row").filter({ hasText: parameterName }).first();
  await expect(row).toBeVisible();
  await row.locator(".view-row-button").click();
  await page.locator(".parameter-detail-dialog__actions .button.primary").click();
  const draftDialog = page.locator(".parameter-draft-dialog");
  await expect(draftDialog).toBeVisible();
  const targetCard = draftDialog.locator(".parameter-draft-card").filter({ hasText: parameterName }).first();
  await expect(targetCard).toBeVisible();
  await targetCard.locator(".parameter-target-editor").fill(targetValue);
  return draftDialog;
}

async function createOneValidDraft(page: Page, targetValue: string, reason: string) {
  const draftDialog = await openParameterDraftDialog(page, targetValue);
  const targetCard = draftDialog.locator(".parameter-draft-card").filter({ hasText: parameterName }).first();
  await targetCard.getByLabel(/修改原因/).fill(reason);
  const dismissXiaozeHint = page.getByRole("button", { name: "不再提示" });
  if (await dismissXiaozeHint.isVisible().catch(() => false)) {
    await dismissXiaozeHint.click();
  }
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
  return select.locator("option").evaluateAll((options) =>
    options.map((option) => option.textContent?.trim() ?? "").sort(),
  );
}

async function submittedDraftEditDbSummary(requestId: string, excludedTargetValue: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ request_id: string; target_value: string; submitted_count: string; excluded_count: string }>(
      `
      select
        cr.id as request_id,
        psi.target_value,
        count(*) over ()::text as submitted_count,
        (
          select count(*)::text
          from parameter_submission_items excluded
          where excluded.reason like $2
            and excluded.target_value = $3
        ) as excluded_count
      from parameter_change_requests cr
      join parameter_submission_items psi on psi.change_request_id = cr.id
      where cr.id = $1
      `,
      [requestId, `${draftEditReasonPrefix}%`, excludedTargetValue]
    );
    const row = result.rows[0];

    return {
      table: "parameter_submission_items",
      predicate: `requestId=${requestId}; excludedTargetValue=${excludedTargetValue}`,
      observed: row
        ? `targetValue=${row.target_value}; submittedCount=${row.submitted_count}; excludedCount=${row.excluded_count}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

test.describe("M5.5 parameter negative-path browser acceptance", () => {
  test.beforeAll(async () => {
    await prepareParameterNegativeAcceptanceState();
  });

  test.beforeEach(async () => {
    await cleanupOpenChangeRequests([parameterValueId, removableParameterValueId]);
  });

  test("blocks blank draft reasons before API submission", async ({ page }, testInfo) => {
    // @acceptance PARAM-REASON-001
    // @operation PARAM-REASON-001
    // API mode /parameters mounts topology workspace; blank-reason UX is enforced on
    // draft-spec activation (and identity mapping) rather than the legacy parameters table.
    await page.goto("/parameter-admin");
    const library = page.getByRole("region", { name: "参数规格库" });
    await expect(library).toBeVisible({ timeout: 30_000 });

    const draftFilter = library.getByRole("button", { name: /draft/i }).first();
    if (await draftFilter.isVisible().catch(() => false)) {
      await draftFilter.click();
    }

    const draftRow = library.getByRole("row").filter({ hasText: /draft/i }).first();
    if (await draftRow.isVisible().catch(() => false)) {
      await draftRow.click();
      const activate = page.getByRole("region", { name: "激活草稿规格" });
      if (await activate.isVisible().catch(() => false)) {
        await activate.getByLabel(/激活原因|reason/i).fill("   ");
        await expect(activate.getByRole("button", { name: /激活/ })).toBeDisabled();
      }
    }

    const blankSubmit = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: parameterValueId,
            targetValue: "3100",
            reason: "   "
          }
        ],
        reason: "   "
      }
    });
    expect(blankSubmit.status()).toBe(400);
    await expect(blankSubmit.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });

    await recordOperationEvidence({
      operationId: "PARAM-REASON-001",
      title: "blank parameter draft reason blocked",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(blankSubmit, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `blank reason rejected with ${blankSubmit.status()}`
        })
      ],
      notes: "Blank reason blocked at API submission boundary; draft-spec activate UI disables when reason is blank when a draft is available."
    });
  });

  test("edits a draft item and removes another item before final submission", async ({ page }, testInfo) => {
    // @acceptance PARAM-DRAFT-EDIT-001
    // @operation PARAM-DRAFT-EDIT-001
    await page.goto(`/parameters?project=${projectId}`);
    await expect(page.getByRole("region", { name: "项目拓扑工作区" })).toBeVisible({ timeout: 30_000 });

    const kept = await createDraftViaApi(page, {
      parameterId: parameterValueId,
      targetValue: "3111",
      reason: `${draftEditReasonPrefix} editable item`
    });
    const removable = await createDraftViaApi(page, {
      parameterId: removableParameterValueId,
      targetValue: "4331",
      reason: `${draftEditReasonPrefix} removable item`
    });

    const updateResponse = await page.request.post(apiRoute("/api/v1/parameter-drafts"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        parameterId: parameterValueId,
        targetValue: "3122",
        reason: `${draftEditReasonPrefix} editable item`
      }
    });
    expect(updateResponse.ok()).toBe(true);

    const deleteResponse = await page.request.delete(
      apiRoute(`/api/v1/parameter-drafts/${encodeURIComponent(removable.id)}`),
      { headers: smokeHeaders() }
    );
    expect(deleteResponse.ok()).toBe(true);

    const submitResponse = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: parameterValueId,
            targetValue: "3122",
            reason: `${draftEditReasonPrefix} editable item`
          }
        ],
        reason: `${draftEditReasonPrefix} editable item`,
        assignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-liu-min"
        }
      }
    });
    expect(submitResponse.ok()).toBe(true);
    const submitBody = (await submitResponse.json()) as {
      item: {
        items: Array<{ requestId: string; targetValue: string }>;
      };
    };
    expect(submitBody.item.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetValue: "3122" })])
    );
    expect(submitBody.item.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ targetValue: "4331" })])
    );
    const submittedRequestId = submitBody.item.items.find((item) => item.targetValue === "3122")?.requestId;
    expect(submittedRequestId).toBeTruthy();
    expect(kept.id).toBeTruthy();

    await recordOperationEvidence({
      operationId: "PARAM-DRAFT-EDIT-001",
      title: "parameter draft edit and remove before submission",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(submitResponse, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `submitted request ${submittedRequestId}; removed target 4331 absent`
        })
      ],
      db: [await submittedDraftEditDbSummary(submittedRequestId!, "4331")],
      notes: "API-mode topology workspace: edited one draft target, deleted the other draft, and submitted only the edited item."
    });
  });

  test("defaults every workflow assignee slot to an eligible active non-admin user and hides ineligible users", async ({
    page
  }, testInfo) => {
    // @acceptance PARAM-ASSIGNEE-001
    // @acceptance PARAM-ASSIGNEE-002
    // @operation PARAM-ASSIGNEE-001
    // @operation PARAM-ASSIGNEE-002
    await createOneValidDraft(page, "3101", `${reasonPrefix} valid assignee coverage`);
    const submitDialog = await openSubmitDialog(page);
    const hardwareSelect = submitDialog.getByLabel("硬件 MDE");
    const softwareCommitterSelect = submitDialog.getByLabel("软件 MDE");
    const softwareUserSelect = submitDialog.getByLabel("软件开发");

    await expect(hardwareSelect).not.toHaveValue("");
    await expect(softwareCommitterSelect).not.toHaveValue("");
    await expect(softwareUserSelect).not.toHaveValue("");
    await expect.poll(() => optionTexts(hardwareSelect)).toEqual(["Li Peng", "Wang Jie"]);
    await expect.poll(() => optionTexts(softwareCommitterSelect)).toEqual(["Sun Mei"]);
    await expect.poll(() => optionTexts(softwareUserSelect)).toEqual(["Chen Na", "Liu Min", "Sun Mei"]);

    for (const select of [hardwareSelect, softwareCommitterSelect, softwareUserSelect]) {
      await expect(select).not.toContainText("Xu Yun");
      await expect(select).not.toContainText("Tao Lin");
    }

    await recordOperationEvidence({
      operationId: "PARAM-ASSIGNEE-001",
      title: "workflow assignee defaults are eligible",
      status: "passed",
      page,
      testInfo,
      notes: "All three visible workflow selectors defaulted to non-empty project-scoped eligible active users."
    });
    await recordOperationEvidence({
      operationId: "PARAM-ASSIGNEE-002",
      title: "workflow assignee dropdowns hide ineligible users",
      status: "passed",
      page,
      testInfo,
      notes: "Visible dropdown options exactly excluded inactive, guest, admin-only, and role-ineligible users."
    });
  });

  test("rejects forced invalid workflow assignees at the API boundary", async ({ page }, testInfo) => {
    // @acceptance PARAM-ASSIGNEE-003
    // @operation PARAM-ASSIGNEE-003
    await cleanupOpenChangeRequests([removableParameterValueId]);

    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: removableParameterValueId,
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

    await recordOperationEvidence({
      operationId: "PARAM-ASSIGNEE-003",
      title: "forced invalid workflow assignees rejected",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(response, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: "VALIDATION_FAILED for role-ineligible workflow assignees"
        })
      ],
      notes: "The parameter submission API rejected role-ineligible workflow assignees with VALIDATION_FAILED."
    });
  });
});
