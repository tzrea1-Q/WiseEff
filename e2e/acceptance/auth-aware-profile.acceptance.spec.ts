import "./helpers/loadAcceptanceEnvironment";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "playwright/test";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { authHeadersForRole } from "./helpers/bearerAuth";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

// This controlled, signed OIDC boundary exercises the real verifier and profile API;
// it does not establish acceptance against an externally operated identity provider.
const oidc = process.env.AUTH_PROVIDER === "oidc";
const hmac = !oidc && (process.env.AUTH_PROVIDER === "hmac" || Boolean(smokeHeaders().Authorization ?? process.env.VITE_WISEEFF_API_AUTHORIZATION));
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
let jwksServer: Server | undefined;
function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "profile-browser" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: process.env.AUTH_OIDC_ISSUER, aud: process.env.AUTH_OIDC_AUDIENCE,
    sub: "u-zhao-heng", organization_id: "org-chargelab", email: "zhao@chargelab.cn", email_verified: true,
    name: "Provider display name", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), pair.privateKey).toString("base64url")}`;
}
async function openProfile(page: Page) {
  await page.getByRole("button", { name: /打开用户菜单$/ }).click();
  await page.getByRole("button", { name: "个人资料", exact: true }).click();
  return page.getByRole("dialog", { name: "个人资料" });
}
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "PATCH", path: "/api/v1/me/profile", status: 500 },
  { method: "POST", path: "/api/v1/me/password", status: 401 }
] });
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeAll(async () => {
  await seedAcceptanceRoleMatrix();
  if (!oidc) return;
  await withPgClient((client) => client.query("update public.user_oidc_identities set issuer=$1,subject='u-zhao-heng' where user_id='u-zhao-heng'", [process.env.AUTH_OIDC_ISSUER]));
  const endpoint = new URL(process.env.AUTH_OIDC_JWKS_URI!);
  jwksServer = createServer((request, response) => {
    if (request.url !== endpoint.pathname) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "profile-browser", alg: "RS256", use: "sig" }] }));
  });
  await new Promise<void>((resolve, reject) => { jwksServer!.once("error", reject); jwksServer!.listen(Number(endpoint.port), "127.0.0.1", resolve); });
});
test.afterAll(async () => { if (jwksServer) await new Promise<void>((resolve, reject) => jwksServer!.close((error) => error ? reject(error) : resolve())); });

test("actual authentication mode controls profile and password actions, preserving profile errors for keyboard retry", async ({ page }, testInfo) => {
  const provider = oidc ? "oidc" : hmac ? "hmac" : "local";
  expect((await (await page.request.get(apiRoute("/api/v1/auth/local-config"))).json()).provider).toBe(provider);
  let token: string;
  if (oidc) {
    token = accessToken();
    await page.addInitScript((value) => { Object.assign(window, { wiseEffOidc: { getAccessToken: () => value } }); }, token);
  } else if (hmac) {
    token = authHeadersForRole("hardware-user").Authorization.replace(/^Bearer\s+/, "");
    await page.addInitScript((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
  } else {
    const registered = await page.request.post(apiRoute("/api/v1/auth/register"), { data: { username: `profile.${randomUUID()}`, name: "Local profile", title: "Local title", password: "initial-password", roleId: "hardware-user" } });
    expect(registered.status()).toBe(201);
    const result = await registered.json() as { token: string; auth: { user: { username: string } } };
    token = result.token;
    await page.addInitScript((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
  }
  const headers = { Authorization: `Bearer ${token}` };
  const before = await (await page.request.get(apiRoute("/api/v1/me"), { headers })).json() as { user: { id: string; name: string; title: string }; roles: unknown[] };
  await page.goto("/feedback");
  let dialog = await openProfile(page);
  if (oidc) {
    await expect(dialog.getByText(/密码由组织身份提供方管理/)).toBeVisible();
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("link")).toHaveCount(0);
  } else if (hmac) {
    await expect(dialog.getByText(/当前登录方式不提供本地密码修改/)).toBeVisible();
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveCount(0);
  } else {
    await expect(dialog.getByLabel("当前密码", { exact: true })).toBeVisible();
  }
  let failOnce = true;
  await page.route("**/api/v1/me/profile", async (route) => {
    if (!failOnce || route.request().method() !== "PATCH") { await route.continue(); return; }
    failOnce = false;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "资料暂时无法保存" } }) });
  });
  const name = `Application ${provider} display`, title = "Application profile title";
  await dialog.getByLabel("姓名", { exact: true }).fill(name);
  await dialog.getByLabel("职务", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "保存", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("姓名", { exact: true })).toHaveValue(name);
  await dialog.getByRole("button", { name: "保存", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  const after = await (await page.request.get(apiRoute("/api/v1/me"), { headers })).json() as typeof before;
  expect(after.user).toMatchObject({ id: before.user.id, name, title }); expect(after.roles).toEqual(before.roles);
  await page.reload(); dialog = await openProfile(page);
  await expect(dialog.getByLabel("姓名", { exact: true })).toHaveValue(name);
  await expect(dialog.getByLabel("职务", { exact: true })).toHaveValue(title);
  if (oidc) {
    await expect(dialog.getByText(/密码由组织身份提供方管理/)).toBeVisible();
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveCount(0);
  } else if (hmac) {
    await expect(dialog.getByText(/当前登录方式不提供本地密码修改/)).toBeVisible();
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveCount(0);
  } else {
    await dialog.getByLabel("当前密码", { exact: true }).fill("wrong-password");
    await dialog.getByLabel("新密码", { exact: true }).fill("changed-password");
    await dialog.getByLabel("确认新密码", { exact: true }).fill("changed-password");
    await dialog.getByRole("button", { name: "更新密码", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveValue("wrong-password");
    await dialog.getByLabel("当前密码", { exact: true }).fill("initial-password");
    await dialog.getByRole("button", { name: "更新密码", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveValue("");
    expect((await page.request.get(apiRoute("/api/v1/me"), { headers })).status()).toBe(200);
  }
  await dialog.evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  await page.screenshot({ path: testInfo.outputPath(`profile-${oidc ? "controlled-oidc" : provider}.png`), fullPage: true });
});
