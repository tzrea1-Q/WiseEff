import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

useBrowserDiagnostics(test, {
  expectedApiFailures: [{ method: "DELETE", path: "/api/v1/knowledge/entries", status: 500 }]
});

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(seedAcceptanceRoleMatrix);

for (const status of ["draft", "published", "archived"] as const) {
test(`knowledge managers directly delete human ${status} entries with confirmation, failure recovery and editor restrictions`, async ({ page }, testInfo) => {
  const title = `KB-ACCEPT human ${status} cleanup ${randomUUID()}`;
  const created = await page.request.post(apiRoute("/api/v1/knowledge/entries"), {
    headers: authHeadersForRole("hardware-user"),
    data: { contentForm: "markdown", title, tags: [], contentMarkdown: "Human draft awaiting cleanup." }
  });
  expect(created.status()).toBe(201);
  const { item } = await created.json() as { item: { id: string } };
  const path = `/api/v1/knowledge/entries/${item.id}`;
  try {
    if (status === "published") {
      const transition = await page.request.post(apiRoute(`${path}/publish`), {
        headers: authHeadersForRole("hardware-user")
      });
      expect(transition.status()).toBe(200);
    }
    await signInBrowserAsRole(page, "hardware-user", `/knowledge?entryId=${item.id}`);
    const editorDetail = page.getByRole("dialog", { name: new RegExp(title) });
    await expect(editorDetail).toBeVisible();
    if (status === "archived") {
      await editorDetail.getByRole("button", { name: "归档", exact: true }).click();
      await expect(editorDetail.locator('[data-status="archived"]')).toBeVisible();
    }
    await expect(editorDetail.getByRole("button", { name: "彻底删除" })).toHaveCount(0);

    await signInBrowserAsRole(page, "admin", "/knowledge");
    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button", { name: /：更多$/ }).click();
    await page.getByRole("menuitem", { name: "彻底删除" }).click();
    const confirmation = page.getByRole("dialog", { name: /彻底删除/ });
    await expect(confirmation).toContainText("存储中的原始文件保留");
    await expect(confirmation).toContainText("全部 1 个修订");
    await expect(confirmation.getByRole("checkbox")).toHaveCount(0);
    await expect(confirmation.getByRole("button", { name: "彻底删除" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "查看", exact: true }).click();
    const detail = page.getByRole("dialog", { name: new RegExp(title) });
    await detail.getByRole("button", { name: "彻底删除" }).focus();
    await page.keyboard.press("Enter");
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail.getByRole("button", { name: "彻底删除" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmation.getByRole("checkbox")).toHaveCount(0);
    const screenshot = testInfo.outputPath("human-draft-delete-confirmation.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("human-draft-delete-confirmation", { path: screenshot, contentType: "image/png" });

    let failOnce = true;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() === "DELETE" && failOnce) {
        failOnce = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "删除暂不可用" } }) });
      } else {
        await route.continue();
      }
    });
    await confirmation.getByRole("button", { name: "彻底删除" }).click();
    await expect(confirmation.getByRole("alert")).toHaveText("删除暂不可用");
    await expect(detail.getByText("Human draft awaiting cleanup.")).toBeVisible();
    await confirmation.getByRole("button", { name: "彻底删除" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("table", { name: "知识条目列表" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);

    await withPgClient(async (client) => {
      const result = await client.query<{ entries: number; revisions: number; audit: number }>(
        `select
           (select count(*)::int from knowledge_entries where id = $1::uuid) as entries,
           (select count(*)::int from knowledge_revisions where entry_id = $1::uuid) as revisions,
           (select count(*)::int from audit_events where target_id = $1::text and kind = 'knowledge-entry-delete') as audit`,
        [item.id]
      );
      expect(result.rows[0]).toEqual({ entries: 0, revisions: 0, audit: 1 });
    });
  } finally {
    await page.request.delete(apiRoute(path), { headers: authHeadersForRole("admin") });
  }
});
}
