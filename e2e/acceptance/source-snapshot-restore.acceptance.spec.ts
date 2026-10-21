import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import JSZip from "jszip";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { prepareInteractionSurface } from "./helpers/interactionSurface";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { apiRoute } from "./helpers/runtime";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { createObjectStoreFromEnv } from "../../server/objectStoreFactory";
import { loadServerEnv } from "../../server/config/env";
import { processNextSourceIndexJob } from "../../server/modules/logs/sourceIndexWorker";
import type { SourceSnapshotDto } from "../../server/modules/logs/sourceSnapshots";
import type { AnalysisSkill } from "../../src/features/log-skills/types";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [409, 503].map(status => ({ method: "POST", path: "/api/v1/log-skills", status })) });

test("resolves a reused source label and restores the original snapshot by keyboard without changing published defaults", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix(); const headers = authHeadersForRole("admin");
  const created = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name: `源码恢复-${Date.now().toString(36)}` } }); expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  const zip = new JSZip(); zip.file("src/restore.c", 'pr_warn("restore code=%d\\n", code);\n'); const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const listPath = `/api/v1/log-skills/${skill.id}/source-snapshots`;
  const uploadHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"));
  const upload = async () => {
    const response = await request.post(apiRoute(listPath), { headers: uploadHeaders, multipart: { versionLabel: "original-build", file: { name: "source.zip", mimeType: "application/zip", buffer: bytes } } });
    expect(response.status(), await response.text()).toBe(201); return (await response.json() as { item: SourceSnapshotDto }).item;
  };
  const original = await upload(); const path = `${listPath}/${original.id}`;
  const db = createPostgresDatabase(process.env.DATABASE_URL!); const store = createObjectStoreFromEnv(loadServerEnv(process.env));
  const driveReady = async (id: string) => {
    await expect.poll(async () => {
      const response = await request.get(apiRoute(listPath), { headers }); expect(response.status()).toBe(200);
      const item = (await response.json() as { items: SourceSnapshotDto[] }).items.find(item => item.id === id)!;
      // Exercise the existing worker when this acceptance runtime disables background jobs.
      if (item.status === "queued") await processNextSourceIndexJob({ db, objectStore: store });
      return item.status;
    }, { timeout: 30_000 }).toBe("ready");
  };
  try {
    await driveReady(original.id);
    const selected = await request.post(apiRoute(`${path}/default`), { headers, data: {} }); expect(selected.status()).toBe(200);
    const draft = (await selected.json() as { item: AnalysisSkill }).item.draft!;
    const published = await request.post(apiRoute(`/api/v1/log-skills/${skill.id}/publish`), { headers, data: { draftRevisionId: draft.id } }); expect(published.status()).toBe(200);
    const publishedId = (await published.json() as { item: AnalysisSkill }).item.currentRevision.id;
    expect((await request.post(apiRoute(`${path}/archive`), { headers, data: {} })).status()).toBe(200);
    const occupant = await upload(); await driveReady(occupant.id);
    await signInBrowserAsRole(page, "admin", `/log-admin/skills/${skill.id}?section=source`); await prepareInteractionSurface(page);
    const row = (id: string) => page.getByRole("row").filter({ has: page.locator(`[id="source-snapshot-${id}"]`) });
    const originalRow = row(original.id); const occupantRow = row(occupant.id);
    await expect(originalRow.getByText("已归档", { exact: true })).toBeVisible();
    await originalRow.getByRole("button", { name: "恢复快照", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("版本标签");
    const managementLink = page.getByRole("link", { name: "查看占用快照 original-build", exact: true });
    await expect(managementLink).toHaveAttribute("href", `#source-snapshot-${occupant.id}`);
    const conflictImage = testInfo.outputPath("source-restore-conflict-1440.png"); await page.screenshot({ path: conflictImage, animations: "disabled" });
    await testInfo.attach("source-restore-conflict-1440", { path: conflictImage, contentType: "image/png" });
    await managementLink.focus(); await page.keyboard.press("Enter");
    await expect(occupantRow.locator(`[id="source-snapshot-${occupant.id}"]`)).toBeFocused();
    await occupantRow.getByRole("button", { name: "original-build 快照操作：更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await page.getByRole("dialog", { name: "归档源码快照？", exact: true }).getByRole("button", { name: "归档", exact: true }).click();
    await expect(occupantRow.getByText("已归档", { exact: true })).toBeVisible();
    await page.route(`**${path}/restore`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "恢复暂时不可用，请重试。" } }) }), { times: 1 });
    await originalRow.getByRole("button", { name: "恢复快照", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("请重试"); await expect(originalRow.getByText("已归档", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "查看占用快照 original-build", exact: true })).toHaveCount(0);
    const restored = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${path}/restore`);
    await originalRow.getByRole("button", { name: "恢复快照", exact: true }).focus(); await page.keyboard.press("Enter");
    const response = await restored; expect(response.status()).toBe(202); expect((await response.json() as { item: SourceSnapshotDto }).item).toMatchObject({ id: original.id, status: "queued" });
    await driveReady(original.id); await expect(originalRow.getByText("就绪", { exact: true })).toBeVisible();
    await expect(originalRow.getByRole("button", { name: "恢复快照", exact: true })).toHaveCount(0);
    const readyImage = testInfo.outputPath("source-restore-ready-1440.png"); await page.screenshot({ path: readyImage, animations: "disabled" });
    await testInfo.attach("source-restore-ready-1440", { path: readyImage, contentType: "image/png" });
    await page.reload(); await expect(row(original.id).getByText("就绪", { exact: true })).toBeVisible();
    const preserved = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
    expect((await preserved.json() as { item: AnalysisSkill }).item.currentRevision).toMatchObject({ id: publishedId, spec: { defaultSourceSnapshotId: original.id } });
    const metadata = (await db.query<{ storage_key: string }>("select storage_key from log_source_snapshots where id=$1", [original.id])).rows[0]!;
    expect(await store.get(metadata.storage_key)).toEqual(bytes);
    await signInBrowserAsRole(page, "software-user", `/log-admin/skills/${skill.id}?section=source`);
    await expect(page.getByText("仅供查看；编辑需要技能管理权限。", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "源码快照", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "恢复快照", exact: true })).toHaveCount(0);
    expect((await request.post(apiRoute(`${listPath}/${occupant.id}/restore`), { headers: authHeadersForRole("software-user"), data: {} })).status()).toBe(403);
  } finally { await db.close(); }
});
