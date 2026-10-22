import "./helpers/loadAcceptanceEnvironment";
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
// Manual playwright-cli evidence, when captured outside the automated run, should live under work/ui-checks/product-feedback-*.

useBrowserDiagnostics(test);

const organizationId = "org-chargelab";
const submitterUserId = "acceptance-product-feedback-user";
const submitterRoleBindingId = "acceptance-product-feedback-user-hardware-user";
const descriptionPrefix = "PFB acceptance product feedback";
const submitDescription = `${descriptionPrefix} footer submit ${Date.now()}`;
const adminDescription = `${descriptionPrefix} admin triage ${Date.now()}`;
const adminNote = "Acceptance triage note: routed to beta response owner.";
const onePixelPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type ProductFeedbackApiItem = {
  id: string;
  submitterUserId: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: "experience" | "data" | "export_submit" | "feature";
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  adminNote: string | null;
  progressEvents: Array<{ kind: string; internalMessage: string | null; publicMessage: string | null }>;
  attachments: Array<{ id: string; fileName: string; contentType: string; sizeBytes: number; sortOrder: number }>;
};

type AuditApiItem = {
  id?: string;
  kind: string;
  action: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

function authHeaders(userId?: string): Record<string, string> {
  if (userId === submitterUserId) {
    return authHeadersForUser(submitterUserId, "pfb.acceptance@chargelab.cn", "PFB Acceptance User");
  }
  return smokeHeaders();
}

async function seedProductFeedbackAcceptanceUser() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'PFB Acceptance User', 'pfb.acceptance@chargelab.cn', 'Hardware Beta User', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [submitterUserId, organizationId]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, null, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [submitterRoleBindingId, submitterUserId, organizationId]
    );
  });
}

async function cleanupProductFeedbackAcceptanceRows() {
  await withPgClient(async (client) => {
    const feedback = await client.query<{ id: string }>(
      `
      select id
      from product_feedback
      where description like $1
      `,
      [`${descriptionPrefix}%`]
    );
    const feedbackIds = feedback.rows.map((row) => row.id);

    if (feedbackIds.length > 0) {
      await client.query("delete from audit_events where app = 'product-feedback' and target_id = any($1::text[])", [feedbackIds]);
      await client.query("delete from product_feedback where id = any($1::uuid[])", [feedbackIds]);
    }
  });
}

async function pastePngIntoFeedbackDialog(page: Page) {
  await page.getByRole("region", { name: /粘贴上传截图/ }).evaluate(
    (target, base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], "acceptance-feedback.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        })
      );
    },
    onePixelPngBase64
  );
}

