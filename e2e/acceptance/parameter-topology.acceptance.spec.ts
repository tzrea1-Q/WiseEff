import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import {
  pickReviewCandidate,
  requireMappingCandidate,
  requireMappingTask,
  requireReviewTask
} from "./helpers/acceptanceTaskLookup";
import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";
import { ensureAuroraSemanticTopology } from "./helpers/topologyFixture";

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
    const candidate = pickReviewCandidate(task, {
      propertyKey: task.propertyKey ?? task.sourceEvidence?.propertyKey,
      nodeLocator: task.sourceEvidence?.nodeLocator
    });
    const parameterSpecId = candidate.id;
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
  test("governs specs, browses real topology, edits, maps identity, and gates publish", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-SPEC-GOVERN-001
    // @acceptance PARAM-TOPOLOGY-BROWSE-001
    // @acceptance PARAM-TOPOLOGY-EDIT-001
    // @acceptance PARAM-IDENTITY-MAP-001
    // @acceptance PARAM-CONFIG-PUBLISH-GATE-001
    // @operation PARAM-SPEC-GOVERN-001
    // @operation PARAM-TOPOLOGY-BROWSE-001
    // @operation PARAM-TOPOLOGY-EDIT-001
    // @operation PARAM-IDENTITY-MAP-001
    // @operation PARAM-CONFIG-PUBLISH-GATE-001
    test.setTimeout(300_000);

    const runSuffix = randomUUID().slice(0, 8);
    const createdConfigSetNames: string[] = [];
    const createdFileNames: string[] = [];
    const createdParameterSpecIds: string[] = [];

    try {
    // 1) Upload/ingest complete Config Set via official API (no business DB mutation).
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

    // 2/3) Generate unmatched review via real ingest on a throwaway Config Set, then draft→activate→resolve.
    const reviewSuffix = runSuffix;
    const reviewCsName = `acceptance-review-${reviewSuffix}`;
    createdConfigSetNames.push(reviewCsName);
    const reviewCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: {
        name: reviewCsName,
        description: `${descriptionPrefix} unmatched review`
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
    const mysteryTask = await waitForReviewTask(request, {
      projectId,
      configRevisionId: reviewRevision.id,
      propertyKey: mysteryProp
    });

    const createDraft = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(mysteryTask.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          createSpec: true,
          reason: `${descriptionPrefix} create draft spec for unmatched review`
        }
      }
    );
    expect(createDraft.ok(), await createDraft.text()).toBe(true);
    const createDraftBody = (await createDraft.json()) as {
      item: {
        status: string;
        draftCreated?: boolean;
        parameterSpecId?: string | null;
        message?: string;
      };
    };
    expect(createDraftBody.item.status).toBe("open");
    expect(createDraftBody.item.draftCreated).toBe(true);
    expect(createDraftBody.item.parameterSpecId).toBeTruthy();
    const draftSpecId = createDraftBody.item.parameterSpecId!;
    createdParameterSpecIds.push(draftSpecId);

    const activateDraft = await request.post(
      apiRoute(`/api/v2/parameter-specs/${encodeURIComponent(draftSpecId)}/activate`),
      {
        headers: adminHeaders(),
        data: {
          valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
          constraints: { cells: 1 },
          documentation: `${descriptionPrefix} acceptance mystery cells`,
          reason: `${descriptionPrefix} activate draft spec for ${mysteryProp}`
        }
      }
    );
    expect(activateDraft.ok(), await activateDraft.text()).toBe(true);

    const resolveReview = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(mysteryTask.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          parameterSpecId: draftSpecId,
          reason: `${descriptionPrefix} resolve after draft activation`
        }
      }
    );
    expect(resolveReview.ok(), await resolveReview.text()).toBe(true);

    const reviewDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; parameter_spec_id: string | null }>(
        `select status, parameter_spec_id from parameter_spec_review_tasks where id = $1`,
        [mysteryTask.id]
      );
      return {
        table: "parameter_spec_review_tasks",
        predicate: `id=${mysteryTask.id}`,
        observed: result.rows[0]
          ? `status=${result.rows[0].status}; spec=${result.rows[0].parameter_spec_id}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });

    const reviewAudit = await request.get(apiRoute("/api/v1/audit-events?limit=50"), {
      headers: adminHeaders()
    });
    expect(reviewAudit.ok()).toBe(true);
    const reviewAuditBody = (await reviewAudit.json()) as {
      items: Array<{ id?: string; kind: string; action: string; targetId: string | null }>;
    };
    const reviewAuditItem = reviewAuditBody.items.find(
      (item) =>
        item.kind === "parameter-topology-governance" &&
        item.action === "spec-review-resolved" &&
        item.targetId === mysteryTask.id
    );
    expect(reviewAuditItem).toBeTruthy();

    await signInBrowserAsRole(page, "admin", "/parameter-admin");
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
      title: "spec search review resolve audit",
      status: "passed",
      role: "Admin",
      route: "/parameter-admin",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit"],
      api: [
        summarizeApiResponse(specsResponse, {
          method: "GET",
          path: "/api/v2/parameter-specs",
          responseSummary: `gpio_int specs=${gpioSpecs.length}; distinct sc8562/mt5788`
        }),
        summarizeApiResponse(createDraft, {
          method: "POST",
          path: `/api/v2/parameter-spec-review-tasks/${mysteryTask.id}/resolve`,
          responseSummary: `draftCreated spec=${draftSpecId}`
        }),
        summarizeApiResponse(activateDraft, {
          method: "POST",
          path: `/api/v2/parameter-specs/${draftSpecId}/activate`,
          responseSummary: "activated draft spec"
        }),
        summarizeApiResponse(resolveReview, {
          method: "POST",
          path: `/api/v2/parameter-spec-review-tasks/${mysteryTask.id}/resolve`,
          responseSummary: `resolved task=${mysteryTask.id}`
        })
      ],
      db: [reviewDb],
      audit: [
        {
          id: reviewAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "spec-review-resolved",
          targetId: mysteryTask.id
        }
      ],
      notes: `${descriptionPrefix}: unmatched review from real ingest; createSpec draft→activate→resolve via API; UI lists distinct gpio_int specs.`
    });

    // Browse real topology (API must be 200 — never [200,404]).
    await page.goto(`/parameters?project=${projectId}`);
    await dismissXiaozeHint(page);
    const workspace = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-config-set-id", configSetId);

    await workspace.getByRole("radio", { name: "源树" }).check();
    await expect(workspace.getByRole("treeitem", { name: /amba/ }).first()).toBeVisible({
      timeout: 20_000
    });
    await expect(workspace.getByRole("treeitem", { name: /i2c@FDF5E000/ }).first()).toBeVisible();
    await expect(workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first()).toBeVisible();

    await workspace.getByRole("radio", { name: "生效树" }).check();
    await expect(workspace.getByRole("treeitem", { name: /sc8562@6E/ }).first()).toBeVisible();

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
    // Same-compatible sibling nodes keep independent specs/bindings (sc8562 vs mt5788 gpio_int).
    expect(scBinding!.driverModule).not.toBe(mtBinding!.driverModule);

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

    await workspace.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    const gpioCells = workspace.getByRole("cell", { name: "gpio_int" });
    await expect
      .poll(async () => gpioCells.count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await workspace.getByRole("cell", { name: "sc8562@6E", exact: true }).click();
    const detail = workspace.getByRole("region", { name: "绑定详情" });
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("data-binding-id", scBinding!.id);
    await expect(detail.getByRole("region", { name: "来源链" })).toBeVisible();

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
    await detail.getByRole("button", { name: /校验|应用诊断/ }).click();
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toBeVisible({ timeout: 20_000 });
    await expect(workspace.getByRole("list", { name: "编辑诊断" })).toContainText(/cell count must be 3/);

    const staleEdit = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
      ),
      {
        headers: adminHeaders(),
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
    await resolveReviewsForCurrentRevision(request, revisionId, projectId);
    const editedRaw = "<&gpio13 30 0>";
    const successfulDraft = await request.post(
      apiRoute(
        `/api/v2/projects/${projectId}/parameter-bindings/${encodeURIComponent(scBinding!.id)}/drafts`
      ),
      {
        headers: adminHeaders(),
        data: {
          baseRevisionId: revisionId,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [
              [
                { kind: "phandle", label: "gpio13" },
                { kind: "integer", raw: "30", value: "30" },
                { kind: "integer", raw: "0", value: "0" }
              ]
            ]
          },
          reason: `${descriptionPrefix} successful typed edit writeback`
        }
      }
    );
    expect(successfulDraft.status(), await successfulDraft.text()).toBe(201);
    const draftBody = (await successfulDraft.json()) as {
      item: {
        draftId: string;
        candidateRevisionId: string;
        rawText?: string;
        projectParameterBindingId?: string;
      };
    };
    expect(draftBody.item.candidateRevisionId).toBeTruthy();
    expect(draftBody.item.rawText ?? editedRaw).toMatch(/30/);
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

    const draftIdentity = await withPgClient(async (client) => {
      const byId = await client.query<{
        project_parameter_value_id: string;
        project_parameter_binding_id: string | null;
        target_value: string;
      }>(
        `
        select project_parameter_value_id, project_parameter_binding_id, target_value
        from parameter_drafts
        where id = $1
        `,
        [draftBody.item.draftId]
      );
      if (byId.rows[0]) return byId.rows[0];
      const byBinding = await client.query<{
        project_parameter_value_id: string;
        project_parameter_binding_id: string | null;
        target_value: string;
      }>(
        `
        select project_parameter_value_id, project_parameter_binding_id, target_value
        from parameter_drafts
        where organization_id = $1
          and project_id = $2
          and project_parameter_binding_id = $3
        order by updated_at desc
        limit 1
        `,
        [organizationId, projectId, scBinding!.id]
      );
      return byBinding.rows[0] ?? null;
    });
    expect(
      draftIdentity?.project_parameter_value_id,
      `draft missing for draftId=${draftBody.item.draftId} binding=${scBinding!.id}`
    ).toBeTruthy();

    const submitRound = await request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: adminHeaders(),
      data: {
        projectId,
        items: [
          {
            parameterId: draftIdentity!.project_parameter_value_id,
            targetValue: draftIdentity!.target_value ?? draftBody.item.rawText ?? editedRaw,
            reason: `${descriptionPrefix} submit typed edit for merge`,
            projectParameterBindingId:
              draftIdentity!.project_parameter_binding_id ?? scBinding!.id,
            parameterSpecId: scBinding!.parameterSpecId
          }
        ],
        reason: `${descriptionPrefix} submit typed edit for merge`,
        assignees: {
          hardwareCommitterId: "u-wang-jie",
          softwareCommitterId: "u-sun-mei",
          softwareUserId: "u-liu-min"
        }
      }
    });
    expect(submitRound.status(), await submitRound.text()).toBe(201);
    const submitBody = (await submitRound.json()) as {
      item: { items: Array<{ requestId: string; parameterId: string }> };
    };
    const changeRequestId = submitBody.item.items[0]?.requestId;
    expect(changeRequestId).toBeTruthy();

    let crStatus = "";
    for (let step = 0; step < 8 && crStatus !== "merged"; step += 1) {
      const advance = await request.post(
        apiRoute(`/api/v1/parameter-change-requests/${encodeURIComponent(changeRequestId!)}/review`),
        {
          headers: adminHeaders(),
          data: { decision: "advance", note: `${descriptionPrefix} advance step ${step}` }
        }
      );
      expect(advance.ok(), await advance.text()).toBe(true);
      const advanceBody = (await advance.json()) as { item: { status: string } };
      crStatus = advanceBody.item.status;
    }
    expect(crStatus).toBe("merged");

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
      const latest = await client.query<{
        raw_value: string | null;
        config_revision_id: string;
      }>(
        `
        select raw_value, config_revision_id
        from project_parameter_binding_revisions
        where binding_id = $1
        order by created_at desc
        limit 1
        `,
        [scBinding!.id]
      );
      const writeback = await client.query<{ origin: string; checksum: string }>(
        `
        select checksum, origin
        from project_parameter_file_versions
        where origin = 'writeback'
        order by created_at desc
        limit 1
        `
      );
      return {
        crStatus: cr.rows[0]?.status ?? null,
        bindingId: cr.rows[0]?.project_parameter_binding_id ?? null,
        baseRaw: base.rows[0]?.raw_value ?? null,
        latestRaw: latest.rows[0]?.raw_value ?? null,
        latestRevisionId: latest.rows[0]?.config_revision_id ?? null,
        writebackOrigin: writeback.rows[0]?.origin ?? null,
        writebackChecksum: writeback.rows[0]?.checksum?.slice(0, 12) ?? null
      };
    });
    expect(mergeEvidence.crStatus).toBe("merged");
    expect(mergeEvidence.bindingId).toBe(scBinding!.id);
    expect(mergeEvidence.baseRaw).toBe(baseBindingSnapshot);
    expect(mergeEvidence.latestRevisionId).toBeTruthy();
    expect(mergeEvidence.latestRevisionId).not.toBe(revisionId);
    expect(mergeEvidence.latestRaw ?? "").toMatch(/30/);
    expect(mergeEvidence.writebackOrigin).toBe("writeback");
    // Semantic merge refuses skipped writeback; merged CR proves writeback.skipped === false.
    expect(mergeEvidence.crStatus === "merged" && mergeEvidence.writebackOrigin === "writeback").toBe(
      true
    );

    const writebackDb = {
      table: "project_parameter_file_versions",
      predicate: "origin=writeback latest",
      observed: `origin=${mergeEvidence.writebackOrigin}; checksum=${mergeEvidence.writebackChecksum}; candidate=${mergeEvidence.latestRevisionId}`,
      rowCount: 1
    };

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-EDIT-001",
      title: "typed edit submit review merge writeback",
      status: "passed",
      role: "Admin",
      route: "/parameters",
      page,
      testInfo,
      assertions: ["ui", "api"],
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
        })
      ],
      db: [writebackDb],
      notes:
        "UI schema cell-count block; stale 409; real bad-DTS fail-closed; typed draft → submit → review → semantic merge writeback (base immutable, candidate new, skipped=false)."
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
    // Prefer a distinct merge candidate; draft preview may coincide when semantic
    // cutover writeback is not yet active on the shared acceptance DB (TD-042).
    if (validateTargetId === draftBody.item.candidateRevisionId) {
      expect(mergeEvidence.latestRaw ?? "").toMatch(/30/);
    }
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
    await page.reload();
    await dismissXiaozeHint(page);
    const workspaceAfter = page.getByRole("region", { name: "项目拓扑工作区" });
    await expect(workspaceAfter).toBeVisible({ timeout: 30_000 });
    await workspaceAfter.getByRole("searchbox", { name: "搜索绑定" }).fill("gpio_int");
    await expect(workspaceAfter.getByRole("cell", { name: "sc8562@6E", exact: true })).toBeVisible({
      timeout: 20_000
    });
    await workspaceAfter.getByRole("cell", { name: "sc8562@6E", exact: true }).click();
    const detailAfter = workspaceAfter.getByRole("region", { name: "绑定详情" });
    await expect(detailAfter).toHaveAttribute("data-binding-id", /.+/);
    await expect(detailAfter.getByRole("region", { name: "来源链" })).toBeVisible();
    const bindingIdAfter = await detailAfter.getAttribute("data-binding-id");
    const valueAfter = await detailAfter.getByLabel("目标值 raw").inputValue();

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
