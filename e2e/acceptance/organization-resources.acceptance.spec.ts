import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { WebSocket } from "ws";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { withPgClient } from "./helpers/database";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { installBrowserDiagnostics, useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);
type Session = { token: string; auth: { user: { id: string; organizationId: string }; organization: { id: string; name: string } } };
type Credential = { id: string; name: string; status: string; skillId: string | null };
const username = "organization.resources.operator";

test.describe("fixed-target device and integration governance", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane; HMAC/OIDC skips are not acceptance.");
  test.beforeAll(async () => {
    const hash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient(async client => {
      await client.query("insert into organizations(id,name) values('organization-resources-home','资源治理所属组织') on conflict(id) do nothing");
      for (const [id, name, role] of [["organization-resources-platform", "资源治理平台管理员", "platform-admin"], ["organization-resources-admin", "资源治理普通管理员", "admin"]]) {
        await client.query("insert into users(id,organization_id,name,title,is_active) values($1,'organization-resources-home',$2,'Administrator',true) on conflict(id) do update set is_active=true", [id, name]);
        await client.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,'organization-resources-home',$3) on conflict(id) do nothing", [`${id}-role`, id, role]);
        await client.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3) on conflict(user_id) do update set password_hash=excluded.password_hash", [id, role === "platform-admin" ? username : `${username}.admin`, hash]);
      }
    });
  });

  test("revokes a target owner's live pairing and reuses organization and skill credential views with real token invalidation", async ({ page, browser }, testInfo) => {
    const signIn = async (loginName: string) => {
      const result = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: loginName, password: LOCAL_DEMO_SHARED_PASSWORD } });
      expect(result.status()).toBe(200); return await result.json() as Session;
    };
    const platform = await signIn(username), admin = await signIn(`${username}.admin`), headers = { Authorization: `Bearer ${platform.token}` };
    const suffix = randomUUID().slice(0, 8), ownerUsername = `resources.owner.${suffix}`;
    const created = await page.request.post(apiRoute("/api/v1/platform/organizations"), { headers, data: { name: `资源验收组织-${suffix}`, initialAdministrator: { name: `设备所有者-${suffix}`, username: ownerUsername, password: LOCAL_DEMO_SHARED_PASSWORD } } });
    expect(created.status()).toBe(201); const target = (await created.json() as { item: { id: string; name: string } }).item;
    const owner = await signIn(ownerUsername), ownerHeaders = { Authorization: `Bearer ${owner.token}` }, scope = `?organizationId=${target.id}`;
    const skillResponse = await page.request.post(apiRoute("/api/v1/log-skills"), { headers: ownerHeaders, data: { name: `目标技能-${suffix}`, startingPoint: { templateId: "generic-text" } } });
    expect(skillResponse.status()).toBe(201); const skill = (await skillResponse.json() as { item: { id: string; name: string } }).item;
    const boundName = `技能流水线-${suffix}`, organizationName = `组织流水线-${suffix}`;
    expect((await page.request.post(apiRoute("/api/v1/log-integration-credentials"), { headers: ownerHeaders, data: { name: boundName, skillId: skill.id } })).status()).toBe(201);
    expect((await page.request.post(apiRoute("/api/v1/log-integration-credentials"), { headers, data: { name: `所属组织凭据-${suffix}` } })).status()).toBe(201);
    const code = await page.request.post(apiRoute("/api/v1/device-bridges/pairing-codes"), { headers: ownerHeaders, data: {} });
    expect(code.status()).toBe(201);
    const machineLabel = `目标电脑-${suffix}`;
    const pairing = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), { data: { code: (await code.json() as { code: string }).code, machineLabel, platform: "linux", arch: "amd64", clientVersion: "0.1.1" } });
    expect(pairing.status()).toBe(201); const paired = await pairing.json() as { bridgeId: string; bridgeToken: string };
    const ws = new URL(apiRoute("/api/v1/device-bridges/ws")); ws.protocol = "ws:";
    const connect = () => new WebSocket(ws, { headers: { authorization: `Bridge ${paired.bridgeToken}` } });
    const closed = (socket: WebSocket) => new Promise<number>((resolve, reject) => { socket.once("close", resolve); socket.once("error", reject); });
    const socket = connect();
    try {
      await new Promise<void>((resolve, reject) => { socket.once("message", raw => { expect(JSON.parse(raw.toString()).type).toBe("bridge.hello"); resolve(); }); socket.once("error", reject); });
      await page.addInitScript(token => window.localStorage.setItem("wiseeff.localAuthToken", token), platform.token);
      await page.goto(`/organization/bridges${scope}`); await prepareInteractionSurface(page);
      await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText(target.name);
      const bridgeRow = page.getByRole("table", { name: "组织设备代理", exact: true }).getByRole("row").filter({ hasText: machineLabel });
      await expect(bridgeRow.getByText("在线", { exact: true })).toBeVisible(); await expect(bridgeRow).toContainText(`设备所有者-${suffix}`);
      expect(await page.locator("body").innerText()).not.toContain(paired.bridgeToken);
      const bridgePath = `/api/v1/device-bridges/organization/${paired.bridgeId}`;
      expect((await page.request.get(apiRoute(`${bridgePath}${scope}`), { headers })).status()).toBe(200);
      for (const path of ["/api/v1/device-bridges/organization", "/api/v1/log-integration-credentials"]) {
        expect((await page.request.get(apiRoute(`${path}${scope}`), { headers: { Authorization: `Bearer ${admin.token}` } })).status()).toBe(403);
      }
      const disconnected = closed(socket);
      await bridgeRow.getByRole("button", { name: "撤销配对", exact: true }).focus(); await page.keyboard.press("Enter");
      const revoke = page.getByRole("dialog", { name: "撤销设备代理配对？", exact: true });
      await revoke.getByRole("textbox", { name: "撤销原因", exact: true }).fill("目标组织设备退役");
      await revoke.getByRole("button", { name: "撤销配对", exact: true }).click();
      await expect(revoke).toHaveCount(0); await expect(bridgeRow.getByText("已撤销", { exact: true })).toBeVisible();
      expect(await disconnected).toBe(4401); expect(await closed(connect())).toBe(4401);
      await page.screenshot({ path: testInfo.outputPath("target-bridge-revoked-1440.png"), animations: "disabled" });

      await page.getByRole("button", { name: "集成凭据", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`organization/integrations\\?organizationId=${target.id}`));
      const table = page.getByRole("table", { name: "集成凭据列表", exact: true });
      await expect(table).toContainText(boundName); await expect(table).not.toContainText(`所属组织凭据-${suffix}`);
      await page.getByRole("button", { name: "签发凭据", exact: true }).click();
      const issuing = page.getByRole("dialog", { name: "签发集成凭据", exact: true });
      await issuing.getByLabel("凭据名称", { exact: true }).fill(organizationName);
      await issuing.getByRole("button", { name: "签发", exact: true }).click();
      const reveal = page.getByRole("dialog", { name: "保存集成凭据", exact: true });
      const token = await reveal.getByLabel("集成凭据", { exact: true }).inputValue();
      await reveal.getByRole("button", { name: "完成", exact: true }).click();
      await expect(table).toContainText(organizationName);
      await page.getByRole("combobox", { name: "筛选绑定技能", exact: true }).click();
      await page.getByRole("option", { name: skill.name, exact: true }).click();
      await expect(table).toContainText(boundName); await expect(table).not.toContainText(organizationName);
      await page.screenshot({ path: testInfo.outputPath("target-credential-skill-filter-1440.png"), animations: "disabled" });
      await page.getByRole("combobox", { name: "筛选绑定技能", exact: true }).click(); await page.getByRole("option", { name: "全部技能", exact: true }).click();
      const credentialRow = table.getByRole("row").filter({ hasText: organizationName });
      await credentialRow.getByRole("button", { name: `凭据 ${organizationName}：更多`, exact: true }).click(); await page.getByRole("menuitem", { name: "轮换", exact: true }).click();
      await page.getByRole("dialog", { name: "轮换集成凭据", exact: true }).getByRole("button", { name: "轮换凭据", exact: true }).click();
      const rotated = await reveal.getByLabel("集成凭据", { exact: true }).inputValue();
      await reveal.getByRole("button", { name: "完成", exact: true }).click();
      const upload = (value: string) => page.request.post(apiRoute("/api/v1/log-files"), { headers: { Authorization: `Bearer ${value}` }, data: { fileName: "scope.log", contentBase64: Buffer.from("INFO target upload\n").toString("base64"), contentType: "text/plain" } });
      expect((await upload(token)).status()).toBe(401); expect((await upload(rotated)).status()).toBe(201);
      expect((await page.request.get(apiRoute(`/api/v1/log-integration-credentials${scope}`), { headers: { Authorization: `Bearer ${rotated}` } })).status()).toBe(403);
      await credentialRow.getByRole("button", { name: `凭据 ${organizationName}：更多`, exact: true }).click(); await page.getByRole("menuitem", { name: "撤销", exact: true }).click();
      await page.getByRole("dialog", { name: "撤销集成凭据", exact: true }).getByRole("button", { name: "撤销凭据", exact: true }).click();
      await expect(credentialRow).toContainText("已撤销"); expect((await upload(rotated)).status()).toBe(401);
      await page.screenshot({ path: testInfo.outputPath("target-credentials-revoked-1440.png"), animations: "disabled" });

      const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        await ownerContext.addInitScript(value => window.localStorage.setItem("wiseeff.localAuthToken", value), owner.token);
        const ownerPage = await ownerContext.newPage(), diagnostics = installBrowserDiagnostics(ownerPage, testInfo);
        await ownerPage.goto(`/log-admin/skills/${skill.id}?section=integration`); await prepareInteractionSurface(ownerPage);
        const skillTable = ownerPage.getByRole("table", { name: "集成凭据列表", exact: true });
        await expect(skillTable).toContainText(boundName); await expect(skillTable).toContainText(organizationName);
        await ownerPage.getByRole("button", { name: "签发凭据", exact: true }).click();
        const boundIssue = ownerPage.getByRole("dialog", { name: "签发集成凭据", exact: true });
        await expect(boundIssue.getByRole("checkbox", { name: "绑定到当前技能", exact: true })).toBeChecked();
        await boundIssue.getByLabel("凭据名称", { exact: true }).fill(`技能界面签发-${suffix}`);
        await boundIssue.getByRole("button", { name: "签发", exact: true }).click();
        await ownerPage.getByRole("dialog", { name: "保存集成凭据", exact: true }).getByRole("button", { name: "完成", exact: true }).click();
        await expect(skillTable).toContainText(`技能界面签发-${suffix}`);
        diagnostics.assertNoBrowserDiagnosticsFailures();
      } finally { await ownerContext.close(); }
      await page.reload(); await expect(table).toContainText(`技能界面签发-${suffix}`);
      const current = await page.request.get(apiRoute("/api/v1/me"), { headers }); expect((await current.json() as Session["auth"]).organization).toEqual(platform.auth.organization);
      const all = await page.request.get(apiRoute(`/api/v1/log-integration-credentials${scope}`), { headers });
      expect((await all.json() as { items: Credential[] }).items).toContainEqual(expect.objectContaining({ name: `技能界面签发-${suffix}`, skillId: skill.id }));
      const lifecycle = apiRoute(`/api/v1/platform/organizations/${target.id}/lifecycle`);
      expect((await page.request.patch(lifecycle, { headers, data: { status: "suspended", expectedStatus: "active" } })).status()).toBe(200);
      try {
        await page.goto(`/organization/integrations${scope}`); await prepareInteractionSurface(page);
        await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText("已停用 · 仅可查看");
        await expect(table).toContainText(boundName);
        await expect(table).toContainText(`技能界面签发-${suffix}`);
        await expect(page.getByRole("button", { name: "签发凭据", exact: true })).toHaveCount(0);
        await expect(table.getByRole("button", { name: /凭据 .*：更多/ })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath("target-credentials-suspended-readonly-1440.png"), animations: "disabled" });
      } finally {
        expect((await page.request.patch(lifecycle, { headers, data: { status: "active", expectedStatus: "suspended" } })).status()).toBe(200);
      }
    } finally { socket.terminate(); }
  });
});
