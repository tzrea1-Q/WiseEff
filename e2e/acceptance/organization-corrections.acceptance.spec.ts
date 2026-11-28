import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "playwright/test";
import { planEvidenceIngest } from "../../server/modules/parameter-governance/evidence";
import { CatalogReleaseId } from "../../server/modules/parameter-catalog-contract";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";

const organization = "org-chargelab";
const structure = `/api/v2/organizations/${organization}/module-structure`;
const reviewPath = `/api/v2/organizations/${organization}/parameter-review-items`;

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);
test.beforeEach(async () => { await seedAcceptanceRoleMatrix(); });

async function exportStructure(request: APIRequestContext) {
  const response = await request.post(apiRoute(`${structure}/exports`), { headers: authHeadersForRole("admin"), data: {} });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test("sets and clears an owned node display alias in Module management", async ({ page, request }, info) => {
  const original = await exportStructure(request);
  const child = original.subjects.find((subject: { ownerSubjectId: string | null; state: string; displayAlias: string | null }) =>
    subject.ownerSubjectId && subject.state === "active" && subject.displayAlias === null);
  expect(child).toBeDefined();
  await signInBrowserAsRole(page, "admin", `/parameter-admin/modules?selectedSubject=${encodeURIComponent(child.subjectId)}`);
  const edit = page.getByRole("button", { name: /^编辑展示别名：/ }).first();
  const dialog = page.getByRole("dialog", { name: /^编辑节点展示别名/ });
  const label = "浏览器验证子节点别名";
  for (const alias of [label, ""]) {
    await expect(edit).toBeEnabled();
    if (alias) await edit.press("Enter");
    else await edit.click();
    await expect(dialog).toContainText("业务归属随所属驱动");
    await expect(dialog.getByRole("combobox", { name: "目标模块" })).toHaveCount(0);
    await dialog.getByRole("textbox", { name: "展示别名" }).fill(alias);
    if (alias) await page.screenshot({ path: info.outputPath("child-alias-1440x900.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "继续确认" }).click();
    const confirm = page.getByRole("dialog", { name: "确认修改展示别名" });
    await confirm.getByRole("checkbox").check();
    await confirm.getByRole("button", { name: "确认修改展示别名" }).click();
    await expect(dialog).toHaveCount(0);
    const exported = await exportStructure(request);
    expect(exported.subjects.find((subject: { subjectId: string }) => subject.subjectId === child.subjectId))
      .toEqual({ ...child, displayAlias: alias || null });
    if (alias) await expect(page.getByText(alias, { exact: true })).toBeVisible();
  }
});

test("corrects a deleted target from structure import preview and shows its copy record", async ({ page, request }, info) => {
  const headers = authHeadersForRole("admin");
  const unique = randomUUID().slice(0, 8);
  const createModule = async (name: string) => {
    const created = await request.post(apiRoute("/api/v1/parameter-modules"), { headers, data: { name } });
    expect(created.status(), await created.text()).toBe(201);
    return (await created.json()).item.id as string;
  };
  const originalId = await createModule(`复制原目标 ${unique}`);
  const targetId = await createModule(`复制新目标 ${unique}`);
  const exported = await exportStructure(request);
  const original = exported.modules.find((entry: { sourceId: string }) => entry.sourceId === originalId);
  const sourceRef = `source-module-${unique}`;
  const document = { ...exported, source: { ...exported.source, organizationId: `source-${unique}`, exportId: `copy-${unique}` },
    modules: [{ ...original, ref: sourceRef, sourceId: sourceRef }], subjects: [], references: [] };
  const first = { mode: "copy", document, mappings: { [sourceRef]: originalId }, resolutions: {} };
  const preview = await request.post(apiRoute(`${structure}/previews`), { headers, data: first });
  expect(preview.status(), await preview.text()).toBe(200);
  const copied = await request.post(apiRoute(`${structure}/applies`), { headers, data: { ...first, token: (await preview.json()).token,
    idempotencyKey: randomUUID(), reason: "Initial mapping" } });
  expect(copied.status(), await copied.text()).toBe(200);
  const deleted = await request.delete(apiRoute(`/api/v1/parameter-modules/${originalId}`), { headers });
  expect(deleted.ok(), await deleted.text()).toBe(true);

  await signInBrowserAsRole(page, "admin", "/parameter-admin/modules");
  await page.getByRole("button", { name: "导入结构" }).click();
  const dialog = page.getByRole("dialog", { name: "导入模块结构" });
  await dialog.getByRole("radio", { name: "复制到当前组织" }).check();
  await dialog.getByTestId("file-drop-zone-input").setInputFiles({ name: "copy-correction.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByRole("alert")).toContainText("已保存的目标已删除或不可用");
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await dialog.getByRole("combobox", { name: `${sourceRef} 的映射纠正目标` }).click();
  await page.getByRole("option", { name: `复用 复制新目标 ${unique} (${targetId})` }).click();
  await expect(dialog.getByText(/后续复制目标：复制新目标/)).toBeVisible();
  await dialog.getByText("查看原有复制记录（1）", { exact: true }).click();
  await expect(dialog.getByText(new RegExp(`${originalId} · 已删除`))).toBeVisible();
  await dialog.getByRole("combobox", { name: `${sourceRef}:name 的冲突选择` }).click();
  await page.getByRole("option", { name: "保留当前" }).click();
  await expect(dialog.getByText("请填写变更原因", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /待解决冲突/ })).toHaveCount(0);
  await dialog.getByLabel("变更原因").fill("核对后改用当前业务模块");
  await dialog.getByText("查看原有复制记录（1）", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("mapping-correction-1440x900.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog.getByRole("status")).toContainText("回执");
  const rerun = await request.post(apiRoute(`${structure}/previews`), { headers, data: { ...first, mappings: {} } });
  expect(await rerun.json()).toMatchObject({ changes: [], conflicts: [], mappings: [{ selected: targetId, history: [
    expect.objectContaining({ moduleId: originalId, available: false }), expect.objectContaining({ moduleId: targetId, available: true }),
  ] }] });
});

test("reopens an out-of-scope decision and follows the linked pending review from the queue", async ({ page, request }, info) => {
  const { source } = await exportStructure(request);
  const propertyKey = `review-reopen-${randomUUID().slice(0, 8)}`;
  await withPgClient(async client => {
    const result = planEvidenceIngest({ organizationId: organization, sourceIdentity: propertyKey,
      catalogReleaseId: CatalogReleaseId(source.catalogReleaseId), matcherRevision: "browser-org-correction",
      matcherOutput: { status: "unknown" }, evidence: { propertyKey }, provenance: null });
    if (!result.ok || result.value.kind !== "review-evidence") throw new Error("Expected review evidence");
    await client.query(`insert into parameter_catalog.parameter_review_evidence
      (id,organization_id,reason,candidate_safe_digest,evidence) values ($1,$2,$3,$4,$5::jsonb)`,
    [`prev_${randomUUID()}`, organization, result.value.reason, result.value.fingerprint, JSON.stringify(result.value.evidence)]);
  });

  await signInBrowserAsRole(page, "admin", "/parameter-admin/specs");
  await page.getByRole("button", { name: /^待审核事项/ }).click();
  const queue = page.getByRole("region", { name: "待审核事项" });
  await queue.getByRole("row").filter({ hasText: propertyKey }).getByRole("button", { name: "处理审核" }).click();
  const editor = page.getByRole("region", { name: "处理审核" });
  const confirm = page.getByRole("dialog", { name: "确认处理审核" });
  const submit = async (reason: string) => {
    await editor.getByRole("textbox", { name: "原因" }).fill(reason);
    await editor.getByRole("button", { name: "继续确认" }).click();
    await confirm.getByRole("checkbox").check();
    await confirm.getByRole("button", { name: "确认处理" }).click();
  };
  await editor.getByRole("radio", { name: "标为范围外" }).check();
  await submit("原结论的理由");
  await expect(editor.getByRole("status").filter({ hasText: "已标为范围外" })).toBeVisible();
  await editor.getByRole("button", { name: "返回待审核事项" }).click();
  await queue.getByRole("combobox", { name: "审核状态" }).click();
  await page.getByRole("option", { name: "范围外记录" }).click();
  await queue.getByRole("row").filter({ hasText: propertyKey }).getByRole("button", { name: "重新提请复核" }).click();
  await expect(editor.getByRole("region", { name: "审核记录" })).toContainText("原结论的理由");
  await page.screenshot({ path: info.outputPath("review-reopen-1440x900.png"), animations: "disabled" });
  await submit("更正范围外判断的理由");
  await expect(editor.getByRole("status").filter({ hasText: "已重新提请复核" })).toBeVisible();
  await editor.getByRole("button", { name: "查看关联复核事项" }).click();
  await expect(editor.getByRole("region", { name: "审核记录" })).toContainText("更正范围外判断的理由");
  await expect(editor.getByRole("button", { name: "查看原审核事项" })).toBeVisible();
  const pending = await request.get(apiRoute(reviewPath), { headers: authHeadersForRole("admin") });
  expect((await pending.json()).items.filter((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === propertyKey))
    .toEqual([expect.objectContaining({ status: "open", reopenedFrom: expect.objectContaining({ reason: "更正范围外判断的理由" }) })]);
});
