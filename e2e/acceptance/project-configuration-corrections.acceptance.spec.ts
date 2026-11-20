import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installConfigurationSourceFixture } from "../../server/testing/parameterCatalog/configurationSource";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { openWorkbenchFileActions, openWorkbenchPanel } from "./helpers/runtime";
import { startSwappedDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });

test("corrects project configuration metadata, file path, baseline and JSON instance in the workbench", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const { runtime, restore } = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
    catalog: "fixture-owned", label: "config_corr", markerPurpose: "project-configuration-corrections"
  });
  let outcome: "success" | "failure" = "failure";
  try {
    const db = createPostgresDatabase(runtime.databaseUrl);
    const schema = "wiseeff.corrections.settings";
    try {
      await installConfigurationSourceFixture(db, makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId, organizationId: "org-chargelab"
      }), { subjectId: "csub_corrections_settings", schemaId: schema });
    } finally {
      await db.close();
    }
    const headers = authHeadersForRole("admin");
    const project = "/api/v1/projects/aurora";
    const post = async <T,>(path: string, data: unknown): Promise<T> => {
      const response = await request.post(`${runtime.apiUrl}${path}`, { headers, data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json() as Promise<T>;
    };
    const { item: set } = await post<{ item: { id: string } }>(`${project}/config-sets`, { name: "Correction fixture" });
    const { item: file, version } = await post<{ item: { id: string }; version: { id: string } }>(`${project}/parameter-files`, {
      fileName: "correction.json", contentBase64: Buffer.from('{"old":{"limit":11},"new":{"limit":22}}').toString("base64")
    });
    await post(`${project}/config-sets/${set.id}/files`, { fileId: file.id, role: "base", sortOrder: 0 });
    await post(`/api/v2/projects/aurora/parameter-files/${file.id}/configuration-instances`, {
      configSetId: set.id, fileVersionId: version.id, configurationSchemaId: schema, rootPointer: "/old",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/old/limit" }]
    });
    const gate = await request.get(`${runtime.apiUrl}${project}/config-sets/${set.id}/release-readiness`, { headers });
    expect(gate.ok(), await gate.text()).toBe(true);
    const gateToken = (await gate.json()).item.gateToken as string;
    const { item: baseline } = await post<{ item: { id: string } }>(`${project}/config-sets/${set.id}/baselines`, {
      name: "Draft correction", notes: "Initial note", gateToken
    });
    const pageErrors: string[] = [];
    const unexpectedApi: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && path.startsWith("/api/") && !path.endsWith("/correction/preview")) {
        unexpectedApi.push(`${response.status()} ${path}`);
      }
    });
    const route = `${runtime.frontendUrl}/parameter-admin/projects/aurora/configuration?configSet=${set.id}`;
    await signInBrowserAsRole(page, "admin", `${route}&inspector=config-set`);
    await dismissXiaozeHint(page);
    const files = page.getByRole("dialog", { name: "配置组成", exact: true });
    await files.getByRole("button", { name: "更正配置集资料", exact: true }).click();
    const metadata = page.getByRole("dialog", { name: "更正配置集资料" });
    await metadata.getByLabel("名称", { exact: true }).fill("Corrected configuration");
    await metadata.getByLabel("说明", { exact: true }).fill("Corrected workbench description");
    await metadata.getByRole("button", { name: "保存更正" }).click();
    await expect(files).toContainText("Corrected configuration");

    const versions = await openWorkbenchPanel(page, "release");
    await versions.getByRole("button", { name: /Draft correction/ }).click();
    await versions.getByRole("button", { name: "更正草稿版本资料" }).click();
    const draft = page.getByRole("dialog", { name: "更正草稿版本资料" });
    await draft.getByLabel("名称").fill("Corrected snapshot");
    await draft.getByLabel("备注").fill("Original publication note");
    await draft.getByRole("button", { name: "保存更正" }).click();
    await expect(versions.getByRole("button", { name: /Corrected snapshot/ })).toBeVisible();
    await post(`${project}/baselines/${baseline.id}/release`, { gateToken });
    await page.goto(`${route}&inspector=release&baseline=${baseline.id}`);
    await versions.getByRole("button", { name: "追加版本勘误" }).click();
    const erratum = page.getByRole("dialog", { name: "追加版本勘误" });
    await erratum.getByLabel("勘误说明").fill("Correct the published annotation");
    await erratum.getByLabel("勘误来源").fill("QA correction memorandum");
    const erratumRoute = (url: URL) => url.pathname === `${project}/baselines/${baseline.id}/errata`;
    const sent: string[] = [];
    await page.route(erratumRoute, async route => {
      sent.push(route.request().postDataJSON().clientMutationId);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (sent.length === 1) await route.abort("connectionreset");
      else await route.fulfill({ response });
    });
    await erratum.getByRole("button", { name: "追加勘误" }).click();
    await expect(erratum.getByRole("alert")).toBeVisible();
    await erratum.getByRole("button", { name: "追加勘误" }).click();
    const errata = versions.getByRole("region", { name: "版本勘误" });
    await expect(errata).toContainText("QA correction memorandum");
    await expect(errata.getByText("Correct the published annotation", { exact: true })).toHaveCount(1);
    expect(sent).toEqual([expect.any(String), sent[0]]);
    await page.unroute(erratumRoute);
    await expect(versions.getByText("Original publication note")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("baseline-erratum-retry-1440.png") });
    await versions.getByRole("button", { name: "关闭配置版本" }).click();

    const menu = await openWorkbenchFileActions(page, "correction.json");
    await menu.getByRole("menuitem", { name: "更正文件路径" }).click();
    const move = page.getByRole("dialog", { name: "更正项目文件路径" });
    await move.getByLabel("新路径").fill("settings/corrected.json");
    await move.getByRole("button", { name: "预览更正" }).press("Enter");
    await expect(move.getByRole("region", { name: "更正预览" })).toContainText("correction.json → settings/corrected.json");
    await move.getByLabel("更正原因").fill("Fix the project source directory");
    await page.screenshot({ path: testInfo.outputPath("private-source-path-1440.png") });
    await move.getByRole("button", { name: "确认更正" }).click();
    await expect(files.getByRole("button", { name: "settings/corrected.json", exact: true })).toBeVisible();

    const jsonMenu = await openWorkbenchFileActions(page, "settings/corrected.json");
    await jsonMenu.getByRole("menuitem", { name: "更正 JSON 实例关联" }).click();
    const association = page.getByRole("dialog", { name: "更正 JSON 实例关联" });
    await expect(association.getByRole("list", { name: "现有绑定" })).toContainText("/old/limit");
    await expect(association.getByRole("list", { name: "现有绑定" })).toContainText("11");
    await association.getByLabel("根 JSON Pointer").fill("/missing");
    await association.getByRole("button", { name: "预览更正" }).click();
    await expect(association.getByRole("alert")).toBeVisible();
    await association.getByLabel("根 JSON Pointer").fill("/new");
    await association.getByLabel("字段 JSON Pointer 1").fill("/new/limit");
    await association.getByRole("button", { name: "预览更正" }).click();
    await expect(association.getByRole("list", { name: "目标字段取值" })).toContainText("22");
    await association.getByLabel("更正原因").fill("Use the authored JSON root");
    await page.screenshot({ path: testInfo.outputPath("json-instance-correction-1440.png") });
    await association.getByRole("button", { name: "确认更正" }).click();
    await expect(association).toBeHidden();
    const read = await request.get(`${runtime.apiUrl}/api/v2/projects/aurora/parameter-files/${file.id}/configuration-instances`, { headers });
    expect(read.ok(), await read.text()).toBe(true);
    expect((await read.json()).items).toMatchObject([{ rootPointer: "/new", bindings: [{ pointer: "/new/limit", value: 22 }] }]);
    expect(pageErrors).toEqual([]);
    expect(unexpectedApi).toEqual([]);
    outcome = "success";
  } finally {
    await restore(outcome);
  }
});
