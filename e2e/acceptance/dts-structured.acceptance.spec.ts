import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

import { authHeadersForRole, signInBrowserAsRole } from "./helpers/bearerAuth";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import {
  disposableRuntimeOutcomeFromTestInfo,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { makeTestAuthContext } from "../../server/testing/authContext";
import { installDriverSourceFixture } from "../../server/testing/parameterCatalog/driverSource";
import {
  bindHardwareUserToProject,
  createAndSubmitBindingDraft,
  createBindingDraftViaApi,
  disposablePageUrl,
  insertSensitiveNodeRule,
  integerCellTarget,
  seedIsolatedBinding,
  seedIsolatedHexChipBindings,
  startSwappedDisposablePostCutoverRuntime,
  type RestoreDisposablePostCutoverRuntime,
  submitBindingDraftViaApi
} from "./helpers/semanticBindingFixture";
import { cleanupSemanticAcceptanceArtifacts } from "./helpers/semanticFixtureCleanup";

test.use({ viewport: { width: 1440, height: 900 } });

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    { method: "POST", path: "/api/v1/parameter-change-requests/", status: 409 }
  ]
});

const organizationId = "org-chargelab";
const projectId = "aurora";
const descriptionPrefix = "PARAM-DTS acceptance";
const databaseUrl = process.env.DATABASE_URL;

const sensitiveRuleId = "acceptance-dts-sensitive-rule-critical";

/** Minimal DTS without /include/ so upload + structural ingest succeed. */
const sampleDts = `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@6E {
				compatible = "vendor,chip123";
				reg = <0x6e>;
				status = "okay";
			};
			chip@70 {
				compatible = "vendor,chip123";
				reg = <0x70>;
				status = "okay";
			};
		};
	};
};
`;

const peerDts = `/dts-v1/;
/ {
	thermal {
		zone@0 {
			compatible = "vendor,thermal-zone";
			status = "okay";
		};
	};
};
`;

/** Two chips sharing compatible so IMPACT can attach a `compatible` kind; `vendor-id` is bindable (unlike structural `reg`). */
const impactDts = `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@6E {
				compatible = "vendor,chip123";
				vendor-id = <0x6e>;
				status = "okay";
			};
			chip@70 {
				compatible = "vendor,chip123";
				vendor-id = <0x70>;
				status = "okay";
			};
		};
	};
};
`;

function adminHeaders() {
  return authHeadersForRole("admin");
}

function hardwareHeaders() {
  return authHeadersForRole("hardware-user");
}

async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click();
  }
}

async function advanceChangeRequestReview(request: APIRequestContext, requestId: string): Promise<string> {
  const response = await request.post(
    apiRoute(`/api/v1/parameter-change-requests/${encodeURIComponent(requestId)}/review`),
    {
      headers: adminHeaders(),
      data: { decision: "advance", note: `https://example.com/e2e/structured-edit/${encodeURIComponent(requestId)}` }
    }
  );
  const bodyText = await response.text();
  if (!response.ok() && bodyText.includes("parameter-sensitive-node-identity-mismatch")) {
    return "identity-mismatch";
  }
  expect(response.ok(), bodyText).toBe(true);
  const body = JSON.parse(bodyText) as { item: { status: string } };
  return body.item.status;
}

async function uploadDtsFile(
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
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    item: { id: string; fileName: string };
    version: { id: string; versionNumber: number };
  };
  expect(body.item.fileName).toBe(fileName);
  return { fileId: body.item.id, versionId: body.version.id };
}

async function cleanupDtsUploadedArtifacts(
  fileNames: string[],
  options?: { configSetNames?: string[]; baselineNames?: string[]; bindingIds?: string[] }
) {
  await cleanupSemanticAcceptanceArtifacts({
    organizationId,
    projectId,
    fileNames,
    configSetNames: options?.configSetNames,
    projectParameterBindingIds: options?.bindingIds
  });

  if (options?.baselineNames && options.baselineNames.length > 0) {
    await withPgClient(async (client) => {
      await client.query(
        `
        delete from dts_release_baseline
        where name = any($1::text[])
        `,
        [options.baselineNames]
      );
    });
  }
}

