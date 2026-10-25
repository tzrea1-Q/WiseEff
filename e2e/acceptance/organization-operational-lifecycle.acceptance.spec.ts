import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { persistGate0ExactValuesForRescan } from "../../scripts/gate0-artifact-sanitizer";
import { withTestClusterRoleCatalogLock } from "../../server/testing/testDatabase";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { installBrowserDiagnostics, useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { resolveEvidenceRunContext } from "./helpers/evidenceRun";

// @acceptance ORG-OPERATING-LIFECYCLE-001
// @operation ORG-OPERATING-LIFECYCLE-001
test.use({ viewport: { width: 1440, height: 900 } });
const expectedApiFailures = [{ method: "GET", path: "/api/v1/me", status: 401 }, { method: "POST", path: "/api/v1/platform/organizations/", status: 409 }];
useBrowserDiagnostics(test, { expectedApiFailures });
type Session = { token: string; auth: { user: { id: string }; organization: { id: string; name: string }; roles: Array<{ projectId: string | null; roleId: string }>; projectMemberships: Array<{ projectId: string; roles: string[] }> } };
let faultInstalled = false;
test.afterEach(async () => { if (faultInstalled) await withPgClient(client => client.query("drop trigger if exists test_operational_erasure_ack on parameter_catalog.organization_log_erasure_objects; drop function if exists test_operational_erasure_ack()")); faultInstalled = false; });

test("operates one Organization from invitation and handover through transfer, suspension and recoverable mixed deletion", async ({ page, browser }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires actual local password sessions; the OIDC companion runs with its signed issuer.");
  test.setTimeout(180_000);
  const artifactRoot = resolveEvidenceRunContext().artifactsRoot;
  mkdirSync(artifactRoot, { recursive: true });
  const artifact = (name: string) => path.join(artifactRoot, name);
  const outputRoot = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? path.dirname(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) : process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR!;
  const reportRoot = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR!;
  const suffix = randomUUID().slice(0, 8), name = `运营闭环-${suffix}`, operatorUsername = `operations.platform.${suffix}`;
  const adminUsername = `operations.admin.${suffix}`, successorUsername = `operations.successor.${suffix}`;
  const registerSecret = (value: string) => {
    for (const root of [outputRoot, reportRoot, artifactRoot]) {
      mkdirSync(path.resolve(root), { recursive: true }); persistGate0ExactValuesForRescan(path.resolve(root), [value]);
    }
  };
  registerSecret(LOCAL_DEMO_SHARED_PASSWORD);
  await withTestClusterRoleCatalogLock(async () => {
    await seedAcceptanceRoleMatrix();
    await withPgClient(async client => client.query(`insert into user_password_credentials(user_id,username,password_hash) values($1,$2,$3)
      on conflict(user_id) do update set username=excluded.username,password_hash=excluded.password_hash`,
    [acceptanceCast.platformOperator.userId, operatorUsername, await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD)]));
  });
  async function signIn(target: Page, username: string, route: string) {
    await target.goto(route);
    await target.getByLabel("用户名", { exact: true }).fill(username);
    await target.getByLabel("密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
    const loggingIn = target.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/login" && response.request().method() === "POST");
    await target.getByRole("button", { name: "登录", exact: true }).click();
    const response = await loggingIn; expect(response.status()).toBe(200);
    const session = await response.json() as Session; registerSecret(session.token); await prepareInteractionSurface(target); return session;
  }
  const platform = await signIn(page, operatorUsername, "/platform/organizations");
  expect(platform.auth.roles).toContainEqual({ projectId: null, roleId: "platform-admin" });
  async function call<T>(method: string, route: string, data?: unknown, session = platform, status = 200): Promise<T> {
    const response = await page.request.fetch(apiRoute(route), { method, headers: { Authorization: `Bearer ${session.token}` }, ...(data === undefined ? {} : { data }) });
    expect(response.status(), await response.text()).toBe(status); return response.status() === 204 ? undefined as T : await response.json() as T;
  }
  async function login(username: string) {
    const response = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username, password: LOCAL_DEMO_SHARED_PASSWORD } });
    expect(response.status()).toBe(200); const session = await response.json() as Session; registerSecret(session.token); return session;
  }
  await page.getByRole("button", { name: "创建组织", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建组织", exact: true });
  await create.getByLabel("组织名称", { exact: true }).fill(name);
  await create.getByLabel("初始管理员姓名", { exact: true }).fill("留任管理员");
  await create.getByLabel("管理员用户名", { exact: true }).fill(adminUsername);
  await create.getByLabel("管理员初始密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  const creating = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/platform/organizations" && response.request().method() === "POST");
  await create.getByRole("button", { name: "创建组织及管理员", exact: true }).press("Enter");
  const created = await creating; expect(created.status()).toBe(201);
  const org = (await created.json() as { item: { id: string } }).item.id;
  await page.getByRole("dialog", { name: "组织资料", exact: true }).getByRole("button", { name: "进入组织", exact: true }).click();
  const scope = (route: string) => `${route}${route.includes("?") ? "&" : "?"}organizationId=${org}`;
  const workspace = page.getByRole("navigation", { name: "组织管理范围" });
  for (const entry of ["概览", "成员与权限", "邀请", "团队", "项目参与", "业务交接", "资源", "组织资料"]) await expect(workspace.getByRole("button", { name: entry, exact: true })).toBeVisible();
  const home = await page.context().newPage(), homeDiagnostics = installBrowserDiagnostics(home, testInfo);
  await home.goto("/organization"); await prepareInteractionSurface(home);
  await expect(home.getByRole("region", { name: "当前操作组织" })).toContainText(platform.auth.organization.name);
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), adminPage = await memberContext.newPage();
  const adminDiagnostics = installBrowserDiagnostics(adminPage, testInfo, { expectedApiFailures });
  const admin = await signIn(adminPage, adminUsername, "/organization/settings"); expect(admin.auth.organization.id).toBe(org);
  expect(admin.auth.roles).toEqual([{ projectId: null, roleId: "admin" }]);
  const project = `operations-${suffix}`;
  await call("POST", scope("/api/v1/parameters/admin/projects"), { id: project, name: "闭环项目", code: `OP${suffix}` }, admin, 201);
  const team = (await call<{ item: { id: string } }>("POST", scope("/api/v1/organization/teams"), { name: "闭环研发团队" }, admin, 201)).item.id;
  const people: Record<string, Session> = {};
  for (const [key, label, roles] of [["departing", "离职作者", ["admin", "software-user"]], ["observer", "未参与工程师", ["software-user"]], ["transfer", "调动工程师", ["software-user"]]] as const) {
    const username = `operations.${key}.${suffix}`;
    await call("POST", scope("/api/v1/users"), { name: label, username, password: LOCAL_DEMO_SHARED_PASSWORD, roles: roles.map(roleId => ({ roleId })) }, admin, 201);
    people[key] = await login(username);
  }
  await page.goto(`/organization/members?organizationId=${org}`); await prepareInteractionSurface(page);
  await page.route(url => url.pathname.startsWith("/api/v1/organization/invitations"), async route => {
    const response = await route.fetch(); if (response.ok() && route.request().method() === "POST") {
      const body = await response.json() as { token?: string }; if (body.token) registerSecret(body.token);
    } await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "邀请", exact: true }).click();
  await page.getByRole("button", { name: "创建邀请", exact: true }).click();
  const invitation = page.getByRole("dialog", { name: "创建邀请", exact: true });
  await invitation.getByLabel("邀请备注", { exact: true }).fill("闭环接任者");
  await invitation.getByRole("button", { name: /^组织角色/ }).click();
  await page.getByRole("checkbox", { name: "硬件开发", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "软件开发", exact: true }).check(); await page.keyboard.press("Escape");
  await invitation.getByRole("button", { name: "预设团队", exact: true }).click();
  await page.getByRole("checkbox", { name: "闭环研发团队", exact: true }).check(); await page.keyboard.press("Escape");
  await invitation.getByRole("button", { name: "预设项目", exact: true }).click();
  await page.getByRole("checkbox", { name: "闭环项目", exact: true }).check(); await page.keyboard.press("Escape");
  await page.screenshot({ path: artifact("operations-invitation-1440.png"), animations: "disabled" });
  await invitation.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  const linkDialog = page.getByRole("dialog", { name: "邀请链接已生成", exact: true });
  const link = await linkDialog.getByLabel("一次性邀请链接", { exact: true }).inputValue();
  await linkDialog.getByRole("button", { name: "关闭", exact: true }).click();
  const successorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), successorPage = await successorContext.newPage();
  const successorDiagnostics = installBrowserDiagnostics(successorPage, testInfo, { expectedApiFailures });
  await successorPage.goto(`/invite${new URL(link).hash}`);
  await expect(successorPage.getByText("闭环研发团队", { exact: true })).toBeVisible();
  await expect(successorPage.getByText(/闭环项目.*软件开发/)).toBeVisible();
  await successorPage.getByLabel("姓名", { exact: true }).fill("受邀接任者");
  await successorPage.getByLabel("用户名", { exact: true }).fill(successorUsername);
  await successorPage.getByLabel("设置密码", { exact: true }).fill(LOCAL_DEMO_SHARED_PASSWORD);
  await successorPage.getByRole("button", { name: "接受邀请并创建账号", exact: true }).click();
  await expect(successorPage.getByText("账号已创建，可直接登录。", { exact: true })).toBeVisible();
  await successorPage.getByRole("link", { name: "前往登录", exact: true }).click();
  const successor = await signIn(successorPage, successorUsername, "/organization");
  expect((await page.request.post(apiRoute("/api/v1/auth/invitations/accept"), { data: { token: new URL(link).hash.slice(1), username: `replayed.${suffix}`, password: LOCAL_DEMO_SHARED_PASSWORD, name: "不应重复创建" } })).status()).toBe(409);
  expect(successor.auth.roles).toEqual([{ projectId: null, roleId: "software-user" }]);
  expect(successor.auth.projectMemberships).toEqual([{ projectId: project, roles: ["software-user"] }]);
  expect((await page.request.get(apiRoute(`/api/v1/organization?organizationId=${platform.auth.organization.id}`), { headers: { Authorization: `Bearer ${successor.token}` } })).status()).toBe(403);
  await call("PUT", scope(`/api/v1/organization/teams/${team}/members`), { userIds: [successor.auth.user.id, people.observer.auth.user.id] }, admin);
  const candidateRoute = `/api/v1/projects/${project}/parameter-file-candidates`;
  const candidateInput = { fileName: "pending.json", contentBase64: Buffer.from('{"limit":42}').toString("base64") };
  const participationRoute = `/api/v1/parameters/projects/${project}/initialization/draft`;
  const initialization = { projectName: "闭环项目", projectCode: `OP${suffix}`, ownerUserId: people.observer.auth.user.id, sourceProjectIds: [], primarySourceProjectId: null,
    supplementSourceProjectIds: [], selectedModuleIds: [], selectedRisks: [], selectedSourceBindingIds: [], bindingSnapshots: [], emptyLibrary: true, notes: "明确参与后才可写入的草稿" };
  expect((await page.request.put(apiRoute(participationRoute), { headers: { Authorization: `Bearer ${people.observer.token}` }, data: initialization })).status()).toBe(403);
  await page.goto(`/organization/projects?organizationId=${org}`); await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "批量授予项目角色", exact: true }).click();
  const grants = page.getByRole("dialog", { name: "批量授予项目角色", exact: true });
  await grants.getByRole("combobox", { name: "选择来源团队" }).click(); await page.getByRole("option", { name: "闭环研发团队", exact: true }).click();
  await grants.getByRole("button", { name: "授予项目编辑角色", exact: true }).click();
  await page.getByRole("checkbox", { name: "软件开发", exact: true }).check(); await page.keyboard.press("Escape");
  await grants.getByRole("button", { name: "预览授权", exact: true }).click();
  await expect(grants.getByRole("table", { name: "批量项目授权结果" })).toContainText("未参与工程师");
  await grants.getByRole("button", { name: /确认授予/ }).click();
  await expect(grants.getByRole("status")).toContainText("已生效 2 人");
  await grants.getByRole("button", { name: "关闭", exact: true }).click();
  await call("PUT", participationRoute, initialization, people.observer);
  await call("PUT", scope(`/api/v1/organization/teams/${team}/members`), { userIds: [people.transfer.auth.user.id] }, admin);
  expect((await login(`operations.transfer.${suffix}`)).auth.projectMemberships).toEqual([]);
  expect((await page.request.put(apiRoute(participationRoute), { headers: { Authorization: `Bearer ${people.transfer.token}` }, data: initialization })).status()).toBe(403);
  expect((await login(`operations.observer.${suffix}`)).auth.projectMemberships).toEqual([{ projectId: project, roles: ["software-user"] }]);
  const candidate = (await call<{ item: { id: string } }>("POST", candidateRoute, candidateInput, people.departing, 201)).item;
  const draft = (await call<{ item: { id: string; historicalAttribution: unknown } }>("POST", "/api/v1/knowledge/entries", { contentForm: "markdown", title: "闭环原始知识草稿", tags: [], contentMarkdown: "离职前的原始内容" }, people.departing, 201)).item;
  const movedDraft = (await call<{ item: { id: string } }>("POST", "/api/v1/knowledge/entries", { contentForm: "markdown", title: "调动前草稿", tags: [], contentMarkdown: "保留在 B" }, people.transfer, 201)).item;
  const machine = await call<{ token: string }>("POST", "/api/v1/log-integration-credentials", { name: "离职后仍工作的组织集成", skillId: null }, people.departing, 201); registerSecret(machine.token);
  const pairingCode = await call<{ code: string }>("POST", "/api/v1/device-bridges/pairing-codes", {}, people.departing, 201); registerSecret(pairingCode.code);
  const paired = await call<{ bridgeId: string; bridgeToken: string }>("POST", "/api/v1/device-bridges/pair", { code: pairingCode.code, machineLabel: "闭环个人配对", platform: "linux", arch: "amd64" }, people.departing, 201); registerSecret(paired.bridgeToken);
  const machineUpload = () => page.request.post(apiRoute("/api/v1/log-files"), { headers: { Authorization: `Bearer ${machine.token}` }, data: { fileName: "operations.log", contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO operational lifecycle\nERROR controlled fault").toString("base64") } });
  await page.goto(`/organization/members?organizationId=${org}`); await prepareInteractionSurface(page);
  const departingRow = page.getByRole("row").filter({ hasText: "离职作者" });
  await departingRow.getByRole("button", { name: /更多$/ }).click(); await page.getByRole("menuitem", { name: "停用", exact: true }).click();
  await page.getByRole("dialog", { name: "确认停用用户", exact: true }).getByRole("button", { name: "确认停用", exact: true }).press("Enter");
  await expect(departingRow).toContainText("停用");
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${people.departing.token}` } })).status()).toBe(401);
  await withPgClient(async client => { expect((await client.query("select revoked_at is not null as revoked from device_bridges where id=$1", [paired.bridgeId])).rows).toEqual([{ revoked: true }]); });
  const uploadedLog = await machineUpload(); expect(uploadedLog.status()).toBe(201);
  const log = await uploadedLog.json() as { fileObject: { storageKey: string } };
  await page.goto(`/organization/handovers?organizationId=${org}`); await prepareInteractionSurface(page);
  const knowledgeRow = page.getByRole("table", { name: "知识业务交接", exact: true }).getByRole("row").filter({ hasText: "闭环原始知识草稿" });
  await knowledgeRow.getByRole("button", { name: /更多$/ }).click(); await page.getByRole("menuitem", { name: "指定接任者", exact: true }).click();
  const assignment = page.getByRole("dialog", { name: "指定接任者", exact: true });
  await assignment.getByRole("combobox", { name: "接任者", exact: true }).click(); await page.getByRole("option", { name: "受邀接任者", exact: true }).click();
  await assignment.getByRole("button", { name: "保存交接", exact: true }).click();
  const continued = (await call<{ item: { historicalAttribution: unknown; createdByUserId: string } }>("PATCH", `/api/v1/knowledge/entries/${draft.id}`, { contentMarkdown: "受邀接任者继续的同一草稿", expectedHeadRevisionNumber: 1 }, successor)).item;
  expect(continued.createdByUserId).toBe(people.departing.auth.user.id); expect(continued.historicalAttribution).toEqual(draft.historicalAttribution);
  await expect(page.getByRole("table", { name: "项目业务交接", exact: true })).toContainText("pending.json");
  await page.screenshot({ path: artifact("operations-retained-handover-1440.png"), animations: "disabled" });
  await page.goto(`/organization/members?organizationId=${org}`); await prepareInteractionSurface(page);
  const transferRow = page.getByRole("row").filter({ hasText: "调动工程师" });
  await transferRow.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "调动 调动工程师 到其他组织", exact: true }).click();
  const transfer = page.getByRole("dialog", { name: "调动 调动工程师", exact: true });
  await transfer.getByRole("combobox", { name: "目标组织", exact: true }).click();
  await page.getByRole("option", { name: `${platform.auth.organization.name}（${platform.auth.organization.id}）`, exact: true }).click();
  await transfer.getByRole("button", { name: "预览影响", exact: true }).click();
  await transfer.getByRole("button", { name: "确认调动", exact: true }).press("Enter"); await expect(transfer).toBeHidden();
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${people.transfer.token}` } })).status()).toBe(401);
  const moved = await login(`operations.transfer.${suffix}`);
  expect(moved.auth.user.id).toBe(people.transfer.auth.user.id); expect(moved.auth.organization.id).toBe(platform.auth.organization.id);
  expect(moved.auth.roles).toEqual([{ projectId: null, roleId: "guest" }]); expect(moved.auth.projectMemberships).toEqual([]);
  expect((await page.request.get(apiRoute(scope(`/api/v1/knowledge/entries/${movedDraft.id}`)), { headers: { Authorization: `Bearer ${moved.token}` } })).status()).toBe(403);
  await call("GET", scope(`/api/v1/knowledge/entries/${movedDraft.id}`), undefined, admin);
  await page.goto("/platform/organizations"); await prepareInteractionSurface(page);
  await page.getByRole("searchbox", { name: "搜索组织", exact: true }).fill(org);
  const directoryRow = page.getByRole("table", { name: "平台组织目录" }).getByRole("row").filter({ hasText: name });
  await directoryRow.getByRole("button", { name: /更多$/ }).click();
  await page.getByRole("menuitem", { name: "查看资料", exact: true }).click();
  let details = page.getByRole("dialog", { name: "组织资料", exact: true });
  await details.getByRole("button", { name: "停用组织", exact: true }).click();
  await page.getByRole("dialog", { name: "停用组织", exact: true }).getByRole("button", { name: "确认停用组织", exact: true }).press("Enter");
  await adminPage.reload(); await prepareInteractionSurface(adminPage);
  await expect(adminPage.getByLabel("显示名称", { exact: true })).toBeDisabled();
  await expect(adminPage.getByRole("region", { name: "当前操作组织" })).toContainText("已停用 · 仅可查看");
  expect((await machineUpload()).status()).toBe(403);
  await call("GET", `/api/v1/knowledge/entries/${draft.id}`, undefined, successor);
  await adminPage.screenshot({ path: artifact("operations-suspended-1440.png"), animations: "disabled" });
  await details.getByRole("button", { name: "恢复组织", exact: true }).click();
  await page.getByRole("dialog", { name: "恢复组织", exact: true }).getByRole("button", { name: "确认恢复组织", exact: true }).press("Enter");
  await expect(details.getByRole("button", { name: "停用组织", exact: true })).toBeVisible();
  expect((await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${people.departing.token}` } })).status()).toBe(401);
  const pdf = (await call<{ item: { file: { storageKey: string } } }>("POST", scope("/api/v1/knowledge/entries"), { title: "闭环附件", contentForm: "file", tags: [], file: { fileName: "private.pdf", contentType: "application/pdf", contentBase64: (await readFile(new URL("../../server/modules/knowledge/testing/fixtures/sample.pdf", import.meta.url))).toString("base64") } }, platform, 201)).item;
  const feedback = (await call<{ item: { attachments: Array<{ storageKey: string }> } }>("POST", "/api/v1/product-feedback", { pagePath: "/knowledge", pageTitle: "闭环", feedbackType: "experience", description: "闭环反馈", attachments: [{ fileName: "private.png", contentType: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=" }] }, successor, 201)).item;
  const retainedA = (await call<{ item: { id: string } }>("POST", "/api/v1/knowledge/entries", { title: "A保留对照", contentForm: "markdown", tags: [], contentMarkdown: "其他组织的保留业务" }, platform, 201)).item;
  const keys = [log.fileObject.storageKey, pdf.file.storageKey, feedback.attachments[0]!.storageKey];
  adminDiagnostics.assertNoBrowserDiagnosticsFailures(); successorDiagnostics.assertNoBrowserDiagnosticsFailures();
  await memberContext.close(); await successorContext.close();
  await withPgClient(async client => {
    const audit = (await client.query<{ kind: string; actor_user_id: string; organization_id: string }>("select kind,actor_user_id,organization_id from audit_events where organization_id=$1 and kind in ('account-transfer','knowledge-handover','organization-lifecycle')", [org])).rows;
    expect(new Set(audit.map(event => event.kind))).toEqual(new Set(["account-transfer", "knowledge-handover", "organization-lifecycle"]));
    expect(audit.every(event => event.actor_user_id === platform.auth.user.id && event.organization_id === org)).toBe(true);
    keys.push((await client.query<{ storage_key: string }>("select storage_key from project_parameter_file_candidates where id=$1", [candidate.id])).rows[0]!.storage_key);
    await client.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values($1,$2,$3,'xiaoze','{}','archived','闭环暂存对话')", [`operations-${suffix}`, org, successor.auth.user.id]);
    await client.query(`drop trigger if exists test_operational_erasure_ack on parameter_catalog.organization_log_erasure_objects; drop function if exists test_operational_erasure_ack();
      create function test_operational_erasure_ack() returns trigger language plpgsql as $$ begin raise exception 'controlled operational file acknowledgement fault'; end $$;
      create trigger test_operational_erasure_ack before delete on parameter_catalog.organization_log_erasure_objects for each row execute function test_operational_erasure_ack()`);
    faultInstalled = true;
  });
  for (const key of keys) expect((await readFile(path.resolve(process.env.OBJECT_STORE_ROOT!, key))).length).toBeGreaterThan(0);
  let failed: { id: string; status: string; domains: Record<string, { status: string; attempts: number }> } | undefined;
  for (let attempt = 0; attempt < 2 && !failed; attempt++) {
    if (attempt) { await directoryRow.getByRole("button", { name: /更多$/ }).click(); await page.getByRole("menuitem", { name: "查看资料", exact: true }).click(); }
    await details.getByRole("button", { name: "删除影响", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "组织删除影响预览", exact: true });
    await preview.getByRole("button", { name: "开始彻底删除", exact: true }).scrollIntoViewIfNeeded(); await preview.getByRole("button", { name: "开始彻底删除", exact: true }).press("Enter");
    const confirmation = page.getByRole("dialog", { name: "彻底删除组织", exact: true });
    await confirmation.getByRole("textbox", { name: "输入组织编号确认" }).fill(org);
    const deleting = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/platform/organizations/${org}/deletions` && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "确认彻底删除", exact: true }).press("Enter");
    const response = await deleting;
    if (response.status() === 409) {
      expect(await response.json()).toMatchObject({ error: { details: { code: "organization-deletion-preview-stale" } } });
      await expect(confirmation.getByRole("alert")).toContainText("重新查看预览");
      expect((await call<{ item: { status: string } }>("GET", `/api/v1/platform/organizations/${org}`)).item.status).toBe("active");
      await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    } else { expect(response.status(), await response.text()).toBe(202); failed = (await response.json() as { item: NonNullable<typeof failed> }).item; }
  }
  if (!failed) throw new Error("Organization preview kept changing; no erasure was accepted");
  expect(failed.status).toBe("failed");
  const cleanup = page.getByRole("dialog", { name: "组织清理记录", exact: true }).getByRole("region", { name: `组织 ${org} 清理` });
  await expect(cleanup.getByLabel("领域清理进度")).toContainText("清理失败，可重试");
  await page.screenshot({ path: artifact("operations-deletion-failed-1440.png"), animations: "disabled" });
  await withPgClient(client => client.query("drop trigger test_operational_erasure_ack on parameter_catalog.organization_log_erasure_objects; drop function test_operational_erasure_ack()"));
  await page.reload(); await prepareInteractionSurface(page);
  await page.getByRole("button", { name: "组织目录：更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "清理记录", exact: true }).click();
  await cleanup.getByRole("button", { name: "继续清理", exact: true }).press("Enter"); await expect(cleanup).toContainText("已删除");
  await expect(cleanup.getByLabel("领域清理进度")).toHaveCount(0);
  const final = await call<{ item: { status: string; domains: object; attempts: number } }>("GET", `/api/v1/platform/organization-deletions/${failed.id}`);
  expect(final.item).toMatchObject({ status: "deleted", domains: {}, attempts: 0 });
  for (const key of keys) await expect(readFile(path.resolve(process.env.OBJECT_STORE_ROOT!, key))).rejects.toMatchObject({ code: "ENOENT" });
  await call("GET", `/api/v1/knowledge/entries/${retainedA.id}`); await call("GET", "/api/v1/me", undefined, moved);
  await expect(home.getByRole("region", { name: "当前操作组织" })).toContainText(platform.auth.organization.name);
  await withPgClient(async client => {
    expect((await client.query("select id from organizations where id=$1", [org])).rowCount).toBe(0);
    expect((await client.query("select organization_id from users where id=$1", [moved.auth.user.id])).rows).toEqual([{ organization_id: platform.auth.organization.id }]);
  });
  await page.screenshot({ path: artifact("operations-minimal-receipt-1440.png"), animations: "disabled" });
  homeDiagnostics.assertNoBrowserDiagnosticsFailures(); await home.close();
  await recordOperationEvidence({ operationId: "ORG-OPERATING-LIFECYCLE-001", title: "Organization operational lifecycle with actual local identities", status: "passed", role: "platform-admin, admin, invited editor, nonparticipant, offboarded author, transferred guest", route: "/platform/organizations", page, testInfo,
    assertions: ["ui", "api", "db", "audit", "screenshot"],
    report: { path: path.join(reportRoot, "index.html"), format: "html" }, trace: { mode: "retain-on-failure", path: outputRoot },
    artifacts: ["operations-invitation-1440.png", "operations-retained-handover-1440.png", "operations-suspended-1440.png", "operations-deletion-failed-1440.png", "operations-minimal-receipt-1440.png"].map(artifact),
    api: [{ method: "POST", path: "/api/v1/platform/organizations", status: 201, responseSummary: "Created B with a usable local administrator; invited editor continued retained work; transferred account remained in A." }, { method: "POST", path: `/api/v1/platform/organization-deletions/${failed.id}/retry`, status: 200, responseSummary: "Actual durable acknowledgement fault remained retryable after page reload; all four domains converged to a minimal receipt." }],
    db: [{ table: "organizations", predicate: "the publicly created target B", observed: "Target absent; A actor, transferred identity and A business retained", rowCount: 0 }],
    audit: [{ kind: "account-transfer", targetId: moved.auth.user.id }, { kind: "organization-lifecycle", action: "suspend", targetId: org }] });
});
