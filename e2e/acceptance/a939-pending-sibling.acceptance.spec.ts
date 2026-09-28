import "./helpers/loadAcceptanceEnvironment";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../server/modules/audit/trustedRefusalSink";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { registerCanonicalJsonSource } from "../../server/modules/parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { createCanonicalValueDraft } from "../../server/modules/parameter-bindings/drafts/service";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { startSwappedDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

async function objectInventory(root: string) {
  const names = (await readdir(root, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(root, name);
    return [name, (await stat(path)).isFile() ? (await readFile(path)).toString("base64") : null];
  }));
}

test("#939 blocks a pending sibling JSON request, then allows refreshed batch submission", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  let outcome: "success" | "failure" = "failure";
  const started = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
    label: "a939_pending_sibling", markerPurpose: "a939-pending-sibling"
  });
  const runtime = started.runtime;
  const db = createPostgresDatabase(runtime.databaseUrl);
  const storage = createLocalObjectStore(runtime.objectStoreRoot);
  const api = (path: string) => `${runtime.apiUrl}${path}`;
  const headers = authHeadersForRole("admin");
  const authorHeaders = authHeadersForRole("software-user");
  const network: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (/source-conflicts|parameter-value-change-requests/.test(response.url()))
      network.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
  });
  try {
    const admin = makeTestAuthContext({ userId: acceptanceCast.xuYun.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    const author = makeTestAuthContext({ userId: acceptanceCast.liuMin.userId,
      organizationId: "org-chargelab", permissions: ["parameter:view", "parameter:edit"],
      roles: [{ roleId: "software-user", projectId: "aurora" }] });
    await installConfigurationSourceFixture(db, admin, {
      subjectId: "csub_a939_pending_sibling", schemaId: "wiseeff.a939.pending.sibling"
    });
    const set = await request.post(api("/api/v1/projects/aurora/config-sets"), {
      headers, data: { name: "A #939 pending sibling" }
    });
    expect(set.status(), await set.text()).toBe(201);
    const setId = (await set.json()).item.id as string;
    const fileName = "a939-pending-sibling.json";
    const source = '{"first":{"limit":10},"second":{"limit":20},"third":{"limit":30}}\n';
    const uploaded = await request.post(api("/api/v1/projects/aurora/parameter-files"), {
      headers, data: { fileName, contentBase64: Buffer.from(source).toString("base64") }
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const file = await uploaded.json() as { item: { id: string }; version: { id: string } };
    const fileId = file.item.id;
    const linked = await request.post(api(`/api/v1/projects/aurora/config-sets/${setId}/files`), {
      headers, data: { fileId, role: "base", sortOrder: 0 }
    });
    expect(linked.ok(), await linked.text()).toBe(true);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    let siblingId = "";
    let siblingValueId = "";
    for (const [index, key] of ["first", "second", "third"].entries()) {
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
        projectId: "aurora", configSetId: setId, fileId, fileVersionId: file.version.id,
        configurationSchemaId: "wiseeff.a939.pending.sibling", rootPointer: `/${key}`,
        mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: `/${key}/limit` }],
        invocation: createUserInvocation(admin), requestId: `a939-sibling-register-${index}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      if (key === "third") {
        siblingId = registered.bindings[0]!.id;
        siblingValueId = registered.bindings[0]!.currentValueId;
      }
    }
    const candidate = await request.post(api("/api/v1/projects/aurora/parameter-file-candidates"), {
      headers, data: { fileId, fileName,
        contentBase64: Buffer.from('{"first":{"limit":50},"second":{"limit":60},"third":{"limit":30}}\n').toString("base64") }
    });
    expect(candidate.status(), await candidate.text()).toBe(201);
    const candidateId = (await candidate.json()).item.id as string;
    const base = (await db.query<{ config_revision_id: string }>(
      "select config_revision_id from parameter_catalog.project_parameter_values where id=$1", [siblingValueId])).rows[0]!;
    const draft = await createCanonicalValueDraft(db, author, {
      projectId: "aurora", bindingId: siblingId,
      sourceTarget: { format: "json", sourceText: "99" }, reason: "Pending sibling",
      baseRevisionId: base.config_revision_id, baseCurrentValueId: siblingValueId
    }, { objectStore: storage, invocation: createUserInvocation(author),
      requestId: "a939-pending-sibling-draft", refusalSink: createTrustedRefusalAuditSink(db) });
    const single = await request.post(api(`/api/v2/projects/aurora/parameter-value-drafts/${draft.id}/submit`), {
      headers: authorHeaders, data: { assignedToUserId: acceptanceCast.sunMei.userId }
    });
    expect(single.status(), await single.text()).toBe(201);
    const singleId = (await single.json()).item.id as string;

    const url = `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${setId}&file=${fileId}&sourceMode=candidate&candidate=${candidateId}`;
    const openDialog = async () => {
      await signInBrowserAsRole(page, "admin", url);
      await dismissXiaozeHint(page);
      const inspector = page.getByRole("complementary", { name: "配置检查器" });
      const toggle = page.getByRole("button", { name: "检查器", exact: true });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(inspector.getByRole("list", { name: "来源变更目标" }).getByRole("listitem")).toHaveCount(2);
      await inspector.getByRole("button", { name: "提交 JSON 批量审核" }).click();
      const dialog = page.getByRole("dialog", { name: "提交 JSON 批量来源审核" });
      await dialog.getByRole("textbox", { name: "修改原因" }).fill("Pending sibling browser proof");
      await dialog.getByRole("combobox", { name: "指定软件审核人" }).selectOption(acceptanceCast.sunMei.userId);
      return dialog;
    };
    let dialog = await openDialog();
    const before = await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" });
    const beforeObjects = await objectInventory(runtime.objectStoreRoot);
    const refused = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/parameter-value-change-requests/batches"));
    await dialog.getByRole("button", { name: "一次提交全部 2 项" }).click();
    const refusal = await refused;
    expect(refusal.status()).toBe(409);
    expect(await refusal.json()).toMatchObject({ error: { details: {
      reason: "cohort-draft-pending-review", bindingId: siblingId
    } } });
    await expect(dialog.getByRole("alert")).toContainText("409");
    expect(await captureConfigurationSourceState(db, { organizationId: "org-chargelab", projectId: "aurora" })).toEqual(before);
    expect(await objectInventory(runtime.objectStoreRoot)).toEqual(beforeObjects);
    await page.screenshot({ path: testInfo.outputPath("a939-pending-sibling-blocked-1440x900.png") });

    const withdrawn = await request.post(api(`/api/v2/projects/aurora/parameter-value-change-requests/${singleId}/withdraw`), {
      headers: authorHeaders
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    dialog = await openDialog();
    const submitted = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/parameter-value-change-requests/batches"));
    await dialog.getByRole("button", { name: "一次提交全部 2 项" }).click();
    const resumed = await submitted;
    expect(resumed.status(), await resumed.text()).toBe(201);
    await expect(page.getByRole("article", { name: "批量源文件请求详情" })).toContainText("Pending sibling browser proof");
    expect(network.some((entry) => entry.includes("POST 409") && entry.endsWith("/batches"))).toBe(true);
    expect(network.some((entry) => entry.includes("POST 201") && entry.endsWith("/batches"))).toBe(true);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("a939-pending-sibling-recovered-1440x900.png") });
    await testInfo.attach("pending-sibling-network.txt", { body: Buffer.from(network.join("\n")), contentType: "text/plain" });
    outcome = "success";
  } finally {
    await db.close();
    await started.restore(outcome);
  }
});
