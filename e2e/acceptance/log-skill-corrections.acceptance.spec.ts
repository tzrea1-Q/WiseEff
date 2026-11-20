import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { expect, test } from "playwright/test";
import { acceptanceUserIdForRole, authHeadersForRole, authHeadersForUser, signInBrowserAsRole } from "./helpers/bearerAuth";
import { withPgClient } from "./helpers/database";
import { installBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { acceptanceAdminOnlyUser, seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import type { LogRecordDto } from "../../server/modules/logs/types";
import type { AnalysisSkill, SourceSnapshot } from "../../src/features/log-skills/types";

test.use({ viewport: { width: 1440, height: 900 } });

test("corrects source labels and credential names in a selected log workspace", async ({ page }, testInfo) => {
  // @acceptance LOG-SKILL-CORRECTIONS-001
  // @operation LOG-SKILL-CORRECTIONS-001
  await seedAcceptanceRoleMatrix();
  const stamp = randomUUID().slice(0, 8), organizationId = `log-corrections-${stamp}`, organizationName = `日志更正验收-${stamp}`;
  const actorId = acceptanceUserIdForRole("platform-admin");
  await withPgClient(async db => {
    await db.query("insert into organizations(id,name) values($1,$2)", [organizationId, organizationName]);
    expect((await db.query("select role_id from user_role_bindings where user_id=$1", [actorId])).rows).toEqual([{ role_id: "platform-admin" }]);
  });
  const headers = authHeadersForRole("platform-admin"), scope = `?organizationId=${organizationId}`;
  const skillName = `日志更正技能-${stamp}`;
  const created = await page.request.post(apiRoute(`/api/v1/log-skills${scope}`), { headers, data: { name: skillName } });
  expect(created.status()).toBe(201);
  const skill = (await created.json()).item as AnalysisSkill;
  const skillPath = `/api/v1/log-skills/${skill.id}`, snapshotsPath = `${skillPath}/source-snapshots`;
  const zip = new JSZip();
  zip.file("source.c", 'pr_warn("controller timeout=%d\\n", timeout);\n');
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  async function uploadSnapshot(versionLabel: string): Promise<SourceSnapshot> {
    const form = new FormData();
    form.append("versionLabel", versionLabel);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "source.zip");
    const response = await fetch(apiRoute(`${snapshotsPath}${scope}`), { method: "POST", headers: { Authorization: headers.Authorization }, body: form });
    expect(response.status).toBe(201);
    return (await response.json()).item;
  }
  const original = await uploadSnapshot("build-old"), fallback = await uploadSnapshot("build-default");
  const archived = await uploadSnapshot("build-new");
  expect((await page.request.post(apiRoute(`${snapshotsPath}/${archived.id}/archive${scope}`), { headers })).status()).toBe(200);
  const selected = await page.request.post(apiRoute(`${snapshotsPath}/${fallback.id}/default${scope}`), { headers });
  expect(selected.status()).toBe(200);
  const draftRevisionId = (await selected.json()).item.draft.id;
  const published = await page.request.post(apiRoute(`${skillPath}/publish${scope}`), { headers, data: { draftRevisionId } });
  expect(published.status()).toBe(200);
  await expect.poll(async () => {
    const listed = await page.request.get(apiRoute(`${snapshotsPath}${scope}`), { headers });
    return ((await listed.json()).items as SourceSnapshot[]).filter(item => item.status === "ready").map(item => item.id).sort();
  }).toEqual([original.id, fallback.id].sort());

  // Independent HTTP calls keep the issued secret out of Playwright traces and attachments.
  const credentialsPath = "/api/v1/log-integration-credentials";
  const issued = await fetch(apiRoute(`${credentialsPath}${scope}`), { method: "POST", headers,
    body: JSON.stringify({ name: "Uploader before correction", skillId: skill.id }) });
  expect(issued.status).toBe(201);
  const { item: credential, token } = await issued.json() as { item: { id: string }; token: string };
  const machineHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  async function readReport(id: string): Promise<LogRecordDto> {
    const response = await fetch(apiRoute(`/api/v1/logs/${id}`), { headers: machineHeaders });
    expect(response.status).toBe(200);
    return (await response.json()).item;
  }
  async function analyze(sourceVersion: string) {
    const response = await fetch(apiRoute("/api/v1/log-files"), { method: "POST", headers: machineHeaders, body: JSON.stringify({
      fileName: `versions-${stamp}.log`, contentType: "text/plain", sourceVersion, contentBase64: Buffer.from("WARN controller timeout=7\n").toString("base64")
    }) });
    expect(response.status).toBe(201);
    const { log } = await response.json() as { log: { id: string } };
    await expect.poll(async () => (await readReport(log.id)).status).toBe("complete");
    return readReport(log.id);
  }
  const prior = await analyze("build-old");
  expect(prior.sourceSnapshot?.id).toBe(original.id);

  const restorePath = `${snapshotsPath}/${archived.id}/restore`;
  const diagnostics = installBrowserDiagnostics(page, testInfo, { expectedApiFailures: [
    { method: "POST", path: restorePath, status: 409, exact: true },
    { method: "POST", path: "/api/v1/organization/operating-scope", status: 403, exact: true }
  ] });
  await signInBrowserAsRole(page, "platform-admin", `/log-admin?tab=skills&organizationId=${organizationId}`);
  await expect(page.getByRole("region", { name: "当前操作组织" })).toContainText(organizationName);
  await page.getByRole("table", { name: "分析技能列表" }).getByRole("link", { name: skillName, exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "技能分区导航" });
  await navigation.getByRole("button", { name: "源码", exact: true }).click();
  const table = page.getByRole("table", { name: "源码快照" });
  await table.getByRole("button", { name: /build-old 快照操作/ }).press("Enter");
  await page.getByRole("menuitem", { name: "更正版本标签", exact: true }).click();
  const labelDialog = page.getByRole("dialog", { name: "更正源码版本标签" });
  const input = labelDialog.getByRole("textbox", { name: "新版本标签" });
  await expect(input).toBeFocused();
  const saveLabel = labelDialog.getByRole("button", { name: "保存标签" });
  await input.fill("build-default");
  await input.press("Enter");
  await expect(labelDialog.getByRole("link", { name: "查看占用快照 build-default" })).toHaveAttribute("href", `#source-snapshot-${fallback.id}`);
  await expect(saveLabel).toBeDisabled();
  await input.fill("build-new");
  await expect(saveLabel).toBeDisabled();
  await input.press("Enter");
  await expect(labelDialog).toContainText("更正后 使用已发布默认快照 · build-default · 就绪");
  await expect(labelDialog).toContainText("更正后 匹配标签 · build-new · 就绪");
  const labelScreenshot = testInfo.outputPath("source-label-preview-1440.png");
  await page.screenshot({ path: labelScreenshot, animations: "disabled" });
  const labelSaved = page.waitForResponse(response => new URL(response.url()).pathname === `${snapshotsPath}/${original.id}` && response.request().method() === "PATCH");
  await saveLabel.press("Enter");
  const sourceResponse = await labelSaved;
  expect(sourceResponse.status()).toBe(200);
  expect(new URL(sourceResponse.url()).searchParams.get("organizationId")).toBe(organizationId);
  await expect(labelDialog).toBeHidden();
  await table.getByRole("row").filter({ hasText: "已归档" }).getByRole("button", { name: "恢复快照" }).click();
  await expect(page.getByRole("link", { name: "查看占用快照 build-new" })).toHaveAttribute("href", `#source-snapshot-${original.id}`);

  await navigation.getByRole("button", { name: "集成", exact: true }).click();
  await page.getByRole("button", { name: /凭据 Uploader before correction/ }).click();
  await page.getByRole("menuitem", { name: "更正名称", exact: true }).click();
  const credentialDialog = page.getByRole("dialog", { name: "更正集成凭据名称" });
  await credentialDialog.getByRole("textbox", { name: "凭据名称" }).fill("Uploader after correction");
  const credentialScreenshot = testInfo.outputPath("credential-name-correction-1440.png");
  await page.screenshot({ path: credentialScreenshot, animations: "disabled" });
  const credentialSaved = page.waitForResponse(response => new URL(response.url()).pathname === `${credentialsPath}/${credential.id}` && response.request().method() === "PATCH");
  await credentialDialog.getByRole("button", { name: "保存名称" }).press("Enter");
  const credentialResponse = await credentialSaved;
  expect(credentialResponse.status()).toBe(200);
  expect(new URL(credentialResponse.url()).searchParams.get("organizationId")).toBe(organizationId);
  await expect(credentialDialog).toBeHidden();
  await expect(page.getByRole("table", { name: "集成凭据列表" }).getByRole("row").filter({ hasText: "Uploader after correction" })).toContainText("有效");
  expect(await analyze("build-old")).toMatchObject({ sourceSnapshot: { id: fallback.id }, sourceSnapshotSelection: "default" });
  expect(await analyze("build-new")).toMatchObject({ sourceSnapshot: { id: original.id }, sourceSnapshotSelection: "matched_version" });
  expect(await readReport(prior.id)).toMatchObject({ reportId: prior.reportId, sourceSnapshot: { id: original.id }, requestedSourceVersion: "build-old" });

  await signInBrowserAsRole(page, "guest", "/logs");
  await page.goto(`/log-admin/skills/${skill.id}?section=source&organizationId=${organizationId}`);
  await expect(page.getByRole("alert")).toContainText("没有权限执行该操作。");
  await expect(page.getByRole("button", { name: /快照操作/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "签发凭据" })).toHaveCount(0);
  const admin = acceptanceAdminOnlyUser;
  for (const denied of [authHeadersForRole("guest"), authHeadersForUser(admin.userId, admin.email, admin.name)]) {
    expect((await page.request.patch(apiRoute(`${credentialsPath}/${credential.id}${scope}`), { headers: denied, data: { name: "Denied" } })).status()).toBe(403);
    expect((await page.request.patch(apiRoute(`${snapshotsPath}/${original.id}${scope}`), { headers: denied,
      data: { versionLabel: "denied", expectedVersionLabel: "build-new", expectedArchived: false } })).status()).toBe(403);
  }
  const audit = await withPgClient(db => db.query(`select kind, actor_user_id, organization_id,
    coalesce(metadata->>'beforeName', metadata->>'beforeVersionLabel') as before_name,
    coalesce(metadata->>'afterName', metadata->>'afterVersionLabel') as after_name
    from audit_events where target_id=any($1) and kind in ('log-source-snapshot-rename','log-integration-credential-rename') order by kind`, [[original.id, credential.id]]));
  expect(audit.rows).toEqual([
    { kind: "log-integration-credential-rename", actor_user_id: actorId, organization_id: organizationId, before_name: "Uploader before correction", after_name: "Uploader after correction" },
    { kind: "log-source-snapshot-rename", actor_user_id: actorId, organization_id: organizationId, before_name: "build-old", after_name: "build-new" }
  ]);
  diagnostics.assertNoBrowserDiagnosticsFailures();
  await recordOperationEvidence({ testInfo, operationId: "LOG-SKILL-CORRECTIONS-001", title: "Log skill corrections", status: "passed", role: "Platform Admin",
    artifacts: [labelScreenshot, credentialScreenshot],
    api: [{ method: "PATCH", path: `${snapshotsPath}/${original.id}`, status: 200 }, { method: "PATCH", path: `${credentialsPath}/${credential.id}`, status: 200 }],
    db: [{ table: "audit_events", predicate: "the selected organization and both corrected targets", observed: "scoped rename events for the platform operator", rowCount: audit.rows.length }],
    audit: audit.rows.map(row => ({ kind: row.kind, metadataSummary: "The actual platform actor and selected organization were verified." })) });
});
