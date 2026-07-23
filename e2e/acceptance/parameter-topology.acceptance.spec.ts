import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Locator, type Page } from "playwright/test";

import {
  pickReviewCandidate,
  requireMappingCandidate,
  requireMappingTask,
  requireReviewTask
} from "./helpers/acceptanceTaskLookup";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import {
  startDisposablePostCutoverRuntime,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";
import { ensureAuroraSemanticTopology, ensureProjectSemanticTopology } from "./helpers/topologyFixture";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    // Typed-edit schema rejection and stale-revision conflict are intentional.
    { method: "POST", path: "/api/v2/projects/aurora/parameter-bindings", status: 400 },
    { method: "POST", path: "/api/v2/projects/aurora/parameter-bindings", status: 409 }
  ]
});

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

const brokenBase = `/dts-v1/;
/ {
	board {
		compatible = "wiseeff,acceptance-broken";
		reg = <0>;
	};
};
`;
const brokenOverlay = `/dts-v1/;
/plugin/;

&missing_label_for_compile_fail {
	broken = <1>;
};
`;

const mappingR1 = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	model = "Acceptance Mapping R1";
	bus {
		compatible = "wiseeff,amba";
		dev@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			gpio_int = <1>;
			status = "okay";
		};
	};
};
`;

const mappingR2 = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	model = "Acceptance Mapping R2";
	bus {
		compatible = "wiseeff,amba";
		left@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			gpio_int = <1>;
			status = "okay";
		};
		right@10 {
			compatible = "wiseeff,acceptance-map";
			reg = <0x10>;
			gpio_int = <2>;
			status = "okay";
		};
	};
};
`;

function adminHeaders() {
  return authHeadersForRole("admin");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function listSpecs(request: APIRequestContext, query: string) {
  return request.get(apiRoute(`/api/v2/parameter-specs?${query}`), { headers: adminHeaders() });
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
    if (row && predicate(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for revision on config set ${configSetId}`);
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

async function resolveReviewsForCurrentRevision(
  request: APIRequestContext,
  revisionId: string,
  projectId: string
) {
  const list = await request.get(
    apiRoute(
      `/api/v2/parameter-spec-review-tasks?status=open&configRevisionId=${encodeURIComponent(revisionId)}&projectId=${encodeURIComponent(projectId)}&limit=100`
    ),
    { headers: adminHeaders() }
  );
  expect(list.ok()).toBe(true);
  const body = (await list.json()) as {
    items: Array<{
      id: string;
      propertyKey?: string | null;
      sourceEvidence?: { propertyKey?: string; nodeLocator?: string };
      candidateSchemas?: Array<{ id: string; propertyKey?: string; label?: string }>;
      candidates?: Array<{ id: string; propertyKey?: string | null; label?: string }>;
    }>;
  };
  for (const task of body.items) {
    const candidates = task.candidateSchemas ?? task.candidates ?? [];
    let parameterSpecId: string;
    if (candidates.length > 0) {
      parameterSpecId = pickReviewCandidate(task, {
        propertyKey: task.propertyKey ?? task.sourceEvidence?.propertyKey,
        nodeLocator: task.sourceEvidence?.nodeLocator
      }).id;
    } else {
      const createDraft = await request.post(
        apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(task.id)}/resolve`),
        {
          headers: adminHeaders(),
          data: {
            decision: "resolved",
            createSpec: true,
            reason: `${descriptionPrefix} create occurrence-derived draft for ${task.id}`
          }
        }
      );
      expect(createDraft.ok(), `create draft spec for review ${task.id}`).toBe(true);
      const created = (await createDraft.json()) as { item: { parameterSpecId?: string | null } };
      parameterSpecId = created.item.parameterSpecId ?? "";
      expect(parameterSpecId, `review ${task.id} did not return a draft spec id`).toBeTruthy();

      const detailResponse = await request.get(
        apiRoute(`/api/v2/parameter-specs/${encodeURIComponent(parameterSpecId)}`),
        { headers: adminHeaders() }
      );
      expect(detailResponse.ok(), `load draft spec ${parameterSpecId}`).toBe(true);
      const detailBody = (await detailResponse.json()) as {
        item: { lifecycle?: string; valueShape?: Record<string, unknown> | null };
      };
      const shape = detailBody.item.valueShape;
      expect(shape && typeof shape.kind === "string", `draft ${parameterSpecId} missing valueShape`).toBeTruthy();
      const kind = String(shape!.kind);
      let constraints: Record<string, unknown> = {};
      if (kind === "cells" || kind === "u32-array" || kind === "phandle-list") {
        const cells = shape!.cellsPerGroup ?? shape!.cells;
        expect(Number.isInteger(cells) && Number(cells) > 0, `draft ${parameterSpecId} missing cells`).toBe(true);
        constraints = { cells };
      } else if (kind === "bytes") {
        const length = shape!.length;
        expect(Number.isInteger(length) && Number(length) >= 0, `draft ${parameterSpecId} missing byte length`).toBe(true);
        constraints = { minLength: length, maxLength: length };
      } else {
        expect(["bool", "empty", "string", "string-list"]).toContain(kind);
      }
      if (detailBody.item.lifecycle !== "active") {
        const activate = await request.post(
          apiRoute(`/api/v2/parameter-specs/${encodeURIComponent(parameterSpecId)}/activate`),
          {
            headers: adminHeaders(),
            data: {
              valueShape: shape,
              constraints,
              documentation: `${descriptionPrefix} occurrence-derived acceptance spec`,
              reason: `${descriptionPrefix} activate occurrence-derived acceptance spec`
            }
          }
        );
        expect(activate.ok(), `activate draft spec ${parameterSpecId}: ${await activate.text()}`).toBe(true);
      }
    }
    const resolve = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(task.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          parameterSpecId,
          reason: `${descriptionPrefix} resolve review for revision ${revisionId}`
        }
      }
    );
    expect(resolve.ok(), `resolve review ${task.id}`).toBe(true);
  }
}

