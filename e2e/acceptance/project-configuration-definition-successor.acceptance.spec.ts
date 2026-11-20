import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import { publishSourceRevisionLifecycleFixture } from "../../server/testing/parameterCatalog/sourceRevision";
import { addConfigSetFile, createConfigSet } from "../../server/modules/parameter-files/configSetService";
import { ingestConfigRevision } from "../../server/modules/parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../server/modules/parameter-bindings/catalogProjectValueSync";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { dismissXiaozeHint } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { startSwappedDisposablePostCutoverRuntime } from "./helpers/semanticBindingFixture";

test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test);

test("opens the successor from a foreign project workbench while editing the pinned property", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const { runtime, restore } = await startSwappedDisposablePostCutoverRuntime(process.env.DATABASE_URL!, {
    catalog: "fixture-owned", label: "config_successor", markerPurpose: "project-configuration-definition-successor"
  });
  let outcome: "success" | "failure" = "failure";
  try {
    await seedAcceptanceRoleMatrix();
    const organizationId = "org-successor-fixture";
    const projectId = "successor-project";
    const userId = "successor-fixture-admin";
    const editor = makeTestAuthContext({ organizationId, userId, roleId: "admin" });
    const db = createPostgresDatabase(runtime.databaseUrl);
    let query: URLSearchParams;
    try {
      await db.query("insert into organizations (id,name) values ($1,'Successor fixture org')", [organizationId]);
      await db.query("insert into users (id,organization_id,name,title) values ($1,$2,'Fixture editor','Editor')", [userId, organizationId]);
      await db.query("insert into projects (id,organization_id,name,code,status) values ($1,$2,'Successor fixture project','SUCCESSOR','initialized')", [projectId, organizationId]);
      await installDriverSourceFixture(db, editor, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Successor fixture",
        driverName: "Acme power", idempotencyKey: "successor-fixture", reason: "Pin the original definition before publishing its recommendation" });
      const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!catalog) throw new Error("Published Catalog fixture unavailable");
      const configSetId = (await createConfigSet(db, editor, { projectId, name: "Successor configuration" })).id;
      const fileName = "successor.dts";
      const content = '/dts-v1/; / { charger { compatible = "acme,power"; iin_max = <31>; }; };';
      const upload = await request.post(`${runtime.apiUrl}/api/v1/projects/${projectId}/parameter-files?organizationId=${organizationId}`,
        { headers: authHeadersForRole("platform-admin"), data: { fileName, contentBase64: Buffer.from(content).toString("base64") } });
      expect(upload.status(), await upload.text()).toBe(201);
      const file = await upload.json() as { item: { id: string }; version: { id: string } };
      await addConfigSetFile(db, editor, { configSetId, fileId: file.item.id, role: "base", sortOrder: 0 });
      const revision = await ingestConfigRevision(db, { organizationId, projectId, configSetId, entryFile: fileName,
        includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: file.item.id, fileVersionId: file.version.id,
          fileName, content, role: "base", sortOrder: 0 }] }, editor);
      await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
        { organizationId, projectId, configSetId, configRevisionId: revision.id }));
      await publishSourceRevisionLifecycleFixture(db, catalog.release, { target: "definition", lifecycle: "deprecated" });
      query = new URLSearchParams({ organizationId, configSet: configSetId, file: file.item.id, node: "charger", property: "iin_max", inspector: "selection" });
    } finally {
      await db.close();
    }

    const route = `/parameter-admin/projects/${projectId}/configuration?${query}`;
    await signInBrowserAsRole(page, "platform-admin", `${runtime.frontendUrl}${route}`);
    await dismissXiaozeHint(page);
    const definition = page.getByRole("region", { name: "参数含义与约束" });
    await expect(definition).toContainText("Input current limit");
    const recommended = definition.getByRole("link", { name: "Minimum input current" });
    await expect(recommended).toHaveAttribute("href", `/parameters/definitions?definitionId=pdef_acme_power_iin_min&organizationId=${organizationId}`);
    await expect(page.getByLabel("当前属性完整值")).toHaveText("<31>");
    const edit = page.getByRole("radio", { name: "编辑" });
    await edit.click();
    await expect(edit).toBeChecked();
    await expect(definition).toContainText("最小 0");
    await page.screenshot({ path: testInfo.outputPath("workbench-successor-1440.png") });
    await recommended.click();
    await expect(page).toHaveURL(url => url.pathname === "/parameters/definitions" && url.searchParams.get("organizationId") === organizationId);
    await expect(page.getByText("Minimum input current", { exact: true }).first()).toBeVisible();
    outcome = "success";
  } finally {
    await restore(outcome);
  }
});
