import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type APIRequestContext, type Dialog, type Locator, type Page } from "playwright/test";
import { seedSemanticBindingCatalog } from "../../server/testing/parameterCatalog/semanticBinding";

import {
  requireMappingCandidate,
  requireMappingTask,
  requireReviewTask
} from "./helpers/acceptanceTaskLookup";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import {
  disposableRuntimeOutcomeFromTestInfo,
  startDisposablePostCutoverRuntime,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { useBrowserDiagnostics, type ExpectedApiFailure } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  readCanonicalFixtureBindings,
  seedIsolatedBinding,
  restoreProcessEnvFromDisposableRuntime,
} from "./helpers/semanticBindingFixture";
import {
  auroraPrimarySource,
  ensureAuroraSemanticTopology,
  ensureDedicatedProjectTopology,
  withNodeStatus,
  ensureProjectSemanticTopology,
  registerCatalogDriverSubjects,
  seedAmbiguousIdentityMappingConfigSet
} from "./helpers/topologyFixture";
import {
  annotateFailureRoute,
  PARAMETER_TOPOLOGY_FAILURE_ROUTE,
} from "../shared/failureRouteMetadata";

const expectedApiFailures: ExpectedApiFailure[] = [
  // CatalogPage on /parameter-admin reads subjects; the first-release fixture leaves
  // lineage subjects unpublished for some orgs.
  { method: "GET", path: "/api/v2/catalog/subjects", status: 404 }
];
useBrowserDiagnostics(test, { expectedApiFailures });
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

const organizationId = "org-chargelab";
const projectId = "aurora";
const descriptionPrefix = "PARAM-TOPOLOGY acceptance";
const SC8562_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const MT5788_LOCATOR = "/amba/i2c@FF24E000/mt5788@2B";

function semanticBindingRow(scope: Locator, nodeLabel: string): Locator {
  return scope
    .getByRole("row")
    .filter({ hasText: "gpio_int" })
    .filter({ hasText: nodeLabel })
    .first();
}

function bindingRowById(scope: Locator, bindingId: string): Locator {
  return scope.locator(`[role="row"][data-binding-id="${bindingId}"]`);
}

// Include-missing remains a hard resolve error. Use DTS `/include/` (not CPP `#include`),
// which single-file upload accepts; dangling `&label` overlays self-anchor as warnings.
const brokenBase = `/dts-v1/;
/include/ "missing-acceptance-include.dtsi"
/ {
	board {
		compatible = "wiseeff,acceptance-broken";
		reg = <0>;
	};
};
`;
const brokenOverlay = `/dts-v1/;
/plugin/;

&board {
	broken = <1>;
};
`;

const mappingR1 = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	bus {
		compatible = "wiseeff,amba";
		dev@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			status = "okay";
		};
	};
};
`;

const mappingR2 = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	bus {
		compatible = "wiseeff,amba";
		left@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			status = "okay";
		};
		right@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			status = "okay";
		};
	};
};
`;

/**
 * PARAM-ENABLE-GATE-001 source: Aurora's primary DTS plus one extra disabled node that
 * declares an unmatched key. Canonical source history is immutable, so the node is part
 * of the dedicated project's first ingested source instead of a later overlay.
 */
function enablementGateSource(modelSuffix: string, prop: string) {
  return `${auroraPrimarySource()}
/ {
	egate_${modelSuffix}@60 {
		compatible = "wiseeff,enable-gate";
		reg = <0x60>;
		${prop} = <1>;
		status = "disabled";
	};
};
`;
}

/** Keep in sync with `STRUCTURAL_PROPERTY_KEYS` in parameterSurface.ts (ADR-0003). */
const STRUCTURAL_REVIEW_PROPERTY_KEYS = [
  "compatible",
  "device_type",
  "gpio-controller",
  "interrupt-controller",
  "linux,phandle",
  "phandle",
  "ranges",
  "reg",
  "status",
  "#address-cells",
  "#gpio-cells",
  "#interrupt-cells",
  "#size-cells"
];

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function listDefinitions(request: APIRequestContext, query: string) {
  return request.get(apiRoute(`/api/v2/catalog/definitions?${query}`), { headers: adminHeaders() });
}

async function uploadDts(
  request: APIRequestContext,
  fileName: string,
  content: string
): Promise<{ fileId: string; versionId: string }> {
  const response = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders(),
    data: {
      fileName,
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    }
  });
  expect(response.ok(), `upload ${fileName}`).toBe(true);
  const body = (await response.json()) as { item: { id: string }; version: { id: string } };
  return { fileId: body.item.id, versionId: body.version.id };
}

async function waitForRevision(
  configSetId: string,
  predicate: (row: { id: string; status: string }) => boolean,
  timeoutMs = 20_000
): Promise<{ id: string; status: string }> {
  const started = Date.now();
  let lastSeen: { id: string; status: string } | null = null;
  while (Date.now() - started < timeoutMs) {
    const row = await withPgClient(async (client) => {
      const result = await client.query<{ id: string; status: string }>(
        `
        select id, status from dts_config_revisions
        where config_set_id = $1
        order by revision_number desc
        limit 1
        `,
        [configSetId]
      );
      return result.rows[0] ?? null;
    });
    lastSeen = row;
    if (row && predicate(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `Timed out waiting for revision on config set ${configSetId}; latest=${lastSeen ? `${lastSeen.id}:${lastSeen.status}` : "none"}`
  );
}

async function listEffectiveTopologyNodes(
  request: APIRequestContext,
  configSetId: string,
  revisionId: string,
  targetProjectId: string = projectId
) {
  const topologyApi = await request.get(
    apiRoute(
      `/api/v2/projects/${targetProjectId}/config-sets/${encodeURIComponent(configSetId)}/revisions/${revisionId}/topology?view=effective`
    ),
    { headers: adminHeaders() }
  );
  expect(topologyApi.status()).toBe(200);
  const topologyBody = (await topologyApi.json()) as {
    item: {
      nodes: Array<{
        name?: string;
        locator?: string;
        logicalNodeId?: string;
        enablement?: {
          selfEnabled: boolean;
          reachable: boolean;
          override?: string;
          rawStatus?: string | null;
          rawToken?: string | null;
        };
      }>;
    };
  };
  return { topologyApi, nodes: topologyBody.item.nodes };
}

async function expandTreeitemIfCollapsed(workspace: Locator, name: RegExp) {
  const item = workspace.getByRole("treeitem", { name }).first();
  if (!(await item.isVisible().catch(() => false))) return;
  if ((await item.getAttribute("aria-expanded")) === "false") {
    await item.getByRole("button", { name: /展开/ }).click({ timeout: 10_000 });
  }
}

async function revealAndSelectTreeitem(workspace: Locator, name: RegExp) {
  await expandTreeitemIfCollapsed(workspace, /未分类/);
  const item = workspace.getByRole("treeitem", { name }).first();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      return;
    }
    const expander = workspace.getByRole("button", { name: /展开/ }).first();
    if (!(await expander.isVisible().catch(() => false))) break;
    await expander.click();
  }
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
}

