import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { catalogAppUrl, test } from "./helpers/catalogFixtureRuntime";
import { CATALOG_EXPECTED_API_FAILURES, catalogJson, catalogScreenshot, dismissXiaozeHint, signInCatalogActor } from "./helpers/catalogBrowser";
import { recordOperationEvidence } from "./helpers/operationEvidence";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { selectControlOption } from "./helpers/selectControl";
import { retiredPowerSubjectSuccessorBundle, refreshReleaseSource, compileOrThrow, X_DEFINITION_ID } from "../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import type { CatalogReleaseNode } from "../../server/modules/catalog-kernel/compiler/types";
import type { CatalogReleasePin } from "../../server/modules/parameter-catalog-contract/index";
import type pg from "pg";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

async function installLibraryFixture(pool: pg.Pool, predecessor: CatalogReleasePin) {
  const bundle = retiredPowerSubjectSuccessorBundle();
  const next = structuredClone(bundle.releases.at(-1)!) as Mutable<CatalogReleaseNode>;
  Object.assign(next.manifest.release, { id: "crel_parlib_read", version: "1.6.0", sequence: 7,
    publishedAt: "2026-09-07T00:00:00Z", predecessor });
  const template = next.documents.find((item) => item.kind === "definition");
  if (!template || template.kind !== "definition") throw new Error("Missing definition template");
  const source = template.source;
  next.documents.push({ source, kind: "subject", normalizedDigest: template.normalizedDigest, content: {
    id: "csub_parlib_config", kind: "configuration-schema", canonicalKey: "configuration-schema:parlib.config",
    lifecycle: "active", selector: { kind: "configuration-schema-id", value: "parlib.config", provenance: { source: source.path } }, subtype: {}, tombstone: null
  } });
  const add = (subjectId: string, selectorKind: "driver-compatible" | "node-type-name" | "configuration-schema-id", key: string) => {
    const item = structuredClone(template);
    Object.assign(item.content, { id: `pdef_${key}`, subjectId, propertyKey: key });
    Object.assign(item.content.revision, { id: `drev_${key}_1`, number: 1, displayName: key,
      documentation: `Published description for ${key}`, matching: { ...item.content.revision.matching, selectorKind, sourceProperty: key } });
    next.documents.push(item);
  };
  for (let index = 0; index < 30; index += 1) add("csub_acme_sensor", "driver-compatible", `parlib_driver_${String(index).padStart(2, "0")}`);
  add("csub_acme_charger", "node-type-name", "parlib_node");
  add("csub_parlib_config", "configuration-schema-id", "parlib_config");
  refreshReleaseSource(next);
  const successor = { ...bundle, targetReleaseId: next.manifest.release.id, releases: [...bundle.releases, next] };
  const compiled = compileOrThrow(successor);
  const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "advance", source: jsonCatalogReleaseSource(successor),
    expectedCurrent: predecessor, expectedTargetDigest: compiled.aggregateDigest });
  if (!installed.ok) throw new Error(`Library fixture install failed: ${installed.error.kind}`);
}

test.use({ viewport: { width: 1440, height: 900 }, catalogRuntimeScope: import.meta.url, catalogRuntimeDatabaseUrl: process.env.TEST_DATABASE_URL });
useBrowserDiagnostics(test, { expectedApiFailures: [...CATALOG_EXPECTED_API_FAILURES,
  { method: "GET", path: `/api/v2/catalog/definitions/${X_DEFINITION_ID}/revisions`, status: 503, exact: true }] });

test("opens a global definition from the library without a project", async ({ page, catalogAcceptanceRuntime }, testInfo) => {
  // @acceptance PARLIB-READ-001
  // @operation PARLIB-READ-001
  const { fixture } = catalogAcceptanceRuntime;
  await installLibraryFixture(fixture.pool, fixture.chain.pinF);
  await signInCatalogActor(page, "org-admin", "/parameter-home");
  await dismissXiaozeHint(page);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "参数库" }).click();
  await expect(page).toHaveURL(/\/parameters\/definitions/);
  await expect(page.getByRole("table", { name: "参数定义列表" })).toBeVisible();
  await selectControlOption(page.getByLabel("每页条数"), "20");
  await expect(page.getByRole("status", { name: "结果计数" })).toContainText("32");
  await expect(page.getByRole("table", { name: "参数定义列表" })).not.toContainText("parlib_driver_29");
  const type = page.getByLabel("主体类型");
  for (const [value, key] of [["driver", "parlib_driver_00"], ["node-type", "parlib_node"], ["configuration-schema", "parlib_config"]]) {
    await selectControlOption(type, value);
    await expect(page.getByRole("table", { name: "参数定义列表" })).toContainText(key);
  }
  await selectControlOption(type, "");
  const search = page.getByRole("searchbox", { name: "搜索参数定义" });
  await search.fill("parlib_driver_29");
  await search.press("Enter");
  await page.getByRole("button", { name: "查看 parlib_driver_29" }).click();
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("未登记");
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("当前发布");
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("Published description for parlib_driver_29");
  await page.getByRole("button", { name: "返回参数库" }).click();
  const response = await catalogJson(page.request, "GET", `/api/v2/catalog/definitions/${fixture.xDefinitionId}?catalogReleaseId=${fixture.chain.pinC.id}`);
  expect(response.status).toBe(200);
  await page.goto(catalogAppUrl(`/parameters/definitions?catalogReleaseId=${fixture.chain.pinC.id}`));
  await expect(page.getByRole("table", { name: "参数定义列表" })).toBeVisible();
  await search.fill("iin_max");
  await search.press("Enter");
  await page.getByRole("button", { name: "查看 iin_max" }).click();
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("iin_max");
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("未登记");
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("历史发布");
  const historyRoute = "**/api/v2/catalog/definitions/*/revisions?*";
  await page.route(historyRoute, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "catalog-not-ready" } }) }));
  await page.getByRole("button", { name: /查看历史/ }).click();
  await expect(page.getByRole("region", { name: "定义详情" })).toContainText("Documented maximum accepted input current.");
  await expect(page.getByText("修订历史读取失败，请重试。")).toBeVisible();
  await page.unroute(historyRoute);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("list", { name: "定义时间线" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "定义时间线" })).toBeVisible();
  await page.getByText(/^修订 #1 · 查看内容/).click();
  await expect(page.getByRole("table", { name: "修订 #1 内容比较" })).toContainText("Maximum accepted input current.");
  await catalogScreenshot(page, testInfo, "parlib-read-definition");
  await recordOperationEvidence({ operationId: "PARLIB-READ-001", title: testInfo.title, status: "passed", page, testInfo,
    assertions: ["ui", "api", "screenshot"], api: [{ method: "GET", path: "/api/v2/catalog/definitions/:definitionId", status: response.status,
      responseSummary: "Published definition read in the fixture Catalog release." }] });
});

// @operation-planned PARLIB-SHARE-001