async function createFeedbackViaApi(page: Page, description: string) {
  const response = await page.request.post(apiRoute("/api/v1/product-feedback"), {
    headers: authHeaders(submitterUserId),
    data: {
      pagePath: "/parameters",
      pageTitle: "参数工作台",
      feedbackType: "experience",
      description,
      attachments: [
        {
          fileName: "acceptance-admin-feedback.png",
          contentType: "image/png",
          contentBase64: onePixelPngBase64
        }
      ]
    }
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { item: ProductFeedbackApiItem };
  return { response, item: body.item };
}

async function productFeedbackDbSummary(feedbackId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      status: string;
      admin_note: string | null;
      attachment_count: string;
      submitter_user_id: string;
    }>(
      `
      select
        feedback.status,
        feedback.admin_note,
        feedback.submitter_user_id,
        count(attachments.id)::text as attachment_count
      from product_feedback feedback
      left join product_feedback_attachments attachments on attachments.feedback_id = feedback.id
      where feedback.id = $1
      group by feedback.id
      `,
      [feedbackId]
    );
    const row = result.rows[0];

    return {
      table: "product_feedback,product_feedback_attachments",
      predicate: `feedbackId=${feedbackId}`,
      observed: row
        ? `status=${row.status}; adminNote=${row.admin_note ?? "none"}; submitter=${row.submitter_user_id}; attachments=${row.attachment_count}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function feedbackAuditSummaries(feedbackId: string) {
  const response = await fetch(apiRoute(`/api/v1/audit-events?targetId=${encodeURIComponent(feedbackId)}`), {
    headers: { Accept: "application/json", ...authHeaders() }
  });
  expect(response.ok).toBe(true);
  const body = (await response.json()) as { items: AuditApiItem[] };
  return body.items
    .filter((item) => item.targetId === feedbackId && item.kind.startsWith("product-feedback-"))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      action: item.action,
      targetId: item.targetId,
      requestId: item.traceId,
      metadataSummary: Object.keys(item.metadata ?? {}).sort().join(",")
    }));
}

async function loadPageAsHardwareUser(page: Page, route: string) {
  await signInBrowserAsUser(page, submitterUserId, "pfb.acceptance@chargelab.cn", "PFB Acceptance User", route);
}

test.describe("Product feedback browser acceptance", () => {
  test.beforeAll(async () => {
    runNpmScript("db:migrate");
    runNpmScript("db:seed:m0");
    await seedProductFeedbackAcceptanceUser();
    await cleanupProductFeedbackAcceptanceRows();
  });

  test.afterAll(async () => {
    await cleanupProductFeedbackAcceptanceRows();
  });

  test("submits footer feedback with an optional image and persists it", async ({ page }, testInfo) => {
    // @acceptance PFB-SUBMIT-001
    // @operation PFB-SUBMIT-001
    await page.goto("/parameters");

    await page.locator('footer[aria-label="页脚信息"]').getByRole("button", { name: "问题反馈" }).click();
    const dialog = page.getByRole("dialog", { name: "问题反馈" });
    await expect(dialog).toBeVisible();
    const feedbackType = dialog.getByRole("combobox", { name: "反馈类型", exact: true });
    await feedbackType.click();
    await page.getByRole("option", { name: "导出/提交异常", exact: true }).click();
    await expect(feedbackType).toBeFocused();
    await feedbackType.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(feedbackType).toBeFocused();
    await dialog.getByLabel("问题描述").fill(submitDescription);
    await pastePngIntoFeedbackDialog(page);
    await expect(dialog.getByAltText("问题反馈截图预览")).toBeVisible();

    await dialog.getByRole("button", { name: "提交反馈" }).click();
    await expect(dialog.getByText("反馈已记录，并附带 1 张截图。")).toBeVisible();

    const listResponse = await page.request.get(apiRoute("/api/v1/product-feedback"), {
      headers: authHeaders()
    });
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: ProductFeedbackApiItem[] };
    const submitted = listBody.items.find((item) => item.description === submitDescription);
    expect(submitted).toBeTruthy();
    expect(submitted).toMatchObject({
      pagePath: "/parameters",
      feedbackType: "export_submit",
      status: "open"
    });
    const detailResponse = await page.request.get(apiRoute(`/api/v1/product-feedback/${submitted!.id}`), {
      headers: authHeaders()
    });
    expect(detailResponse.ok()).toBe(true);
    const detailBody = (await detailResponse.json()) as { item: ProductFeedbackApiItem };
    expect(detailBody.item.attachments).toHaveLength(1);

    await expect.poll(async () => (await productFeedbackDbSummary(submitted!.id)).observed).toContain("attachments=1");
    const audit = await feedbackAuditSummaries(submitted!.id);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "product-feedback-create",
          action: "create",
          targetId: submitted!.id
        })
      ])
    );

    await recordOperationEvidence({
      operationId: "PFB-SUBMIT-001",
      title: "footer feedback submit with optional image",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      api: [
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/product-feedback",
          responseSummary: `submitted feedback=${submitted!.id}`
        }),
        summarizeApiResponse(detailResponse, {
          method: "GET",
          path: `/api/v1/product-feedback/${submitted!.id}`,
          responseSummary: `attachments=${detailBody.item.attachments.length}`
        })
      ],
      db: [await productFeedbackDbSummary(submitted!.id)],
      audit
    });
  });

  test("lets Admin list, open, triage, close, and note feedback", async ({ page }, testInfo) => {
    // @acceptance PFB-ADMIN-001
    // @operation PFB-ADMIN-001
    const created = await createFeedbackViaApi(page, adminDescription);
    // Put the target beyond the first server page so search exercises the actual cursor round trip.
    for (let index = 0; index < 50; index += 1) {
      await createFeedbackViaApi(page, `${descriptionPrefix} newer page ${index} ${Date.now()}`);
    }
    const firstPageResponse = await page.request.get(apiRoute("/api/v1/product-feedback?limit=50"), { headers: authHeaders() });
    expect(firstPageResponse.ok()).toBe(true);
    const firstPage = await firstPageResponse.json() as { items: ProductFeedbackApiItem[]; nextCursor: string | null };
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.items.some((item) => item.id === created.item.id)).toBe(false);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPageResponse = await page.request.get(apiRoute(`/api/v1/product-feedback?limit=50&cursor=${encodeURIComponent(firstPage.nextCursor!)}`), { headers: authHeaders() });
    expect(secondPageResponse.ok()).toBe(true);
    const secondPage = await secondPageResponse.json() as { items: ProductFeedbackApiItem[] };
    expect(secondPage.items.some((item) => item.id === created.item.id)).toBe(true);

    await page.goto("/feedback-admin");
    await expect(page.getByRole("table", { name: "产品反馈记录" })).toBeVisible();
    await page.getByLabel("搜索反馈").fill(adminDescription);

    const table = page.getByRole("table", { name: "产品反馈记录" });
    const row = table.getByRole("row").filter({ hasText: adminDescription });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.getByRole("heading", { name: adminDescription })).toBeVisible();
    await expect(page.getByRole("table", { name: "产品反馈记录" })).toBeHidden();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.getByRole("button", { name: "写内部备注", exact: true }).click();
    await page.getByLabel("内部备注", { exact: true }).fill(adminNote);
    await page.getByRole("button", { name: "开始处理" }).click();
    await expect(page.getByRole("button", { name: "标记解决", exact: true })).toBeVisible();
    await expect(page.getByLabel("内部备注", { exact: true })).toHaveValue(adminNote);
    await page.getByRole("button", { name: "保存内部备注", exact: true }).click();
    await expect(page.getByRole("button", { name: "写内部备注", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "标记解决", exact: true }).click();
    await page.getByRole("dialog", { name: "标记解决", exact: true }).getByLabel("处理说明", { exact: true }).fill("处理已完成，复核通过。");
    await page.getByRole("button", { name: "确认解决", exact: true }).click();
    await expect(page.getByRole("button", { name: "关闭反馈", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "关闭反馈", exact: true }).click();
    await page.getByRole("dialog", { name: "关闭反馈", exact: true }).getByLabel("处理说明", { exact: true }).fill("已确认处理结果，关闭反馈。");
    await page.getByRole("button", { name: "确认关闭", exact: true }).click();
    await expect(page.getByRole("button", { name: "重新打开", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("反馈已关闭。需要继续沟通时，可在右上角重新打开。")).toBeVisible();
    await page.getByRole("button", { name: "返回反馈列表", exact: true }).click();
    await expect(page.getByLabel("搜索反馈")).toHaveValue(adminDescription);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole("heading", { name: adminDescription })).toBeVisible();

    const detailResponse = await page.request.get(apiRoute(`/api/v1/product-feedback/${created.item.id}`), {
      headers: authHeaders()
    });
    expect(detailResponse.ok()).toBe(true);
    const detailBody = (await detailResponse.json()) as { item: ProductFeedbackApiItem };
    expect(detailBody.item.status).toBe("closed");
    expect(detailBody.item.progressEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalMessage: adminNote }),
      expect.objectContaining({ publicMessage: "处理已完成，复核通过。" }),
      expect.objectContaining({ publicMessage: "已确认处理结果，关闭反馈。" })
    ]));

    await expect.poll(async () => (await productFeedbackDbSummary(created.item.id)).observed).toContain("status=closed");
    const audit = await feedbackAuditSummaries(created.item.id);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "product-feedback-create", action: "create" }),
        expect.objectContaining({ kind: "product-feedback-progress", action: "update" })
      ])
    );

    await recordOperationEvidence({
      operationId: "PFB-ADMIN-001",
      title: "admin feedback triage status and note",
      status: "passed",
      role: "Admin",
      route: "/feedback-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(firstPageResponse, {
          method: "GET", path: "/api/v1/product-feedback?limit=50",
          responseSummary: "first page has 50 newer feedbacks and an opaque cursor"
        }),
        summarizeApiResponse(secondPageResponse, {
          method: "GET", path: "/api/v1/product-feedback?limit=50&cursor=…",
          responseSummary: "second page contains the feedback found through UI search"
        }),
        summarizeApiResponse(created.response, {
          method: "POST",
          path: "/api/v1/product-feedback",
          responseSummary: `seeded feedback=${created.item.id}`
        }),
        summarizeApiResponse(detailResponse, {
          method: "GET",
          path: `/api/v1/product-feedback/${created.item.id}`,
          responseSummary: `status=${detailBody.item.status}; note=${detailBody.item.progressEvents.some((event) => event.internalMessage === adminNote) ? "set" : "missing"}`
        })
      ],
      db: [await productFeedbackDbSummary(created.item.id)],
      audit
    });
  });

  test("blocks non-Admin feedback admin APIs and page access", async ({ page }, testInfo) => {
    // @acceptance PFB-AUTHZ-001
    // @operation PFB-AUTHZ-001
    const created = await createFeedbackViaApi(page, `${descriptionPrefix} authz ${Date.now()}`);

    const listDenied = await page.request.get(apiRoute("/api/v1/product-feedback"), {
      headers: authHeaders(submitterUserId)
    });
    expect(listDenied.status()).toBe(403);

    const detailDenied = await page.request.get(apiRoute(`/api/v1/product-feedback/${created.item.id}`), {
      headers: authHeaders(submitterUserId)
    });
    expect(detailDenied.status()).toBe(403);

    const patchDenied = await page.request.patch(apiRoute(`/api/v1/product-feedback/${created.item.id}`), {
      headers: authHeaders(submitterUserId),
      data: { status: "in_progress" }
    });
    expect(patchDenied.status()).toBe(403);

    await loadPageAsHardwareUser(page, "/feedback-admin");
    await expect(page.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
    await expect(page.getByText("当前角色：硬件开发")).toBeVisible();
    await expect(page.getByText("所需角色：管理员")).toBeVisible();

    await recordOperationEvidence({
      operationId: "PFB-AUTHZ-001",
      title: "non admin feedback admin denial",
      status: "passed",
      role: "Hardware User",
      route: "/feedback-admin",
      page,
      testInfo,
      api: [
        summarizeApiResponse(listDenied, {
          method: "GET",
          path: "/api/v1/product-feedback",
          responseSummary: "FORBIDDEN for non-Admin list"
        }),
        summarizeApiResponse(detailDenied, {
          method: "GET",
          path: `/api/v1/product-feedback/${created.item.id}`,
          responseSummary: "FORBIDDEN for non-Admin detail"
        }),
        summarizeApiResponse(patchDenied, {
          method: "PATCH",
          path: `/api/v1/product-feedback/${created.item.id}`,
          responseSummary: "FORBIDDEN for non-Admin update"
        })
      ],
      db: [await productFeedbackDbSummary(created.item.id)],
      notes: "Hardware User cannot access feedback-admin page and receives 403 from list/detail/update admin APIs."
    });
  });
});
