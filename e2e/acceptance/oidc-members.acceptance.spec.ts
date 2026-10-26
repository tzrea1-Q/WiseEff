import "./helpers/loadAcceptanceEnvironment";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test } from "playwright/test";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { apiRoute } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

const oidc = process.env.AUTH_PROVIDER === "oidc", pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const adminSubject = "controlled-existing-administrator";
let jwks: Server | undefined;
function accessToken(subject: string, email?: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256",kid: "members-browser" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: process.env.AUTH_OIDC_ISSUER,aud: process.env.AUTH_OIDC_AUDIENCE,sub: subject,organization_id: "org-chargelab",
    exp: Math.floor(Date.now()/1000)+3600,...(email ? { email,email_verified: true } : {}) })).toString("base64url");
  return `${header}.${claims}.${sign("RSA-SHA256",Buffer.from(`${header}.${claims}`),pair.privateKey).toString("base64url")}`;
}
useBrowserDiagnostics(test,{ expectedApiFailures: [{ method: "POST",path: "/api/v1/users",status: 409 },{ method: "PUT",path: "/api/v1/users/",status: 409 }] });
test.use({ viewport: { width: 1440,height: 900 } });
test.beforeAll(async () => {
  await seedAcceptanceRoleMatrix();
  if (!oidc) return;
  // Establish only the controlled operator identity. The member below is created and bound through the real UI/API.
  await withPgClient((client) => client.query("update public.user_oidc_identities set issuer=$1,subject=$2 where user_id='u-xu-yun'",[process.env.AUTH_OIDC_ISSUER,adminSubject]));
  const endpoint = new URL(process.env.AUTH_OIDC_JWKS_URI!);
  jwks = createServer((request,response) => {
    if (request.url !== endpoint.pathname) { response.writeHead(404); response.end(); return; }
    response.writeHead(200,{ "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }),kid: "members-browser",alg: "RS256",use: "sig" }] }));
  });
  await new Promise<void>((resolve,reject) => { jwks!.once("error",reject); jwks!.listen(Number(endpoint.port),"127.0.0.1",resolve); });
});
test.afterAll(async () => { if (jwks) await new Promise<void>((resolve,reject) => jwks!.close((error) => error ? reject(error) : resolve())); });

test("member provisioning follows the actual provider; controlled OIDC binds a stable member without local credentials", async ({ page },testInfo) => {
  if (!oidc) {
    await signInBrowserAsRole(page,"admin","/organization/members");
    await page.getByRole("button",{ name: "添加用户",exact: true }).click();
    const dialog = page.getByRole("dialog",{ name: "添加用户" });
    await expect(dialog.getByLabel("初始密码",{ exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Subject",{ exact: true })).toHaveCount(0);
    const rejected = await page.request.post(apiRoute("/api/v1/users"),{ headers: authHeadersForRole("admin"),data: { authentication: "oidc",issuer: "https://unconfigured.example",subject: "unconfigured",name: "Unconfigured member",roles: [{ roleId: "hardware-user" }] } });
    expect(rejected.status()).toBe(400);
    await dialog.getByRole("button",{ name: "取消",exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    return;
  }
  const adminToken = accessToken(adminSubject), headers = { Authorization: `Bearer ${adminToken}` };
  await page.addInitScript((value) => { Object.assign(window,{ wiseEffOidc: { getAccessToken: () => value } }); },adminToken);
  await page.goto("/organization/members");
  await page.getByRole("button",{ name: "添加用户",exact: true }).click();
  const dialog = page.getByRole("dialog",{ name: "添加用户" });
  await expect(dialog.getByLabel("初始密码",{ exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("用户名",{ exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Issuer",{ exact: true })).toHaveValue(process.env.AUTH_OIDC_ISSUER!);
  const name = `OIDC member ${randomUUID().slice(0,8)}`, email = `${randomUUID()}@example.test`, subject = `external-${randomUUID()}`;
  await dialog.getByLabel("姓名",{ exact: true }).fill(name);
  await dialog.getByLabel("身份提供方邮箱（选填）",{ exact: true }).fill(email);
  await dialog.getByLabel("Subject",{ exact: true }).fill(adminSubject);
  await dialog.getByRole("button",{ name: "创建用户",exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("核对 Subject");
  await expect(dialog.getByLabel("姓名",{ exact: true })).toHaveValue(name);
  await expect(dialog.getByLabel("Subject",{ exact: true })).toHaveValue(adminSubject);
  await dialog.getByLabel("Subject",{ exact: true }).fill(subject);
  await page.screenshot({ path: testInfo.outputPath("oidc-provision-without-local-password.png"),fullPage: true });
  await dialog.getByRole("button",{ name: "创建用户",exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  const listed = await (await page.request.get(apiRoute("/api/v1/users"),{ headers })).json() as { items: Array<{ id: string; name: string; username: string | null; oidcIdentity: { issuer: string; subject: string } }> };
  const member = listed.items.find((item) => item.name === name)!;
  expect(member.username).toBeNull(); expect(member.oidcIdentity.subject).toBe(subject);
  const me = await (await page.request.get(apiRoute("/api/v1/me"),{ headers: { Authorization: `Bearer ${accessToken(subject,email)}` } })).json() as { user: { id: string }; roles: unknown[] };
  expect(me.user.id).toBe(member.id);
  await page.getByRole("button",{ name: `查看 ${name} 的成员资料` }).click();
  const details = page.getByRole("dialog",{ name: `${name} · 成员资料` }), binding = details.getByRole("form",{ name: "OIDC 身份绑定" });
  await expect(binding.getByRole("textbox", { name: /邮箱/ })).toHaveCount(0);
  await binding.getByLabel("Subject",{ exact: true }).fill(adminSubject);
  await binding.getByRole("button",{ name: "保存",exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(binding.getByRole("alert")).toContainText("核对 Subject");
  await expect(binding.getByLabel("Subject",{ exact: true })).toHaveValue(adminSubject);
  const nextSubject = `${subject}-updated`;
  await binding.getByLabel("Subject",{ exact: true }).fill(nextSubject);
  await binding.getByRole("button",{ name: "保存",exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(binding.getByText(`已绑定：${nextSubject}`,{ exact: true })).toBeVisible();
  await binding.scrollIntoViewIfNeeded();
  await details.evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  await page.screenshot({ path: testInfo.outputPath("oidc-existing-member-binding-saved.png"),fullPage: true });
  expect((await page.request.get(apiRoute("/api/v1/me"),{ headers: { Authorization: `Bearer ${accessToken(subject,email)}` } })).status()).toBe(401);
  const updated = await page.request.get(apiRoute("/api/v1/me"),{ headers: { Authorization: `Bearer ${accessToken(nextSubject,email)}` } });
  expect(updated.status()).toBe(200);
  const after = await updated.json() as typeof me; expect(after.user.id).toBe(member.id); expect(after.roles).toEqual(me.roles);
  await details.getByRole("button",{ name: "关闭",exact: true }).click();
  await page.reload();
  await page.getByRole("button",{ name: `查看 ${name} 的成员资料` }).click();
  await expect(page.getByRole("form",{ name: "OIDC 身份绑定" }).getByLabel("Subject",{ exact: true })).toHaveValue(nextSubject);
});