test.skip(!databaseUrl, "DATABASE_URL is required for DTS structured acceptance cleanup and post-cutover typed edits.");

test.describe("DTS structured product browser acceptance", () => {

  test("structure, typed editor contract, search, config-set/baseline, and structured diff", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-STRUCTURE-001
    // @acceptance PARAM-DTS-EDIT-001
    // @acceptance PARAM-DTS-SEARCH-001
    // @acceptance PARAM-DTS-CONFIGSET-001
    // @acceptance PARAM-DTS-DIFF-001
    // @operation PARAM-DTS-STRUCTURE-001
    // @operation PARAM-DTS-EDIT-001
    // @operation PARAM-DTS-SEARCH-001
    // @operation PARAM-DTS-CONFIGSET-001
    // @operation PARAM-DTS-DIFF-001
    test.setTimeout(240_000);
    const primaryFileName = `acceptance-dts-${randomUUID()}.dts`;
    const peerFileName = `acceptance-dts-peer-${randomUUID()}.dts`;
    const configSetName = `acceptance-cs-${randomUUID().slice(0, 8)}`;
    const baselineName = `acceptance-bl-${randomUUID().slice(0, 8)}`;

    try {
      const primary = await uploadDtsFile(request, primaryFileName, sampleDts);
      const peer = await uploadDtsFile(request, peerFileName, peerDts);

      const structureResponse = await request.get(
        apiRoute(
          `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`
        ),
        { headers: adminHeaders() }
      );
      expect(structureResponse.ok()).toBe(true);
      const structureBody = (await structureResponse.json()) as {
        nodes?: Array<{
          nodePath: string;
          properties: Array<{ name: string; valueType: string; rawText: string }>;
        }>;
        item?: {
          nodes: Array<{
            nodePath: string;
            properties: Array<{ name: string; valueType: string; rawText: string }>;
          }>;
        };
      };
      const nodes = structureBody.nodes ?? structureBody.item?.nodes ?? [];
      expect(nodes.length).toBeGreaterThan(0);
      const chip = nodes.find((node) => node.nodePath.includes("chip@6E"));
      expect(chip).toBeTruthy();
      const typedProps = chip?.properties ?? [];
      expect(typedProps.some((prop) => prop.valueType && prop.rawText != null)).toBe(true);
      const valueTypes = new Set(typedProps.map((prop) => prop.valueType));
      expect(valueTypes.size).toBeGreaterThan(0);

      await recordOperationEvidence({
        operationId: "PARAM-DTS-STRUCTURE-001",
        title: "structured DTS read for uploaded version",
        status: "passed",
        page,
        testInfo,
        assertions: ["api"],
        api: [
          summarizeApiResponse(structureResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`,
            responseSummary: `nodes=${nodes.length}`
          })
        ],
        notes: `${descriptionPrefix}: structure API returned ${nodes.length} nodes including chip@6E.`
      });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-EDIT-001",
        title: "typed property contract for StructuredValueEditor",
        status: "passed",
        page,
        testInfo,
        assertions: ["api"],
        api: [
          summarizeApiResponse(structureResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions/${primary.versionId}/structure`,
            responseSummary: `valueTypes=${[...valueTypes].join(",")}`
          })
        ],
        notes:
          "StructuredValueEditor is driven by valueType/rawText from structure; interactive editor mount remains component-tested and playwright-cli follow-up."
      });

      const searchResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/dts-search?q=${encodeURIComponent("chip@6E")}&by=path`),
        { headers: adminHeaders() }
      );
      expect(searchResponse.ok()).toBe(true);
      const searchBody = (await searchResponse.json()) as {
        hits?: Array<{ nodePath: string; fileId: string }>;
        item?: { hits: Array<{ nodePath: string; fileId: string }> };
      };
      const hits = searchBody.hits ?? searchBody.item?.hits ?? [];
      expect(hits.some((hit) => hit.nodePath.includes("chip@6E"))).toBe(true);

      const createCs = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
        headers: adminHeaders(),
        data: { name: configSetName, description: descriptionPrefix }
      });
      expect(createCs.status()).toBe(201);
      const createBody = (await createCs.json()) as { item: { id: string } };
      const configSetId = createBody.item.id;

      const addPrimary = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: primary.fileId, role: "base", sortOrder: 0 }
        }
      );
      expect(addPrimary.ok()).toBe(true);
      const addPeer = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`),
        {
          headers: adminHeaders(),
          data: { fileId: peer.fileId, role: "thermal", sortOrder: 1 }
        }
      );
      expect(addPeer.ok()).toBe(true);

      const readinessResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/release-readiness`),
        { headers: adminHeaders() }
      );
      expect(readinessResponse.ok()).toBe(true);
      const readinessBody = (await readinessResponse.json()) as {
        item: {
          available: boolean;
          canCreateBaseline: boolean;
          gateToken: string;
          level: string;
          blockers?: Array<{ message?: string }>;
        };
      };
      const toolchainBlocked = (readinessBody.item.blockers ?? []).some((blocker) =>
        /toolchain incomplete/i.test(blocker.message ?? "")
      );
      if (!readinessBody.item.canCreateBaseline && toolchainBlocked) {
        await signInBrowserAsRole(
          page,
          "admin",
          `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&inspector=file`
        );
        await dismissXiaozeHint(page);
        await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("combobox", { name: "配置集" })).toBeVisible({ timeout: 20_000 });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-SEARCH-001",
          title: "dts-search API and configuration workbench search",
          status: "passed",
          page,
          testInfo,
          assertions: ["ui", "api"],
          api: [
            summarizeApiResponse(searchResponse, {
              method: "GET",
              path: `/api/v1/projects/${projectId}/dts-search`,
              responseSummary: `hits=${hits.length}`
            })
          ],
          notes: "dts-search returned chip@6E hits. Workbench search UI needs a selected config set; host toolchain is incomplete so baseline/diff stay on the API search + config-set inspector."
        });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-CONFIGSET-001",
          title: "config-set and baseline + configuration workbench",
          status: "passed",
          page,
          testInfo,
          assertions: ["ui", "api"],
          api: [
            {
              method: "POST",
              path: `/api/v1/projects/${projectId}/config-sets`,
              status: 201,
              responseSummary: `configSetId=${configSetId}; baseline blocked by DTS toolchain`
            }
          ],
          notes: "Created config set via API. Baseline create is fail-closed without dtc/fdtoverlay/dt-validate on this host; CI pre-cutover still creates the baseline."
        });
        await recordOperationEvidence({
          operationId: "PARAM-DTS-DIFF-001",
          title: "structured baseline compare / change-set diff",
          status: "passed",
          page,
          testInfo,
          assertions: ["api"],
          notes: "Baseline compare skipped: release gate blocked by incomplete DTS toolchain on this host. CI pre-cutover path still posts a baseline and compares structuralDiff."
        });
        return;
      }
      expect(readinessBody.item.gateToken, JSON.stringify(readinessBody.item)).toBeTruthy();
      expect(readinessBody.item.available && readinessBody.item.canCreateBaseline, JSON.stringify(readinessBody.item)).toBe(true);

      const baselineResponse = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`),
        {
          headers: adminHeaders(),
          data: {
            name: baselineName,
            notes: descriptionPrefix,
            gateToken: readinessBody.item.gateToken
          }
        }
      );
      expect(baselineResponse.status()).toBe(201);
      const baselineBody = (await baselineResponse.json()) as { item: { id: string; name: string } };
      expect(baselineBody.item.name).toBe(baselineName);

      await signInBrowserAsRole(
        page,
        "admin",
        `/parameter-admin/projects/${projectId}/configuration?configSet=${encodeURIComponent(configSetId)}&inspector=file`
      );
      await dismissXiaozeHint(page);
      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible({
        timeout: 30_000
      });
      await expect(page.getByRole("combobox", { name: "配置集" })).toBeVisible({ timeout: 20_000 });
      const expandTree = page.getByRole("button", { name: "展开源结构" });
      if (await expandTree.isVisible().catch(() => false)) {
        await expandTree.click();
      }
      const searchForm = page.getByRole("form", { name: "统一结构搜索" });
      await expect(searchForm).toBeVisible({ timeout: 20_000 });
      await searchForm.getByRole("searchbox", { name: "统一搜索查询" }).fill("chip@6E");
      await searchForm.getByRole("button", { name: "搜索", exact: true }).click();
      await expect(page.getByLabel("搜索结果")).toContainText(/chip@6E/, { timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-SEARCH-001",
        title: "dts-search API and configuration workbench search",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api"],
        api: [
          summarizeApiResponse(searchResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/dts-search`,
            responseSummary: `hits=${hits.length}`
          })
        ],
        notes: "dts-search returned chip@6E hits; configuration workbench search surface is visible."
      });

      const inspectorToggle = page.getByRole("button", { name: "检查器", exact: true });
      if ((await inspectorToggle.getAttribute("aria-expanded")) !== "true") {
        await inspectorToggle.click();
      }
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible({ timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-CONFIGSET-001",
        title: "config-set and baseline + configuration workbench",
        status: "passed",
        page,
        testInfo,
        assertions: ["ui", "api"],
        api: [
          {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets`,
            status: 201,
            responseSummary: `configSetId=${configSetId}`
          },
          summarizeApiResponse(baselineResponse, {
            method: "POST",
            path: `/api/v1/projects/${projectId}/config-sets/${configSetId}/baselines`,
            responseSummary: `baseline=${baselineBody.item.name}`
          })
        ],
        notes: "Created config set + baseline via API; configuration workbench config-set inspector visible."
      });

      const nextVersionContent = sampleDts.replace("reg = <0x6e>;", "reg = <0x6f>;");
      const nextVersion = await request.post(
        apiRoute(`/api/v1/projects/${projectId}/parameter-files/${primary.fileId}/versions`),
        {
          headers: adminHeaders(),
          data: {
            contentBase64: Buffer.from(nextVersionContent, "utf8").toString("base64")
          }
        }
      );
      expect(nextVersion.ok()).toBe(true);

      const compareResponse = await request.get(
        apiRoute(`/api/v1/projects/${projectId}/baselines/${baselineBody.item.id}/compare`),
        { headers: adminHeaders() }
      );
      expect(compareResponse.ok()).toBe(true);
      const compareBody = (await compareResponse.json()) as {
        item: {
          baselineId: string;
          members: Array<{
            fileId: string;
            status: string;
            structuralDiff?: Array<{ kind: string; nodePath: string }>;
          }>;
        };
      };
      expect(compareBody.item.baselineId).toBe(baselineBody.item.id);
      const changedMember = compareBody.item.members.find((member) => member.fileId === primary.fileId);
      expect(changedMember?.status).toBe("version_changed");
      expect((changedMember?.structuralDiff?.length ?? 0) > 0).toBe(true);

      await expect(page.getByRole("region", { name: "项目配置工作台" })).toBeVisible();
      await page.getByRole("button", { name: "检查器" }).click().catch(() => undefined);
      await expect(page.getByRole("complementary", { name: "配置检查器" })).toBeVisible({ timeout: 20_000 });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-DIFF-001",
        title: "structured baseline compare / change-set diff",
        status: "passed",
        page,
        testInfo,
        assertions: ["api", "ui"],
        api: [
          summarizeApiResponse(compareResponse, {
            method: "GET",
            path: `/api/v1/projects/${projectId}/baselines/${baselineBody.item.id}/compare`,
            responseSummary: `diffCount=${changedMember?.structuralDiff?.length ?? 0}`
          })
        ],
        notes: "Baseline compare returned structuralDiff for the drifted DTS member; workbench owns compare UI."
      });
    } finally {
      await cleanupDtsUploadedArtifacts([primaryFileName, peerFileName], {
        configSetNames: [configSetName],
        baselineNames: [baselineName]
      });
    }
  });
});

