import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v1/organization/teams", status: 503 },
  { method: "POST", path: "/api/v1/organization/teams", status: 409 }
] });

test("manages flat teams and explicit multi-team membership without changing accounts or project grants", async ({ page }, testInfo) => {
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), target = `team-target-${suffix}`, firstUser = `team-first-${suffix}`, secondUser = `team-second-${suffix}`, project = `team-project-${suffix}`;
  const firstName = `研发成员-${suffix}`, secondName = `验证成员-${suffix}`, teamName = `研发-${suffix}`, renamedName = `软件-${suffix}`, otherTeam = `验证-${suffix}`;
  await withPgClient(async (client) => {
    await client.query("insert into organizations(id,name) values($1,'团队目标组织')", [target]);
    await client.query("insert into users(id,organization_id,name,title,is_active) values($1,$3,$4,'工程师',true),($2,$3,$5,'工程师',false)", [firstUser, secondUser, target, firstName, secondName]);
    await client.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'团队验证项目',$3,'initialized')", [project, target, `T${suffix}`]);
    await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,'software-user')", [`team-role-${suffix}`, firstUser, target]);
  });
  let failList = true;
  await page.route((url) => url.pathname === "/api/v1/organization/teams", async (route) => {
    if (failList && route.request().method() === "GET") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "团队列表暂不可用" } }) });
    return route.continue();
  });
  await signInBrowserAsRole(page, "platform-admin", `/organization/teams?organizationId=${target}`);
  await expect(page.getByText("团队列表暂不可用", { exact: true })).toBeVisible();
  failList = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("还没有团队，可创建团队为成员分组。", { exact: true })).toBeVisible();
  const create = page.getByRole("button", { name: "创建团队", exact: true });
  await create.focus(); await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "创建团队", exact: true });
  await dialog.getByLabel("团队名称", { exact: true }).fill(" ");
  await expect(dialog.getByRole("button", { name: "创建团队", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("团队名称不能为空。");
  await dialog.getByLabel("团队名称", { exact: true }).fill(teamName);
  await dialog.getByRole("button", { name: "创建团队", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const table = page.getByRole("table", { name: "组织团队", exact: true });
  await expect(table).toContainText(teamName);
  await create.click(); dialog = page.getByRole("dialog", { name: "创建团队", exact: true });
  await dialog.getByLabel("团队名称", { exact: true }).fill(teamName);
  await dialog.getByRole("button", { name: "创建团队", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("当前组织已存在同名团队。");
  await dialog.getByLabel("团队名称", { exact: true }).fill(otherTeam);
  await dialog.getByRole("button", { name: "创建团队", exact: true }).click(); await expect(dialog).toHaveCount(0);
  let row = table.getByRole("row").filter({ hasText: teamName });
  await row.getByRole("button", { name: `管理 ${teamName} 的成员`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: `管理 ${teamName} 的成员`, exact: true });
  await dialog.getByRole("button", { name: "选择本组织全部成员", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "选择团队成员 (2)", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "清空选择", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "选择团队成员", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "选择团队成员", exact: true }).click();
  const memberOptions = page.getByRole("dialog", { name: "选择团队成员选项", exact: true });
  await memberOptions.getByRole("checkbox", { name: `${firstName} · ${firstUser}`, exact: true }).check();
  await memberOptions.getByRole("checkbox", { name: `${secondName} · ${secondUser}（已停用）`, exact: true }).check();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "保存团队成员", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(firstName); await expect(row).toContainText(secondName);
  await table.getByRole("row").filter({ hasText: otherTeam }).getByRole("button", { name: `管理 ${otherTeam} 的成员`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: `管理 ${otherTeam} 的成员`, exact: true });
  await dialog.getByRole("button", { name: "选择团队成员", exact: true }).click();
  await memberOptions.getByRole("checkbox", { name: `${firstName} · ${firstUser}`, exact: true }).check(); await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "保存团队成员", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await row.getByRole("button", { name: `${teamName} 操作：更多`, exact: true }).click();
  await page.getByRole("menuitem", { name: "改名", exact: true }).click(); dialog = page.getByRole("dialog", { name: "修改团队名称", exact: true });
  await dialog.getByLabel("团队名称", { exact: true }).fill(renamedName);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "放弃未保存的更改？", exact: true }).getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(dialog.getByLabel("团队名称", { exact: true })).toHaveValue(renamedName);
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("organization-teams-1440.png"), animations: "disabled" });
  await page.getByRole("button", { name: "成员与权限", exact: true }).click(); await prepareInteractionSurface(page);
  const memberRow = page.getByRole("table", { name: "平台用户", exact: true }).getByRole("row").filter({ hasText: firstName });
  await expect(memberRow).toContainText(renamedName); await expect(memberRow).toContainText(otherTeam);
  await page.screenshot({ path: testInfo.outputPath("organization-members-team-column-1440.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(memberRow.getByRole("button", { name: `查看 ${firstName} 的成员资料`, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("organization-members-team-column-1280.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await memberRow.getByRole("button", { name: `查看 ${firstName} 的成员资料`, exact: true }).click();
  dialog = page.getByRole("dialog", { name: `${firstName} · 成员资料`, exact: true });
  await expect(dialog.getByRole("region", { name: "团队归属", exact: true })).toContainText(`${renamedName}、${otherTeam}`);
  await page.screenshot({ path: testInfo.outputPath("organization-member-teams-1440.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "团队", exact: true }).click();
  row = table.getByRole("row").filter({ hasText: renamedName });
  await row.getByRole("button", { name: `${renamedName} 操作：更多`, exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除团队？", exact: true });
  await expect(dialog).toContainText("成员账号、项目和个人权限均保留");
  await dialog.getByRole("button", { name: "删除团队", exact: true }).click(); await expect(row).toHaveCount(0);
  const headers = authHeadersForRole("platform-admin");
  const members = await page.request.get(apiRoute(`/api/v1/users?organizationId=${target}`), { headers });
  expect((await members.json() as { items: Array<{ id: string; isActive: boolean; roles: unknown[] }> }).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: firstUser, isActive: true, roles: [{ projectId: null, roleId: "software-user" }] }), expect.objectContaining({ id: secondUser, isActive: false })
  ]));
  expect((await page.request.get(apiRoute(`/api/v1/organization/teams?organizationId=${target}`), { headers: authHeadersForRole("software-user") })).status()).toBe(403);
  expect((await withPgClient((client) => client.query("select id from projects where id=$1", [project]))).rowCount).toBe(1);
});
