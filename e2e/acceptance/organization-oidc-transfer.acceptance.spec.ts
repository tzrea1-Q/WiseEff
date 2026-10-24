import "./helpers/loadAcceptanceEnvironment";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "playwright/test";
import { persistGate0ExactValuesForRescan } from "../../scripts/gate0-artifact-sanitizer";
import { withPgClient } from "./helpers/database";
import { apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { resolveEvidenceRunContext } from "./helpers/evidenceRun";

// @acceptance ORG-OIDC-TRANSFER-001
// @operation ORG-OIDC-TRANSFER-001
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "POST", path: "/api/v1/platform/organizations/", status: 409 },
  { method: "GET", path: "/api/v1/users", status: 503 }
] });
test("keeps OIDC transfer pending until a real signed target login and retries an honest synchronization check", async ({ page }, testInfo) => {
  test.skip(process.env.AUTH_PROVIDER !== "oidc" || !process.env.WISEEFF_OIDC_TRANSFER_TEST_SIGNING_KEY, "Requires the controlled OIDC issuer and its ephemeral signing fixture.");
  const artifactRoot = resolveEvidenceRunContext().artifactsRoot;
  mkdirSync(artifactRoot, { recursive: true });
  const artifact = (name: string) => path.join(artifactRoot, name);
  const outputRoot = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? path.dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) : process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR!;
  const reportRoot = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR!;
  const issuer = process.env.AUTH_OIDC_ISSUER!, issuerUrl = new URL(issuer);
  expect(issuerUrl.hostname).toBe("127.0.0.1");
  const signingKey = createPrivateKey(Buffer.from(process.env.WISEEFF_OIDC_TRANSFER_TEST_SIGNING_KEY!, "base64"));
  const registerSecret = (value: string) => {
    for (const root of [outputRoot, reportRoot, artifactRoot]) {
      mkdirSync(path.resolve(root), { recursive: true }); persistGate0ExactValuesForRescan(path.resolve(root), [value, `Bearer ${value}`]);
    }
  };
  function token(subject: string, org: string, issuedAt = Math.floor(Date.now() / 1000)) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "oidc-transfer-browser" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: process.env.AUTH_OIDC_AUDIENCE, sub: subject, organization_id: org, iat: issuedAt, exp: issuedAt + 3600,
      wiseeff_roles: [{ projectId: null, roleId: "platform-admin" }] })).toString("base64url");
    const jwt = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), signingKey).toString("base64url")}`;
    registerSecret(jwt); return jwt;
  }
  const suffix = randomUUID().slice(0, 8), home = `oidc-home-${suffix}`, source = `oidc-source-${suffix}`, target = `oidc-target-${suffix}`;
  const platform = `oidc-platform-${suffix}`, member = `oidc-member-${suffix}`, admin = `oidc-admin-${suffix}`, targetAdmin = `oidc-target-admin-${suffix}`;
  const memberName = `OIDC 调动成员-${suffix}`;
  await withPgClient(async db => {
    await db.query("insert into organizations(id,name) values($1,'OIDC 平台所属组织'),($2,'OIDC 调动源组织'),($3,'OIDC 调动目标组织')", [home, source, target]);
    for (const [id, org, name, role, subject] of [[platform, home, "OIDC 平台管理员", "platform-admin", platform], [member, source, memberName, "software-user", member], [admin, source, "源组织管理员", "admin", admin], [targetAdmin, target, "目标冲突成员", "admin", member]]) {
      await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$3,'研发',true)", [id, org, name]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`${id}-role`, id, org, role]);
      await db.query("update user_oidc_identities set issuer=$1,subject=$2 where user_id=$3", [issuer, subject, id]);
    }
  });
  const platformToken = token(platform, home), previousIssuedAt = Math.floor(Date.now() / 1000), oldToken = token(member, source, previousIssuedAt);
  const headers = { Authorization: `Bearer ${platformToken}` };
  await page.addInitScript(bearer => { (window as Window & { wiseEffOidc?: { getAccessToken(): string } }).wiseEffOidc = { getAccessToken: () => bearer }; }, platformToken);
  await page.goto(`/organization/members?organizationId=${source}`); await prepareInteractionSurface(page);
  const row = page.getByRole("row").filter({ hasText: memberName });
  await row.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: `调动 ${memberName} 到其他组织`, exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `调动 ${memberName}`, exact: true });
  await dialog.getByRole("combobox", { name: "目标组织", exact: true }).click();
  await page.getByRole("option", { name: `OIDC 调动目标组织（${target}）`, exact: true }).click();
  await dialog.getByRole("button", { name: "预览影响", exact: true }).click();
  await expect(dialog.getByRole("note", { name: "外部身份同步要求" })).toContainText(target);
  await expect(dialog.getByRole("note", { name: "外部身份同步要求" })).toContainText(issuer);
  await dialog.getByRole("note", { name: "外部身份同步要求" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifact("oidc-transfer-preview-1440.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "确认调动", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("目标组织存在");
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(200);
  const rebind = await page.request.put(apiRoute(`/api/v1/users/${targetAdmin}/oidc-identity?organizationId=${target}`), { headers, data: { issuer, subject: targetAdmin, expectedIdentity: { issuer, subject: member } } });
  expect(rebind.status()).toBe(200);
  await dialog.getByRole("button", { name: "预览影响", exact: true }).click();
  await dialog.getByRole("button", { name: "确认调动", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden(); await expect(row).toHaveCount(0);
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${token(member, target, previousIssuedAt)}` } })).status()).toBe(401);
  await page.goto(`/organization/members?organizationId=${target}`); await prepareInteractionSurface(page);
  const targetRow = page.getByRole("row").filter({ hasText: memberName });
  await expect(targetRow).toContainText("OIDC · 等待身份系统同步");
  await targetRow.getByRole("button", { name: `查看 ${memberName} 的成员资料`, exact: true }).click();
  const details = page.getByRole("dialog", { name: `${memberName} · 成员资料`, exact: true }), status = details.getByRole("status", { name: "外部身份同步结果" });
  await expect(status).toContainText("等待身份系统同步"); await expect(status).toContainText(target);
  await status.scrollIntoViewIfNeeded();
  await page.screenshot({ path: artifact("oidc-transfer-pending-1440.png"), animations: "disabled" });
  const usersRoute = (url: URL) => url.pathname === "/api/v1/users";
  await page.route(usersRoute, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "同步检查暂不可用" } }) }));
  await status.getByRole("button", { name: "刷新同步结果", exact: true }).click();
  await expect(details.getByRole("alert")).toContainText("同步检查暂不可用"); await expect(status).toContainText("等待身份系统同步");
  await page.screenshot({ path: artifact("oidc-transfer-check-failure-1440.png"), animations: "disabled" });
  await page.unroute(usersRoute);
  const afterTransferSecond = Math.floor(Date.now() / 1000);
  await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(afterTransferSecond);
  const authenticated = await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${token(member, target)}` } });
  expect(authenticated.status()).toBe(200);
  expect(await authenticated.json()).toMatchObject({ user: { id: member }, organization: { id: target }, roles: [{ projectId: null, roleId: "guest" }] });
  await status.getByRole("button", { name: "刷新同步结果", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(status).toContainText("已验证目标组织登录");
  await page.screenshot({ path: artifact("oidc-transfer-verified-1440.png"), animations: "disabled" });
  await withPgClient(async db => {
    const result = await db.query("select transfer_pending_since is not null and transfer_verified_at>=transfer_pending_since as verified from user_oidc_identities where user_id=$1 and organization_id=$2", [member, target]);
    expect(result.rows).toEqual([{ verified: true }]);
    const audit = await db.query("select actor_user_id,organization_id,metadata->>'targetOrganizationId' as target from audit_events where kind='account-transfer' and target_id=$1", [member]);
    expect(audit.rows).toEqual([{ actor_user_id: platform, organization_id: source, target }]);
  });
  const lifecycle = `/api/v1/platform/organizations/${target}/lifecycle`, freshMember = token(member, target);
  expect((await page.request.patch(apiRoute(lifecycle), { headers, data: { status: "suspended", expectedStatus: "active" } })).status()).toBe(200);
  await page.goto(`/organization?organizationId=${target}`); await prepareInteractionSurface(page);
  await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText("已停用 · 仅可查看");
  const readOnlyIdentity = await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${freshMember}` } });
  expect(readOnlyIdentity.status()).toBe(200);
  expect(await readOnlyIdentity.json()).toMatchObject({ user: { id: member }, organization: { id: target }, roles: [{ projectId: null, roleId: "guest" }] });
  await page.screenshot({ path: artifact("oidc-transfer-suspended-1440.png"), animations: "disabled" });
  expect((await page.request.patch(apiRoute(lifecycle), { headers, data: { status: "active", expectedStatus: "suspended" } })).status()).toBe(200);
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${oldToken}` } })).status()).toBe(401);
  const restoredIdentity = await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${freshMember}` } });
  expect(restoredIdentity.status()).toBe(200); expect(await restoredIdentity.json()).toMatchObject({ roles: [{ projectId: null, roleId: "guest" }] });
  await page.reload(); await prepareInteractionSurface(page);
  await expect(page.getByRole("region", { name: "当前操作组织" })).not.toContainText("已停用");
  await recordOperationEvidence({ operationId: "ORG-OIDC-TRANSFER-001", title: "Signed OIDC transfer, synchronization and lifecycle continuity", status: "passed", page, testInfo,
    assertions: ["ui", "api", "db", "audit", "screenshot"],
    report: { path: path.join(reportRoot, "index.html"), format: "html" }, trace: { mode: "retain-on-failure", path: outputRoot },
    artifacts: ["oidc-transfer-preview-1440.png", "oidc-transfer-pending-1440.png", "oidc-transfer-check-failure-1440.png", "oidc-transfer-verified-1440.png", "oidc-transfer-suspended-1440.png"].map(artifact),
    api: [{ method: "POST", path: `/api/v1/platform/organizations/${source}/members/${member}/transfer`, status: 200, responseSummary: "Real signed target login verified synchronization; source and pre-revocation claims stayed invalid." },
      { method: "GET", path: "/api/v1/me", status: 200, responseSummary: "Target login remained guest through suspend/restore despite a provider claim requesting platform-admin." }],
    db: [{ table: "user_oidc_identities", predicate: "the explicitly transferred member", observed: "Target login verified without broadening application roles", rowCount: 1 }],
    audit: [{ kind: "account-transfer", targetId: member, metadataSummary: "The actual platform actor and source Organization matched the successful transfer." }] });
});
