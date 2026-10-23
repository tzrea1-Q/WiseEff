import "./helpers/loadAcceptanceEnvironment";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiBaseUrl, apiRoute } from "./helpers/runtime";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v1/me", status: 401 }, // Signed-out screen and explicitly revoked session.
  { method: "PATCH", path: "/api/v1/users/", status: 503 } // The one UI failure/retry exercised below.
] });
type Session = { token: string };
const username = "organization.offboarding.operator";

test.describe("member offboarding with real local sessions and paired device", () => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires native local login; HMAC/OIDC revocation is covered by signed-token HTTP/PostgreSQL tests.");
  test.beforeAll(async () => {
    await seedAcceptanceRoleMatrix();
    const passwordHash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    await withPgClient(client => client.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3) on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash", [acceptanceCast.platformOperator.userId, username, passwordHash]));
  });

  test("explains immediate revocation, retains the member on failure, and re-enables without reviving old sessions or pairings", async ({ page }, testInfo) => {
    const login = async (account: string) => {
      const response = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: account, password: LOCAL_DEMO_SHARED_PASSWORD } });
      expect(response.status()).toBe(200); return await response.json() as Session;
    };
    const operator = await login(username), suffix = randomUUID().slice(0, 8), name = `离职成员-${suffix}`, memberUsername = `offboarding.${suffix}`;
    const created = await page.request.post(apiRoute("/api/v1/platform/organizations"), { headers: { Authorization: `Bearer ${operator.token}` }, data: { name: `离职验收-${suffix}`, initialAdministrator: { name: "留任管理员", username: `offboarding.admin.${suffix}`, password: LOCAL_DEMO_SHARED_PASSWORD } } });
    expect(created.status()).toBe(201); const organization = (await created.json() as { item: { id: string; name: string } }).item;
    const memberResponse = await page.request.post(apiRoute(`/api/v1/users?organizationId=${organization.id}`), { headers: { Authorization: `Bearer ${operator.token}` }, data: { name, username: memberUsername, password: LOCAL_DEMO_SHARED_PASSWORD, roles: [{ roleId: "admin" }, { roleId: "software-user" }] } });
    expect(memberResponse.status()).toBe(201); const memberId = (await memberResponse.json() as { item: { id: string } }).item.id;
    const member = await login(memberUsername), memberHeaders = { Authorization: `Bearer ${member.token}` };
    const codeResponse = await page.request.post(apiRoute("/api/v1/device-bridges/pairing-codes"), { headers: memberHeaders, data: {} }); expect(codeResponse.status()).toBe(201);
    const paired = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), { data: { code: (await codeResponse.json() as { code: string }).code, machineLabel: `离职设备-${suffix}`, platform: "linux", arch: "amd64" } }); expect(paired.status()).toBe(201);
    const pairing = await paired.json() as { bridgeId: string; bridgeToken: string };
    const machine = await page.request.post(apiRoute("/api/v1/log-integration-credentials"), { headers: memberHeaders, data: { name: `组织流水线-${suffix}`, skillId: null } }); expect(machine.status()).toBe(201);
    const credential = await machine.json() as { token: string };
    const socket = new WebSocket(`${apiBaseUrl().replace("http:", "ws:")}/api/v1/device-bridges/ws`, { headers: { Authorization: `Bridge ${pairing.bridgeToken}` } });
    try {
      await once(socket, "message");
      const route = `/organization/members?organizationId=${organization.id}&q=${encodeURIComponent(name)}`;
      await page.goto(route);
      await page.getByLabel("用户名", { exact: true }).fill(username); await page.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
      await page.getByRole("button", { name: "登录", exact: true }).click(); await prepareInteractionSurface(page);
      const row = page.getByRole("table", { name: "平台用户" }).getByRole("row").filter({ hasText: name });
      await expect(row).toContainText("启用");
      await row.getByRole("button", { name: /：更多$/ }).click(); await page.getByRole("menuitem", { name: "停用", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "确认停用用户", exact: true });
      await expect(confirmation).toContainText("立即撤销个人会话、访问凭据和设备配对"); await expect(confirmation).toContainText("交接可随后完成");
      const path = `/api/v1/users/${memberId}/activation`; let fail = true;
      await page.route(url => url.pathname === path, async request => { if (fail) { fail = false; await request.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } }) }); } else await request.continue(); });
      await confirmation.getByRole("button", { name: "确认停用", exact: true }).focus(); await page.keyboard.press("Enter");
      await expect(confirmation.getByRole("alert")).toBeVisible(); expect((await page.request.get(apiRoute("/api/v1/me"), { headers: memberHeaders })).status()).toBe(200);
      await page.screenshot({ path: testInfo.outputPath("offboarding-failure-retains-member-1440.png"), animations: "disabled" });
      const disconnected = once(socket, "close");
      await confirmation.getByRole("button", { name: "确认停用", exact: true }).click(); await expect(confirmation).toHaveCount(0);
      expect((await disconnected)[0]).toBe(4401); await expect(row).toContainText("停用");
      expect((await page.request.get(apiRoute("/api/v1/me"), { headers: memberHeaders })).status()).toBe(401);
      await page.screenshot({ path: testInfo.outputPath("offboarded-member-1440.png"), animations: "disabled" });
      await page.goto(`/organization/bridges?organizationId=${organization.id}`); await prepareInteractionSurface(page);
      await expect(page.getByRole("row").filter({ hasText: `离职设备-${suffix}` })).toContainText("已撤销");
      await page.screenshot({ path: testInfo.outputPath("offboarded-device-pairing-1440.png"), animations: "disabled" });
      await page.goto(route); await prepareInteractionSurface(page);
      await row.getByRole("button", { name: /：更多$/ }).click(); await page.getByRole("menuitem", { name: "启用", exact: true }).click();
      const enabling = page.getByRole("dialog", { name: "确认启用用户", exact: true }); await expect(enabling).toContainText("原有会话和设备配对不会恢复");
      await enabling.getByRole("button", { name: "确认启用", exact: true }).click(); await expect(enabling).toHaveCount(0); await expect(row).toContainText("启用");
      expect((await page.request.get(apiRoute("/api/v1/me"), { headers: memberHeaders })).status()).toBe(401); expect((await login(memberUsername)).token).toBeTruthy();
      const upload = await page.request.post(apiRoute("/api/v1/log-files"), { headers: { Authorization: `Bearer ${credential.token}` }, data: { fileName: "pipeline.log", contentType: "text/plain", contentBase64: Buffer.from("INFO pipeline remains available\n").toString("base64") } }); expect(upload.status()).toBe(201);
      await withPgClient(async client => {
        const audit = await client.query("select actor_user_id,organization_id from audit_events where kind='user-activation' and target_id=$1 order by created_at", [memberId]);
        expect(audit.rows).toEqual([{ actor_user_id: acceptanceCast.platformOperator.userId, organization_id: organization.id }, { actor_user_id: acceptanceCast.platformOperator.userId, organization_id: organization.id }]);
      });
    } finally { socket.terminate(); }
  });
});
