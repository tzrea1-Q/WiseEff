import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { withPgClient } from "./helpers/database";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test.describe("fixed-target knowledge and Agent workspace", () => {
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
  });

  test("keeps knowledge, unsaved edits, Agent approval and private threads in the selected organization", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = randomUUID().slice(0, 8), target = `knowledge-target-${suffix}`, targetName = `知识目标组织-${suffix}`;
    await withPgClient((client) => client.query("insert into organizations(id,name) values($1,$2)", [target, targetName]));
    const headers = authHeadersForRole("admin"), homeTitle = `所属组织知识-${suffix}`, targetTitle = `目标组织知识-${suffix}`;
    for (const [title, query] of [[homeTitle, ""], [targetTitle, `?organizationId=${target}`]]) {
      const created = await page.request.post(apiRoute(`/api/v1/knowledge/entries${query}`), { headers, data: { contentForm: "markdown", title, contentMarkdown: "知识组织隔离验收", tags: [] } });
      expect(created.status(), await created.text()).toBe(201);
    }
    await signInBrowserAsRole(page, "admin", `/knowledge?organizationId=${target}`);
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(targetName);
    await expect(page.getByText(targetTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(homeTitle, { exact: true })).toHaveCount(0);
    const home = await page.context().newPage();
    await home.goto("/knowledge");
    await expect(home.getByText(homeTitle, { exact: true })).toBeVisible();
    await expect(home.getByText(targetTitle, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "返回所属组织", exact: true }).click();
    await expect(page.getByText(homeTitle, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(targetName);

    await page.getByRole("button", { name: "新建条目", exact: true }).click();
    await page.getByRole("menuitem", { name: "编写条目", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新建 Markdown 条目", exact: true });
    await editor.getByLabel("条目标题", { exact: true }).fill(`页面创建知识-${suffix}`);
    await editor.getByLabel("Markdown 内容", { exact: true }).fill("目标组织的未保存内容");
    await page.goForward();
    const leave = page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(editor.getByLabel("Markdown 内容", { exact: true })).toHaveValue("目标组织的未保存内容");
    const creating = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/knowledge/entries" && response.request().method() === "POST");
    await editor.getByRole("button", { name: "创建草稿", exact: true }).click();
    const response = await creating;
    expect(new URL(response.url()).searchParams.get("organizationId")).toBe(target);
    expect((await response.json() as { item: { organizationId: string } }).item.organizationId).toBe(target);
    await expect(editor).toHaveCount(0);

    const hint = page.getByRole("button", { name: "不再提示", exact: true });
    if (await hint.isVisible().catch(() => false)) await hint.click();
    await page.getByRole("button", { name: "打开小泽", exact: true }).click();
    const popup = page.getByTestId("xiaoze-popup-layer");
    const composer = popup.locator("textarea").first();
    await composer.fill(`创建知识草稿:目标助手知识-${suffix}`);
    const stream = page.waitForResponse((next) => new URL(next.url()).pathname === "/api/v1/agent/xiaoze" && next.request().method() === "POST");
    await composer.press("Enter");
    expect(new URL((await stream).url()).searchParams.get("organizationId")).toBe(target);
    const card = page.getByTestId("xiaoze-approval-card");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole("button", { name: "批准", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(async () => {
      const entries = await page.request.get(apiRoute(`/api/v1/knowledge/entries?organizationId=${target}`), { headers });
      return (await entries.json() as { items: Array<{ title: string; organizationId: string }> }).items.some((entry) => entry.title === `目标助手知识-${suffix}` && entry.organizationId === target);
    }).toBe(true);
    const targetThreads = await page.request.get(apiRoute(`/api/v1/agent/xiaoze/threads?organizationId=${target}`), { headers });
    const threads = (await targetThreads.json() as { items: Array<{ id: string }> }).items;
    expect(threads.length).toBeGreaterThan(0);
    const homeThreads = await page.request.get(apiRoute("/api/v1/agent/xiaoze/threads"), { headers });
    const homeIds = (await homeThreads.json() as { items: Array<{ id: string }> }).items.map((thread) => thread.id);
    expect(threads.some((thread) => homeIds.includes(thread.id))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("knowledge-target-agent-1440.png"), animations: "disabled" });
    await page.getByRole("button", { name: "关闭小泽", exact: true }).click();
    await page.getByRole("button", { name: "知识后台", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`knowledge-admin\\?organizationId=${target}`));
    const draft = page.getByRole("table", { name: "小泽知识草稿", exact: true }).getByRole("row").filter({ hasText: `目标助手知识-${suffix}` });
    await expect(draft).toContainText("Xu Yun");
    await draft.getByRole("button", { name: /更多$/ }).click();
    const publishing = page.waitForResponse((next) => new URL(next.url()).pathname.endsWith("/publish") && next.request().method() === "POST");
    await page.getByRole("menuitem", { name: "发布", exact: true }).click();
    const published = await publishing;
    expect(published.status()).toBe(200);
    expect(new URL(published.url()).searchParams.get("organizationId")).toBe(target);
    await expect(draft).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("knowledge-target-publish-1440.png"), animations: "disabled" });
    await home.close();
  });
});
