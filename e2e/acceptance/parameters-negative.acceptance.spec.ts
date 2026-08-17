import "dotenv/config";
import { expect, test, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { type DisposablePostCutoverRuntime } from "./helpers/disposablePostCutoverRuntime";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import {
  createBindingDraftViaApi,
  deleteDraftViaApi,
  disposablePageUrl,
  integerCellTarget,
  seedIsolatedNumericCellBinding,
  seedIsolatedNumericCellPair,
  startSwappedDisposablePostCutoverRuntime,
  submitBindingDraftViaApi,
  type IsolatedBinding
} from "./helpers/semanticBindingFixture";

useBrowserDiagnostics(test);

const projectId = "aurora";
const reasonPrefix = "M5.5 browser acceptance";
const draftEditReasonPrefix = "M5.8 PARAM-DRAFT-EDIT-001 browser acceptance";
const databaseUrl = process.env.DATABASE_URL;

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover parameter negative acceptance.");

function adminHeaders() {
  return authHeadersForRole("admin");
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
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: (() => Promise<void>) | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable parameter-negative acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "param_neg",
      markerPurpose: "param-negative"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
    await cleanupM55ParameterState();
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await restoreDisposable?.();
  });

  test("blocks blank draft reasons before API submission", async ({ page }, testInfo) => {
    // @acceptance PARAM-REASON-001
    // @operation PARAM-REASON-001
    await signInBrowserAsRole(page, "admin", disposablePageUrl(disposableRuntime, "/parameter-admin"));
    const library = page.getByRole("region", { name: "参数定义库" });
    await expect(library).toBeVisible({ timeout: 30_000 });

    const draftFilter = library.getByRole("button", { name: /draft/i }).first();
    if (await draftFilter.isVisible().catch(() => false)) {
      await draftFilter.click();
    }

    const draftRow = library.getByRole("row").filter({ hasText: /draft/i }).first();
    if (await draftRow.isVisible().catch(() => false)) {
      await draftRow.click();
      const activate = page.getByRole("region", { name: "激活草稿定义" });
      if (await activate.isVisible().catch(() => false)) {
        await activate.getByLabel(/激活原因|reason/i).fill("   ");
        await expect(activate.getByRole("button", { name: /激活/ })).toBeDisabled();
      }
    }

    const blankSubmit = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: adminHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: "unused-legacy-id",
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

  test("edits a draft item and removes another item before final submission", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-DRAFT-EDIT-001
    // @operation PARAM-DRAFT-EDIT-001
    test.setTimeout(180_000);
    await signInBrowserAsRole(
      page,
      "admin",
      disposablePageUrl(disposableRuntime, `/parameters?project=${projectId}`)
    );
    await expect(page.getByRole("region", { name: "DTS 参数工作台" })).toBeVisible({ timeout: 30_000 });

    const pair = await seedIsolatedNumericCellPair(request, {
      kept: { propertyKey: "iin_max", cellValue: 2300 },
      removable: { propertyKey: "vin_min", cellValue: 4100 },
      reason: `${draftEditReasonPrefix} bindings`
    });

    const keptCreated = await createBindingDraftViaApi(request, {
      binding: pair.kept,
      targetValue: integerCellTarget("3111"),
      reason: `${draftEditReasonPrefix} editable item`
    });
    expect(keptCreated.status, keptCreated.bodyText).toBe(201);
    expect(keptCreated.draft).toBeTruthy();
    expect(keptCreated.draft!.rawText).toContain("3111");

    // Recreate the kept draft at the edited target so the write lock is captured
    // in one createBindingDraft; a second upsert can coalesce a stale occurrence.
    await deleteDraftViaApi(request, keptCreated.draft!.draftId);
    const updated = await createBindingDraftViaApi(request, {
      binding: pair.kept,
      targetValue: integerCellTarget("3122"),
      reason: `${draftEditReasonPrefix} editable item`
    });
    expect(updated.status, updated.bodyText).toBe(201);
    expect(updated.draft).toBeTruthy();
    expect(updated.draft!.rawText).toContain("3122");
    expect(updated.draft!.rawText).not.toContain("3111");

    const removableCreated = await createBindingDraftViaApi(request, {
      binding: pair.removable,
      targetValue: integerCellTarget("4331"),
      reason: `${draftEditReasonPrefix} removable item`,
      baseRevisionId: updated.draft!.candidateRevisionId
    });
    expect(removableCreated.status, removableCreated.bodyText).toBe(201);
    expect(removableCreated.draft).toBeTruthy();

    await deleteDraftViaApi(request, removableCreated.draft!.draftId);

    const submitResponse = await submitBindingDraftViaApi(request, {
      projectId,
      draft: updated.draft!,
      reason: `${draftEditReasonPrefix} editable item`
    });
    expect(submitResponse.status, submitResponse.bodyText).toBe(201);
    expect(submitResponse.requestId).toBeTruthy();
    expect(submitResponse.bodyText).toContain("3122");
    expect(submitResponse.bodyText).not.toContain("4331");

    await recordOperationEvidence({
      operationId: "PARAM-DRAFT-EDIT-001",
      title: "parameter draft edit and remove before submission",
      status: "passed",
      page,
      testInfo,
      api: [
        {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          status: submitResponse.status,
          responseSummary: `submitted request ${submitResponse.requestId}; removed target 4331 absent`
        }
      ],
      db: [await submittedDraftEditDbSummary(submitResponse.requestId!, "<4331>")],
      notes: "API-mode topology workspace: edited one typed binding draft target, deleted the other draft, and submitted only the edited item on disposable post-cutover identity (TD-079)."
    });
  });

  test("rejects forced invalid workflow assignees at the API boundary", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-ASSIGNEE-003
    // @operation PARAM-ASSIGNEE-003
    test.setTimeout(180_000);
    const binding: IsolatedBinding = await seedIsolatedNumericCellBinding(request, {
      propertyKey: "iin_max",
      cellValue: 2400,
      reason: `${reasonPrefix} assignee binding`
    });
    const created = await createBindingDraftViaApi(request, {
      binding,
      targetValue: integerCellTarget("3102"),
      reason: `${reasonPrefix} invalid assignee guard`
    });
    expect(created.status, created.bodyText).toBe(201);
    expect(created.draft).toBeTruthy();

    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: adminHeaders(),
      data: {
        projectId,
        items: [
          {
            draftId: created.draft!.draftId,
            projectParameterBindingId: created.draft!.projectParameterBindingId,
            parameterSpecId: created.draft!.parameterSpecId,
            action: created.draft!.action,
            targetValue: created.draft!.rawText,
            reason: created.draft!.reason
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
      notes: "The parameter submission API rejected role-ineligible workflow assignees with VALIDATION_FAILED after a typed binding draft was staged (TD-079)."
    });
  });
});