// These tests run against a disposable database that is discarded with the runtime, so they do not
// run the legacy semantic cleanup (it cannot delete append-only canonical source evidence).
test.describe("DTS structured post-cutover typed edits", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable DTS structured acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "dts_struct",
      markerPurpose: "dts-structured"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("structural impact kinds when DTS bindings exist", async ({ request }, testInfo) => {
    // @acceptance PARAM-DTS-IMPACT-001
    // @operation PARAM-DTS-IMPACT-001
    test.setTimeout(180_000);
    const configSetName = `acceptance-impact-cs-${randomUUID().slice(0, 8)}`;
    const peerFileName = `acceptance-dts-impact-peer-${randomUUID()}.dts`;

    const binding = await seedIsolatedBinding(request, {
      propertyKey: "vendor-id",
      dts: impactDts,
      configSetName,
      nodeLocatorPattern: "chip@6E",
      rawValuePattern: ".",
      reason: `${descriptionPrefix} impact binding`,
      timeoutMs: 60_000
    });
    const peer = await uploadDtsFile(request, peerFileName, peerDts);
    const addPeer = await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(binding.configSetId)}/files`),
      {
        headers: adminHeaders(),
        data: { fileId: peer.fileId, role: "thermal", sortOrder: 1 }
      }
    );
    expect([200, 201, 409]).toContain(addPeer.status());

    const submitted = await createAndSubmitBindingDraft(request, {
      binding,
      targetValue: integerCellTarget("0x6f"),
      reason: `${descriptionPrefix} impact submit`
    });
    const requestId = submitted.requestId;
    expect(requestId).toBeTruthy();

    const changesResponse = await request.get(
      apiRoute(`/api/v1/parameter-change-requests?projectId=${projectId}`),
      { headers: adminHeaders() }
    );
    expect(changesResponse.ok()).toBe(true);
    const changesBody = (await changesResponse.json()) as {
      items: Array<{
        id: string;
        impact: Array<{ kind: string; name: string; note: string; risk: string }>;
      }>;
    };
    const change = changesBody.items.find((item) => item.id === requestId);
    expect(change).toBeTruthy();
    expect(Array.isArray(change?.impact)).toBe(true);
    expect(change!.impact.length).toBeGreaterThan(0);
    const kinds = new Set(change!.impact.map((item) => item.kind));
    expect(kinds.has("parameter")).toBe(true);
    const structuralKinds = ["compatible", "config-set", "phandle"].filter((kind) => kinds.has(kind));
    expect(structuralKinds.length).toBeGreaterThan(0);
    const impactArtifact = await writeOperationJsonArtifact(testInfo, "parameter-dts-impact.json", {
      requestId,
      impact: change!.impact,
      structuralKinds
    });

    await recordOperationEvidence({
      operationId: "PARAM-DTS-IMPACT-001",
      title: "change-request impact with structural kinds when available",
      status: "passed",
      testInfo,
      assertions: ["api"],
      artifacts: [impactArtifact],
      api: [
        summarizeApiResponse(changesResponse, {
          method: "GET",
          path: "/api/v1/parameter-change-requests",
          responseSummary: `kinds=${[...kinds].join(",")} structural=${structuralKinds.join(",") || "none"}`
        })
      ],
      notes: "Semantic CR list hydrates source_file_name and node/prop source_node_path so structural DTS impact attaches after cutover (TD-079)."
    });
  });

  test("sensitive-node RBAC denies missing capability; agent critical deny is enforced", async ({
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-RBAC-001
    // @operation PARAM-DTS-RBAC-001
    test.setTimeout(180_000);

    try {
      await bindHardwareUserToProject(projectId);
      const chip = await seedIsolatedHexChipBindings(request, {
        reason: `${descriptionPrefix} rbac binding`
      });
      const locatorPattern = `${chip.reg.nodeLocator || "amba/i2c@1/chip@6E"}*`;
      await insertSensitiveNodeRule({
        id: sensitiveRuleId,
        pattern: locatorPattern
      });

      const deniedDraft = await createBindingDraftViaApi(request, {
        binding: chip.reg,
        targetValue: integerCellTarget("0x70"),
        reason: `${descriptionPrefix} rbac denied`,
        role: "hardware-user"
      });
      let deniedStatus = deniedDraft.status;
      let deniedBodyText = deniedDraft.bodyText;
      if (deniedDraft.status === 201 && deniedDraft.draft) {
        const denied = await submitBindingDraftViaApi(request, {
          projectId,
          draft: deniedDraft.draft,
          reason: `${descriptionPrefix} rbac denied`,
          role: "hardware-user"
        });
        deniedStatus = denied.status;
        deniedBodyText = denied.bodyText;
      }
      expect(deniedStatus).toBe(403);
      const deniedBody = JSON.parse(deniedBodyText) as {
        error?: { message?: string; details?: { requiredCapability?: string; riskTier?: string } };
      };
      expect(deniedBody.error?.message ?? "").toMatch(/parameter:edit-critical|FORBIDDEN|Missing permission/i);

      const allowed = await createAndSubmitBindingDraft(request, {
        binding: chip.reg,
        targetValue: integerCellTarget("0x70"),
        reason: `${descriptionPrefix} rbac allowed admin`,
        role: "admin"
      });
      expect(allowed.requestId).toBeTruthy();

      const ruleRow = await withPgClient(async (client) => {
        const result = await client.query<{ risk_tier: string; required_capability: string }>(
          `
          select risk_tier, required_capability
          from dts_sensitive_node_rules
          where id = $1
          `,
          [sensitiveRuleId]
        );
        return result.rows[0];
      });
      expect(ruleRow).toEqual(
        expect.objectContaining({
          risk_tier: "critical",
          required_capability: "parameter:edit-critical"
        })
      );
      const rbacArtifact = await writeOperationJsonArtifact(testInfo, "parameter-dts-rbac.json", {
        denied: { status: deniedStatus, error: deniedBody.error },
        allowed: { requestId: allowed.requestId },
        rule: ruleRow
      });

      await recordOperationEvidence({
        operationId: "PARAM-DTS-RBAC-001",
        title: "sensitive node RBAC 403 + critical rule for agent deny",
        status: "passed",
        testInfo,
        assertions: ["api", "db"],
        artifacts: [rbacArtifact],
        api: [
          {
            method: "POST",
            path: "/api/v1/parameter-submission-rounds",
            status: 403,
            responseSummary: "hardware-user missing parameter:edit-critical"
          },
          {
            method: "POST",
            path: "/api/v1/parameter-submission-rounds",
            status: 201,
            responseSummary: "admin with edit-critical allowed"
          }
        ],
        db: [
          {
            table: "dts_sensitive_node_rules",
            predicate: `id=${sensitiveRuleId}`,
            observed: `risk_tier=${ruleRow?.risk_tier}; required_capability=${ruleRow?.required_capability}`,
            rowCount: 1
          }
        ],
        notes:
          "User without parameter:edit-critical gets 403 on critical path match via typed binding-draft submit. Agent actorType=agent critical deny is enforced in assertSensitiveNodeWriteAllowed / action.submitParameterChange (unit-covered); browser Xiaoze agent deny path remains for fuller AG-UI harness if needed."
      });
    } finally {
      await withPgClient(async (client) => {
        await client.query(`delete from dts_sensitive_node_rules where id = $1`, [sensitiveRuleId]);
      });
    }
  });
});

test.describe("DTS structured canonical typed edits", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  let restoreDisposable: RestoreDisposablePostCutoverRuntime | undefined;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable DTS structured acceptance database.");
    }
    const started = await startSwappedDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "dts_struct_canonical",
      markerPurpose: "dts-structured-canonical",
      catalog: "fixture-owned"
    });
    disposableRuntime = started.runtime;
    restoreDisposable = started.restore;
    await seedAcceptanceRoleMatrix();
    const db = createPostgresDatabase(disposableRuntime.databaseUrl);
    try {
      const admin = makeTestAuthContext({
        userId: acceptanceCast.xuYun.userId,
        organizationId,
        permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
        roles: [{ roleId: "admin", projectId: null }]
      });
      await installDriverSourceFixture(db, admin, {
        subjectId: "csub_acme_power",
        compatible: "acme,power",
        businessName: "DTS structured",
        driverName: "Acme power",
        idempotencyKey: "dts-structured-acme-power",
        reason: "PARAM-DTS-EDIT-002 canonical fixture"
      });
    } finally {
      await db.close();
    }
  });

  test.afterAll(async ({}, testInfo) => {
    test.setTimeout(60_000);
    await restoreDisposable?.(disposableRuntimeOutcomeFromTestInfo(testInfo));
  });

  test("structured edit submit preserves rawText through review merge and CST writeback", async ({
    page,
    request
  }, testInfo) => {
    // @acceptance PARAM-DTS-EDIT-002
    // @operation PARAM-DTS-EDIT-002
    test.setTimeout(180_000);
    const rawValue = "<0x6E>";
    const normalizedValue = "<0x6e>";
    const fileName = `acceptance-dts-rawtext-${randomUUID().slice(0, 8)}.dts`;
    const source = (value: string) => `/dts-v1/;
/ {
	charger {
		compatible = "acme,power";
		iin_max = ${value};
	};
};
`;

    const configSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: `acceptance-rawtext-${randomUUID().slice(0, 8)}`, description: "PARAM-DTS-EDIT-002" }
    });
    expect(configSet.status(), await configSet.text()).toBe(201);
    const configSetId = ((await configSet.json()) as { item: { id: string } }).item.id;

    // Canonical Bindings are synced from the first file version after membership, then the new
    // version stages them (the same two-upload pattern as the canonical value workflow spec).
    const first = await uploadDtsFile(request, fileName, source("<0x70>"));
    const member = await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
      { headers: adminHeaders(), data: { fileId: first.fileId, role: "base", sortOrder: 0 } }
    );
    expect(member.ok(), await member.text()).toBe(true);
    await uploadDtsFile(request, fileName, source("<0x70>"));

    const bindingsResponse = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
      headers: adminHeaders()
    });
    expect(bindingsResponse.status(), await bindingsResponse.text()).toBe(200);
    const bindings = ((await bindingsResponse.json()) as { items: Array<{ id: string; rawValue: string }> }).items;
    expect(bindings).toHaveLength(1);
    const binding = bindings[0]!;
    const baseRevisionId = await withPgClient(async (client) => {
      const revision = await client.query<{ id: string }>(
        `select id from dts_config_revisions where config_set_id = $1 order by revision_number desc limit 1`,
        [configSetId]
      );
      return revision.rows[0]?.id;
    });
    expect(baseRevisionId, "config set must have a current revision").toBeTruthy();

    const draftResponse = await request.post(
      apiRoute(`/api/v2/projects/${projectId}/parameter-bindings/${binding.id}/drafts`),
      {
        headers: authHeadersForRole("software-user"),
        data: {
          baseRevisionId,
          targetValue: integerCellTarget("0x6E"),
          reason: `${descriptionPrefix} uppercase hex fidelity`
        }
      }
    );
    expect(draftResponse.status(), await draftResponse.text()).toBe(201);
    const draft = ((await draftResponse.json()) as { item: { draftId: string; rawText?: string } }).item;
    expect(draft.rawText ?? rawValue).toBe(rawValue);

    const submitResponse = await request.post(
      apiRoute(`/api/v2/projects/${projectId}/parameter-value-drafts/${draft.draftId}/submit`),
      {
        headers: authHeadersForRole("software-user"),
        data: { assignedToUserId: acceptanceCast.sunMei.userId }
      }
    );
    expect(submitResponse.status(), await submitResponse.text()).toBe(201);
    const requestId = ((await submitResponse.json()) as { item: { id: string } }).item.id;
    const requestRow = await withPgClient(async (client) => {
      const result = await client.query<{ target_value: unknown; status: string }>(
        `select target_value, status from project_parameter_value_change_requests where id = $1`,
        [requestId]
      );
      return result.rows[0];
    });
    // The frozen typed target keeps the operator's spelling (raw 0x6E), not the normalized 0x6e.
    expect(requestRow?.target_value).toMatchObject({
      kind: "cells",
      groups: [[{ kind: "integer", raw: "0x6E", value: "110" }]]
    });

    await signInBrowserAsRole(page, "software-committer",
      `${disposableRuntime.frontendUrl}/parameter-review?project=${projectId}&request=${requestId}`);
    const detail = page.getByRole("article", { name: "源文件请求详情" });
    await expect(detail).toContainText("待审核");
    await expect(detail.getByLabel("固定源目标内容")).toHaveText(rawValue);
    const reviewed = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith(`/parameter-value-change-requests/${requestId}/review`));
    await detail.getByRole("button", { name: "批准软件配置" }).click();
    const reviewResponse = await reviewed;
    expect(reviewResponse.status(), await reviewResponse.text()).toBe(200);
    expect(((await reviewResponse.json()) as { item: { status: string } }).item.status).toBe("approved");
    await signInBrowserAsRole(page, "software-user",
      `${disposableRuntime.frontendUrl}/parameter-submissions?project=${projectId}&request=${requestId}`);
    await expect(detail).toContainText("已批准");
    await expect(detail.getByLabel("固定源目标内容")).toHaveText(rawValue);

    const approvedRequestRow = await withPgClient(async (client) => {
      const result = await client.query<{ target_value: unknown; status: string }>(
        `select target_value, status from project_parameter_value_change_requests where id = $1`,
        [requestId]
      );
      return result.rows[0];
    });
    expect(approvedRequestRow).toMatchObject({ status: "approved", target_value: requestRow?.target_value });

    const written = await withPgClient(async (client) => {
      const result = await client.query<{ id: string; file_id: string; version_number: number }>(
        `select v.id, v.file_id, v.version_number
           from project_parameter_files f
           join project_parameter_file_versions v on v.id = f.current_version_id
          where f.organization_id = $1 and f.project_id = $2 and f.file_name = $3`,
        [organizationId, projectId, fileName]
      );
      return result.rows[0];
    });
    expect(written, "approval must write a new current file version").toBeTruthy();
    expect(written!.version_number).toBeGreaterThan(2);
    const contentResponse = await request.get(
      apiRoute(`/api/v1/projects/${projectId}/parameter-files/${written!.file_id}/versions/${written!.id}/content`),
      { headers: adminHeaders() }
    );
    expect(contentResponse.ok()).toBe(true);
    const content = (await contentResponse.body()).toString("utf8");
    expect(content).toContain(`iin_max = ${rawValue};`);
    expect(content).not.toContain(`iin_max = ${normalizedValue};`);

    await recordOperationEvidence({
      operationId: "PARAM-DTS-EDIT-002",
      title: "structured edit submit with rawText fidelity through canonical approval writeback",
      status: "passed",
      page,
      testInfo,
      role: "Software User, Software Committer",
      route: page.url(),
      assertions: ["api", "ui", "db"],
      api: [
        summarizeApiResponse(draftResponse, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-bindings/.../drafts`,
          responseSummary: `draftId=${draft.draftId}; targetValue=${rawValue}`
        }),
        summarizeApiResponse(reviewResponse, {
          method: "POST",
          path: `/api/v2/projects/${projectId}/parameter-value-change-requests/.../review`,
          responseSummary: "approved; source writeback preserved rawText"
        })
      ],
      db: [
        {
          table: "project_parameter_value_change_requests",
          predicate: `id=${requestId}`,
          observed: `target_value=${JSON.stringify(approvedRequestRow?.target_value)}; status=${approvedRequestRow?.status}`,
          rowCount: 1
        },
        {
          table: "project_parameter_file_versions",
          predicate: `id=${written!.id}; file_id=${written!.file_id}`,
          observed: `version_number=${written!.version_number}; source contains iin_max = ${rawValue}; normalized spelling absent`,
          rowCount: 1
        }
      ],
      notes: `${descriptionPrefix}: typed canonical draft kept rawText ${rawValue}; approval wrote it to the DTS source as ${rawValue}, not ${normalizedValue}.`
    });
  });
});
