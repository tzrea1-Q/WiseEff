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
useBrowserDiagnostics(test, { expectedApiFailures: [{ method: "POST", path: "/api/v1/log-skills", status: 503 }] });

test("retries the same failed source snapshot by keyboard and preserves failure before storage recovery", async ({ page, request }, testInfo) => {
  await seedAcceptanceRoleMatrix(); const headers = authHeadersForRole("admin");
  const created = await request.post(apiRoute("/api/v1/log-skills"), { headers, data: { name: `源码重试-${Date.now().toString(36)}` } }); expect(created.status()).toBe(201);
  const skill = (await created.json() as { item: AnalysisSkill }).item;
  const zip = new JSZip(); zip.file("src/retry.c", 'pr_warn("retry code=%d\\n", code);\n'); const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const listPath = `/api/v1/log-skills/${skill.id}/source-snapshots`;
  const uploadHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"));
  const uploaded = await request.post(apiRoute(listPath), { headers: uploadHeaders, multipart: { versionLabel: "original-build", file: { name: "source.zip", mimeType: "application/zip", buffer: bytes } } });
  expect(uploaded.status(), await uploaded.text()).toBe(201); const snapshot = (await uploaded.json() as { item: SourceSnapshotDto }).item;
  const path = `${listPath}/${snapshot.id}`;
  const db = createPostgresDatabase(process.env.DATABASE_URL!); const store = createObjectStoreFromEnv(loadServerEnv(process.env));
  const metadata = (await db.query<{ organization_id: string; storage_key: string }>("select organization_id,storage_key from log_source_snapshots where id=$1", [snapshot.id])).rows[0]!;
  const restore = () => store.put({ organizationId: metadata.organization_id, fileName: `${snapshot.id}-source.zip`, contentType: "application/octet-stream", bytes });
  const drive = async (status: SourceSnapshotDto["status"]) => {
    await expect.poll(async () => {
      const listed = await request.get(apiRoute(listPath), { headers }); expect(listed.status()).toBe(200);
      const item = (await listed.json() as { items: SourceSnapshotDto[] }).items.find(item => item.id === snapshot.id)!;
      // Use the existing worker directly when this acceptance runtime has background workers disabled.
      if (item.status === "queued") await processNextSourceIndexJob({ db, objectStore: store });
      return item.status;
    }, { timeout: 30_000 }).toBe(status);
  };
  try {
    await drive("ready");
    const selected = await request.post(apiRoute(`${path}/default`), { headers, data: {} }); expect(selected.status()).toBe(200);
    const draft = (await selected.json() as { item: AnalysisSkill }).item.draft!;
    const published = await request.post(apiRoute(`/api/v1/log-skills/${skill.id}/publish`), { headers, data: { draftRevisionId: draft.id } }); expect(published.status()).toBe(200);
    const publishedId = (await published.json() as { item: AnalysisSkill }).item.currentRevision.id;
    await store.delete!(metadata.storage_key);
    await db.query("update log_source_snapshots set status='queued',index_attempt_id=null where id=$1", [snapshot.id]);
    await drive("failed");
    await signInBrowserAsRole(page, "admin", `/log-admin/skills/${skill.id}?section=source`); await prepareInteractionSurface(page);
    const row = page.getByRole("row").filter({ has: page.getByText("original-build", { exact: true }) });
    await expect(row.getByText("索引失败", { exact: true })).toBeVisible();
    await expect(row.getByText(/原始文件.*对象存储/)).toBeVisible();
    await page.route(`**${path}/retry`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "重新排队暂时不可用，请重试。" } }) }), { times: 1 });
    await row.getByRole("button", { name: "重试索引", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("请重试"); await expect(row.getByText("索引失败", { exact: true })).toBeVisible();
    const failedImage = testInfo.outputPath("source-retry-failed-1440.png"); await page.screenshot({ path: failedImage, animations: "disabled" });
    await testInfo.attach("source-retry-failed-1440", { path: failedImage, contentType: "image/png" });
    expect((await restore()).storageKey).toBe(metadata.storage_key);
    const queued = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${path}/retry`);
    await row.getByRole("button", { name: "重试索引", exact: true }).focus(); await page.keyboard.press("Enter");
    const response = await queued; expect(response.status()).toBe(202); expect((await response.json() as { item: SourceSnapshotDto }).item).toMatchObject({ id: snapshot.id, status: "queued" });
    await drive("ready"); await expect(row.getByText("就绪", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "重试索引", exact: true })).toHaveCount(0);
    const readyImage = testInfo.outputPath("source-retry-ready-1440.png"); await page.screenshot({ path: readyImage, animations: "disabled" });
    await testInfo.attach("source-retry-ready-1440", { path: readyImage, contentType: "image/png" });
    await page.reload(); await expect(page.getByRole("row").filter({ has: page.getByText("original-build", { exact: true }) }).getByText("就绪", { exact: true })).toBeVisible();
    const preserved = await request.get(apiRoute(`/api/v1/log-skills/${skill.id}`), { headers });
    expect((await preserved.json() as { item: AnalysisSkill }).item.currentRevision).toMatchObject({ id: publishedId, spec: { defaultSourceSnapshotId: snapshot.id } });
    expect(await store.get(metadata.storage_key)).toEqual(bytes);
    await signInBrowserAsRole(page, "software-user", `/log-admin/skills/${skill.id}?section=source`);
    await expect(page.getByText("仅供查看；编辑需要技能管理权限。", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "源码快照", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "重试索引", exact: true })).toHaveCount(0);
    expect((await request.post(apiRoute(`${path}/retry`), { headers: authHeadersForRole("software-user"), data: {} })).status()).toBe(403);
  } finally { await restore(); await db.close(); }
});
