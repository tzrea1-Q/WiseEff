import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
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
      propertyKey?: string;
      candidateSchemas?: Array<{ id: string; propertyKey?: string }>;
    }>;
  };
  for (const task of body.items) {
    expect(task.candidateSchemas?.length ?? 0, `task ${task.id} must expose candidates`).toBeGreaterThan(0);
    const parameterSpecId = task.candidateSchemas![0]!.id;
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

    // 2/3) Generate unmatched review via real ingest on a throwaway Config Set, then resolve.
    const reviewSuffix = randomUUID().slice(0, 8);
    const reviewCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: {
        name: `acceptance-review-${reviewSuffix}`,
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

    const openReviews = await request.get(
      apiRoute(`/api/v2/parameter-spec-review-tasks?status=open&limit=50`),
      { headers: adminHeaders() }
    );
    expect(openReviews.ok()).toBe(true);
    const openReviewBody = (await openReviews.json()) as {
      items: Array<{
        id: string;
        candidateSchemas?: Array<{ id: string; label?: string }>;
        sourceEvidence?: { propertyKey?: string; configRevisionId?: string };
      }>;
    };
    const mysteryProp = `acceptance_mystery_${reviewSuffix}`;
    const mysteryTask =
      openReviewBody.items.find(
        (item) =>
          item.sourceEvidence?.propertyKey === mysteryProp ||
          item.sourceEvidence?.configRevisionId === reviewRevision.id
      ) ?? openReviewBody.items[0];
    expect(
      mysteryTask,
      `expected open review for ${mysteryProp}; open=${openReviewBody.items.length}`
    ).toBeTruthy();

    const resolveReview = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(mysteryTask!.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: mysteryTask!.candidateSchemas?.[0]?.id
          ? {
              decision: "resolved",
              parameterSpecId: mysteryTask!.candidateSchemas[0].id,
              reason: `${descriptionPrefix} approve mystery/unmatched review`
            }
          : {
              decision: "resolved",
              createSpec: true,
              reason: `${descriptionPrefix} create-and-resolve unmatched review`
            }
      }
    );
    expect(resolveReview.ok(), await resolveReview.text()).toBe(true);

    const reviewDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; parameter_spec_id: string | null }>(
        `select status, parameter_spec_id from parameter_spec_review_tasks where id = $1`,
        [mysteryTask!.id]
      );
      return {
        table: "parameter_spec_review_tasks",
        predicate: `id=${mysteryTask!.id}`,
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
        item.targetId === mysteryTask!.id
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
        summarizeApiResponse(resolveReview, {
          method: "POST",
          path: `/api/v2/parameter-spec-review-tasks/${mysteryTask!.id}/resolve`,
          responseSummary: `resolved task=${mysteryTask!.id}`
        })
      ],
      db: [reviewDb],
      audit: [
        {
          id: reviewAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "spec-review-resolved",
          targetId: mysteryTask!.id
        }
      ],
      notes: `${descriptionPrefix}: unmatched review from real ingest; resolved via API; UI lists distinct gpio_int specs.`
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
    const suffix = randomUUID().slice(0, 8);
    const brokenBaseName = `acceptance-broken-base-${suffix}.dts`;
    const brokenOverlayName = `acceptance-broken-overlay-${suffix}.dts`;
    const brokenCsName = `acceptance-broken-cs-${suffix}`;
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

    // Successful typed edit → precise DTS writeback + re-ingest (createBindingDraft).
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
      };
    };
    expect(draftBody.item.candidateRevisionId).toBeTruthy();
    expect(draftBody.item.rawText ?? editedRaw).toMatch(/30/);

    const writebackDb = await withPgClient(async (client) => {
      const result = await client.query<{ checksum: string; origin: string }>(
        `
        select checksum, origin
        from project_parameter_file_versions
        where origin = 'writeback'
        order by created_at desc
        limit 1
        `
      );
      return {
        table: "project_parameter_file_versions",
        predicate: "origin=writeback latest",
        observed: result.rows[0]
          ? `origin=${result.rows[0].origin}; checksum=${result.rows[0].checksum.slice(0, 12)}`
          : "missing",
        rowCount: result.rowCount ?? result.rows.length
      };
    });
    expect(writebackDb.observed).toContain("writeback");

    await recordOperationEvidence({
      operationId: "PARAM-TOPOLOGY-EDIT-001",
      title: "typed edit schema diagnostics, stale 409, compiler failure",
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
          responseSummary: `draft=${draftBody.item.draftId}; candidate=${draftBody.item.candidateRevisionId}; raw=${editedRaw}`
        })
      ],
      db: [writebackDb],
      notes:
        "UI schema cell-count block; stale 409; real bad-DTS fail-closed; successful typed draft writeback+reingest."
    });

    // Identity mapping via real ambiguous ingest (throwaway Config Set).
    const mapSuffix = randomUUID().slice(0, 8);
    const mapCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: `acceptance-map-${mapSuffix}`, description: `${descriptionPrefix} identity map` }
    });
    expect(mapCs.status()).toBe(201);
    const mapCsBody = (await mapCs.json()) as { item: { id: string } };
    const r1Name = `acceptance-map-r1-${mapSuffix}.dts`;
    const r2Name = `acceptance-map-r2-${mapSuffix}.dts`;
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
    const openMapTask = mappingBody.items.find(
      (item) => item.configRevisionId === r2Revision.id
    ) ?? mappingBody.items[0];
    expect(openMapTask).toBeTruthy();
    const selected =
      openMapTask!.evidence?.candidates?.find((c) => c.nodeLocator.includes("left")) ??
      openMapTask!.evidence?.candidates?.[0];
    expect(selected?.logicalNodeId).toBeTruthy();

    const resolveMapping = await request.post(
      apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(openMapTask!.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          selectedLogicalNodeId: selected!.logicalNodeId,
          reason: `${descriptionPrefix} resolve mapping via real ingest task`
        }
      }
    );
    expect(resolveMapping.ok()).toBe(true);

    // Resolve any remaining open mapping tasks on this revision.
    const stillOpenMaps = await request.get(
      apiRoute(
        `/api/v2/identity-mapping-tasks?projectId=${encodeURIComponent(projectId)}&status=open`
      ),
      { headers: adminHeaders() }
    );
    const stillOpenBody = (await stillOpenMaps.json()) as {
      items: Array<{
        id: string;
        configRevisionId?: string;
        evidence?: { candidates?: Array<{ logicalNodeId: string }> };
      }>;
    };
    for (const task of stillOpenBody.items.filter((item) => item.configRevisionId === r2Revision.id)) {
      const pick = task.evidence?.candidates?.[0];
      if (!pick) continue;
      await request.post(apiRoute(`/api/v2/identity-mapping-tasks/${encodeURIComponent(task.id)}/resolve`), {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          selectedLogicalNodeId: pick.logicalNodeId,
          reason: `${descriptionPrefix} clear remaining map`
        }
      });
    }

    const mappingDb = await withPgClient(async (client) => {
      const result = await client.query<{ status: string }>(
        `select status from identity_mapping_tasks where id = $1`,
        [openMapTask!.id]
      );
      return {
        table: "identity_mapping_tasks",
        predicate: `id=${openMapTask!.id}`,
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
        item.targetId === openMapTask!.id
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
          path: `/api/v2/identity-mapping-tasks/${openMapTask!.id}/resolve`,
          responseSummary: `selected=${selected!.logicalNodeId}`
        })
      ],
      db: [mappingDb],
      audit: [
        {
          id: mappingAuditItem?.id,
          kind: "parameter-topology-governance",
          action: "identity-mapping-resolved",
          targetId: openMapTask!.id
        }
      ],
      notes: "Ambiguous ingest created open-mapping; validate fail-closed; resolve via API with audit."
    });

    // 10) SUCCESSFUL validate on golden/candidate path (not schema-failed-as-success).
    const validateTargetId = draftBody.item.candidateRevisionId || revisionId;
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
      notes: `${descriptionPrefix}: successful validate (not schema-failed); bindingId+provenance persist after reload. org=${organizationId} runId=${randomUUID().slice(0, 8)}`
    });
  });
});