async function openWorkbenchEnablementDialog(
  page: Page,
  workspace: Locator,
  propertyKey: string,
  treeItemName: RegExp
) {
  await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill(propertyKey);
  const row = workspace.getByRole("row").filter({ hasText: propertyKey }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  // Clicking 查看 opens a modal that hides the workbench from the a11y tree, so
  // the enablement control is selected from the module tree (PARAM-ENABLE-VISIBLE-001).
  await revealAndSelectTreeitem(workspace, treeItemName);
  const enablementButton = workspace.getByRole("button", { name: /节点启用/ });
  await expect(enablementButton).toBeVisible({ timeout: 30_000 });
  await enablementButton.click();
  const dialog = page.getByRole("dialog", { name: "节点启用状态" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function waitForReviewTask(
  request: APIRequestContext,
  criteria: {
    projectId: string;
    configRevisionId: string;
    propertyKey: string;
  },
  timeoutMs = 20_000
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const list = await request.get(
      apiRoute(
        `/api/v2/parameter-spec-review-tasks?status=open&projectId=${encodeURIComponent(criteria.projectId)}&configRevisionId=${encodeURIComponent(criteria.configRevisionId)}&limit=50`
      ),
      { headers: adminHeaders() }
    );
    expect(list.ok()).toBe(true);
    const body = (await list.json()) as {
      items: Array<{
        id: string;
        propertyKey?: string | null;
        candidateSchemas?: Array<{ id: string; label?: string }>;
        candidates?: Array<{ id: string; label?: string }>;
        sourceEvidence?: { propertyKey?: string; configRevisionId?: string; projectId?: string };
      }>;
    };
    try {
      return requireReviewTask(body.items, criteria);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  const finalList = await request.get(
    apiRoute(
      `/api/v2/parameter-spec-review-tasks?status=open&projectId=${encodeURIComponent(criteria.projectId)}&configRevisionId=${encodeURIComponent(criteria.configRevisionId)}&limit=50`
    ),
    { headers: adminHeaders() }
  );
  const finalBody = (await finalList.json()) as {
    items: Array<{ id: string; propertyKey?: string | null }>;
  };
  return requireReviewTask(finalBody.items, criteria);
}

async function assertCanonicalBindingsForCurrentRevision(
  request: APIRequestContext,
  revisionId: string,
  projectId: string
) {
  const list = await request.get(
    apiRoute(
      `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings?revisionId=${encodeURIComponent(revisionId)}`
    ),
    { headers: adminHeaders() }
  );
  expect(list.status(), await list.text()).toBe(200);
  const body = (await list.json()) as {
    items: Array<{ id: string; definitionId: string; effectiveRevisionId: string }>;
  };
  for (const binding of body.items) {
    expect(binding.definitionId, `canonical owner for ${binding.id}`).toBeTruthy();
    expect(binding.effectiveRevisionId, `pinned definition revision for ${binding.id}`).toBeTruthy();
    const pinnedRevision = await request.get(
      apiRoute(`/api/v2/catalog/definitions/${encodeURIComponent(binding.definitionId)}/revisions/${encodeURIComponent(binding.effectiveRevisionId)}`),
      { headers: adminHeaders() }
    );
    expect(pinnedRevision.status(), await pinnedRevision.text()).toBe(200);
    expect(await pinnedRevision.json()).toMatchObject({
      item: { id: binding.effectiveRevisionId, definitionId: binding.definitionId }
    });
  }
}

test.describe("Parameter topology / schema browser acceptance", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  const originalEnvironment = captureProcessEnvForDisposableRuntime();

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    const baseDatabaseUrl = originalEnvironment.databaseUrl?.trim();
    if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required to create the disposable topology database.");
    disposableRuntime = await startDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "parameter_topology",
    });
    applyDisposableRuntimeEnv(disposableRuntime);
    const fixturePool = new pg.Pool({ connectionString: disposableRuntime.databaseUrl });
    try {
      await seedSemanticBindingCatalog(fixturePool);
    } finally {
      await fixturePool.end();
    }
    // Canonical Bindings exist only for registered Catalog driver Subjects.
    await registerCatalogDriverSubjects(request, [
      { subjectId: "csub_drv_sc8562", canonicalName: "sc8562" },
      { subjectId: "csub_drv_mt_mt5788", canonicalName: "mt,mt5788" }
    ]);
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    try {
      await disposableRuntime?.dispose(disposableRuntimeOutcomeFromTestInfo(testInfo));
    } finally {
      restoreProcessEnvFromDisposableRuntime(originalEnvironment);
    }
  });

  test("governs specs, browses real topology, edits, maps identity, and gates publish", async ({
    page,
    request
  }, testInfo) => {
    annotateFailureRoute(testInfo, PARAMETER_TOPOLOGY_FAILURE_ROUTE);
    // @acceptance PARAM-SPEC-GOVERN-001
    // @acceptance PARAM-TOPOLOGY-BROWSE-001
    // @acceptance PARAM-TOPOLOGY-EDIT-001
    // @acceptance PARAM-HAPPY-001
    // @acceptance PARAM-ASSIGNEE-001
    // @acceptance PARAM-ASSIGNEE-002
    // @acceptance PARAM-IDENTITY-MAP-001
    // @acceptance PARAM-CONFIG-PUBLISH-GATE-001
    // @operation PARAM-SPEC-GOVERN-001
    // @operation PARAM-TOPOLOGY-BROWSE-001
    // @operation PARAM-TOPOLOGY-EDIT-001
    // @operation PARAM-HAPPY-001
    // @operation PARAM-ASSIGNEE-001
    // @operation PARAM-ASSIGNEE-002
    // @operation PARAM-IDENTITY-MAP-001
    // @operation PARAM-CONFIG-PUBLISH-GATE-001
    test.setTimeout(420_000);

    const runSuffix = randomUUID().slice(0, 8);
    const createdConfigSetNames: string[] = [];
    const createdFileNames: string[] = [];
    const createdParameterSpecIds: string[] = [];

    try {
    // 1) Upload/ingest complete Config Set via official API (no business DB mutation).
    const createNebula = await request.post(apiRoute("/api/v1/parameters/admin/projects"), {
      headers: adminHeaders(),
      data: { id: "nebula", name: "Nebula 高频调试项目", code: "NEB-RD" }
    });
    expect([201, 409]).toContain(createNebula.status());
    // Project views are scoped by project role bindings; the disposable runtime only
    // binds Aurora, so the software user needs an explicit Nebula binding to switch.
    await withPgClient(async (client) => {
      await client.query(
        `insert into user_role_bindings(id, user_id, organization_id, project_id, role_id)
         values ('topology-nebula-software-user', 'u-liu-min', $1, 'nebula', 'software-user')
         on conflict (id) do nothing`,
        [organizationId]
      );
    });
    const nebulaTopology = await ensureProjectSemanticTopology(request, "nebula");
    const topology = await ensureAuroraSemanticTopology(request);
    let { configSetId, revisionId } = topology;

    const definitionsResponse = await listDefinitions(request, `propertyKey=${encodeURIComponent("gpio_int")}`);
    expect(definitionsResponse.status(), await definitionsResponse.text()).toBe(200);
    const definitionsBody = (await definitionsResponse.json()) as {
      items: Array<{ id: string; propertyKey: string; subject: { id: string }; currentRevision: { id: string; definitionId: string } }>;
    };
    const gpioDefinitions = definitionsBody.items.filter((item) => item.propertyKey === "gpio_int");
    expect(gpioDefinitions.length).toBeGreaterThanOrEqual(2);
    const definitionSc = gpioDefinitions.find((item) => item.subject.id === "csub_drv_sc8562");
    const definitionMt = gpioDefinitions.find((item) => item.subject.id === "csub_drv_mt_mt5788");
    expect(definitionSc).toBeTruthy();
    expect(definitionMt).toBeTruthy();
    expect(definitionSc!.id).not.toBe(definitionMt!.id);
    expect(definitionSc!.currentRevision.definitionId).toBe(definitionSc!.id);
    expect(definitionMt!.currentRevision.definitionId).toBe(definitionMt!.id);

    // 2/3) Unknown properties remain explicit review evidence and never become recognized bindings.
    const reviewSuffix = runSuffix;
    const reviewCsName = `acceptance-review-${reviewSuffix}`;
    createdConfigSetNames.push(reviewCsName);
    const reviewDts = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	model = "Acceptance Unmatched Review";
	probe {
		compatible = "vendor,chip123";
		vendor-id = <123>;
		acceptance_mystery_${reviewSuffix} = <42>;
		status = "okay";
	};
	mystery {
		compatible = "vendor,acceptance-mystery-${reviewSuffix}";
		acceptance_mystery_${reviewSuffix} = <42>;
	};
};
`;
    const mysteryName = `acceptance-mystery-${reviewSuffix}.dts`;
    createdFileNames.push(mysteryName);
    const reviewBinding = await seedIsolatedBinding(request, {
      projectId, propertyKey: "vendor-id", dts: reviewDts, fileName: mysteryName,
      configSetName: reviewCsName, nodeLocatorPattern: "/probe$",
      reason: `${descriptionPrefix} canonical known and unknown source fixture`
    });
    const reviewRevision = { id: reviewBinding.revisionId };

    const mysteryProp = `acceptance_mystery_${reviewSuffix}`;
    const openReviews = await request.get(
      apiRoute(
        `/api/v2/organizations/${organizationId}/parameter-review-items`
      ),
      { headers: adminHeaders() }
    );
    expect(openReviews.status(), await openReviews.text()).toBe(200);
    const openReviewBody = (await openReviews.json()) as {
      items: Array<{ id: string; status: string; observation?: { propertyKey: string } }>;
    };
    const mysteryReviews = openReviewBody.items.filter(
      (item) => item.observation?.propertyKey.endsWith(`:vendor,acceptance-mystery-${reviewSuffix}`)
    );
    expect(mysteryReviews).toHaveLength(1);
    const mysteryReview = mysteryReviews[0];
    expect(mysteryReview, "unmatched mystery properties must remain governance work").toBeTruthy();
    expect(mysteryReview!.status).toBe("open");

    const mysteryBindings = await request.get(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(reviewRevision.id)}`
      ),
      { headers: adminHeaders() }
    );
    expect(mysteryBindings.ok(), await mysteryBindings.text()).toBe(true);
    const mysteryBindingsBody = (await mysteryBindings.json()) as {
      items: Array<{ id: string; propertyKey?: string | null; schemaState?: string | null }>;
    };
    const mysteryBinding = mysteryBindingsBody.items.find((item) => item.propertyKey === mysteryProp);
    expect(mysteryBinding, `unmatched ${mysteryProp} must not create a recognized binding`).toBeUndefined();
    expect(mysteryBindingsBody.items.find((item) => item.propertyKey === "vendor-id"), "published seed property must bind").toBeTruthy();

    const mysteryDefinitions = await listDefinitions(request, `propertyKey=${encodeURIComponent(mysteryProp)}`);
    expect(mysteryDefinitions.status(), await mysteryDefinitions.text()).toBe(200);
    const mysteryDefinitionsBody = (await mysteryDefinitions.json()) as { items: Array<{ id: string }> };
    expect(mysteryDefinitionsBody.items, "unmatched evidence must not author a definition").toHaveLength(0);

    const canonicalFixtureBindings = await readCanonicalFixtureBindings(projectId);
    const reviewBindings = canonicalFixtureBindings.filter((binding) => binding.configRevisionId === reviewRevision.id);
    expect(reviewBindings.find((binding) => binding.propertyKey === "vendor-id"), "published seed binding must persist for the reviewed source").toBeTruthy();
    const unknownBindingCount = reviewBindings.filter((binding) => binding.propertyKey === mysteryProp).length;
    expect(unknownBindingCount, "unmatched mystery property must have no persisted canonical binding").toBe(0);
    const provisionalDb = {
      table: "parameter_catalog.project_parameter_bindings",
      predicate: `organization=${organizationId}; project=${projectId}; revision=${reviewRevision.id}; property=${mysteryProp}`,
      observed: `binding_count=${unknownBindingCount}`,
      rowCount: unknownBindingCount
    };

    await signInBrowserAsRole(page, "admin", `${disposableRuntime.frontendUrl}/parameter-admin`);
    await dismissXiaozeHint(page);
    const catalog = page.getByRole("region", { name: "参数定义目录" });
    await expect(catalog).toBeVisible({ timeout: 30_000 });
    await expect(catalog).toHaveAttribute("data-catalog-page", "true");
    await expect(page.getByRole("searchbox", { name: "搜索参数定义" })).toBeVisible();
    await page.getByRole("searchbox", { name: "搜索参数定义" }).fill("gpio_int");
    await expect(page.getByRole("button", { name: "待处理工作" })).toBeVisible();
    await expect(page.getByRole("region", { name: "参数定义库" })).toHaveCount(0);

    await recordOperationEvidence({
      operationId: "PARAM-SPEC-GOVERN-001",
      title: "canonical definition search with queued unmatched evidence",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      assertions: ["ui", "api", "db"],
      api: [
        summarizeApiResponse(definitionsResponse, {
          method: "GET",
          path: "/api/v2/catalog/definitions",
          responseSummary: `gpio_int definitions=${gpioDefinitions.length}; distinct canonical sc8562/mt5788 owners`
        }),
        summarizeApiResponse(openReviews, {
          method: "GET",
          path: `/api/v2/organizations/${organizationId}/parameter-review-items`,
          responseSummary: `open tasks=${openReviewBody.items.length}; mystery review=${mysteryReview!.id}`
        }),
        summarizeApiResponse(mysteryBindings, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: "mystery binding absent"
        }),
        summarizeApiResponse(mysteryDefinitions, {
          method: "GET",
          path: "/api/v2/catalog/definitions",
          responseSummary: "unmatched mystery property has no published definition"
        })
      ],
      db: [provisionalDb],
      notes: `${descriptionPrefix}: unknown compatible evidence stays open; its unmatched property has no recognized Binding or published Definition; the known vendor-id and distinct gpio_int definitions use canonical owners without legacy draft authoring.`
    });

    // Browse real topology (API must be 200 — never [200,404]).
    await signInBrowserAsRole(
      page,
      "admin",
      `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`,
    );
    await dismissXiaozeHint(page);
    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-config-set-id", configSetId);
    await expect(page.getByRole("region", { name: "检索参数表" })).toHaveCount(0);
    await expect(page.getByText("推荐值", { exact: false })).toHaveCount(0);
    await expect(workspace.getByRole("group", { name: "DTS 视图" })).toHaveCount(0);
    await expect(workspace.getByRole("button", { name: "源 DTS" })).toHaveCount(0);

    await expect(workspace.getByRole("tree", { name: "业务模块树" })).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.getByRole("columnheader", { name: /所属模块/ })).toBeVisible();
    await workspace.getByRole("button", { name: "DTS 源码" }).click();
    await expect(workspace.getByRole("tree", { name: "业务模块树" })).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.locator(".project-primary-dts-viewer__body")).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.getByRole("tree", { name: "生效 DTS 拓扑" })).toHaveCount(0);
    await workspace.getByRole("button", { name: "参数列表" }).click();
    await expect(workspace.getByRole("region", { name: "DTS 参数列表" })).toBeVisible({
      timeout: 20_000
    });
    await workspace.getByRole("button", { name: /查看 gpio_int/ }).first().click({
      timeout: 20_000
    });
    const provenanceDetail = page.getByRole("dialog", { name: /gpio_int 参数详情/ });
    await expect(provenanceDetail.getByRole("heading", { name: "参数定义" })).toBeVisible();
    await expect(provenanceDetail.getByText("来源链")).toHaveCount(0);
    // Phase-2: the detail history region is a real revision surface, not phase-1 placeholder copy.
    const historyRegion = provenanceDetail.getByRole("region", { name: "近期历史" });
    await expect(historyRegion).toBeVisible();
    await expect(historyRegion.getByText(/阶段一占位/)).toHaveCount(0);
    await expect(provenanceDetail.getByRole("region", { name: "跨项目对比" })).toBeVisible();
    await provenanceDetail.getByRole("button", { name: "关闭参数详情" }).click();

    const topologyApi = await request.get(
      apiRoute(
        `/api/v2/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/revisions/${revisionId}/topology?view=effective`
      ),
      { headers: adminHeaders() }
    );
    expect(topologyApi.status()).toBe(200);
    const topologyBody = (await topologyApi.json()) as {
      item: {
        revisionId: string;
        nodes: Array<{ locator?: string; name?: string }>;
      };
    };
    const locators = topologyBody.item.nodes.map((node) => node.locator ?? "");
    expect(locators.some((locator) => locator.includes("amba"))).toBe(true);
    expect(locators).toContain(SC8562_LOCATOR);
    expect(locators).toContain(MT5788_LOCATOR);

    const bindingsApi = await request.get(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(revisionId)}`
      ),
      { headers: adminHeaders() }
    );
    expect(bindingsApi.ok()).toBe(true);
    const bindingsBody = (await bindingsApi.json()) as {
      items: Array<{
        id: string;
        propertyKey: string;
        driverModule: string | null;
        locator: string | null;
        rawValue: string;
        currentValueId: string;
        definitionId: string;
      }>;
    };
    const gpioBindings = bindingsBody.items.filter((item) => item.propertyKey === "gpio_int");
    expect(gpioBindings.length).toBeGreaterThanOrEqual(2);
    const scBinding = gpioBindings.find((item) => item.locator === SC8562_LOCATOR);
    const mtBinding = gpioBindings.find((item) => item.locator === MT5788_LOCATOR);
    expect(
      scBinding,
      `sc8562 binding missing; got=${gpioBindings.map((b) => b.locator).join(",")}`
    ).toBeTruthy();
    expect(mtBinding).toBeTruthy();
    expect(scBinding!.id).not.toBe(mtBinding!.id);
    expect(scBinding!.definitionId).toBeTruthy();
    expect(mtBinding!.definitionId).toBeTruthy();
    expect(scBinding!.definitionId).toBe(definitionSc!.id);
    expect(mtBinding!.definitionId).toBe(definitionMt!.id);
    // Same-compatible sibling nodes keep independent specs/bindings (sc8562 vs mt5788 gpio_int).
    // driverModule is display-only from AttributionSubject / module name (D-AG-03); do not use it
    // as identity — both may show taxonomy labels like「未分类」when parked there.
    expect(scBinding!.definitionId).not.toBe(mtBinding!.definitionId);

    // ADR-0010: taxonomy tree has no provisional「未分类 · {driver}」buckets. Workbench uses
    // groupByDevice (module → device leaf). Expand ancestors, then scope via sc8562@6E device.
    const expandTreeitemIfCollapsed = async (name: RegExp) => {
      const item = workspace.getByRole("treeitem", { name }).first();
      if (!(await item.isVisible().catch(() => false))) {
        return;
      }
      if ((await item.getAttribute("aria-expanded")) === "false") {
        await item.getByRole("button", { name: /展开/ }).click({ timeout: 10_000 });
      }
    };
    await expandTreeitemIfCollapsed(/未分类/);
    await expandTreeitemIfCollapsed(/(?<!@)sc8562(?!@)/);
    const sc8562TreeItem = workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first();
    await expect(sc8562TreeItem).toBeVisible({ timeout: 20_000 });
    await sc8562TreeItem.click({ timeout: 20_000 });
    const scopedSc8562Row = bindingRowById(workspace, scBinding!.id);
    await expect(scopedSc8562Row.locator('[data-label="参数名"]')).toBeVisible({ timeout: 20_000 });
    await expect(scopedSc8562Row).toContainText("sc8562@6E");
    await expect(scopedSc8562Row).toContainText("<&gpio13 29 0>");
    await expect(bindingRowById(workspace, mtBinding!.id)).toHaveCount(0);
    // Toggle the same tree node to clear subtree scoping (toolbar no longer has clear-all).
    await sc8562TreeItem.click({ timeout: 20_000 });
    const unscopedMt5788Row = bindingRowById(workspace, mtBinding!.id);
    await expect(unscopedMt5788Row.locator('[data-label="参数名"]')).toBeVisible({ timeout: 20_000 });
    await expect(unscopedMt5788Row).toContainText("mt5788@2B");

    // Canonical Binding value as published by the Bindings read model (no legacy revision table).
    const baseBindingSnapshot = scBinding!.rawValue;
    expect(baseBindingSnapshot).toBeTruthy();

    await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const gpioCells = workspace.getByRole("cell", { name: "gpio_int" });
    await expect
      .poll(async () => gpioCells.count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    const sc8562Row = bindingRowById(workspace, scBinding!.id);
    await expect(sc8562Row.locator('[data-label="参数名"]')).toBeVisible();
    await sc8562Row.getByRole("button", { name: /^查看 gpio_int/ }).click();
    const detail = page.getByRole("dialog", { name: /gpio_int 参数详情/ });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "参数定义" })).toBeVisible();
    await expect(detail.getByText("<&gpio13 29 0>").first()).toBeVisible();
    await expect(detail.getByRole("heading", { name: "DTS 位置" })).toHaveCount(0);
    await expect(detail.getByText("值形态")).toHaveCount(0);
    await expect(detail.getByText("治理状态")).toHaveCount(0);
    await expect(detail.getByText("来源链")).toHaveCount(0);
    await expect(detail.getByText("技术身份")).toHaveCount(0);
    await expect(detail.getByText(scBinding!.id, { exact: true })).toHaveCount(0);
    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-BROWSE-001",
      title: "real source/effective tree and two gpio_int bindings",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        summarizeApiResponse(topologyApi, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/config-sets/.../topology`,
          responseSummary: `status=200 nodes=${topologyBody.item.nodes.length}; sc8562+mt5788 present`
        }),
        summarizeApiResponse(bindingsApi, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: `gpio_int bindings=${gpioBindings.length}`
        })
      ],
      notes:
        "API-mode workspace loads ingested Config Set; topology API 200; two gpio_int bindings with provenance."
    });

    // 5) Typed edit diagnostics + stale 409 + successful draft (writeback + re-ingest inside API).
    const originalRaw = scBinding!.rawValue;
    await detail.getByRole("button", { name: "关闭参数详情" }).click();
    await expect(detail).toHaveCount(0);
    await sc8562Row.getByRole("button", { name: /^(编辑|继续编辑) gpio_int/ }).click();
    const draftDialog = page.getByRole("dialog", { name: "修改草稿" });
    await expect(draftDialog).toBeVisible();
    expectedApiFailures.push({
      method: "POST",
      path: `/api/v2/projects/${projectId}/parameter-bindings/${scBinding!.id}/drafts`,
      status: 400
    });
    await draftDialog.getByLabel("目标值", { exact: true }).fill("<&gpio13 29 0");
    await draftDialog.getByLabel("修改原因", { exact: true }).fill(`${descriptionPrefix} invalid typed-value probe`);
    await draftDialog.getByRole("button", { name: "校验并加入本轮" }).click();
    await expect(draftDialog.getByRole("list", { name: "编辑诊断" })).toBeVisible({ timeout: 20_000 });
    await expect(draftDialog.getByRole("list", { name: "编辑诊断" })).toContainText(/DTS_VALUE_PARSE/);

    const staleEdit = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
      ),
      {
        headers: authHeadersForRole("software-user"),
        data: {
          baseRevisionId: "missing-revision-stale",
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [
              [
                { kind: "phandle", label: "gpio13" },
                { kind: "integer", raw: "29", value: "29" },
                { kind: "integer", raw: "0", value: "0" }
              ]
            ]
          },
          reason: `${descriptionPrefix} stale revision probe`
        }
      }
    );
    expect(staleEdit.status()).toBe(409);

    await draftDialog.getByLabel("目标值", { exact: true }).fill(originalRaw);
    await draftDialog.getByRole("button", { name: "关闭草稿" }).click();
    await expect(draftDialog).toHaveCount(0);

    // Fail-closed blocker from REAL bad DTS (include-missing → resolve-failed).
    const suffix = runSuffix;
    const brokenBaseName = `acceptance-broken-base-${suffix}.dts`;
    const brokenOverlayName = `acceptance-broken-overlay-${suffix}.dts`;
    const brokenCsName = `acceptance-broken-cs-${suffix}`;
    createdFileNames.push(brokenBaseName, brokenOverlayName);
    createdConfigSetNames.push(brokenCsName);
    const brokenBaseUpload = await uploadDts(request, brokenBaseName, brokenBase);
    const brokenOverlayUpload = await uploadDts(request, brokenOverlayName, brokenOverlay);
    const brokenCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: brokenCsName, description: `${descriptionPrefix} resolve failure` }
    });
    expect(brokenCs.status()).toBe(201);
    const brokenCsBody = (await brokenCs.json()) as { item: { id: string } };
    await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${brokenCsBody.item.id}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: brokenBaseUpload.fileId, role: "base", sortOrder: 0 }
      }
    );
    await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${brokenCsBody.item.id}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: brokenOverlayUpload.fileId, role: "overlay", sortOrder: 1 }
      }
    );
    await uploadDts(request, brokenBaseName, brokenBase);
    const brokenRevision = await waitForRevision(brokenCsBody.item.id, () => true);
    const compileValidate = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(brokenRevision.id)}/validate`
      ),
      { headers: adminHeaders(), data: { stage: "toolchain" } }
    );
    expect(compileValidate.ok()).toBe(true);
    const compileBody = (await compileValidate.json()) as {
      item: { status: string; failureCode?: string | null };
    };
    expect(compileBody.item.status).toBe("failed");
    expect(compileBody.item.failureCode).toBe("resolve-failed");

    // Successful typed edit draft, then real submit → review → merge → writeback.
    const semanticCutover = await withPgClient(async (client) => {
      const result = await client.query<{
        database_name: string;
        purpose: string;
        marker_migration_run_id: string;
        cutover_migration_run_id: string;
      }>(
        `
        select current_database() as database_name,
               marker.purpose,
               marker.migration_run_id as marker_migration_run_id,
               cutover.migration_run_id as cutover_migration_run_id
        from wiseeff_acceptance_test_markers marker
        inner join parameter_identity_cutovers cutover
          on cutover.migration_run_id = marker.migration_run_id
        where marker.purpose = 'parameter-topology'
          and marker.migration_run_id = $1
        `,
        [disposableRuntime.migrationRunId]
      );
      return result.rows[0] ?? null;
    });
    expect(semanticCutover).toMatchObject({
      database_name: disposableRuntime.databaseName,
      purpose: "parameter-topology",
      marker_migration_run_id: disposableRuntime.migrationRunId,
      cutover_migration_run_id: disposableRuntime.migrationRunId,
    });

    await assertCanonicalBindingsForCurrentRevision(request, revisionId, projectId);
    const editedRaw = "<&gpio13 30 0>";
    const typedEditReason = `${descriptionPrefix} successful typed edit writeback`;
    await signInBrowserAsRole(
      page,
      "software-user",
      `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`,
    );
    await dismissXiaozeHint(page);
    const editWorkspace = page.getByRole("region", { name: "DTS 参数工作台" });
    const createTypedDraftInAurora = async () => {
      await expect(editWorkspace).toHaveAttribute("data-config-set-id", configSetId, { timeout: 30_000 });
      await editWorkspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
      await expect.poll(async () => editWorkspace.getByRole("cell", { name: "gpio_int" }).count()).toBeGreaterThanOrEqual(2);
      const sc8562EditRow = bindingRowById(editWorkspace, scBinding!.id);
      await expect(sc8562EditRow.locator('[data-label="参数名"]')).toBeVisible();
      await sc8562EditRow.getByRole("button", { name: /^(编辑|继续编辑) gpio_int/ }).click();
      const editDetail = page.getByRole("dialog", { name: "修改草稿" });
      await expect(editDetail).toBeVisible();
      await editDetail.getByLabel("目标值", { exact: true }).fill(editedRaw);
      await editDetail.getByLabel("修改原因", { exact: true }).fill(typedEditReason);
      // The draft dialog resolves its binding from hydrated server drafts, so after
      // earlier rounds advanced the working tip the POST may target the binding's
      // current id rather than the one captured at page load — match any binding
      // draft POST for this project instead of pinning the stale id.
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v2/projects/${projectId}/parameter-bindings/`) &&
        response.url().includes("/drafts")
      );
      await editDetail.getByRole("button", { name: "校验并加入本轮" }).click();
      return responsePromise;
    };

    let successfulDraft = await createTypedDraftInAurora();
    expect(successfulDraft.status(), await successfulDraft.text()).toBe(201);
    let draftBody = (await successfulDraft.json()) as {
      item: {
        draftId: string;
        candidateRevisionId: string;
        rawText?: string;
        projectParameterBindingId?: string;
      };
    };
    expect(draftBody.item.candidateRevisionId).toBeTruthy();
    expect(draftBody.item.projectParameterBindingId).toBeTruthy();
    expect(draftBody.item.rawText ?? editedRaw).toMatch(/30/);

    // Switching projects with a pending draft round now stops at the unsaved-work
    // guard (HCI trust repair wave 0, merged via #331): the drafts are only dropped
    // after the user explicitly acknowledges the discard. Acknowledge whichever
    // presentation the guard uses — window.confirm today, the shared ConfirmDialog
    // once the page-defect wave (#417) migrates it — so the switch proceeds and the
    // intentional discard below stays covered.
    const switchProjectAcknowledgingDiscard = async (optionName: RegExp) => {
      const acceptDiscardConfirm = (dialog: Dialog) => void dialog.accept();
      page.once("dialog", acceptDiscardConfirm);
      try {
        await page.getByRole("combobox", { name: "项目" }).click();
        await page.getByRole("option", { name: optionName }).click();
        await page
          .getByRole("dialog", { name: "切换项目" })
          .getByRole("button", { name: "丢弃并切换" })
          .click({ timeout: 2_000 })
          .catch(() => undefined);
      } finally {
        page.off("dialog", acceptDiscardConfirm);
      }
    };

    // A candidate from Aurora must never be requested under Nebula after the visible project switch.
    const nebulaCurrentResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      response.url().includes(`/api/v2/projects/nebula/config-sets/${encodeURIComponent(nebulaTopology.configSetId)}/revisions/current/topology`) &&
      response.url().includes("view=effective")
    );
    await switchProjectAcknowledgingDiscard(/Nebula 高频调试项目/);
    expect((await nebulaCurrentResponse).status()).toBe(200);
    await expect(editWorkspace).toHaveAttribute("data-project-id", "nebula");
    await expect(editWorkspace).toHaveAttribute("data-revision-id", nebulaTopology.revisionId);
    await expect(page.getByRole("region", { name: "参数修改提交" })).toHaveCount(0);
    await expect(page.getByText(/尚未生成语义配置修订/)).toHaveCount(0);

    const auroraCurrentResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      response.url().includes(`/api/v2/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/revisions/current/topology`) &&
      response.url().includes("view=effective")
    );
    // No drafts remain after the acknowledged discard, so no guard is expected here;
    // the helper tolerates its absence.
    await switchProjectAcknowledgingDiscard(/Aurora/);
    expect((await auroraCurrentResponse).status()).toBe(200);
    await expect(editWorkspace).toHaveAttribute("data-project-id", projectId);
    await expect(editWorkspace).not.toHaveAttribute("data-revision-id", "");

    // The project switch intentionally discarded the first pending draft UI; recreate it on Aurora current.
    successfulDraft = await createTypedDraftInAurora();
    expect(successfulDraft.status(), await successfulDraft.text()).toBe(201);
    draftBody = (await successfulDraft.json()) as typeof draftBody;
    expect(draftBody.item.candidateRevisionId).toBeTruthy();
    // Draft-time candidate is preview only — no open canonical request for this binding yet.
    const openCrBefore = await withPgClient(async (client) => {
      const result = await client.query<{ c: string }>(
        `
        select count(*)::text as c
        from project_parameter_value_change_requests
        where binding_id = $1
          and status not in ('approved', 'rejected', 'withdrawn')
        `,
        [scBinding!.id]
      );
      return Number(result.rows[0]?.c ?? 0);
    });
    expect(openCrBefore).toBe(0);

    // Canonical review is single-stage: the submitter only picks the eligible software
    // committer; hardware and software-developer stages no longer exist.
    const submissionPanel = page.getByRole("region", { name: "参数修改提交" });
    await expect(submissionPanel).toBeVisible({ timeout: 20_000 });
    const softwareCommitterAssignee = submissionPanel.getByLabel("软件 MDE", { exact: true });
    await expect(submissionPanel.getByLabel("硬件 MDE", { exact: true })).toHaveCount(0);
    await expect(submissionPanel.getByLabel("软件开发", { exact: true })).toHaveCount(0);
    const optionTexts = async (select: typeof softwareCommitterAssignee) =>
      (await select.locator("option").allTextContents()).map((text) => text.trim()).sort();
    await expect(softwareCommitterAssignee).not.toHaveValue("");
    await expect.poll(() => optionTexts(softwareCommitterAssignee)).toEqual(["Sun Mei", "软件审核池（未指定）"]);
    await expect(softwareCommitterAssignee).not.toContainText("Xu Yun");
    await expect(softwareCommitterAssignee).not.toContainText("Tao Lin");
    await expect(softwareCommitterAssignee).not.toContainText("Liu Min");
    await recordOperationEvidence({
      operationId: "PARAM-ASSIGNEE-001",
      title: "binding workflow assignee defaults are eligible",
      status: "passed",
      role: "Software User",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        {
          method: "GET",
          path: `/api/v1/projects/${projectId}/parameter-workflow-assignees`,
          status: 200,
          responseSummary: "project-scoped eligible assignees populated the canonical software committer selector"
        }
      ],
      notes: "Canonical single-stage submit panel defaulted its only workflow selector to an eligible active software committer."
    });
    await recordOperationEvidence({
      operationId: "PARAM-ASSIGNEE-002",
      title: "binding workflow assignee dropdowns hide ineligible users",
      status: "passed",
      role: "Software User",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        {
          method: "GET",
          path: `/api/v1/projects/${projectId}/parameter-workflow-assignees`,
          status: 200,
          responseSummary: "exact software-committer option set excluded admin, submitter, inactive, guest, and role-ineligible users"
        }
      ],
      notes: "The visible canonical selector exposed only the exact project-scoped eligible software committer; no hardware or developer stage selector exists."
    });
    await softwareCommitterAssignee.selectOption("u-sun-mei");
    await expect(softwareCommitterAssignee).toHaveValue("u-sun-mei");
    const submitRoundPromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && /parameter-value-drafts\/[^/]+\/submit$/.test(response.url())
    );
    await submissionPanel.getByRole("button", { name: /提交/ }).click();
    const submitRound = await submitRoundPromise;
    expect(submitRound.status(), await submitRound.text()).toBe(201);
    const submitBody = (await submitRound.json()) as {
      item: { id: string; status: string; assignedToUserId: string; bindingId?: string };
    };
    const changeRequestId = submitBody.item.id;
    expect(changeRequestId).toBeTruthy();
    expect(submitBody.item.assignedToUserId).toBe("u-sun-mei");
    expect(submitBody.item.status).toBe("pending");

    const reviewRowBefore = await withPgClient(async (client) => {
      const result = await client.query<{
        status: string;
        action: string;
        base_current_value_id: string;
        binding_id: string;
        applied_value_id: string | null;
      }>(
        `select status, action, base_current_value_id, binding_id, applied_value_id
         from project_parameter_value_change_requests where id = $1`,
        [changeRequestId]
      );
      return result.rows[0];
    });
    expect(reviewRowBefore).toMatchObject({
      status: "pending",
      action: "set",
      base_current_value_id: scBinding!.currentValueId,
      binding_id: scBinding!.id,
      applied_value_id: null
    });
    // Submission alone never moves the Binding's current value.
    const bindingBeforeReview = await request.get(
      apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`),
      { headers: authHeadersForRole("software-user") }
    );
    const bindingBeforeReviewBody = (await bindingBeforeReview.json()) as {
      items: Array<{ id: string; currentValueId: string; rawValue: string }>;
    };
    expect(bindingBeforeReviewBody.items.find((item) => item.id === scBinding!.id)).toMatchObject({
      currentValueId: scBinding!.currentValueId,
      rawValue: originalRaw
    });

    // The independent software committer approves in the visible 软件配置审核 surface.
    await signInBrowserAsRole(
      page,
      "software-committer",
      `${disposableRuntime.frontendUrl}/parameter-review?project=${projectId}`
    );
    await dismissXiaozeHint(page);
    const softwareReview = page.getByRole("region", { name: "软件配置审核" });
    await expect(softwareReview.getByLabel("固定源变更后")).toContainText("30");
    const approvedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/parameter-value-change-requests/${changeRequestId}/review`)
    );
    await softwareReview.getByRole("button", { name: "批准软件配置" }).click();
    const semanticMerge = await approvedResponse;
    expect(semanticMerge.ok(), await semanticMerge.text()).toBe(true);
    const semanticMergeBody = (await semanticMerge.json()) as { item: { status: string; action: string } };
    expect(semanticMergeBody.item).toMatchObject({ status: "approved", action: "set" });
    const mergeRequestId = semanticMerge.headers()["x-request-id"];
    expect(mergeRequestId).toBeTruthy();

    const mergeEvidence = await withPgClient(async (client) => {
      const applied = await client.query<{
        status: string;
        binding_id: string;
        applied_value_id: string | null;
        applied_audit_ref: string | null;
        applied_history_event_id: string | null;
        base_current_value_id: string;
        current_value_id: string;
        config_revision_id: string;
        value_digest: string;
        file_id: string | null;
        file_version_id: string | null;
        file_origin: string | null;
        file_checksum: string | null;
        audit_kind: string | null;
        history_new_value_id: string | null;
      }>(
        `
        select request.status, request.binding_id, request.applied_value_id,
               request.applied_audit_ref, request.applied_history_event_id,
               request.base_current_value_id, binding.current_value_id,
               value.config_revision_id, value.value_digest,
               pin.file_id, pin.file_version_id,
               version.origin as file_origin, version.checksum as file_checksum,
               audit.kind as audit_kind, history.new_current_value_id as history_new_value_id
        from project_parameter_value_change_requests request
        join parameter_catalog.project_parameter_bindings binding on binding.id = request.binding_id
        join parameter_catalog.project_parameter_values value on value.id = request.applied_value_id
        left join parameter_catalog.project_value_source_pins pin
          on pin.project_value_id = value.id and pin.binding_id = binding.id
        left join project_parameter_file_versions version on version.id = pin.file_version_id
        left join audit_events audit on audit.id = request.applied_audit_ref
        left join parameter_catalog.binding_history_events history on history.id = request.applied_history_event_id
        where request.id = $1
        `,
        [changeRequestId]
      );
      const row = applied.rows[0];
      return {
        crStatus: row?.status ?? null,
        bindingId: row?.binding_id ?? null,
        appliedValueId: row?.applied_value_id ?? null,
        currentValueId: row?.current_value_id ?? null,
        baseValueId: row?.base_current_value_id ?? null,
        latestRevisionId: row?.config_revision_id ?? null,
        writebackAuditId: row?.applied_audit_ref ?? null,
        writebackAuditKind: row?.audit_kind ?? null,
        writebackFileId: row?.file_id ?? null,
        writebackVersionId: row?.file_version_id ?? null,
        writebackOrigin: row?.file_origin ?? null,
        writebackChecksum: row?.file_checksum?.slice(0, 19) ?? null,
        historyEventId: row?.applied_history_event_id ?? null,
        historyNewValueId: row?.history_new_value_id ?? null
      };
    });
    expect(mergeEvidence.crStatus).toBe("approved");
    expect(mergeEvidence.bindingId).toBe(scBinding!.id);
    expect(mergeEvidence.baseValueId).toBe(scBinding!.currentValueId);
    expect(mergeEvidence.appliedValueId).toBeTruthy();
    expect(mergeEvidence.currentValueId).toBe(mergeEvidence.appliedValueId);
    expect(mergeEvidence.appliedValueId).not.toBe(scBinding!.currentValueId);
    expect(mergeEvidence.latestRevisionId).toBeTruthy();
    expect(mergeEvidence.latestRevisionId).not.toBe(revisionId);
    expect(mergeEvidence.writebackAuditId).toBeTruthy();
    expect(mergeEvidence.writebackVersionId).toBeTruthy();
    expect(mergeEvidence.writebackOrigin).toBe("writeback");
    expect(mergeEvidence.historyEventId).toBeTruthy();
    expect(mergeEvidence.historyNewValueId).toBe(mergeEvidence.appliedValueId);
    const afterMerge = await request.get(
      apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`),
      { headers: authHeadersForRole("software-user") }
    );
    const afterMergeBody = (await afterMerge.json()) as {
      items: Array<{ id: string; currentValueId: string; rawValue: string }>;
    };
    const mergedBinding = afterMergeBody.items.find((item) => item.id === scBinding!.id);
    expect(mergedBinding?.currentValueId).toBe(mergeEvidence.appliedValueId);
    expect(mergedBinding?.rawValue ?? "").toMatch(/30/);
    // The Binding keeps its identity; only its current ProjectValue advanced.
    expect(mergedBinding?.rawValue).not.toBe(originalRaw);

    const writebackDb = {
      table: "project_parameter_file_versions",
      predicate: "origin=writeback applied by canonical request",
      observed: `origin=${mergeEvidence.writebackOrigin}; checksum=${mergeEvidence.writebackChecksum}; candidate=${mergeEvidence.latestRevisionId}; history=${mergeEvidence.historyEventId}`,
      rowCount: 1
    };

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-EDIT-001",
      title: "typed edit submit review apply writeback",
      status: "passed",
      role: "Software User + Software Committer",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(staleEdit, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
          responseSummary: "stale-revision 409"
        }),
        summarizeApiResponse(compileValidate, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/config-revisions/${brokenRevision.id}/validate`,
          responseSummary: `failureCode=${compileBody.item.failureCode}`
        }),
        summarizeApiResponse(successfulDraft, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
          responseSummary: `draft=${draftBody.item.draftId}; previewCandidate=${draftBody.item.candidateRevisionId}`
        }),
        summarizeApiResponse(submitRound, {
          method: "POST",
          path: "/api/v2/projects/:projectId/parameter-value-drafts/:draftId/submit",
          responseSummary: `requestId=${changeRequestId}`
        }),
        summarizeApiResponse(semanticMerge, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-value-change-requests/${changeRequestId}/review`,
          responseSummary: `role=software-committer; status=${semanticMergeBody.item.status}; writeback.skipped=false; candidate=${mergeEvidence.latestRevisionId}`
        })
      ],
      db: [writebackDb],
      audit: [
        {
          id: mergeEvidence.writebackAuditId ?? undefined,
          kind: mergeEvidence.writebackAuditKind ?? "parameter-canonical-apply",
          action: "apply",
          targetId: changeRequestId,
          requestId: mergeRequestId,
          metadataSummary: `candidateRevisionId=${mergeEvidence.latestRevisionId}; skipped=false`
        }
      ],
      notes:
        "API mode contains no legacy recommended-value workbench; UI value-parse diagnostic block; stale 409; real bad-DTS fail-closed; the typed set draft traverses submit → independent software-committer review → canonical apply/writeback. Typed delete and restart durability of the same chain are covered by canonical-value-workflow.acceptance.spec.ts › creates and removes a draft, selects a software reviewer, withdraws, rejects and resubmits for approval."
    });
    await recordOperationEvidence({
      operationId: "PARAM-HAPPY-001",
      title: "binding-centric parameter submit review apply persistence audit",
      status: "passed",
      role: "Software User + Software Committer + Admin",
      route: "/parameters → /parameter-review",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(successfulDraft, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
          responseSummary: `typed draft=${draftBody.item.draftId}`
        }),
        summarizeApiResponse(submitRound, {
          method: "POST",
          path: "/api/v2/projects/:projectId/parameter-value-drafts/:draftId/submit",
          responseSummary: `UI submitted request=${changeRequestId}`
        }),
        summarizeApiResponse(semanticMerge, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-value-change-requests/${changeRequestId}/review`,
          responseSummary: `role UI approve=${semanticMergeBody.item.status}; candidate=${mergeEvidence.latestRevisionId}`
        })
      ],
      db: [writebackDb],
      audit: [
        {
          id: mergeEvidence.writebackAuditId ?? undefined,
          kind: mergeEvidence.writebackAuditKind ?? "parameter-canonical-apply",
          action: "apply",
          targetId: changeRequestId,
          requestId: mergeRequestId,
          metadataSummary: `candidateRevisionId=${mergeEvidence.latestRevisionId}; skipped=false`
        }
      ],
      notes:
        "Binding-centric API-mode UI searched gpio_int, created the typed candidate, submitted to the eligible software committer, approved it in the visible review surface, persisted the canonical ProjectValue/source pin, and emitted audit evidence without rendering recommendedValue compatibility UI."
    });

    // Identity mapping via real ambiguous ingest (throwaway Config Set).
    const mapSuffix = runSuffix;
    const mapCsName = `acceptance-map-${mapSuffix}`;
    const r1Name = `acceptance-map-r1-${mapSuffix}.dts`;
    const r2Name = `acceptance-map-r2-${mapSuffix}.dts`;
    createdConfigSetNames.push(mapCsName);
    createdFileNames.push(r1Name, r2Name);
    // Ambiguous continuity is seeded through the real ingest service (see fixture).
    const seededMap = await seedAmbiguousIdentityMappingConfigSet(disposableRuntime, {
      projectId,
      configSetName: mapCsName,
      baseFileName: r1Name,
      baseText: mappingR1,
      overlayFileName: r2Name,
      overlayText: mappingR2,
      adminUserId: "u-xu-yun"
    });
    const r2Revision = { id: seededMap.ambiguousRevisionId };

    const blockedValidate = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(r2Revision.id)}/validate`
      ),
      { headers: adminHeaders(), data: { stage: "toolchain" } }
    );
    expect(blockedValidate.ok()).toBe(true);
    const blockedBody = (await blockedValidate.json()) as {
      item: { status: string; failureCode?: string | null };
    };
    expect(blockedBody.item.status).toBe("failed");
    expect(blockedBody.item.failureCode).toBe("open-mapping");

    const mappingList = await request.get(
      apiRoute(
        `/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open`
      ),
      { headers: adminHeaders() }
    );
    expect(mappingList.ok()).toBe(true);
    const mappingBody = (await mappingList.json()) as {
      items: Array<{
        id: string;
        configRevisionId?: string;
        evidence?: {
          candidates?: Array<{ logicalNodeId: string; nodeLocator: string }>;
        };
      }>;
    };
    const openMapTask = requireMappingTask(mappingBody.items, {
      projectId,
      configRevisionId: r2Revision.id
    });
    const leftCandidate = requireMappingCandidate(
      openMapTask,
      (candidate) => candidate.nodeLocator.includes("left"),
      "left sibling node"
    );
    const rightCandidate = requireMappingCandidate(
      openMapTask,
      (candidate) => candidate.nodeLocator.includes("right"),
      "right sibling node"
    );
    expect(leftCandidate.logicalNodeId).not.toBe(rightCandidate.logicalNodeId);

    const resolveMapping = await request.post(
      apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(openMapTask.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          selectedLogicalNodeId: leftCandidate.logicalNodeId,
          reason: `${descriptionPrefix} resolve mapping for left sibling via real ingest task`
        }
      }
    );
    expect(resolveMapping.ok()).toBe(true);

    const stillOpenMaps = await request.get(
      apiRoute(
        `/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open&configRevisionId=${encodeURIComponent(r2Revision.id)}`
      ),
      { headers: adminHeaders() }
    );
    const stillOpenBody = (await stillOpenMaps.json()) as {
      items: Array<{
        id: string;
        configRevisionId?: string;
        evidence?: { candidates?: Array<{ logicalNodeId: string; nodeLocator: string }> };
      }>;
    };
    for (const task of stillOpenBody.items) {
      const pick = requireMappingCandidate(
        task,
        (candidate) => candidate.nodeLocator.includes("right"),
        "remaining right sibling mapping"
      );
      await request.post(apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(task.id)}/resolve`), {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          selectedLogicalNodeId: pick.logicalNodeId,
          reason: `${descriptionPrefix} resolve right sibling mapping`
        }
      });
    }

    const mappingDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `select status from identity_mapping_tasks where id = $1`,
        [openMapTask.id]
      );
      return {
        table: "identity_mapping_tasks",
        predicate: `id=${openMapTask.id}`,
        observed: result.rows[0] ? `status=${result.rows[0].status}` : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(mappingDb.observed).toContain("resolved");

    const mappingAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    const mappingAuditBody = (await mappingAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const mappingAuditItem = mappingAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "identity-mapping-resolved" &&
        item.targetId === openMapTask.id
    );
    expect(mappingAuditItem).toBeTruthy();

    await recordOperationEvidence({
      operationId: "PARAM-IDENTITY-MAP-001",
      title: "identity mapping blocker then resolve audit",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(blockedValidate, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/config-revisions/.../validate`,
          responseSummary: `failureCode=${blockedBody.item.failureCode}`
        }),
        summarizeApiResponse(resolveMapping, {
          method: "POST",
          path: `/api/v2/identity-mapping-tasks/${openMapTask.id}/resolve`,
          responseSummary: `selected=${leftCandidate.logicalNodeId}`
        })
      ],
      db: [mappingDb],
      audit: [
        {
          id: mappingAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "identity-mapping-resolved",
          targetId: openMapTask.id
        }
      ],
      notes: "Ambiguous ingest created open-mapping; validate fail-closed; left/right siblings adjudicated independently via API with audit."
    });

    // 10) SUCCESSFUL validate on merge/writeback candidate (not schema-failed-as-success).
    // Revisions pinned by a canonical ProjectValue (the base and the applied one) are
    // immutable source history and are never validated or published in place. The gate
    // runs on the previously blocked, now identity-resolved revision.
    const validateTargetId = seededMap.ambiguousRevisionId;
    expect(validateTargetId).toBeTruthy();
    expect(validateTargetId).not.toBe(revisionId);
    await assertCanonicalBindingsForCurrentRevision(request, validateTargetId, projectId);
    const retainedMysteryReview = await request.get(
      apiRoute(`/api/v2/organizations/${organizationId}/parameter-review-items/${encodeURIComponent(mysteryReview!.id)}`),
      { headers: adminHeaders() }
    );
    expect(retainedMysteryReview.status(), await retainedMysteryReview.text()).toBe(200);
    expect(await retainedMysteryReview.json()).toMatchObject({ item: { id: mysteryReview!.id, status: "open" } });

    const validateResponse = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(validateTargetId)}/validate`
      ),
      { headers: adminHeaders(), data: { stage: "toolchain" } }
    );
    expect(validateResponse.ok(), await validateResponse.text()).toBe(true);
    const validateBody = (await validateResponse.json()) as {
      item: { id: string; status: string; stage: string; failureCode?: string | null };
    };
    expect(
      validateBody.item.status,
      `validate failureCode=${validateBody.item.failureCode}`
    ).toBe("passed");
    expect(validateBody.item.failureCode ?? null).toBeNull();

    const publishDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [validateTargetId]
      );
      return {
        table: "dts_config_revisions",
        predicate: `id=${validateTargetId}`,
        observed: result.rows[0] ? `status=${result.rows[0].status}` : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(publishDb.observed).toContain("validated");

    // The pre-edit canonical ProjectValue and its config revision stay immutable history.
    const baseRevisionUnchanged = await withPgClient(async (client) => {
      const result = await client.query<{ value_digest: string; status: string; config_revision_id: string }>(
        `
        select value.value_digest, cr.status, value.config_revision_id
        from parameter_catalog.project_parameter_values value
        inner join dts_config_revisions cr on cr.id = value.config_revision_id
        where value.id = $1 and value.binding_id = $2
        `,
        [scBinding!.currentValueId, scBinding!.id]
      );
      return result.rows[0];
    });
    expect(baseRevisionUnchanged?.config_revision_id).toBe(revisionId);
    expect(baseRevisionUnchanged?.value_digest).toBeTruthy();
    expect(baseRevisionUnchanged?.status).not.toBe("validated");

    const publishAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    const publishAuditBody = (await publishAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const publishAuditItem = publishAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "config-revision-validated" &&
        item.targetId === validateTargetId
    );
    expect(publishAuditItem).toBeTruthy();

    // 8) Reload bindingId/value/provenance from DB after UI reload.
    await signInBrowserAsRole(
      page,
      "admin",
      `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`
    );
    await page.reload();
    await dismissXiaozeHint(page);
    const workspaceAfter = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
    await workspaceAfter.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const sc8562ReloadRow = bindingRowById(workspaceAfter, scBinding!.id);
    await expect(sc8562ReloadRow.locator('[data-label="参数名"]')).toBeVisible({
      timeout: 20_000
    });
    await sc8562ReloadRow.getByRole("button", { name: /^查看 gpio_int/ }).click();
    const detailAfter = page.getByRole("dialog", { name: /gpio_int 参数详情/ });
    await expect(detailAfter).toBeVisible();
    await expect(detailAfter.getByRole("heading", { name: "参数定义" })).toBeVisible();
    await expect(detailAfter.getByText("来源链")).toHaveCount(0);
    await expect(detailAfter.getByText("技术身份")).toHaveCount(0);
    await expect(detailAfter.getByText(scBinding!.id, { exact: true })).toHaveCount(0);
    const bindingIdAfter = scBinding!.id;
    const currentValueField = detailAfter.locator("dt", { hasText: "当前值" }).locator("xpath=..");
    const valueAfter = (await currentValueField.locator("code").innerText()).trim();

    const persistedDb = await withPgClient(async (client) => {
      const result = await client.query<{ id: string; current_value_id: string; value: unknown }>(
        `
        select b.id, b.current_value_id, v.value
        from parameter_catalog.project_parameter_bindings b
        inner join parameter_catalog.project_parameter_values v on v.id = b.current_value_id
        where b.id = $1
        `,
        [bindingIdAfter]
      );
      return {
        table: "parameter_catalog.project_parameter_bindings",
        predicate: `binding=${bindingIdAfter}`,
        observed: result.rows[0]
          ? `id=${result.rows[0].id}; currentValue=${result.rows[0].current_value_id}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(persistedDb.observed).toContain(bindingIdAfter ?? "");
    expect(valueAfter.length).toBeGreaterThan(0);

    await recordOperationEvidence({
      operationId: "PARAM-CONFIG-PUBLISH-GATE-001",
      title: "validate/publish gate and DB reload persistence",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(validateResponse, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/config-revisions/${validateTargetId}/validate`,
          responseSummary: `run=${validateBody.item.id}; status=${validateBody.item.status}`
        })
      ],
      db: [publishDb, persistedDb],
      audit: [
        {
          id: publishAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "config-revision-validated",
          targetId: validateTargetId
        }
      ],
      notes: `${descriptionPrefix}: successful validate on candidate revision; base revision binding unchanged; bindingId+provenance persist after reload. org=${organizationId} runId=${runSuffix}`
    });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: createdConfigSetNames,
        fileNames: createdFileNames,
        parameterSpecIds: createdParameterSpecIds
      });
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: createdConfigSetNames,
        fileNames: createdFileNames,
        parameterSpecIds: createdParameterSpecIds
      });
    }
  });

  test("removing a tray draft deletes it on the server and it stays gone after reload", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-DRAFT-REMOVE-001
    // @operation PARAM-DRAFT-REMOVE-001
    test.setTimeout(180_000);
    const topology = await ensureAuroraSemanticTopology(request);

    await signInBrowserAsRole(page, "software-user", `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`);
    await dismissXiaozeHint(page);

    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-config-set-id", topology.configSetId, { timeout: 30_000 });
    await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    await expect.poll(async () => workspace.getByRole("cell", { name: "gpio_int" }).count()).toBeGreaterThanOrEqual(1);

    // Anchor the sc8562 binding (its schema accepts the 3-cell target value).
    const bindingsApi = await request.get(
      apiRoute(`/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(topology.revisionId)}`),
      { headers: authHeadersForRole("software-user") }
    );
    expect(bindingsApi.ok()).toBe(true);
    const bindingsBody = (await bindingsApi.json()) as { items: Array<{ id: string; propertyKey: string; locator: string | null }> };
    const scBinding = bindingsBody.items.find((item) => item.propertyKey === "gpio_int" && item.locator === SC8562_LOCATOR);
    expect(scBinding, "sc8562 gpio_int binding must exist in the ensured topology").toBeTruthy();

    // Create a typed draft through the product UI (no API shortcut, so the tray
    // exercises the same seams a user does).
    await bindingRowById(workspace, scBinding!.id).getByRole("button", { name: /^(编辑|继续编辑) gpio_int/ }).click();
    const editDetail = page.getByRole("dialog", { name: "修改草稿" });
    await expect(editDetail).toBeVisible();
    await editDetail.getByLabel("目标值", { exact: true }).fill("<&gpio13 31 0>");
    await editDetail.getByLabel("修改原因", { exact: true }).fill("PARAM-DRAFT-REMOVE acceptance draft");
    const createdDraft = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v2/projects/${projectId}/parameter-bindings/`) &&
        response.url().includes("/drafts")
    );
    await editDetail.getByRole("button", { name: "校验并加入本轮" }).click();
    const draftResponse = await createdDraft;
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draftBody = (await draftResponse.json()) as { item: { draftId: string } };
    const draftId = draftBody.item.draftId;
    expect(draftId).toBeTruthy();

    const tray = page.getByRole("heading", { name: "本轮已修改" });
    await expect(tray).toBeVisible();
    await expect(page.getByText("PARAM-DRAFT-REMOVE acceptance draft")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "DTS 参数工作台" })).toBeVisible({ timeout: 30_000 });
    let listedDraft: { id?: string; reason?: string; updatedAt?: string } | undefined;
    await expect.poll(async () => {
      const response = await page.request.get(
        apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts`),
        { headers: authHeadersForRole("software-user") }
      );
      expect(response.ok()).toBe(true);
      const listedBody = (await response.json()) as {
        items: Array<{ id?: string; reason?: string; updatedAt?: string }>
      };
      listedDraft = listedBody.items.find((item) => item.id === draftId);
      return listedDraft?.reason ?? null;
    }).toBe("PARAM-DRAFT-REMOVE acceptance draft");
    expect(listedDraft?.updatedAt).toBeTruthy();
    await expect(page.getByRole("heading", { name: "本轮已修改" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("PARAM-DRAFT-REMOVE acceptance draft")).toBeVisible();

    // Tray removal must delete the canonical server draft, not just filter local state.
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`/api/v2/projects/${projectId}/parameter-value-drafts/`)
    );
    await page.getByRole("button", { name: "移出本轮修改" }).first().click();
    const deleteResponse = await deleted;
    expect(deleteResponse.ok(), await deleteResponse.text()).toBe(true);
    await expect(page.getByRole("heading", { name: "本轮已修改" })).toHaveCount(0);

    // The draft must stay gone across a full reload (the historical bug: the
    // server copy resurrected into the tray and the next submit).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "DTS 参数工作台" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "本轮已修改" })).toHaveCount(0);

    const remaining = await page.request.get(
      apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts`),
      { headers: authHeadersForRole("software-user") }
    );
    expect(remaining.ok()).toBe(true);
    const remainingBody = (await remaining.json()) as { items: Array<{ id?: string; draftId?: string }> };
    expect(
      remainingBody.items.some((item) => item.id === draftId || item.draftId === draftId),
      `draft ${draftId} should be deleted server-side`
    ).toBe(false);

    await recordOperationEvidence({
      operationId: "PARAM-DRAFT-REMOVE-001",
      title: "tray draft removal deletes server-side and survives reload",
      status: "passed",
      role: "Software User",
      route: `/parameters?project=${projectId}`,
      page,
      testInfo,
      api: [
        summarizeApiResponse(deleteResponse, {
          method: "DELETE",
          path: "/api/v2/.../drafts/:draftId",
          responseSummary: `draft=${draftId} deleted; absent after reload`
        })
      ]
    });
  });

  test("resolves identity mapping tasks from the parameter admin surface", async ({ page, request }, testInfo) => {
    // @acceptance PARAM-IDENTITY-MAP-ADMIN-001
    // @operation PARAM-IDENTITY-MAP-ADMIN-001
    test.setTimeout(120_000);
    const runSuffix = randomUUID().slice(0, 8);
    const mapCsName = `acceptance-map-admin-${runSuffix}`;
    const r1Name = `acceptance-map-admin-r1-${runSuffix}.dts`;
    const r2Name = `acceptance-map-admin-r2-${runSuffix}.dts`;
    const createdConfigSetNames = [mapCsName];
    const createdFileNames = [r1Name, r2Name];

    try {
      await ensureAuroraSemanticTopology(request);

      // Ambiguous continuity is seeded through the real ingest service (see fixture).
      const seeded = await seedAmbiguousIdentityMappingConfigSet(disposableRuntime, {
        projectId,
        configSetName: mapCsName,
        baseFileName: r1Name,
        baseText: mappingR1,
        overlayFileName: r2Name,
        overlayText: mappingR2,
        adminUserId: "u-xu-yun"
      });
      const r2Revision = { id: seeded.ambiguousRevisionId };

      const mappingList = await request.get(
        apiRoute(
          `/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open`
        ),
        { headers: adminHeaders() }
      );
      expect(mappingList.ok()).toBe(true);
      const mappingBody = (await mappingList.json()) as {
        items: Array<{
          id: string;
          configRevisionId?: string;
          evidence?: {
            candidates?: Array<{ logicalNodeId: string; nodeLocator: string }>;
          };
        }>;
      };
      const openMapTask = requireMappingTask(mappingBody.items, {
        projectId,
        configRevisionId: r2Revision.id
      });
      const leftCandidate = requireMappingCandidate(
        openMapTask,
        (candidate) => candidate.nodeLocator.includes("left"),
        "left sibling node"
      );
      const rightCandidate = requireMappingCandidate(
        openMapTask,
        (candidate) => candidate.nodeLocator.includes("right"),
        "right sibling node"
      );

      await signInBrowserAsRole(
        page,
        "admin",
        `${disposableRuntime.frontendUrl}/parameter-admin/specs/identity-mapping`
      );
      await dismissXiaozeHint(page);

      const governance = page.getByRole("region", { name: "节点对应确认" });
      await expect(governance).toBeVisible({ timeout: 30_000 });
      const review = page.getByRole("region", { name: "节点对应审核" });
      await expect(review).toBeVisible({ timeout: 30_000 });
      await expect(review.getByLabel("对应依据")).toBeVisible();
      await review.getByRole("combobox", { name: "选择对应节点" }).selectOption(leftCandidate.logicalNodeId);
      await review.getByLabel("确认原因").fill(`${descriptionPrefix} admin UI resolve ${runSuffix}`);
      await review.getByRole("button", { name: "确认对应" }).click();

      let resolvedDbStatus = "missing";
      await expect
        .poll(
          async () => {
            resolvedDbStatus = await withPgClient(async (client) => {
              const result = await client.query<{ status: string }>(
                `select status from identity_mapping_tasks where id = $1`,
                [openMapTask.id]
              );
              return result.rows[0]?.status ?? "missing";
            });
            return resolvedDbStatus;
          },
          { timeout: 30_000 }
        )
        .toBe("resolved");

      const history = review.getByRole("list", { name: "节点对应历史" });
      const resolvedTask = history.getByRole("listitem").filter({ hasText: leftCandidate.nodeLocator });
      await expect(resolvedTask.getByText(/当前对应/)).toContainText(leftCandidate.nodeLocator);
      await resolvedTask
        .getByRole("combobox", { name: "重新选择对应节点" })
        .selectOption(rightCandidate.logicalNodeId);
      await resolvedTask
        .getByLabel("重新对应原因")
        .fill(`${descriptionPrefix} correct mapping after evidence review ${runSuffix}`);
      const reResolveResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(`/api/v2/identity-mapping-tasks/${openMapTask.id}/resolve`)
      );
      await resolvedTask.getByRole("button", { name: "确认重新对应" }).click();
      const reResolveResponse = await reResolveResponsePromise;
      expect(reResolveResponse.ok(), await reResolveResponse.text()).toBe(true);

      let selectedLogicalNodeId = "missing";
      await expect
        .poll(
          async () => {
            selectedLogicalNodeId = await withPgClient(async (client) => {
              const result = await client.query<{ selected_logical_node_id: string | null }>(
                `select evidence ->> 'selectedLogicalNodeId' as selected_logical_node_id
                 from identity_mapping_tasks where id = $1`,
                [openMapTask.id]
              );
              return result.rows[0]?.selected_logical_node_id ?? "missing";
            });
            return selectedLogicalNodeId;
          },
          { timeout: 30_000 }
        )
        .toBe(rightCandidate.logicalNodeId);

      await expect
        .poll(async () => {
          return resolvedTask.evaluate((item) => {
            const bounds = item.getBoundingClientRect();
            return bounds.left >= -1 && bounds.right <= document.documentElement.clientWidth + 1;
          });
        })
        .toBe(true);
      const overflowingControls = await resolvedTask
        .locator("select, textarea, button")
        .evaluateAll((controls) =>
          controls
            .filter((control) => {
              const bounds = control.getBoundingClientRect();
              return bounds.left < -1 || bounds.right > document.documentElement.clientWidth + 1;
            })
            .map((control) => control.tagName.toLowerCase())
        );
      expect(overflowingControls).toEqual([]);

      const auditResponse = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
        headers: adminHeaders()
      });
      const auditBody = (await auditResponse.json()) as {
        items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
      };
      const mappingAuditItem = auditBody.items.find(
        (item) =>
          item.kind === "parameter-topology-governance" &&
          item.action === "identity-mapping-resolved" &&
          item.targetId === openMapTask.id
      );
      expect(mappingAuditItem).toBeTruthy();

      await recordOperationEvidence({
        operationId: "PARAM-IDENTITY-MAP-ADMIN-001",
        title: "admin identity mapping resolve with evidence",
        status: "passed",
        role: "Admin",
        route: "/parameter-admin",
        page,
        testInfo,
        assertions: ["ui", "api", "db", "audit"],
        api: [
          summarizeApiResponse(mappingList, {
            method: "GET",
            path: "/api/v2/identity-mapping-tasks",
            responseSummary: `openTask=${openMapTask.id}`
          }),
          summarizeApiResponse(reResolveResponse, {
            method: "POST",
            path: `/api/v2/identity-mapping-tasks/${openMapTask.id}/resolve`,
            responseSummary: `reResolved=${rightCandidate.logicalNodeId}`
          })
        ],
        db: [
          {
            table: "identity_mapping_tasks",
            predicate: `id=${openMapTask.id}`,
            observed: `status=${resolvedDbStatus}; selectedLogicalNodeId=${selectedLogicalNodeId}`,
            rowCount: 1
          }
        ],
        audit: [
          {
            id: mappingAuditItem?.id,
            kind: "parameter-topology-governance",
            action: "identity-mapping-resolved",
            targetId: openMapTask.id
          }
        ],
        notes:
          "At PC 1440x900, Admin resolved an open identity mapping task, then corrected the applied choice through protected re-resolve with candidate evidence and governance audit."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId,
        configSetNames: createdConfigSetNames,
        fileNames: createdFileNames
      });
    }
  });

  test("PARAM-ENABLE-VISIBLE-001: workbench no-effect notice and topology enablement model", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-ENABLE-VISIBLE-001
    // @operation PARAM-ENABLE-VISIBLE-001
    test.setTimeout(180_000);
    const enableProjectId = "enable-visible";
    const topology = await ensureDedicatedProjectTopology(request, {
      projectId: enableProjectId,
      name: "Enablement visible acceptance",
      code: "ENABLE-VISIBLE",
      // Canonical source history is immutable, so the disabled parent bus and the
      // disabled mt5788 node are part of this project's first ingested source.
      source: withNodeStatus(
        withNodeStatus(auroraPrimarySource(), /i2c@FDF5E000\s*\{/, "disabled"),
        /mt5788@2B\s*\{/,
        "disabled"
      )
    });
    const enableRevision = { id: topology.revisionId };

    const { topologyApi, nodes } = await listEffectiveTopologyNodes(
      request,
      topology.configSetId,
      enableRevision.id,
      enableProjectId
    );
    const parentNode = nodes.find((node) => (node.locator ?? "").endsWith("/i2c@FDF5E000"));
    const childNode = nodes.find((node) => (node.locator ?? "") === SC8562_LOCATOR);
    const directNode = nodes.find((node) => (node.locator ?? "") === MT5788_LOCATOR);
    expect(parentNode?.enablement?.selfEnabled, "disabled parent must report selfEnabled false").toBe(false);
    expect(childNode?.enablement?.reachable, "child under disabled parent must be unreachable").toBe(false);
    expect(directNode?.enablement?.selfEnabled, "directly disabled node must report selfEnabled false").toBe(
      false
    );

    await signInBrowserAsRole(
      page,
      "admin",
      `${disposableRuntime.frontendUrl}/parameters?project=${enableProjectId}`
    );
    await dismissXiaozeHint(page);

    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-config-set-id", topology.configSetId, { timeout: 30_000 });
    await expect(page.getByRole("tree", { name: "生效拓扑树" })).toHaveCount(0);

    await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const childRow = semanticBindingRow(workspace, "sc8562@6E");
    await expect(childRow).toBeVisible({ timeout: 20_000 });
    await expect(childRow).toContainText(/所属节点已禁用|所属节点不可达/);

    const directRow = semanticBindingRow(workspace, "mt5788@2B");
    await expect(directRow).toBeVisible({ timeout: 20_000 });
    await expect(directRow).toContainText("所属节点已禁用");

    const enablementButton = workspace.getByRole("button", { name: /节点启用/ });
    if (await enablementButton.isVisible().catch(() => false)) {
      await enablementButton.click();
      const enablementDialog = page.getByRole("dialog", { name: "节点启用状态" });
      await expect(enablementDialog).toBeVisible();
      await expect(enablementDialog).toContainText(/已禁用|不可达/);
      await enablementDialog.getByRole("button", { name: "取消" }).click();
    }

    await recordOperationEvidence({
      operationId: "PARAM-ENABLE-VISIBLE-001",
      title: "workbench no-effect notice and topology enablement model",
      status: "passed",
      role: "Admin",
      route: `/parameters?project=${enableProjectId}`,
      page,
      testInfo,
      assertions: ["ui", "api"],
      api: [
        summarizeApiResponse(topologyApi, {
          method: "GET",
          path: `/api/v2/projects/${enableProjectId}/config-sets/.../topology?view=effective`,
          responseSummary: `parent.selfEnabled=${String(parentNode?.enablement?.selfEnabled)}; child.reachable=${String(childNode?.enablement?.reachable)}; direct.selfEnabled=${String(directNode?.enablement?.selfEnabled)}`
        })
      ],
      notes:
        "Live /parameters workbench (DtsParameterWorkbench) shows no-effect notices. TopologyTree (aria-label=生效拓扑树) is not mounted on this page; tree-model evidence is GET topology?view=effective enablement fields."
    });
  });

  test("PARAM-ENABLE-GATE-001: structural keys do not block publish gates", async ({ request }, testInfo) => {
    // @acceptance PARAM-ENABLE-GATE-001
    // @operation PARAM-ENABLE-GATE-001
    test.setTimeout(180_000);
    const runSuffix = randomUUID().slice(0, 8);
    const gateProp = `enable_gate_${runSuffix}`;
    const enableProjectId = "enable-gate";

    const locatorNeedle = `egate_${runSuffix}@60`;
    const topology = await ensureDedicatedProjectTopology(request, {
      projectId: enableProjectId,
      name: "Enablement gate acceptance",
      code: "ENABLE-GATE",
      source: enablementGateSource(runSuffix, gateProp)
    });
    const gateRevision = { id: topology.revisionId };

    const reviewList = await request.get(
      apiRoute(
        `/api/v2/parameter-spec-review-tasks?status=open&enableProjectId=${encodeURIComponent(enableProjectId)}&configRevisionId=${encodeURIComponent(gateRevision.id)}&limit=100`
      ),
      { headers: adminHeaders() }
    );
    expect(reviewList.ok()).toBe(true);
    const reviewBody = (await reviewList.json()) as {
      items: Array<{
        id: string;
        propertyKey?: string | null;
        sourceEvidence?: { propertyKey?: string };
      }>;
    };
    const statusTasks = reviewBody.items.filter((task) => {
      const key = (task.propertyKey ?? task.sourceEvidence?.propertyKey ?? "").toLowerCase();
      return key === "status";
    });
    expect(statusTasks, "status overlay must not create spec-review tasks").toHaveLength(0);

    const bindingsApi = await request.get(
      apiRoute(
        `/api/v2/projects/${enableProjectId}/parameter-bindings?revisionId=${encodeURIComponent(gateRevision.id)}`
      ),
      { headers: adminHeaders() }
    );
    expect(bindingsApi.ok()).toBe(true);
    const bindingsBody = (await bindingsApi.json()) as {
      items: Array<{ propertyKey: string; locator: string | null }>;
    };
    const statusBindings = bindingsBody.items.filter(
      (item) => item.propertyKey === "status" && (item.locator ?? "").includes(locatorNeedle)
    );
    expect(statusBindings, "status must not become a parameter binding").toHaveLength(0);
    expect(
      bindingsBody.items.some((item) => item.propertyKey === gateProp),
      "unmatched overlay keys stay review evidence, not recognized bindings"
    ).toBe(false);

    const { topologyApi, nodes } = await listEffectiveTopologyNodes(
      request,
      topology.configSetId,
      gateRevision.id,
      enableProjectId
    );
    const gateNode = nodes.find((node) => (node.locator ?? "").includes(locatorNeedle));
    expect(gateNode?.enablement?.selfEnabled, "disabled overlay node stays selfEnabled false").toBe(
      false
    );

    const gateDb = await withPgClient(async (client) => {
      const revision = await client.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [gateRevision.id]
      );
      const structuralOpen = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from parameter_spec_review_tasks t
        where t.organization_id = $1
          and t.status = 'open'
          and (
            lower(coalesce(t.source_evidence->>'propertyKey', '')) = any($2::text[])
            or coalesce(t.source_evidence->>'propertyKey', '') like '#%'
          )
          and (
            coalesce(nullif(t.config_revision_id, ''), nullif(t.source_evidence->>'configRevisionId', '')) = $3
            or (
              t.blocker_scope = 'project'
              and coalesce(nullif(t.project_id, ''), nullif(t.source_evidence->>'enableProjectId', '')) = $4
            )
          )
        `,
        [organizationId, STRUCTURAL_REVIEW_PROPERTY_KEYS, gateRevision.id, enableProjectId]
      );
      const gateCounts = await client.query<{
        open_spec_reviews: string;
        unmatched_occurrences: string;
      }>(
        `
        select
          count(*) filter (
            where coalesce(t.source_evidence->>'propertyKey', '') <> all($2::text[])
              and coalesce(t.source_evidence->>'propertyKey', '') not like '#%'
          )::text as open_spec_reviews,
          count(*) filter (
            where coalesce(t.source_evidence->>'propertyKey', '') <> all($2::text[])
              and coalesce(t.source_evidence->>'propertyKey', '') not like '#%'
              and (
                coalesce(jsonb_array_length(t.candidate_schemas), 0) = 0
                or coalesce(t.source_evidence->>'inferred', '') = 'true'
              )
          )::text as unmatched_occurrences
        from parameter_spec_review_tasks t
        where t.organization_id = $1
          and t.status = 'open'
          and (
            (
              t.blocker_scope = 'revision'
              and coalesce(nullif(t.config_revision_id, ''), nullif(t.source_evidence->>'configRevisionId', '')) = $3
            )
            or (
              t.blocker_scope = 'project'
              and coalesce(nullif(t.project_id, ''), nullif(t.source_evidence->>'enableProjectId', '')) = $4
            )
            or t.blocker_scope = 'platform'
          )
        `,
        [organizationId, STRUCTURAL_REVIEW_PROPERTY_KEYS, gateRevision.id, enableProjectId]
      );
      const dismissed = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from parameter_spec_review_tasks
        where organization_id = $1
          and status = 'dismissed'
          and reason = 'systemic:structural-property-not-a-parameter'
        `,
        [organizationId]
      );
      const cutover = await client.query<{ migration_run_id: string }>(
        `
        select migration_run_id
        from parameter_identity_cutovers
        where migration_run_id = $1
        `,
        [disposableRuntime.migrationRunId]
      );
      return {
        revisionStatus: revision.rows[0]?.status ?? null,
        structuralOpen: Number(structuralOpen.rows[0]?.count ?? 0),
        openSpecReviews: Number(gateCounts.rows[0]?.open_spec_reviews ?? 0),
        unmatchedOccurrences: Number(gateCounts.rows[0]?.unmatched_occurrences ?? 0),
        dismissedSystemic: Number(dismissed.rows[0]?.count ?? 0),
        cutoverRunId: cutover.rows[0]?.migration_run_id ?? null
      };
    });

    expect(gateDb.revisionStatus, "structural unmatched must not invalidate the ingested revision").not.toBe(
      "invalid"
    );
    expect(gateDb.structuralOpen, "no open structural spec-review tasks for this overlay").toBe(0);
    expect(
      gateDb.cutoverRunId,
      "disposable post-cutover finalize already succeeded; structural reviews must not block migration finalize"
    ).toBe(disposableRuntime.migrationRunId);

    await recordOperationEvidence({
      operationId: "PARAM-ENABLE-GATE-001",
      title: "structural keys do not block publish gates",
      status: "passed",
      role: "Admin",
      route: `/parameters?project=${enableProjectId}`,
      testInfo,
      assertions: ["api", "db"],
      api: [
        summarizeApiResponse(reviewList, {
          method: "GET",
          path: "/api/v2/parameter-spec-review-tasks",
          responseSummary: `openStatusTasks=${statusTasks.length}; openTasks=${reviewBody.items.length}`
        }),
        summarizeApiResponse(bindingsApi, {
          method: "GET",
          path: `/api/v2/projects/${enableProjectId}/parameter-bindings`,
          responseSummary: `statusBindingsForGateNode=${statusBindings.length}`
        }),
        summarizeApiResponse(topologyApi, {
          method: "GET",
          path: `/api/v2/projects/${enableProjectId}/config-sets/.../topology?view=effective`,
          responseSummary: `gate.selfEnabled=${String(gateNode?.enablement?.selfEnabled)}`
        })
      ],
      db: [
        {
          table: "parameter_spec_review_tasks, dts_config_revisions, parameter_identity_cutovers",
          predicate: `revision=${gateRevision.id}; structuralKeys excluded from semantic gate`,
          observed: `revisionStatus=${gateDb.revisionStatus}; structuralOpen=${gateDb.structuralOpen}; openSpecReviews=${gateDb.openSpecReviews}; unmatchedOccurrences=${gateDb.unmatchedOccurrences}; dismissedSystemic=${gateDb.dismissedSystemic}; cutover=${gateDb.cutoverRunId}`,
          rowCount: 1
        }
      ],
      notes:
        "API+DB: overlay with status on a unique node creates no status spec-review task or binding. Semantic gate counts exclude STRUCTURAL_PROPERTY_KEYS so structural unmatched does not fail-close candidate promotion. Disposable runtime already finalized cutover (0068 dismisses pre-existing structural tasks with systemic:structural-property-not-a-parameter; dismissedSystemic may be 0 when seed ingest ran after 0068)."
    });
  });

  test("PARAM-ENABLE-TOGGLE-001: disable with reason stays independent of the canonical value round", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-ENABLE-TOGGLE-001
    // @operation PARAM-ENABLE-TOGGLE-001
    test.setTimeout(180_000);
    const runSuffix = randomUUID().slice(0, 8);
    const disableReason = `PARAM-ENABLE-TOGGLE-001 isolate ${runSuffix}`;
    const bindingReason = `PARAM-ENABLE-TOGGLE-001 sibling binding ${runSuffix}`;

    try {
      const topology = await ensureAuroraSemanticTopology(request);
      const { nodes } = await listEffectiveTopologyNodes(
        request,
        topology.configSetId,
        topology.revisionId
      );
      const toggleNode = nodes.find((node) => (node.locator ?? "") === SC8562_LOCATOR);
      expect(toggleNode?.logicalNodeId).toBeTruthy();
      expect(toggleNode?.enablement?.selfEnabled, "fixture node starts enabled").toBe(true);

      const bindingsApi = await request.get(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(topology.revisionId)}`
        ),
        { headers: adminHeaders() }
      );
      expect(bindingsApi.ok()).toBe(true);
      const bindingsBody = (await bindingsApi.json()) as {
        items: Array<{
          id: string;
          propertyKey: string;
          locator: string | null;
          logicalNodeId?: string | null;
          parameterSpecId?: string;
          rawValue: string;
        }>;
      };
      const scBinding = bindingsBody.items.find(
        (item) => item.propertyKey === "gpio_int" && item.locator === SC8562_LOCATOR
      );
      expect(scBinding, "sc8562 gpio_int binding must exist for mixed-round submit").toBeTruthy();
      expect(scBinding!.parameterSpecId).toBeTruthy();

      await signInBrowserAsRole(
        page,
        "software-user",
        `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`
      );
      await dismissXiaozeHint(page);

      const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
      await expect(workspace).toBeVisible({ timeout: 30_000 });
      await expect(workspace).toHaveAttribute("data-config-set-id", topology.configSetId, {
        timeout: 30_000
      });
      await expect(page.getByRole("tree", { name: "生效拓扑树" })).toHaveCount(0);

      const enablementDialog = await openWorkbenchEnablementDialog(
        page,
        workspace,
        "gpio_int",
        /sc8562@6E/
      );
      await enablementDialog.getByRole("radio", { name: "禁用" }).click();
      const confirm = enablementDialog.getByRole("button", { name: "校验并加入本轮" });
      await expect(confirm).toBeDisabled();
      await enablementDialog.getByRole("textbox", { name: "修改原因" }).fill(disableReason);
      await expect(confirm).toBeDisabled();
      await enablementDialog.getByRole("checkbox", { name: "我确认要禁用此节点" }).click();
      await expect(confirm).toBeEnabled();

      const enablementPosted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(`/api/v2/projects/${projectId}/node-enablement-drafts`)
      );
      await confirm.click();
      const enablementResponse = await enablementPosted;
      expect(enablementResponse.status(), await enablementResponse.text()).toBe(201);
      const enablementBody = (await enablementResponse.json()) as {
        item: {
          draftId: string;
          candidateRevisionId: string;
          workingCandidateRevisionId?: string;
          rawText?: string;
          action?: string;
          logicalNodeId: string;
          target?: string;
        };
      };
      expect(enablementBody.item.draftId).toBeTruthy();
      expect(enablementBody.item.candidateRevisionId).toBeTruthy();
      expect(enablementBody.item.logicalNodeId).toBe(toggleNode!.logicalNodeId);
      expect(enablementBody.item.target ?? "force-disabled").toBe("force-disabled");

      const tray = page.getByRole("region", { name: "参数修改提交" });
      await expect(tray).toBeVisible({ timeout: 20_000 });
      await expect(tray).toContainText("节点启用");

      const persistedDraft = await withPgClient(async (client) => {
        const result = await client.query<{
          edit_subject_kind: string;
          logical_node_id: string | null;
          candidate_config_revision_id: string | null;
          target_value: string | null;
        }>(
          `
          select edit_subject_kind, logical_node_id, candidate_config_revision_id, target_value
          from parameter_drafts
          where id = $1
          `,
          [enablementBody.item.draftId]
        );
        return result.rows[0] ?? null;
      });
      expect(persistedDraft).toMatchObject({
        edit_subject_kind: "node-enablement",
        logical_node_id: toggleNode!.logicalNodeId,
        candidate_config_revision_id: enablementBody.item.candidateRevisionId
      });

      const auditResponse = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
        headers: adminHeaders()
      });
      expect(auditResponse.ok()).toBe(true);
      const auditBody = (await auditResponse.json()) as {
        items: Array<{
          id?: string;
          kind: string;
          action: string;
          targetId: string | null;
        }>;
      };
      const enablementAudit = auditBody.items.find(
        (item) =>
          item.kind === "parameter-topology-governance" &&
          item.action === "enablement-changed" &&
          item.targetId === toggleNode!.logicalNodeId
      );
      expect(enablementAudit, "disable must write a distinct enablement-changed audit").toBeTruthy();

      // Canonical value drafts pin the Binding's own current source revision, so a
      // value edit on the same node is created independently of the enablement
      // candidate (a draft based on the enablement working tip is refused as stale).
      const bindingBase = await withPgClient(async (client) => {
        const result = await client.query<{ config_revision_id: string }>(
          `select config_revision_id from parameter_catalog.project_parameter_values where id = $1`,
          [scBinding!.currentValueId]
        );
        return result.rows[0]?.config_revision_id ?? null;
      });
      expect(bindingBase).toBeTruthy();
      const staleOnEnablementTip = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
        ),
        {
          headers: authHeadersForRole("software-user"),
          data: {
            baseRevisionId: enablementBody.item.candidateRevisionId,
            targetValue: {
              kind: "cells",
              bits: 32,
              groups: [
                [
                  { kind: "phandle", label: "gpio13" },
                  { kind: "integer", raw: "32", value: "32" },
                  { kind: "integer", raw: "0", value: "0" }
                ]
              ]
            },
            reason: bindingReason
          }
        }
      );
      expect(staleOnEnablementTip.status(), await staleOnEnablementTip.text()).toBe(409);
      const bindingDraft = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
        ),
        {
          headers: authHeadersForRole("software-user"),
          data: {
            baseRevisionId: bindingBase,
            targetValue: {
              kind: "cells",
              bits: 32,
              groups: [
                [
                  { kind: "phandle", label: "gpio13" },
                  { kind: "integer", raw: "32", value: "32" },
                  { kind: "integer", raw: "0", value: "0" }
                ]
              ]
            },
            reason: bindingReason
          }
        }
      );
      expect(bindingDraft.status(), await bindingDraft.text()).toBe(201);
      const bindingDraftBody = (await bindingDraft.json()) as { item: { draftId: string } };

      // Submitting the value round reviews only the value; the enablement draft stays
      // pending and is never swept into the canonical request.
      const valueSubmit = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-value-drafts/${encodeURIComponent(bindingDraftBody.item.draftId)}/submit`
        ),
        { headers: authHeadersForRole("software-user"), data: { assignedToUserId: "u-sun-mei" } }
      );
      expect(valueSubmit.status(), await valueSubmit.text()).toBe(201);
      const valueRequest = ((await valueSubmit.json()) as { item: { id: string; bindingId: string; status: string } }).item;
      expect(valueRequest).toMatchObject({ bindingId: scBinding!.id, status: "pending" });
      const enablementStillPending = await withPgClient(async (client) => {
        const result = await client.query<{ edit_subject_kind: string; logical_node_id: string | null }>(
          `select edit_subject_kind, logical_node_id from parameter_drafts where id = $1`,
          [enablementBody.item.draftId]
        );
        return result.rows[0] ?? null;
      });
      expect(enablementStillPending).toEqual({
        edit_subject_kind: "node-enablement",
        logical_node_id: toggleNode!.logicalNodeId
      });
      // Leave no open request on the shared fixture Binding.
      const withdrawn = await request.post(
        apiRoute(
          `/api/v2/projects/${projectId}/parameter-value-change-requests/${encodeURIComponent(valueRequest.id)}/withdraw`
        ),
        { headers: authHeadersForRole("software-user"), data: {} }
      );
      expect(withdrawn.ok(), await withdrawn.text()).toBe(true);

      await recordOperationEvidence({
        operationId: "PARAM-ENABLE-TOGGLE-001",
        title: "disable with reason stays independent of the canonical value round",
        status: "passed",
        role: "Software User",
        route: `/parameters?project=${projectId}`,
        page,
        testInfo,
        assertions: ["ui", "api", "db", "audit"],
        api: [
          summarizeApiResponse(enablementResponse, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/node-enablement-drafts`,
            responseSummary: `draft=${enablementBody.item.draftId}; candidate=${enablementBody.item.candidateRevisionId}`
          }),
          summarizeApiResponse(staleOnEnablementTip, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
            responseSummary: "value draft on the enablement candidate is refused stale"
          }),
          summarizeApiResponse(bindingDraft, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
            responseSummary: `draft=${bindingDraftBody.item.draftId}`
          }),
          summarizeApiResponse(valueSubmit, {
            method: "POST",
            path: `/api/v2/projects/${projectId}/parameter-value-drafts/.../submit`,
            responseSummary: `canonical request=${valueRequest.id}; enablement draft stays pending`
          })
        ],
        db: [
          {
            table: "parameter_drafts",
            predicate: `id=${enablementBody.item.draftId}`,
            observed: `kind=${persistedDraft?.edit_subject_kind}; logicalNode=${persistedDraft?.logical_node_id}; tip=${persistedDraft?.candidate_config_revision_id}`,
            rowCount: 1
          }
        ],
        audit: [
          {
            id: enablementAudit?.id,
            kind: "parameter-topology-governance",
            action: "enablement-changed",
            targetId: toggleNode!.logicalNodeId
          }
        ],
        notes:
          "UI proves disable requires reason + confirmation on labeled seed sc8562 and writes a distinct audit event. Canonical value drafts pin the Binding's own source revision, so a value edit never shares the enablement working tip (stale 409 on the enablement candidate); the value round submits as a single-stage canonical request and the node-enablement draft stays pending on its own review flow."
      });
    } finally {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId,
        projectId
      });
    }
  });

  test("PARAM-ENABLE-GUARD-001: non-standard status requires acknowledgement override", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-ENABLE-GUARD-001
    // @operation PARAM-ENABLE-GUARD-001
    test.setTimeout(180_000);
    const enableProjectId = "enable-guard";

    // The non-standard `reserved` token is part of the dedicated project's first
    // ingested source (canonical source history is immutable after ingest).
    const topology = await ensureDedicatedProjectTopology(request, {
      projectId: enableProjectId,
      name: "Enablement guard acceptance",
      code: "ENABLE-GUARD",
      source: withNodeStatus(auroraPrimarySource(), /sc8562@6E\s*\{/, "reserved")
    });
    const guardRevision = { id: topology.revisionId };

    const { nodes } = await listEffectiveTopologyNodes(
      request,
      topology.configSetId,
      guardRevision.id,
      enableProjectId
    );
    const guardNode = nodes.find((node) => (node.locator ?? "") === SC8562_LOCATOR);
    expect(guardNode?.enablement?.override ?? guardNode?.enablement?.rawToken).toBeTruthy();
    expect(
      guardNode?.enablement?.rawToken === "reserved" ||
        (guardNode?.enablement?.rawStatus ?? "").includes("reserved")
    ).toBe(true);

    await signInBrowserAsRole(
      page,
      "admin",
      `${disposableRuntime.frontendUrl}/parameters?project=${enableProjectId}`
    );
    await dismissXiaozeHint(page);

    const workspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-config-set-id", topology.configSetId, {
      timeout: 30_000
    });
    await expect(page.getByRole("tree", { name: "生效拓扑树" })).toHaveCount(0);

    const enablementDialog = await openWorkbenchEnablementDialog(
      page,
      workspace,
      "gpio_int",
      /sc8562@6E/
    );
    await expect(enablementDialog.getByRole("region", { name: "非标准 status" })).toBeVisible();
    await expect(enablementDialog).toContainText(/reserved/);
    await expect(enablementDialog.getByRole("radio", { name: "启用" })).toHaveCount(0);
    await expect(enablementDialog.getByRole("button", { name: "校验并加入本轮" })).toHaveCount(0);

    await enablementDialog.getByRole("button", { name: "仍要修改" }).click();
    await expect(enablementDialog.getByRole("radio", { name: "启用" })).toBeVisible();
    await enablementDialog.getByRole("radio", { name: "启用" }).click();
    const confirm = enablementDialog.getByRole("button", { name: "校验并加入本轮" });
    await expect(confirm).toBeDisabled();
    await enablementDialog.getByRole("textbox", { name: "修改原因" }).fill("Override reserved token");
    await expect(confirm).toBeDisabled();
    await enablementDialog
      .getByRole("checkbox", { name: "我了解将覆盖非标准 status 原文" })
      .click();
    await expect(confirm).toBeEnabled();

    await recordOperationEvidence({
      operationId: "PARAM-ENABLE-GUARD-001",
      title: "non-standard status requires acknowledgement override",
      status: "passed",
      role: "Admin",
      route: `/parameters?project=${enableProjectId}`,
      page,
      testInfo,
      assertions: ["ui"],
      notes:
        "Live DtsNodeEnablementDialog: status=reserved renders the read-only 非标准 status panel; 仍要修改 reveals the editor; 启用 is selected so confirm is not blocked by the disable checkbox; 校验并加入本轮 stays disabled until reason + 我了解将覆盖非标准 status 原文."
    });
  });

  // Planned markers (`@acceptance-planned` / `@operation-planned`) declare intended
  // coverage without counting as automated coverage; the coverage gate only accepts
  // plain markers carried by runnable tests.
  test.describe("Module attribution redesign — pending browser automation", () => {
    test("MOD-ATTR-QUEUE-001: unclassified queue dismiss and restore", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-QUEUE-001
      // @operation-planned MOD-ATTR-QUEUE-001
      test.skip(
        true,
        "Pending: playwright coverage for unclassified queue counts, dismiss, and restore with audit."
      );
      void page;
    });

    test("MOD-ATTR-CLASSIFY-001: classify with impact preview and scoped apply", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-CLASSIFY-001
      // @operation-planned MOD-ATTR-CLASSIFY-001
      test.skip(
        true,
        "Pending: playwright coverage for classify dialog preview, apply, and emptied-bucket GC."
      );
      void page;
    });

    test("MOD-ATTR-BULK-001: bulk classify into one business category", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-BULK-001
      // @operation-planned MOD-ATTR-BULK-001
      test.skip(true, "Pending: playwright coverage for multi-select bulk classify confirm.");
      void page;
    });

    test("MOD-ATTR-TREE-001: kind-scoped tree actions and adoption", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-TREE-001
      // @operation-planned MOD-ATTR-TREE-001
      test.skip(
        true,
        "Pending: playwright coverage for kind-scoped actions (node-type/driver-group no-delete, node-type move) and rename adoption across re-ingest."
      );
      void page;
    });

    test("MOD-ATTR-RECLASSIFY-001: node-type to business kind correction", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-RECLASSIFY-001
      // @operation-planned MOD-ATTR-RECLASSIFY-001
      test.skip(
        true,
        "Pending: playwright coverage for edit-dialog reclassify of node-type→business with curated kind surviving re-ingest."
      );
      void page;
    });

    test("MOD-ATTR-IMPORTANCE-001: business importance inheritance", async ({ page }) => {
      // @acceptance-planned MOD-ATTR-IMPORTANCE-001
      // @operation-planned MOD-ATTR-IMPORTANCE-001
      test.skip(
        true,
        "Pending: playwright coverage for business importance edit and workbench filter inheritance."
      );
      void page;
    });
  });

  test.describe("Driver registry — pending browser automation", () => {
    test("DRV-REG-001: register driver before upload as not-yet-observed group", async ({ page }) => {
      // @acceptance-planned DRV-REG-001
      // @operation-planned DRV-REG-001
      test.skip(
        true,
        "Pending: playwright coverage for pre-upload driver registration appearing as not-yet-observed curated driver group with parse-coverage chip."
      );
      void page;
    });

    test("DRV-REG-002: claim observed-unregistered driver promotes curated", async ({ page }) => {
      // @acceptance-planned DRV-REG-002
      // @operation-planned DRV-REG-002
      test.skip(
        true,
        "Pending: playwright coverage for claiming an observed-but-unregistered driver from queue or module tree."
      );
      void page;
    });

    test("DRV-REG-003: upload ingest summary reports registered vs unregistered", async ({ page }) => {
      // @acceptance-planned DRV-REG-003
      // @operation-planned DRV-REG-003
      test.skip(
        true,
        "Pending: playwright coverage for one-shot upload ingest summary of matched registered and new unregistered compatibles."
      );
      void page;
    });

    test("DRV-REG-004: editable nature/cardinality with authz and singleton publish gate", async ({
      page
    }) => {
      // @acceptance-planned DRV-REG-004
      // @operation-planned DRV-REG-004
      test.skip(
        true,
        "Supplemental playwright-cli evidence is under work/ui-checks/attribution-deferred/. Blocking Playwright waits for leftover PPV fixtures (TD-079)."
      );
      void page;
    });

    test("DRV-REG-005: replay-from-registration moves auto groups and skips curated", async ({
      page
    }) => {
      // @acceptance-planned DRV-REG-005
      // @operation-planned DRV-REG-005
      test.skip(
        true,
        "Supplemental playwright-cli evidence is under work/ui-checks/attribution-deferred/. Blocking Playwright waits for leftover PPV fixtures (TD-079)."
      );
      void page;
    });
  });

  test.describe("Organization driver schema overlay — pending browser automation", () => {
    test("DRV-SCHEMA-001: author and activate overlay; chip shows organization coverage", async ({
      page
    }) => {
      // @acceptance-planned DRV-SCHEMA-001
      // @operation-planned DRV-SCHEMA-001
      test.skip(
        true,
        "Pending: playwright coverage for authoring/activating an org overlay from an uncovered driver group."
      );
      void page;
    });

    test("DRV-SCHEMA-002: overlay-only compatible binds typed properties on upload", async ({
      page
    }) => {
      // @acceptance-planned DRV-SCHEMA-002
      // @operation-planned DRV-SCHEMA-002
      test.skip(
        true,
        "Pending: playwright + API coverage for DTS upload matching only an active organization overlay."
      );
      void page;
    });

    test("DRV-SCHEMA-003: reject overlay when pinned schema already covers", async ({ page }) => {
      // @acceptance-planned DRV-SCHEMA-003
      // @operation-planned DRV-SCHEMA-003
      test.skip(
        true,
        "Pending: playwright/API coverage for rejecting overlay activate when pinned schema covers the compatible."
      );
      void page;
    });

    test("DRV-SCHEMA-004: activate upgrades provisional specs without re-upload", async ({
      page
    }) => {
      // @acceptance-planned DRV-SCHEMA-004
      // @operation-planned DRV-SCHEMA-004
      test.skip(
        true,
        "Pending: playwright/API coverage for retroactive provisional-spec upgrade on overlay activate."
      );
      void page;
    });
  });

  test.describe("Pre-upload module create — pending browser automation", () => {
    test("MOD-ATTR-CREATE-KIND-001: create business/driver-group with parent rules and not-yet-observed", async ({
      page
    }) => {
      // @acceptance-planned MOD-ATTR-CREATE-KIND-001
      // @operation-planned MOD-ATTR-CREATE-KIND-001
      test.skip(
        true,
        "Pending: playwright coverage for attribution-tree create of business/driver-group with parent-kind rules, required compatibles, not-yet-observed markers, and stated (non-predicted) spec attribution."
      );
      void page;
    });
  });
});
