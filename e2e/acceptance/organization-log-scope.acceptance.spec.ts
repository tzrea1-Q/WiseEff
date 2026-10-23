import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test } from "playwright/test";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { withPgClient } from "./helpers/database";
import { installBrowserDiagnostics, useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";
import { openLogUploadDialog } from "./helpers/logAnalysis";
import { prepareInteractionSurface } from "./helpers/interactionSurface";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("keeps log uploads, skills, two tabs and late refreshes bound to the displayed organization", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await seedAcceptanceRoleMatrix();
  const suffix = randomUUID().slice(0, 8), target = `log-target-${suffix}`, siblingId = `log-sibling-${suffix}`;
  const targetName = `日志目标组织-${suffix}`, siblingName = `日志并行组织-${suffix}`;
  await withPgClient(client => client.query("insert into organizations(id,name) values($1,$2),($3,$4)", [target, targetName, siblingId, siblingName]));
  const headers = authHeadersForRole("platform-admin"), homeName = `home-${suffix}.log`, siblingFile = `sibling-${suffix}.log`, targetFile = `target-${suffix}.log`;
  for (const [fileName, query] of [[homeName, ""], [siblingFile, `?organizationId=${siblingId}`]]) {
    const uploaded = await page.request.post(apiRoute(`/api/v1/log-files${query}`), { headers,
      data: { fileName, contentType: "text/plain", skillSelection: "generic", contentBase64: Buffer.from("INFO boot\nERROR controller timeout\n").toString("base64") } });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
  }
  await signInBrowserAsRole(page, "platform-admin", `/logs?organizationId=${target}`);
  await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(targetName);
  await expect(page.getByText(homeName, { exact: true })).toHaveCount(0);
  const sibling = await page.context().newPage(), diagnostics = installBrowserDiagnostics(sibling, testInfo);
  let release: (() => void) | undefined;
  try {
    await sibling.goto(`/logs?organizationId=${siblingId}`);
    await prepareInteractionSurface(sibling);
    await expect(sibling.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(siblingName);
    await expect(sibling.getByText(siblingFile, { exact: true }).first()).toBeVisible();
    const dialog = await openLogUploadDialog(page);
    await dialog.getByTestId("file-drop-zone-input").setInputFiles({ name: targetFile, mimeType: "text/plain", buffer: Buffer.from("INFO target boot\nERROR target controller timeout\n") });
    await dialog.locator("#upload-analysis-question").fill("检查当前组织的控制器超时");
    const creatingLog = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/log-files" && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "开始分析", exact: true }).click();
    const createdLog = await creatingLog;
    expect(createdLog.status()).toBe(201);
    expect(new URL(createdLog.url()).searchParams.get("organizationId")).toBe(target);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(targetFile, { exact: true }).first()).toBeVisible();
    await sibling.reload(); await prepareInteractionSurface(sibling);
    await expect(sibling.getByText(targetFile, { exact: true })).toHaveCount(0);
    await expect(sibling.getByText(siblingFile, { exact: true }).first()).toBeVisible();

    await page.goto(`/log-admin?tab=skills&organizationId=${target}`); await prepareInteractionSurface(page);
    await page.getByRole("button", { name: "新建技能", exact: true }).click();
    const createSkill = page.getByRole("dialog", { name: "新建技能", exact: true }), skillName = `页面目标技能-${suffix}`;
    await createSkill.getByLabel("名称", { exact: true }).fill(skillName);
    const creatingSkill = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/log-skills" && response.request().method() === "POST");
    await createSkill.getByRole("button", { name: "创建技能", exact: true }).click();
    const createdSkill = await creatingSkill;
    expect(createdSkill.status()).toBe(201);
    expect(new URL(createdSkill.url()).searchParams.get("organizationId")).toBe(target);
    await expect(page.getByRole("heading", { name: skillName, exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("organizationId")).toBe(target);
    await expect(page.getByRole("link", { name: "← 分析技能", exact: true })).toHaveAttribute("href", `/log-admin?tab=skills&organizationId=${target}`);
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(targetName);
    await page.screenshot({ path: testInfo.outputPath("target-log-skill-1440.png"), animations: "disabled" });

    await page.goto(`/log-admin?tab=records&organizationId=${target}`); await prepareInteractionSurface(page);
    await expect(page.getByText(targetFile, { exact: true }).first()).toBeVisible();
    let entered!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
    const late = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/logs" && new URL(response.url()).searchParams.get("organizationId") === target);
    await page.route("**/api/v1/logs?*", async route => {
      if (new URL(route.request().url()).searchParams.get("organizationId") !== target) return route.continue();
      const response = await route.fetch(); entered(); await resume; await route.fulfill({ response });
    }, { times: 1 });
    await page.getByRole("button", { name: "刷新", exact: true }).click(); await held;
    await page.getByRole("button", { name: "返回所属组织", exact: true }).click();
    await page.getByRole("tab", { name: "日志分析记录", exact: true }).click();
    await expect(page.getByText(homeName, { exact: true }).first()).toBeVisible();
    release!(); await late;
    await expect(page.getByText(targetFile, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "当前操作组织", exact: true })).toHaveCount(0);
    await expect(sibling.getByRole("region", { name: "当前操作组织", exact: true })).toContainText(siblingName);
    await page.screenshot({ path: testInfo.outputPath("home-after-late-log-response-1440.png"), animations: "disabled" });
    const persisted = await withPgClient(client => client.query<{ organization_id: string; submitted_by_user_id: string }>(
      "select organization_id,submitted_by_user_id from log_records where file_name=$1", [targetFile]));
    expect(persisted.rows).toEqual([{ organization_id: target, submitted_by_user_id: "u-platform-admin" }]);
    const audit = await withPgClient(client => client.query<{ organization_id: string; actor_user_id: string }>(
      "select organization_id,actor_user_id from audit_events where kind='log-upload' and target_id in (select id from log_records where file_name=$1)", [targetFile]));
    expect(audit.rows).toEqual([{ organization_id: target, actor_user_id: "u-platform-admin" }]);
    diagnostics.assertNoBrowserDiagnosticsFailures();
  } finally { release?.(); await sibling.close(); }
});
