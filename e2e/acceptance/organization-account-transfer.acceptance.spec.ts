import "./helpers/loadAcceptanceEnvironment";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { expect, test } from "playwright/test";
import { hashLocalAccountPassword } from "../../server/modules/auth/localAccountCredentials";
import { LOCAL_DEMO_SHARED_PASSWORD } from "../../server/modules/auth/seedLocalDemoCredentials";
import { resolveApiAuthorization, resolveApiAuthProvider } from "../../playwright.shared";
import { withPgClient } from "./helpers/database";
import { apiBaseUrl, apiRoute } from "./helpers/runtime";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";

// @acceptance ORG-ACCOUNT-TRANSFER-001
// @operation ORG-ACCOUNT-TRANSFER-001

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/platform/organizations/", status: 503 }] });
let retainedFixture: { organizationId: string; suffix: string } | undefined;
test.afterEach(async () => {
  if (!retainedFixture) return;
  const { organizationId, suffix } = retainedFixture;
  await withPgClient(async db => {
    // These are this test's retained pre-cutover records. Remove only these
    // fixtures so a later owned API boot still enforces its clean-state gate.
    await db.query("delete from parameter_drafts where organization_id=$1 and id=$2", [organizationId, `draft-${suffix}`]);
    await db.query("delete from parameter_change_requests where organization_id=$1 and id=$2", [organizationId, `review-${suffix}`]);
    await db.query("delete from project_parameter_values where organization_id=$1 and id=$2", [organizationId, `value-${suffix}`]);
    await db.query("delete from parameter_definitions where organization_id=$1 and id=$2", [organizationId, `definition-${suffix}`]);
  });
  retainedFixture = undefined;
});
test("previews a local account transfer, retries safely and retains source work after target login", async ({ page }, testInfo) => {
  test.skip(resolveApiAuthProvider(resolveApiAuthorization()) !== "local", "Requires the real local-auth API lane.");
  const suffix = randomUUID().slice(0, 8), home = `transfer-home-${suffix}`, source = `transfer-source-${suffix}`, target = `transfer-target-${suffix}`;
  const platform = `transfer-platform-${suffix}`, member = `transfer-member-${suffix}`, admin = `transfer-admin-${suffix}`, project = `transfer-project-${suffix}`;
  retainedFixture = { organizationId: source, suffix };
  const memberName = `调动工程师-${suffix}`, hash = await hashLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
  await withPgClient(async db => {
    await db.query("insert into organizations(id,name) values($1,'调动平台所属组织'),($2,'调动源组织'),($3,'调动目标组织')", [home, source, target]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$4,'调动平台管理员','平台管理员',true),($2,$5,$6,'研发',true),($3,$5,'源组织管理员','管理员',true)", [platform, member, admin, home, source, memberName]);
    for (const [id, org, role] of [[platform, home, "platform-admin"], [member, source, "software-user"], [admin, source, "admin"]]) {
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [id, hash]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`${id}-role`, id, org, role]);
    }
    await db.query("insert into projects(id,organization_id,name,code) values($1,$2,'源组织保留项目','TRANSFER')", [project, source]);
    await db.query("insert into project_members(organization_id,project_id,user_id,roles) values($1,$2,$3,array['software-user'])", [source, project, member]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id,project_id) values($1,$2,$3,'hardware-committer',$4)", [`${member}-review`, member, source, project]);
    await db.query("insert into organization_teams(id,organization_id,name) values($1,$2,'源组织研发团队')", [`team-${suffix}`, source]);
    await db.query("insert into organization_team_members(team_id,organization_id,user_id) values($1,$2,$3)", [`team-${suffix}`, source, member]);
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values($1,$2,'调动保留参数','','','dts','Module','','','Low')", [`definition-${suffix}`, source]);
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values($1,$2,$3,$4,'0','1')", [`value-${suffix}`, source, project, `definition-${suffix}`]);
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values($1,$2,$3,$4,$5,'1','调动前项目草稿')", [`draft-${suffix}`, source, project, `value-${suffix}`, member]);
    await db.query("insert into parameter_change_requests(id,organization_id,project_id,project_parameter_value_id,parameter_definition_id,base_version,current_value,target_value,status,submitter_user_id,assigned_to_user_id) values($1,$2,$3,$4,$5,1,'0','2','hardware_review',$6,$7)", [`review-${suffix}`, source, project, `value-${suffix}`, `definition-${suffix}`, admin, member]);
  });
  async function login(id: string) { const result = await page.request.post(apiRoute("/api/v1/auth/login"), { data: { username: id, password: LOCAL_DEMO_SHARED_PASSWORD } }); expect(result.status()).toBe(200); return (await result.json() as { token: string }).token; }
  const platformToken = await login(platform), memberToken = await login(member), platformHeaders = { Authorization: `Bearer ${platformToken}` }, memberHeaders = { Authorization: `Bearer ${memberToken}` };
  const before = await (await page.request.get(apiRoute(`/api/v1/organization/project-handovers?organizationId=${source}`), { headers: platformHeaders })).json() as { items: Array<{ id: string; historicalAttribution: unknown }> };
  const knowledge = await page.request.post(apiRoute("/api/v1/knowledge/entries"), { headers: memberHeaders, data: { title: "调动前知识草稿", contentForm: "markdown", tags: [], contentMarkdown: "源组织未完成内容" } }); expect(knowledge.status()).toBe(201);
  const knowledgeId = (await knowledge.json() as { item: { id: string } }).item.id;
  const machine = await page.request.post(apiRoute(`/api/v1/log-integration-credentials?organizationId=${source}`), { headers: platformHeaders, data: { name: "调动后继续工作的组织流水线", skillId: null } }); expect(machine.status()).toBe(201);
  const machineToken = (await machine.json() as { token: string }).token;
  const issueCode = async () => (await (await page.request.post(apiRoute("/api/v1/device-bridges/pairing-codes"), { headers: memberHeaders, data: {} })).json() as { code: string }).code;
  const paired = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), { data: { code: await issueCode(), machineLabel: "调动成员电脑", platform: "linux", arch: "amd64" } }); expect(paired.status()).toBe(201);
  const pairing = await paired.json() as { bridgeToken: string }, unusedCode = await issueCode();
  const socket = new WebSocket(apiBaseUrl().replace("http:", "ws:") + "/api/v1/device-bridges/ws", { headers: { Authorization: `Bridge ${pairing.bridgeToken}` } });
  try {
    await once(socket, "message");
    await page.addInitScript(token => localStorage.setItem("wiseeff.localAuthToken", token), platformToken);
    await page.goto(`/organization/members?organizationId=${source}`); await prepareInteractionSurface(page);
    const row = page.getByRole("row").filter({ hasText: memberName });
    await row.getByRole("button", { name: /更多$/ }).click();
    await page.getByRole("menuitem", { name: `调动 ${memberName} 到其他组织`, exact: true }).focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `调动 ${memberName}`, exact: true });
    await dialog.getByRole("combobox", { name: "目标组织", exact: true }).click();
    await page.getByRole("option", { name: `调动目标组织（${target}）`, exact: true }).click();
    await dialog.getByRole("checkbox", { name: "访客", exact: true }).uncheck();
    await dialog.getByRole("checkbox", { name: "硬件开发", exact: true }).check();
    await dialog.getByRole("button", { name: "预览影响", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "调动影响" })).toContainText("项目草稿与待办：2");
    await page.screenshot({ path: testInfo.outputPath("account-transfer-preview-1440.png"), animations: "disabled" });
    const transferRoute = (url: URL) => url.pathname.endsWith(`/members/${member}/transfer`);
    await page.route(transferRoute, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "调动服务暂不可用" } }) }));
    await dialog.getByRole("button", { name: "确认调动", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("调动服务暂不可用");
    expect((await page.request.get(apiRoute("/api/v1/me"), { headers: memberHeaders })).status()).toBe(200);
    await page.screenshot({ path: testInfo.outputPath("account-transfer-failure-1440.png"), animations: "disabled" });
    await page.unroute(transferRoute);
    await dialog.getByRole("button", { name: "预览影响", exact: true }).click();
    const disconnected = once(socket, "close");
    await dialog.getByRole("button", { name: "确认调动", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden(); expect((await disconnected)[0]).toBe(4401);
    await expect(row).toHaveCount(0);
    expect((await page.request.get(apiRoute("/api/v1/me"), { headers: memberHeaders })).status()).toBe(401);
    expect((await page.request.post(apiRoute("/api/v1/device-bridges/pair"), { data: { code: unusedCode, machineLabel: "旧配对码", platform: "linux", arch: "amd64" } })).status()).toBe(400);
    const freshToken = await login(member), fresh = await (await page.request.get(apiRoute("/api/v1/me"), { headers: { Authorization: `Bearer ${freshToken}` } })).json() as { user: { id: string }; organization: { id: string }; roles: unknown; projectMemberships: unknown };
    expect(fresh).toMatchObject({ user: { id: member }, organization: { id: target }, roles: [{ projectId: null, roleId: "hardware-user" }], projectMemberships: [] });
    expect((await page.request.get(apiRoute(`/api/v1/knowledge/entries/${knowledgeId}?organizationId=${source}`), { headers: { Authorization: `Bearer ${freshToken}` } })).status()).toBe(403);
    expect((await page.request.post(apiRoute("/api/v1/log-files"), { headers: { Authorization: `Bearer ${machineToken}` }, data: { fileName: "source.log", contentType: "text/plain", contentBase64: Buffer.from("INFO retained source pipeline\n").toString("base64") } })).status()).toBe(201);
    await page.goto(`/organization/handovers?organizationId=${source}`); await prepareInteractionSurface(page);
    const table = page.getByRole("table", { name: "项目业务交接", exact: true });
    await expect(table.getByRole("row").filter({ hasText: "调动前项目草稿" })).toContainText("待交接");
    await expect(table.getByRole("row").filter({ hasText: "参数变更" })).toContainText("待交接");
    await page.screenshot({ path: testInfo.outputPath("account-transfer-source-handover-1440.png"), animations: "disabled" });
    const after = await (await page.request.get(apiRoute(`/api/v1/organization/project-handovers?organizationId=${source}`), { headers: platformHeaders })).json() as { items: Array<{ id: string; historicalAttribution: unknown }> };
    for (const item of before.items) expect(after.items.find(candidate => candidate.id === item.id)?.historicalAttribution).toEqual(item.historicalAttribution);
    await page.goto(`/organization/members?organizationId=${target}`); await prepareInteractionSurface(page);
    await expect(page.getByRole("row").filter({ hasText: memberName })).toContainText("硬件开发");
    await page.screenshot({ path: testInfo.outputPath("account-transfer-target-members-1440.png"), animations: "disabled" });
    const actor = await (await page.request.get(apiRoute("/api/v1/me"), { headers: platformHeaders })).json() as { organization: { id: string } }; expect(actor.organization.id).toBe(home);
  } finally { socket.terminate(); }
});
