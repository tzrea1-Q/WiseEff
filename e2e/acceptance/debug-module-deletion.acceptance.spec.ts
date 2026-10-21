import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { authHeadersForUser, signInBrowserAsUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { apiRoute } from "./helpers/runtime";
import { catalogScreenshot, dismissXiaozeHint } from "./helpers/catalogBrowser";

const expectedApiFailures: ExpectedApiFailure[] = [];
useBrowserDiagnostics(test, { expectedApiFailures });
test.use({ viewport: { width: 1440, height: 900 } });

test("#1319 transfers all nodes once, preserves the stale confirmation target, and exposes concrete child blockers", async ({ page, request }, testInfo) => {
  expectedApiFailures.length = 0;
  const person = acceptanceCast.xuYun, headers = authHeadersForUser(person.userId, person.email, person.name);
  const prefix = `叶子删除-${Date.now().toString(36)}`;
  const createModule = async (name: string, parentId?: string) => {
    const response = await request.post(apiRoute("/api/v1/debugging/admin/modules"), { headers, data: { name, parentId } });
    expect(response.status(), await response.text()).toBe(201); return (await response.json() as { item: { id: string } }).item.id;
  };
  const parentName = `${prefix}-父分类`, sourceName = `${prefix}-原分类`, targetName = `${prefix}-目标`;
  const parentId = await createModule(parentName), sourceId = await createModule(sourceName, parentId), targetId = await createModule(targetName);
  const createNode = async (suffix: string) => {
    const response = await request.post(apiRoute("/api/v1/debugging/admin/nodes"), { headers, data: {
      name: `${prefix}-${suffix}`, moduleId: sourceId, description: "保留节点定义与身份",
      bindings: [{ protocol: "hdc", nodePath: `/sys/1319/${suffix}`, accessMode: "RO" }] } });
    expect(response.status(), await response.text()).toBe(201); return (await response.json() as { item: { id: string } }).item.id;
  };
  const explicitId = await createNode("explicit"), legacyId = await createNode("legacy");
  await withPgClient(client => client.query("update debug_nodes set debug_node_module_id=null,module=$2 where id=$1", [legacyId, ` ${sourceName} `]));
  expectedApiFailures.push({ method: "DELETE", path: `/api/v1/debugging/admin/modules/${sourceId}`, status: 409 });
  await signInBrowserAsUser(page, person.userId, person.email, person.name, "/debugging-admin/nodes");
  await dismissXiaozeHint(page);
  await page.getByRole("button", { name: "模块管理", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索模块" }).fill(prefix);
  const openDelete = async (id: string, name: string) => {
    await page.locator(`[data-module-id="${id}"]`).getByRole("button", { name: `${name} 更多操作` }).click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    return page.getByRole("dialog", { name: `删除调试模块「${name}」`, exact: true });
  };
  const blocked = await openDelete(parentId, parentName);
  await expect(blocked.getByRole("button", { name: `移动「${sourceName}」` })).toBeVisible();
  await expect(blocked.getByRole("button", { name: "迁移节点并删除模块" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(blocked).toBeHidden();
  const dialog = await openDelete(sourceId, sourceName);
  await expect(dialog).toContainText("2 个节点");
  await expect(dialog).toContainText("1 个使用旧名称归属");
  await dialog.getByRole("button", { name: "节点迁移目标" }).click();
  await page.getByRole("tree", { name: "节点迁移目标树形选项" }).getByRole("button", { name: targetName, exact: true }).focus();
  await page.keyboard.press("Enter");
  const confirm = dialog.getByRole("button", { name: "迁移节点并删除模块" });
  await expect(confirm).toBeEnabled();
  const concurrentId = await createNode("concurrent");
  await confirm.focus(); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText(/变化|预览|冲突/);
  await expect(dialog.getByRole("button", { name: "节点迁移目标" })).toContainText(targetName);
  await catalogScreenshot(page, testInfo, "issue1319-stale-target-preserved");
  await dialog.getByRole("button", { name: "重新预览" }).focus(); await page.keyboard.press("Enter");
  await expect(dialog).toContainText("3 个节点");
  await expect(confirm).toBeEnabled();
  await catalogScreenshot(page, testInfo, "issue1319-transfer-confirmation");
  await confirm.focus(); await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(`[data-module-id="${sourceId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-module-id="${targetId}"]`).getByRole("button", { name: "3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.reload();
  await page.getByRole("searchbox", { name: "搜索可调节点" }).fill(prefix);
  for (const suffix of ["explicit", "legacy", "concurrent"]) {
    const row = page.getByRole("row").filter({ has: page.getByText(`${prefix}-${suffix}`, { exact: true }) });
    await expect(row).toContainText(targetName);
  }
  const current = await request.get(apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"), { headers });
  const nodes = (await current.json() as { items: Array<{ id: string; moduleId: string; bindings: Array<{ protocol: string }> }> }).items;
  for (const [id, suffix] of [[explicitId, "explicit"], [legacyId, "legacy"], [concurrentId, "concurrent"]]) {
    expect(nodes.find(node => node.id === id)).toMatchObject({ moduleId: targetId,
      bindings: [expect.objectContaining({ protocol: "hdc", nodePath: `/sys/1319/${suffix}`, accessMode: "RO" })] });
  }
  await catalogScreenshot(page, testInfo, "issue1319-moved-nodes-after-reload");
});