test.describe("Parameter topology / schema browser acceptance", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  const originalEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    apiUrl: process.env.VITE_WISEEFF_API_BASE_URL,
    wiseEffApiUrl: process.env.WISEEFF_API_BASE_URL,
    authIssuer: process.env.AUTH_TOKEN_ISSUER,
    authSecret: process.env.AUTH_TOKEN_HMAC_SECRET,
  };

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const baseDatabaseUrl = originalEnvironment.databaseUrl?.trim();
    if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required to create the disposable topology database.");
    disposableRuntime = await startDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "parameter_topology",
    });
    process.env.DATABASE_URL = disposableRuntime.databaseUrl;
    process.env.VITE_WISEEFF_API_BASE_URL = disposableRuntime.apiUrl;
    process.env.WISEEFF_API_BASE_URL = disposableRuntime.apiUrl;
    process.env.AUTH_TOKEN_ISSUER = disposableRuntime.authIssuer;
    process.env.AUTH_TOKEN_HMAC_SECRET = disposableRuntime.authSecret;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await disposableRuntime?.dispose();
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("DATABASE_URL", originalEnvironment.databaseUrl);
    restore("VITE_WISEEFF_API_BASE_URL", originalEnvironment.apiUrl);
    restore("WISEEFF_API_BASE_URL", originalEnvironment.wiseEffApiUrl);
    restore("AUTH_TOKEN_ISSUER", originalEnvironment.authIssuer);
    restore("AUTH_TOKEN_HMAC_SECRET", originalEnvironment.authSecret);
  });

  test("governs specs, browses real topology, edits, maps identity, and gates publish", async ({
    page,
    request
  }, testInfo) => {
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
    test.setTimeout(300_000);

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
    const nebulaTopology = await ensureProjectSemanticTopology(request, "nebula");
    const topology = await ensureAuroraSemanticTopology(request);
    let { configSetId, revisionId } = topology;

    const specsResponse = await listSpecs(request, `propertyKey=${encodeURIComponent("gpio_int")}`);
    expect(specsResponse.ok()).toBe(true);
    const specsBody = (await specsResponse.json()) as {
      items: Array<{ id: string; propertyKey: string | null; driverModule: string | null }>;
    };
    const gpioSpecs = specsBody.items.filter((item) => item.propertyKey === "gpio_int");
    expect(gpioSpecs.length).toBeGreaterThanOrEqual(2);
    const specSc = gpioSpecs.find(
      (item) => item.driverModule === "sc8562" || item.id.includes("sc8562")
    );
    const specMt = gpioSpecs.find(
      (item) =>
        item.driverModule === "mt5788" ||
        item.driverModule === "mt,mt5788" ||
        item.id.includes("mt5788")
    );
    expect(specSc).toBeTruthy();
    expect(specMt).toBeTruthy();
    expect(specSc!.id).not.toBe(specMt!.id);

    // 2/3) Surface MVP: unmatched properties mint provisional ledger rows without review tasks.
    const reviewSuffix = runSuffix;
    const reviewCsName = `acceptance-review-${reviewSuffix}`;
    createdConfigSetNames.push(reviewCsName);
    const reviewCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: {
        name: reviewCsName,
        description: `${descriptionPrefix} unmatched provisional surface`
      }
    });
    expect(reviewCs.status()).toBe(201);
    const reviewCsBody = (await reviewCs.json()) as { item: { id: string } };
    const reviewDts = `/dts-v1/;
/ {
	compatible = "wiseeff,board";
	model = "Acceptance Unmatched Review";
	probe {
		compatible = "wiseeff,acceptance-map";
		acceptance_mystery_${reviewSuffix} = <42>;
		status = "okay";
	};
};
`;
    const mysteryName = `acceptance-mystery-${reviewSuffix}.dts`;
    createdFileNames.push(mysteryName);
    const mysteryUpload = await uploadDts(request, mysteryName, reviewDts);
    await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${reviewCsBody.item.id}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: mysteryUpload.fileId, role: "base", sortOrder: 0 }
      }
    );
    await uploadDts(request, mysteryName, reviewDts);
    const reviewRevision = await waitForRevision(reviewCsBody.item.id, () => true);

    const mysteryProp = `acceptance_mystery_${reviewSuffix}`;
    const openReviews = await request.get(
      apiRoute(
        `/api/v2/parameter-spec-review-tasks?status=open&projectId=${encodeURIComponent(projectId)}&configRevisionId=${encodeURIComponent(reviewRevision.id)}&limit=50`
      ),
      { headers: adminHeaders() }
    );
    expect(openReviews.ok()).toBe(true);
    const openReviewBody = (await openReviews.json()) as {
      items: Array<{ id: string; propertyKey?: string | null; sourceEvidence?: { propertyKey?: string } }>;
    };
    const mysteryReview = openReviewBody.items.find(
      (item) => item.propertyKey === mysteryProp || item.sourceEvidence?.propertyKey === mysteryProp
    );
    expect(mysteryReview, "surface MVP must not open a review task for unmatched mystery properties").toBeUndefined();

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
    expect(mysteryBinding, `expected provisional binding for ${mysteryProp}`).toBeTruthy();

    const provisionalDb = await withPgClient(async (client) => {
      const result = await client.query<{ schema_state: string | null; property_key: string }>(
        `select br.schema_state, dps.property_key
         from project_parameter_bindings b
         join project_parameter_binding_revisions br
           on br.binding_id = b.id and br.config_revision_id = $2
         join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
         where b.project_id = $1 and dps.property_key = $3
         limit 1`,
        [projectId, reviewRevision.id, mysteryProp]
      );
      return {
        table: "project_parameter_binding_revisions",
        predicate: `project=${projectId}; revision=${reviewRevision.id}; property=${mysteryProp}`,
        observed: result.rows[0]
          ? `schema_state=${result.rows[0].schema_state ?? "null"}; property=${result.rows[0].property_key}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });

    await signInBrowserAsRole(page, "admin", `${disposableRuntime.frontendUrl}/parameter-admin`);
    await dismissXiaozeHint(page);
    const specLibrary = page.getByRole("region", { name: "参数规格库" });
    await expect(specLibrary).toBeVisible({ timeout: 30_000 });
    await page.getByRole("searchbox", { name: "搜索规格" }).fill("gpio_int");
    await expect(specLibrary.getByRole("cell", { name: "gpio_int" }).first()).toBeVisible({
      timeout: 20_000
    });
    const gpioRows = specLibrary.locator("tbody tr").filter({ hasText: "gpio_int" });
    await expect(gpioRows.first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => gpioRows.count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await gpioRows.first().getByRole("button", { name: /查看 gpio_int/ }).click();
    await expect(page.getByRole("region", { name: "规格详情" })).toBeVisible({ timeout: 15_000 });

    await recordOperationEvidence({
      operationId: "PARAM-SPEC-GOVERN-001",
      title: "spec search with provisional unmatched surface",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      assertions: ["ui", "api", "db"],
      api: [
        summarizeApiResponse(specsResponse, {
          method: "GET",
          path: "/api/v2/parameter-specs",
          responseSummary: `gpio_int specs=${gpioSpecs.length}; distinct sc8562/mt5788`
        }),
        summarizeApiResponse(openReviews, {
          method: "GET",
          path: "/api/v2/parameter-spec-review-tasks",
          responseSummary: `open tasks=${openReviewBody.items.length}; mystery review absent`
        }),
        summarizeApiResponse(mysteryBindings, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings`,
          responseSummary: `provisional mystery binding=${mysteryBinding!.id}`
        })
      ],
      db: [provisionalDb],
      notes: `${descriptionPrefix}: unmatched mystery property is provisional on surface (no review task); UI lists distinct gpio_int specs.`
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
    await workspace.getByRole("button", { name: "技术视图" }).click();
    await expect(workspace.getByRole("tree", { name: "生效 DTS 拓扑" })).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.getByRole("treeitem", { name: /amba/ }).first()).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.getByRole("treeitem", { name: /i2c@FDF5E000/ }).first()).toBeVisible();
    await expect(workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first()).toBeVisible();
    await workspace.getByRole("button", { name: /查看 gpio_int/ }).first().click();
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
        parameterSpecId?: string;
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
    expect(scBinding!.parameterSpecId).toBeTruthy();
    // Same-compatible sibling nodes keep independent specs/bindings (sc8562 vs mt5788 gpio_int).
    expect(scBinding!.driverModule).not.toBe(mtBinding!.driverModule);

    await workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first().click();
    const scopedSc8562Row = bindingRowById(workspace, scBinding!.id);
    await expect(scopedSc8562Row.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();
    await expect(scopedSc8562Row).toContainText("sc8562@6E");
    await expect(scopedSc8562Row).toContainText("<&gpio13 29 0>");
    await expect(bindingRowById(workspace, mtBinding!.id)).toHaveCount(0);
    // Toggle the same tree node to clear subtree scoping (toolbar no longer has clear-all).
    await workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first().click();
    const unscopedMt5788Row = bindingRowById(workspace, mtBinding!.id);
    await expect(unscopedMt5788Row.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();
    await expect(unscopedMt5788Row).toContainText("mt5788@2B");

    const baseBindingSnapshot = await withPgClient(async (client) => {
      const result = await client.query<{ raw_value: string | null }>(
        `
        select br.raw_value
        from project_parameter_binding_revisions br
        where br.binding_id = $1 and br.config_revision_id = $2
        `,
        [scBinding!.id, revisionId]
      );
      return result.rows[0]?.raw_value ?? null;
    });
    expect(baseBindingSnapshot).toBeTruthy();

    await workspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const gpioCells = workspace.getByRole("cell", { name: "gpio_int" });
    await expect
      .poll(async () => gpioCells.count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    const sc8562Row = bindingRowById(workspace, scBinding!.id);
    await expect(sc8562Row.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();
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
    await detail.getByLabel("目标值 raw").fill("<&gpio13 29>");
    await detail.getByLabel("修改原因").fill(`${descriptionPrefix} invalid cell-count probe`);
    await detail.getByRole("button", { name: /创建草稿/ }).click();
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toBeVisible({ timeout: 20_000 });
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toContainText(/cell count must be 3/);

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

    await detail.getByLabel("目标值 raw").fill(originalRaw);

    // Fail-closed blocker from REAL bad DTS (accurate failure code).
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
      data: { name: brokenCsName, description: `${descriptionPrefix} compiler failure` }
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
    await uploadDts(request, brokenOverlayName, brokenOverlay);
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

    await resolveReviewsForCurrentRevision(request, revisionId, projectId);
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
      await expect(sc8562EditRow.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();
      await sc8562EditRow.getByRole("button", { name: /^编辑 gpio_int/ }).click();
      const editDetail = page.getByRole("dialog", { name: /gpio_int 参数详情/ });
      await expect(editDetail.getByText(scBinding!.id, { exact: true })).toBeVisible();
      await editDetail.getByLabel("目标值 raw").fill(editedRaw);
      await editDetail.getByLabel("修改原因").fill(typedEditReason);
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`)
      );
      await editDetail.getByRole("button", { name: /创建草稿/ }).click();
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
    expect(draftBody.item.projectParameterBindingId).toBe(scBinding!.id);
    expect(draftBody.item.rawText ?? editedRaw).toMatch(/30/);

    // A candidate from Aurora must never be requested under Nebula after the visible project switch.
    const nebulaCurrentResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      response.url().includes(`/api/v2/projects/nebula/config-sets/${encodeURIComponent(nebulaTopology.configSetId)}/revisions/current/topology`) &&
      response.url().includes("view=effective")
    );
    await page.getByRole("combobox", { name: "项目" }).click();
    await page.getByRole("option", { name: /Nebula 高频调试项目/ }).click();
    expect((await nebulaCurrentResponse).status()).toBe(200);
    await expect(editWorkspace).toHaveAttribute("data-project-id", "nebula");
    await expect(editWorkspace).toHaveAttribute("data-revision-id", nebulaTopology.revisionId);
    await expect(page.getByRole("region", { name: "绑定变更提交" })).toHaveCount(0);
    await expect(page.getByText(/尚未生成语义配置修订/)).toHaveCount(0);

    const auroraCurrentResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      response.url().includes(`/api/v2/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/revisions/current/topology`) &&
      response.url().includes("view=effective")
    );
    await page.getByRole("combobox", { name: "项目" }).click();
    await page.getByRole("option", { name: /Aurora/ }).click();
    expect((await auroraCurrentResponse).status()).toBe(200);
    await expect(editWorkspace).toHaveAttribute("data-project-id", projectId);
    await expect(editWorkspace).not.toHaveAttribute("data-revision-id", "");

    // The project switch intentionally discarded the first pending draft UI; recreate it on Aurora current.
    successfulDraft = await createTypedDraftInAurora();
    expect(successfulDraft.status(), await successfulDraft.text()).toBe(201);
    draftBody = (await successfulDraft.json()) as typeof draftBody;
    expect(draftBody.item.candidateRevisionId).toBeTruthy();
    // Draft-time candidate is preview only — no open CR for this binding yet.
    const openCrBefore = await withPgClient(async (client) => {
      const result = await client.query<{ c: string }>(
        `
        select count(*)::text as c
        from parameter_change_requests
        where project_parameter_binding_id = $1
          and status not in ('merged', 'rejected', 'cancelled')
        `,
        [scBinding!.id]
      );
      return Number(result.rows[0]?.c ?? 0);
    });
    expect(openCrBefore).toBe(0);

    const submissionPanel = page.getByRole("region", { name: "绑定变更提交" });
    await expect(submissionPanel).toBeVisible();
    const hardwareAssignee = submissionPanel.getByLabel("硬件 MDE");
    const softwareCommitterAssignee = submissionPanel.getByLabel("软件 MDE");
    const softwareUserAssignee = submissionPanel.getByLabel("软件开发");
    const optionTexts = async (select: typeof hardwareAssignee) =>
      (await select.locator("option").allTextContents()).map((text) => text.trim()).sort();
    await expect(hardwareAssignee).not.toHaveValue("");
    await expect(softwareCommitterAssignee).not.toHaveValue("");
    await expect(softwareUserAssignee).not.toHaveValue("");
    await expect.poll(() => optionTexts(hardwareAssignee)).toEqual(["Li Peng", "Wang Jie"]);
    await expect.poll(() => optionTexts(softwareCommitterAssignee)).toEqual(["Sun Mei"]);
    await expect.poll(() => optionTexts(softwareUserAssignee)).toEqual(["Chen Na", "Liu Min", "Sun Mei"]);
    for (const select of [hardwareAssignee, softwareCommitterAssignee, softwareUserAssignee]) {
      await expect(select).not.toContainText("Xu Yun");
      await expect(select).not.toContainText("Tao Lin");
    }
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
          responseSummary: "project-scoped eligible assignees populated all three visible selectors"
        }
      ],
      notes: "Binding-centric submit panel defaulted every workflow selector to an eligible active user."
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
          responseSummary: "exact role-specific option sets excluded admin, inactive, guest, and role-ineligible users"
        }
      ],
      notes: "Visible binding workflow selectors exposed only the exact project-scoped eligible option sets."
    });
    await hardwareAssignee.selectOption("u-wang-jie");
    await softwareCommitterAssignee.selectOption("u-sun-mei");
    await softwareUserAssignee.selectOption("u-liu-min");
    await expect(hardwareAssignee).toHaveValue("u-wang-jie");
    await expect(softwareCommitterAssignee).toHaveValue("u-sun-mei");
    await expect(softwareUserAssignee).toHaveValue("u-liu-min");
    const submitRoundPromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes("/api/v1/parameter-submission-rounds")
    );
    await submissionPanel.getByRole("button", { name: "提交审核" }).click();
    const submitRound = await submitRoundPromise;
    expect(submitRound.status(), await submitRound.text()).toBe(201);
    const submitWire = submitRound.request().postDataJSON() as {
      items?: Array<Record<string, unknown>>;
    };
    expect(submitWire.items?.[0]).toMatchObject({
      draftId: draftBody.item.draftId,
      projectParameterBindingId: scBinding!.id,
      parameterSpecId: scBinding!.parameterSpecId,
      action: "set"
    });
    expect(submitWire.items?.[0]).not.toHaveProperty("parameterId");
    const submitBody = (await submitRound.json()) as {
      item: {
        status: string;
        items: Array<{ requestId: string; parameterId: string; candidateConfigRevisionId?: string }>;
      };
    };
    const changeRequestId = submitBody.item.items[0]?.requestId;
    expect(changeRequestId).toBeTruthy();
    expect(submitBody.item.status).toBe("hardware_review");
    expect(submitBody.item.items[0]?.candidateConfigRevisionId).toBe(draftBody.item.candidateRevisionId);
    await expect(submissionPanel.getByText(/已提交正式审核/)).toBeVisible();
    await submissionPanel.getByRole("button", { name: "查看审核队列" }).click();

    const advanceReviewInUi = async (
      role: "hardware-committer" | "software-committer" | "software-user",
      expectedStage: RegExp,
      targetRequestId = changeRequestId!,
      rowText = editedRaw,
    ) => {
      await signInBrowserAsRole(
        page,
        role,
        `${disposableRuntime.frontendUrl}/parameter-review`,
      );
      const requestRow = page.getByRole("row").filter({ hasText: rowText }).first();
      await expect(requestRow).toBeVisible({ timeout: 30_000 });
      await requestRow.click();
      const reviewDetail = page.getByRole("complementary", { name: "审阅详情" });
      await expect(reviewDetail).toBeVisible();
      await reviewDetail.getByRole("button", { name: /查看提交详情/ }).click();
      const submissionDetail = page.getByRole("dialog", { name: "提交详情" });
      await expect(submissionDetail).toBeVisible();
      await submissionDetail.getByRole("button", { name: "关闭" }).click();
      await expect(reviewDetail.locator(".vertical-timeline-item--current")).toContainText(expectedStage);
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/parameter-change-requests/${encodeURIComponent(targetRequestId)}/review`)
      );
      await reviewDetail.getByRole("button", {
        name: role === "software-user" ? "确认合入" : "推进流程"
      }).click();
      const response = await responsePromise;
      expect(response.ok(), await response.text()).toBe(true);
      const body = (await response.json()) as {
        item: { status: string; action?: "set" | "delete"; targetValue?: string };
      };
      return { response, body };
    };

    const { response: hardwareReview, body: hardwareReviewBody } = await advanceReviewInUi(
      "hardware-committer",
      /硬件(?:Committer|MDE)检视/,
    );
    expect(hardwareReviewBody.item.status).toBe("software_review");

    const { response: softwareReview, body: softwareReviewBody } = await advanceReviewInUi(
      "software-committer",
      /软件(?:Committer|MDE)检视/,
    );
    expect(softwareReviewBody.item.status).toBe("software_merge");

    const beforeMerge = await withPgClient(async (client) => {
      const result = await client.query<{
        status: string;
        candidate_config_revision_id: string;
        candidate_status: string;
        history_count: string;
        merge_audit_count: string;
        writeback_audit_count: string;
      }>(
        `
        select
          cr.status,
          cr.candidate_config_revision_id,
          candidate.status as candidate_status,
          (select count(*)::text from parameter_history_entries h where h.request_id = cr.id) as history_count,
          (
            select count(*)::text from audit_events ae
            where ae.kind = 'parameter-merge' and ae.target_id = cr.id
          ) as merge_audit_count,
          (
            select count(*)::text from audit_events ae
            where ae.kind = 'parameter-writeback-to-file'
              and ae.metadata ->> 'projectParameterBindingId' = cr.project_parameter_binding_id
              and ae.created_at >= cr.created_at
          ) as writeback_audit_count
        from parameter_change_requests cr
        inner join dts_config_revisions candidate on candidate.id = cr.candidate_config_revision_id
        where cr.id = $1
        `,
        [changeRequestId]
      );
      return result.rows[0];
    });
    expect(beforeMerge?.status).toBe("software_merge");
    expect(beforeMerge?.candidate_config_revision_id).toBe(draftBody.item.candidateRevisionId);
    expect(beforeMerge?.candidate_status).toBe("pending_approval");
    expect(Number(beforeMerge?.history_count ?? 0)).toBe(0);
    expect(Number(beforeMerge?.merge_audit_count ?? 0)).toBe(0);
    expect(Number(beforeMerge?.writeback_audit_count ?? 0)).toBe(0);

    const { response: semanticMerge, body: semanticMergeBody } = await advanceReviewInUi(
      "software-user",
      /软件(?:User|开发人员?)合入/,
    );
    expect(semanticMergeBody.item.status).toBe("merged");
    const mergeRequestId = semanticMerge.headers()["x-request-id"];
    expect(mergeRequestId).toBeTruthy();

    const mergeEvidence = await withPgClient(async (client) => {
      const cr = await client.query<{
        status: string;
        project_parameter_binding_id: string | null;
      }>(
        `select status, project_parameter_binding_id from parameter_change_requests where id = $1`,
        [changeRequestId]
      );
      const base = await client.query<{ raw_value: string | null }>(
        `
        select raw_value from project_parameter_binding_revisions
        where binding_id = $1 and config_revision_id = $2
        `,
        [scBinding!.id, revisionId]
      );
      const writebackAudit = await client.query<{
        id: string;
        trace_id: string;
        target_id: string | null;
        candidate_revision_id: string | null;
      }>(
        `
        select
          id,
          trace_id,
          target_id,
          metadata ->> 'candidateRevisionId' as candidate_revision_id
        from audit_events
        where kind = 'parameter-writeback-to-file'
          and trace_id = $1
        order by created_at desc
        limit 1
        `,
        [mergeRequestId]
      );
      const candidateRevisionId = writebackAudit.rows[0]?.candidate_revision_id ?? null;
      const candidate = await client.query<{
        raw_value: string | null;
        config_revision_id: string;
      }>(
        `
        select raw_value, config_revision_id
        from project_parameter_binding_revisions
        where binding_id = $1 and config_revision_id = $2
        `,
        [scBinding!.id, candidateRevisionId]
      );
      const writeback = await client.query<{ id: string; origin: string; checksum: string }>(
        `
        select id, checksum, origin
        from project_parameter_file_versions
        where file_id = $1 and origin = 'writeback'
        order by created_at desc
        limit 1
        `,
        [writebackAudit.rows[0]?.target_id]
      );
      const completion = await client.query<{
        history_count: string;
        merge_audit_count: string;
      }>(
        `
        select
          (select count(*)::text from parameter_history_entries where request_id = $1) as history_count,
          (
            select count(*)::text from audit_events
            where kind = 'parameter-merge' and target_id = $1 and trace_id = $2
          ) as merge_audit_count
        `,
        [changeRequestId, mergeRequestId]
      );
      return {
        crStatus: cr.rows[0]?.status ?? null,
        bindingId: cr.rows[0]?.project_parameter_binding_id ?? null,
        baseRaw: base.rows[0]?.raw_value ?? null,
        latestRaw: candidate.rows[0]?.raw_value ?? null,
        latestRevisionId: candidate.rows[0]?.config_revision_id ?? null,
        writebackAuditId: writebackAudit.rows[0]?.id ?? null,
        writebackTraceId: writebackAudit.rows[0]?.trace_id ?? null,
        writebackFileId: writebackAudit.rows[0]?.target_id ?? null,
        writebackVersionId: writeback.rows[0]?.id ?? null,
        writebackOrigin: writeback.rows[0]?.origin ?? null,
        writebackChecksum: writeback.rows[0]?.checksum?.slice(0, 12) ?? null,
        historyCount: Number(completion.rows[0]?.history_count ?? 0),
        mergeAuditCount: Number(completion.rows[0]?.merge_audit_count ?? 0)
      };
    });
    expect(mergeEvidence.crStatus).toBe("merged");
    expect(mergeEvidence.bindingId).toBe(scBinding!.id);
    expect(mergeEvidence.baseRaw).toBe(baseBindingSnapshot);
    expect(mergeEvidence.latestRevisionId).toBeTruthy();
    expect(mergeEvidence.latestRevisionId).not.toBe(revisionId);
    expect(mergeEvidence.latestRevisionId).not.toBe(draftBody.item.candidateRevisionId);
    expect(mergeEvidence.latestRaw ?? "").toMatch(/30/);
    expect(mergeEvidence.writebackAuditId).toBeTruthy();
    expect(mergeEvidence.writebackTraceId).toBe(mergeRequestId);
    expect(mergeEvidence.writebackVersionId).toBeTruthy();
    expect(mergeEvidence.writebackOrigin).toBe("writeback");
    expect(mergeEvidence.historyCount).toBe(1);
    expect(mergeEvidence.mergeAuditCount).toBe(1);

    // A real typed delete uses the public API for the currently UI-less delete control,
    // then the same visible role-review UI and semantic merge/writeback boundary.
    await signInBrowserAsRole(
      page,
      "software-user",
      `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`
    );
    const preDeleteWorkspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(preDeleteWorkspace).toHaveAttribute(
      "data-revision-id",
      mergeEvidence.latestRevisionId!,
      { timeout: 30_000 }
    );
    await preDeleteWorkspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const preDeleteMt5788Row = bindingRowById(preDeleteWorkspace, mtBinding!.id);
    await expect(preDeleteMt5788Row.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();
    await expect(preDeleteMt5788Row).toContainText("mt5788@2B");
    const deleteReason = `${descriptionPrefix} delete gpio_int through formal review`;
    const deleteBaseBindingSnapshot = await withPgClient(async (client) => {
      const result = await client.query<{ raw_value: string | null }>(
        `select raw_value from project_parameter_binding_revisions
         where binding_id = $1 and config_revision_id = $2`,
        [mtBinding!.id, mergeEvidence.latestRevisionId]
      );
      return result.rows[0]?.raw_value ?? null;
    });
    expect(deleteBaseBindingSnapshot).toBeTruthy();
    const deleteDraft = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(mtBinding!.id)}/drafts`
      ),
      {
        headers: authHeadersForRole("software-user"),
        data: {
          baseRevisionId: mergeEvidence.latestRevisionId,
          action: "delete",
          reason: deleteReason
        }
      }
    );
    expect(deleteDraft.status(), await deleteDraft.text()).toBe(201);
    const deleteDraftBody = (await deleteDraft.json()) as {
      item: {
        draftId: string;
        candidateRevisionId: string;
        rawText: string;
        action: "delete";
        parameterSpecId: string;
        projectParameterBindingId: string;
      };
    };
    expect(deleteDraftBody.item).toMatchObject({
      action: "delete",
      rawText: "",
      projectParameterBindingId: mtBinding!.id
    });
    const deleteCandidateBeforeSubmit = await withPgClient(async (client) => {
      const result = await client.query<{
        binding_revision_count: string;
        delete_effect_count: string;
      }>(
        `select
           (
             select count(*)::text from project_parameter_binding_revisions
             where binding_id = $1 and config_revision_id = $2
           ) as binding_revision_count,
           (
             select count(*)::text from dts_occurrence_effects oe
             inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
             inner join project_parameter_bindings b on b.logical_node_id = lnr.logical_node_id
             inner join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
             where b.id = $1
               and oe.config_revision_id = $2
               and lnr.config_revision_id = $2
               and oe.effect_kind = 'delete'
               and oe.property_name = dps.property_key
           ) as delete_effect_count`,
        [mtBinding!.id, deleteDraftBody.item.candidateRevisionId]
      );
      return result.rows[0];
    });
    expect(deleteCandidateBeforeSubmit).toEqual({
      binding_revision_count: "0",
      delete_effect_count: "1"
    });

    const deleteSubmit = await request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: authHeadersForRole("software-user"),
      data: {
        projectId,
        items: [
          {
            draftId: deleteDraftBody.item.draftId,
            projectParameterBindingId: deleteDraftBody.item.projectParameterBindingId,
            parameterSpecId: deleteDraftBody.item.parameterSpecId,
            action: "delete",
            targetValue: "",
            reason: deleteReason
          }
        ],
        assignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-liu-min"
        }
      }
    });
    expect(deleteSubmit.status(), await deleteSubmit.text()).toBe(201);
    const deleteSubmitBody = (await deleteSubmit.json()) as {
      item: {
        status: string;
        items: Array<{
          requestId: string;
          action: "delete";
          targetValue: string;
          candidateConfigRevisionId?: string;
        }>;
      };
    };
    const deleteRequestId = deleteSubmitBody.item.items[0]?.requestId;
    expect(deleteRequestId).toBeTruthy();
    expect(deleteSubmitBody.item.status).toBe("hardware_review");
    expect(deleteSubmitBody.item.items[0]).toMatchObject({
      action: "delete",
      targetValue: "",
      candidateConfigRevisionId: deleteDraftBody.item.candidateRevisionId
    });

    const deleteBeforeMerge = await withPgClient(async (client) => {
      const result = await client.query<{
        request_action: string;
        item_action: string;
        request_candidate_id: string;
        item_candidate_id: string;
        candidate_status: string;
        history_count: string;
        merge_audit_count: string;
        writeback_audit_count: string;
      }>(
        `select
           cr.action as request_action,
           psi.action as item_action,
           cr.candidate_config_revision_id as request_candidate_id,
           psi.candidate_config_revision_id as item_candidate_id,
           candidate.status as candidate_status,
           (select count(*)::text from parameter_history_entries where request_id = cr.id) as history_count,
           (select count(*)::text from audit_events where kind = 'parameter-merge' and target_id = cr.id) as merge_audit_count,
           (
             select count(*)::text from audit_events
             where kind = 'parameter-writeback-to-file'
               and metadata ->> 'changeRequestId' = cr.id
           ) as writeback_audit_count
         from parameter_change_requests cr
         inner join parameter_submission_items psi on psi.change_request_id = cr.id
         inner join dts_config_revisions candidate on candidate.id = cr.candidate_config_revision_id
         where cr.id = $1`,
        [deleteRequestId]
      );
      return result.rows[0];
    });
    expect(deleteBeforeMerge).toEqual({
      request_action: "delete",
      item_action: "delete",
      request_candidate_id: deleteDraftBody.item.candidateRevisionId,
      item_candidate_id: deleteDraftBody.item.candidateRevisionId,
      candidate_status: "pending_approval",
      history_count: "0",
      merge_audit_count: "0",
      writeback_audit_count: "0"
    });

    const { response: deleteHardwareReview, body: deleteHardwareBody } = await advanceReviewInUi(
      "hardware-committer",
      /硬件(?:Committer|MDE)检视/,
      deleteRequestId!,
      "gpio_int"
    );
    expect(deleteHardwareBody.item.status).toBe("software_review");
    const { response: deleteSoftwareReview, body: deleteSoftwareBody } = await advanceReviewInUi(
      "software-committer",
      /软件(?:Committer|MDE)检视/,
      deleteRequestId!,
      "gpio_int"
    );
    expect(deleteSoftwareBody.item.status).toBe("software_merge");
    const { response: deleteMerge, body: deleteMergeBody } = await advanceReviewInUi(
      "software-user",
      /软件(?:User|开发人员?)合入/,
      deleteRequestId!,
      "gpio_int"
    );
    expect(deleteMergeBody.item).toMatchObject({ status: "merged", action: "delete", targetValue: "" });
    const deleteMergeRequestId = deleteMerge.headers()["x-request-id"];
    expect(deleteMergeRequestId).toBeTruthy();

    const deleteMergeEvidence = await withPgClient(async (client) => {
      const writebackAudit = await client.query<{
        id: string;
        trace_id: string;
        target_id: string;
        candidate_revision_id: string;
        change_action: string;
      }>(
        `select id, trace_id, target_id,
                metadata ->> 'candidateRevisionId' as candidate_revision_id,
                metadata ->> 'changeAction' as change_action
         from audit_events
         where kind = 'parameter-writeback-to-file' and trace_id = $1
         order by created_at desc limit 1`,
        [deleteMergeRequestId]
      );
      const candidateRevisionId = writebackAudit.rows[0]?.candidate_revision_id;
      const completion = await client.query<{
        action: string;
        value: string;
        binding_revision_count: string;
        delete_effect_count: string;
        merge_audit_count: string;
        source_text: string | null;
      }>(
        `select
           cr.action,
           phe.value,
           (
             select count(*)::text from project_parameter_binding_revisions
             where binding_id = cr.project_parameter_binding_id and config_revision_id = $2
           ) as binding_revision_count,
           (
             select count(*)::text from dts_occurrence_effects oe
             inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
             inner join project_parameter_bindings b on b.logical_node_id = lnr.logical_node_id
             inner join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
             where b.id = cr.project_parameter_binding_id
               and oe.config_revision_id = $2
               and lnr.config_revision_id = $2
               and oe.effect_kind = 'delete'
               and oe.property_name = dps.property_key
           ) as delete_effect_count,
           (
             select count(*)::text from audit_events
             where kind = 'parameter-merge' and target_id = cr.id and trace_id = $3
           ) as merge_audit_count,
           (
             select parsed_index ->> 'sourceText' from project_parameter_file_versions
             where file_id = $4 order by version_number desc limit 1
           ) as source_text
         from parameter_change_requests cr
         inner join parameter_history_entries phe on phe.request_id = cr.id
         where cr.id = $1`,
        [deleteRequestId, candidateRevisionId, deleteMergeRequestId, writebackAudit.rows[0]?.target_id]
      );
      return {
        writebackAuditId: writebackAudit.rows[0]?.id ?? null,
        traceId: writebackAudit.rows[0]?.trace_id ?? null,
        fileId: writebackAudit.rows[0]?.target_id ?? null,
        candidateRevisionId: candidateRevisionId ?? null,
        changeAction: writebackAudit.rows[0]?.change_action ?? null,
        action: completion.rows[0]?.action ?? null,
        historyValue: completion.rows[0]?.value ?? null,
        bindingRevisionCount: Number(completion.rows[0]?.binding_revision_count ?? 0),
        deleteEffectCount: Number(completion.rows[0]?.delete_effect_count ?? 0),
        mergeAuditCount: Number(completion.rows[0]?.merge_audit_count ?? 0),
        sourceText: completion.rows[0]?.source_text ?? ""
      };
    });
    expect(deleteMergeEvidence).toMatchObject({
      traceId: deleteMergeRequestId,
      changeAction: "delete",
      action: "delete",
      historyValue: "",
      bindingRevisionCount: 0,
      deleteEffectCount: 1,
      mergeAuditCount: 1
    });
    expect(deleteMergeEvidence.candidateRevisionId).toBeTruthy();
    expect(deleteMergeEvidence.candidateRevisionId).not.toBe(mergeEvidence.latestRevisionId);
    expect(deleteMergeEvidence.sourceText).toMatch(/\/delete-property\/\s*gpio_int/);
    const setCandidateStillImmutable = await withPgClient(async (client) => {
      const result = await client.query<{ raw_value: string | null }>(
        `select raw_value from project_parameter_binding_revisions
         where binding_id = $1 and config_revision_id = $2`,
        [mtBinding!.id, mergeEvidence.latestRevisionId]
      );
      return result.rows[0]?.raw_value ?? null;
    });
    expect(setCandidateStillImmutable).toBe(deleteBaseBindingSnapshot);

    const deleteReload = await request.get(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${encodeURIComponent(deleteMergeEvidence.candidateRevisionId!)}`
      ),
      { headers: authHeadersForRole("software-user") }
    );
    expect(deleteReload.ok(), await deleteReload.text()).toBe(true);
    const deleteReloadBody = (await deleteReload.json()) as { items: Array<{ id: string }> };
    expect(deleteReloadBody.items.some((item) => item.id === mtBinding!.id)).toBe(false);
    await signInBrowserAsRole(
      page,
      "software-user",
      `${disposableRuntime.frontendUrl}/parameters?project=${projectId}`
    );
    const deleteReloadWorkspace = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(deleteReloadWorkspace).toHaveAttribute(
      "data-revision-id",
      deleteMergeEvidence.candidateRevisionId!,
      { timeout: 30_000 }
    );
    await deleteReloadWorkspace.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    await expect(bindingRowById(deleteReloadWorkspace, mtBinding!.id)).toHaveCount(0);
    await expect(semanticBindingRow(deleteReloadWorkspace, "mt5788@2B")).toHaveCount(0);
    const sc8562DeleteRow = semanticBindingRow(deleteReloadWorkspace, "sc8562@6E");
    await expect(sc8562DeleteRow.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible();

    const writebackDb = {
      table: "project_parameter_file_versions",
      predicate: "origin=writeback latest",
      observed: `origin=${mergeEvidence.writebackOrigin}; checksum=${mergeEvidence.writebackChecksum}; candidate=${mergeEvidence.latestRevisionId}; history=${mergeEvidence.historyCount}; mergeAudit=${mergeEvidence.mergeAuditCount}`,
      rowCount: 1
    };
    const deleteWritebackDb = {
      table: "dts_occurrence_effects, project_parameter_binding_revisions, parameter_history_entries",
      predicate: `delete candidate=${deleteMergeEvidence.candidateRevisionId}`,
      observed: `action=${deleteMergeEvidence.action}; tombstones=${deleteMergeEvidence.deleteEffectCount}; candidateBindings=${deleteMergeEvidence.bindingRevisionCount}; historyValue=empty; mergeAudit=${deleteMergeEvidence.mergeAuditCount}`,
      rowCount: 1
    };

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-EDIT-001",
      title: "typed edit submit review merge writeback",
      status: "passed",
      role: "Software User + Hardware/Software Committers",
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
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `requestId=${changeRequestId}`
        }),
        summarizeApiResponse(hardwareReview, {
          method: "POST",
          path: `/api/v1/parameter-change-requests/${changeRequestId}/review`,
          responseSummary: `role=hardware-committer; status=${hardwareReviewBody.item.status}`
        }),
        summarizeApiResponse(softwareReview, {
          method: "POST",
          path: `/api/v1/parameter-change-requests/${changeRequestId}/review`,
          responseSummary: `role=software-committer; status=${softwareReviewBody.item.status}`
        }),
        summarizeApiResponse(semanticMerge, {
          method: "POST",
          path: `/api/v1/parameter-change-requests/${changeRequestId}/review`,
          responseSummary: `role=software-user; status=${semanticMergeBody.item.status}; writeback.skipped=false; candidate=${mergeEvidence.latestRevisionId}`
        }),
        summarizeApiResponse(deleteDraft, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
          responseSummary: `action=delete; tombstoneCandidate=${deleteDraftBody.item.candidateRevisionId}`
        }),
        summarizeApiResponse(deleteSubmit, {
          method: "POST",
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `action=delete; requestId=${deleteRequestId}`
        }),
        summarizeApiResponse(deleteMerge, {
          method: "POST",
          path: `/api/v1/parameter-change-requests/${deleteRequestId}/review`,
          responseSummary: `role=software-user; action=delete; status=${deleteMergeBody.item.status}; writeback.skipped=false; candidate=${deleteMergeEvidence.candidateRevisionId}`
        }),
        summarizeApiResponse(deleteReload, {
          method: "GET",
          path: `/api/v2/projects/${projectId}/parameter-bindings?revisionId=${deleteMergeEvidence.candidateRevisionId}`,
          responseSummary: `deleted binding present=false; candidate=${deleteMergeEvidence.candidateRevisionId}`
        })
      ],
      db: [writebackDb, deleteWritebackDb],
      audit: [
        {
          id: mergeEvidence.writebackAuditId ?? undefined,
          kind: "parameter-writeback-to-file",
          action: "writeback",
          targetId: mergeEvidence.writebackFileId,
          requestId: mergeEvidence.writebackTraceId ?? undefined,
          metadataSummary: `candidateRevisionId=${mergeEvidence.latestRevisionId}; skipped=false`
        },
        {
          id: deleteMergeEvidence.writebackAuditId ?? undefined,
          kind: "parameter-writeback-to-file",
          action: "writeback",
          targetId: deleteMergeEvidence.fileId,
          requestId: deleteMergeEvidence.traceId ?? undefined,
          metadataSummary: `changeAction=delete; candidateRevisionId=${deleteMergeEvidence.candidateRevisionId}; skipped=false`
        }
      ],
      notes:
        "API mode contains no legacy recommended-value workbench; UI schema cell-count block; stale 409; real bad-DTS fail-closed; set and delete typed drafts both traverse formal submit → visible role review → semantic merge/writeback. Delete is created through the public API because no delete UI exists, carries a same-chain tombstone, preserves prior revisions, creates no replacement binding revision, and remains absent after API/UI reload."
    });
    await recordOperationEvidence({
      operationId: "PARAM-HAPPY-001",
      title: "binding-centric parameter submit review merge persistence audit",
      status: "passed",
      role: "Software User + Hardware/Software Committers + Admin",
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
          path: "/api/v1/parameter-submission-rounds",
          responseSummary: `UI submitted request=${changeRequestId}`
        }),
        summarizeApiResponse(semanticMerge, {
          method: "POST",
          path: `/api/v1/parameter-change-requests/${changeRequestId}/review`,
          responseSummary: `role UI merge=${semanticMergeBody.item.status}; candidate=${mergeEvidence.latestRevisionId}`
        })
      ],
      db: [writebackDb],
      audit: [
        {
          id: mergeEvidence.writebackAuditId ?? undefined,
          kind: "parameter-writeback-to-file",
          action: "writeback",
          targetId: mergeEvidence.writebackFileId,
          requestId: mergeEvidence.writebackTraceId ?? undefined,
          metadataSummary: `candidateRevisionId=${mergeEvidence.latestRevisionId}; skipped=false`
        }
      ],
      notes:
        "Binding-centric API-mode UI searched gpio_int, created the typed candidate, submitted with scoped assignees, advanced all three visible role stages, persisted writeback, and emitted audit evidence without rendering recommendedValue compatibility UI."
    });

    // Identity mapping via real ambiguous ingest (throwaway Config Set).
    const mapSuffix = runSuffix;
    const mapCsName = `acceptance-map-${mapSuffix}`;
    createdConfigSetNames.push(mapCsName);
    const mapCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: mapCsName, description: `${descriptionPrefix} identity map` }
    });
    expect(mapCs.status()).toBe(201);
    const mapCsBody = (await mapCs.json()) as { item: { id: string } };
    const r1Name = `acceptance-map-r1-${mapSuffix}.dts`;
    const r2Name = `acceptance-map-r2-${mapSuffix}.dts`;
    createdFileNames.push(r1Name, r2Name);
    const r1Upload = await uploadDts(request, r1Name, mappingR1);
    await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${mapCsBody.item.id}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: r1Upload.fileId, role: "base", sortOrder: 0 }
      }
    );
    await uploadDts(request, r1Name, mappingR1);
    const r1Revision = await waitForRevision(mapCsBody.item.id, (row) =>
      ["resolved", "validated", "needs_mapping"].includes(row.status)
    );
    expect(r1Revision.status).not.toBe("invalid");

    const r2Upload = await uploadDts(request, r2Name, mappingR2);
    await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${mapCsBody.item.id}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: r2Upload.fileId, role: "overlay", sortOrder: 1 }
      }
    );
    await uploadDts(request, r2Name, mappingR2);
    const r2Revision = await waitForRevision(
      mapCsBody.item.id,
      (row) => row.id !== r1Revision.id && row.status === "needs_mapping",
      30_000
    );

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
    const validateTargetId = mergeEvidence.latestRevisionId!;
    expect(validateTargetId).toBeTruthy();
    expect(validateTargetId).not.toBe(revisionId);
    expect(validateTargetId).not.toBe(draftBody.item.candidateRevisionId);
    await resolveReviewsForCurrentRevision(request, validateTargetId, projectId);

    const validateResponse = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/config-revisions/${encodeURIComponent(validateTargetId)}/validate`
      ),
      { headers: adminHeaders(), data: { stage: "toolchain" } }
    );
    expect(validateResponse.ok()).toBe(true);
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

    const baseRevisionUnchanged = await withPgClient(async (client) => {
      const result = await client.query<{ raw_value: string | null; status: string }>(
        `
        select br.raw_value, cr.status
        from project_parameter_binding_revisions br
        inner join dts_config_revisions cr on cr.id = br.config_revision_id
        where br.binding_id = $1 and br.config_revision_id = $2
        `,
        [scBinding!.id, revisionId]
      );
      return result.rows[0];
    });
    expect(baseRevisionUnchanged?.raw_value).toBe(baseBindingSnapshot);
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
    await page.goto(`${disposableRuntime.frontendUrl}/parameters?project=${projectId}`);
    await page.reload();
    await dismissXiaozeHint(page);
    const workspaceAfter = page.getByRole("region", { name: "DTS 参数工作台" });
    await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
    await workspaceAfter.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
    const sc8562ReloadRow = bindingRowById(workspaceAfter, scBinding!.id);
    await expect(sc8562ReloadRow.getByRole("cell", { name: "gpio_int", exact: true })).toBeVisible({
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
      const result = await client.query<{ id: string; raw_value: string | null }>(
        `
        select b.id, br.raw_value
        from project_parameter_bindings b
        inner join project_parameter_binding_revisions br on br.binding_id = b.id
        where b.id = $1
        order by br.created_at desc nulls last
        limit 1
        `,
        [bindingIdAfter]
      );
      return {
        table: "project_parameter_binding_revisions",
        predicate: `binding=${bindingIdAfter}`,
        observed: result.rows[0]
          ? `id=${result.rows[0].id}; raw=${result.rows[0].raw_value}`
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
});
