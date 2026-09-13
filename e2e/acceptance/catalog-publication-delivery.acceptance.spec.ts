import { expect, test, type Page, type TestInfo } from "playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import {
  CATALOG_EXPECTED_API_FAILURES,
  CATALOG_VIEWPORTS,
  assertNoPageOverflow,
  catalogPage,
  catalogScreenshot,
  confirmGovernanceDialog,
  dismissXiaozeHint,
} from "./helpers/catalogBrowser";
import {
  assertBindingGetOk,
  assertJobSucceeded,
  assertJobSuperseded,
  assertOfficialProjectValue,
  assertUniqueBinding,
  assertUniqueDefinition,
  buildIdentityChain,
  catalogReleaseOf,
  type CatalogDefinitionView,
  type CatalogIdentityChain,
  type ProjectBindingView,
  type PublicationJobView,
} from "./helpers/catalogIdentityChain";

useBrowserDiagnostics(test, {
  expectedApiFailures: [
    ...CATALOG_EXPECTED_API_FAILURES,
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 403 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 409 },
    { method: "POST", path: "/api/v2/catalog/publication-candidates", status: 422 },
  ],
});

type DeliveryEvidence = {
  sha: string;
  image: string;
  imageId: string;
  database: string;
  publisherUserId: string;
  organizationId: string;
  projectId: string;
  adoptedReleaseId: string;
  adoptedDigest: string;
  subjectId: string;
  apiOrigin: string;
  frontendOrigin: string;
  loginUsername: string;
};

type LoginSecrets = { username: string; password: string };

type PublicationIds = {
  candidateId: string;
  jobId: string;
  releaseId: string;
  releaseDigest: string;
  definitionId: string;
  revisionId: string;
};

const loadEvidence = (): DeliveryEvidence => {
  const path = process.env.WISEEFF_CATALOG_DELIVERY_EVIDENCE?.trim();
  if (!path) {
    throw new Error("WISEEFF_CATALOG_DELIVERY_EVIDENCE is required for isolated delivery M1.");
  }
  return JSON.parse(readFileSync(path, "utf8")) as DeliveryEvidence;
};

const loadLogin = (): LoginSecrets => {
  const path = process.env.WISEEFF_CATALOG_DELIVERY_LOGIN_FILE?.trim();
  if (!path) {
    throw new Error("WISEEFF_CATALOG_DELIVERY_LOGIN_FILE is required for isolated delivery M1.");
  }
  return JSON.parse(readFileSync(path, "utf8")) as LoginSecrets;
};

const evidence = loadEvidence();
const login = loadLogin();

const authHeader = async (page: Page) => {
  const token = await page.evaluate(() => window.localStorage.getItem("wiseeff.localAuthToken"));
  if (!token) throw new Error("local auth token missing after login");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

const signIn = async (page: Page) => {
  const response = await page.request.post(`${evidence.apiOrigin}/api/v1/auth/login`, {
    data: { username: login.username, password: login.password },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { token: string; auth: { user: { id: string } } };
  expect(body.auth.user.id).toBe(evidence.publisherUserId);
  await page.goto(`${evidence.frontendOrigin}/favicon.svg`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([storageKey, token]) => window.localStorage.setItem(storageKey, token),
    ["wiseeff.localAuthToken", body.token] as const,
  );
};

const clearStoredPublicationJob = async (page: Page) => {
  await page.evaluate(() => window.localStorage.removeItem("wiseeff.catalog.publication-job"));
};

const readJob = async (page: Page, jobId: string): Promise<PublicationJobView> => {
  const headers = await authHeader(page);
  const job = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog/publications/${jobId}`, { headers });
  expect(job.status(), await job.text()).toBe(200);
  const body = (await job.json()) as { item: PublicationJobView };
  return body.item;
};

const readCatalog = async (page: Page) => {
  const headers = await authHeader(page);
  const catalogRes = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog`, { headers });
  expect(catalogRes.status(), await catalogRes.text()).toBe(200);
  return catalogRes.json() as Promise<{ catalogReleaseId?: string; digest?: string; item?: { catalogReleaseId?: string; digest?: string } }>;
};

const readDefinition = async (page: Page, propertyKey: string): Promise<CatalogDefinitionView> => {
  const headers = await authHeader(page);
  const res = await page.request.get(`${evidence.apiOrigin}/api/v2/catalog/definitions?limit=200`, { headers });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { items?: CatalogDefinitionView[] };
  return assertUniqueDefinition(body.items, { propertyKey, subjectId: evidence.subjectId });
};

const publishDefinition = async (
  page: Page,
  testInfo: TestInfo,
  propertyKey: string,
  displayName: string,
): Promise<PublicationIds> => {
  await clearStoredPublicationJob(page);
  const captured: Partial<PublicationIds> = {};
  const onResponse = async (response: { url: () => string; ok: () => boolean; request: () => { method: () => string }; json: () => Promise<unknown> }) => {
    const url = response.url();
    if (response.request().method() === "POST" && url.includes("/publication-candidates") && !url.endsWith("/publish")) {
      if (response.ok()) {
        const body = (await response.json().catch(() => null)) as { item?: { id?: string } } | null;
        if (body?.item?.id) captured.candidateId = body.item.id;
      }
    }
    if (response.request().method() === "POST" && url.includes("/publish")) {
      if (response.ok()) {
        const body = (await response.json().catch(() => null)) as {
          item?: { id?: string; candidateId?: string };
        } | null;
        if (body?.item?.id) captured.jobId = body.item.id;
        if (body?.item?.candidateId) captured.candidateId = body.item.candidateId;
      }
    }
  };
  page.on("response", onResponse);

  await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
  await dismissXiaozeHint(page);
  await page.getByRole("button", { name: "关闭" }).click({ timeout: 2_000 }).catch(() => undefined);
  await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
  const entry = page.getByRole("button", { name: "新增定义" });
  await expect(entry).toBeVisible();
  await entry.click({ force: true });
  const dialog = page.getByRole("dialog", { name: "向已发布主体新增定义" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const subjects = dialog.getByLabel("已发布主体");
  await expect.poll(async () => subjects.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await subjects.selectOption(evidence.subjectId);
  await dialog.getByLabel("属性键").fill(propertyKey);
  await dialog.getByLabel("显示名称").fill(displayName);
  await dialog.getByLabel("说明").fill("隔离交付 M1 新增定义。");
  await dialog.getByLabel("草稿原因").fill("RA-04 isolated image M1");
  await dialog.getByRole("button", { name: "保存草稿" }).click();
  await expect(dialog.getByText("草稿已保存")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "预览发布" }).click();
  await confirmGovernanceDialog(page, "确认预览");
  await expect(dialog.getByLabel("发布预览")).toBeVisible({ timeout: 30_000 });
  for (const viewport of CATALOG_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, `ra04-publish-dialog-${propertyKey}-${viewport.name}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole("button", { name: "发布到目录" }).click();
  await confirmGovernanceDialog(page, "确认发布");
  await expect(dialog.getByText("目录发布已生效。")).toBeVisible({ timeout: 180_000 });
  await expect(dialog.getByText(/入队|正在执行/)).toHaveCount(0);
  expect(captured.jobId, "captured JobId").toBeTruthy();
  expect(captured.candidateId, "captured CandidateId").toBeTruthy();
  const jobBody = await readJob(page, captured.jobId!);
  assertJobSucceeded(jobBody, { jobId: captured.jobId!, candidateId: captured.candidateId! });
  const catalogBody = await readCatalog(page);
  const release = catalogReleaseOf(catalogBody);
  expect(release.id).not.toBe(evidence.adoptedReleaseId);
  const definition = await readDefinition(page, propertyKey);
  page.off("response", onResponse);
  return {
    candidateId: captured.candidateId!,
    jobId: captured.jobId!,
    releaseId: release.id,
    releaseDigest: release.digest,
    definitionId: definition.id!,
    revisionId: definition.currentRevisionId!,
  };
};

const pollBinding = async (page: Page, definitionId: string, propertyKey: string): Promise<ProjectBindingView> => {
  const headers = await authHeader(page);
  let lastStatus = 0;
  let lastItems: ProjectBindingView[] | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bindings = await page.request.get(
      `${evidence.apiOrigin}/api/v2/projects/${evidence.projectId}/parameter-bindings`,
      { headers },
    );
    lastStatus = bindings.status();
    if (lastStatus === 403 || lastStatus === 404) {
      assertBindingGetOk(lastStatus);
    }
    if (bindings.ok()) {
      const list = (await bindings.json()) as { items?: ProjectBindingView[] };
      lastItems = list.items;
      try {
        return assertUniqueBinding(list.items, {
          propertyKey,
          definitionId,
          projectId: evidence.projectId,
        });
      } catch (error) {
        if (attempt === 29) {
          throw error;
        }
      }
    }
    await page.waitForTimeout(2_000);
  }
  assertBindingGetOk(lastStatus);
  return assertUniqueBinding(lastItems, {
    propertyKey,
    definitionId,
    projectId: evidence.projectId,
  });
};

test.describe("isolated formal-image catalog delivery M1", () => {
  test("completes adopt-bound publish, DTS ingest, workbench save, second publish, restart reread", async ({
    page,
  }, testInfo) => {
    test.setTimeout(12 * 60_000);
    expect(evidence.database.startsWith("wiseeff_test_wk_")).toBe(true);
    await signIn(page);

    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
      await dismissXiaozeHint(page);
      await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
      await assertNoPageOverflow(page);
      await catalogScreenshot(page, testInfo, `ra04-catalog-${viewport.name}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const firstKey = `ra04_${Date.now().toString(36).slice(-6)}`;
    const first = await publishDefinition(page, testInfo, firstKey, "RA04 首次定义");
    await page.getByRole("button", { name: "关闭" }).click({ timeout: 5_000 }).catch(() => undefined);
    await clearStoredPublicationJob(page);

    const catalogAfterFirst = catalogReleaseOf(await readCatalog(page));
    expect(catalogAfterFirst.id).toBe(first.releaseId);

    const dts = `/dts-v1/;
/ {
	charger@0 {
		compatible = "acme,charger";
		${firstKey} = <12>;
		status = "okay";
	};
};
`;
    const headers = await authHeader(page);
    const ingest = await page.request.post(
      `${evidence.apiOrigin}/api/v1/projects/${evidence.projectId}/parameter-files`,
      {
        headers,
        data: {
          fileName: `ra04-${first.jobId}.dts`,
          contentBase64: Buffer.from(dts, "utf8").toString("base64"),
        },
      },
    );
    expect(ingest.status(), await ingest.text()).toBe(201);
    const ingestBody = (await ingest.json()) as { item?: { id?: string }; version?: { id?: string } };
    const fileId = ingestBody.item?.id || ingestBody.version?.id;
    expect(fileId).toBeTruthy();

    const configSet = await page.request.post(
      `${evidence.apiOrigin}/api/v1/projects/${evidence.projectId}/config-sets`,
      { headers, data: { name: `ra04-${firstKey}`, description: "RA-04 workbench" } },
    );
    expect(configSet.status(), await configSet.text()).toBe(201);
    const configSetBody = (await configSet.json()) as { item: { id: string } };
    const addMember = await page.request.post(
      `${evidence.apiOrigin}/api/v1/projects/${evidence.projectId}/config-sets/${configSetBody.item.id}/files`,
      { headers, data: { fileId, role: "base", sortOrder: 0 } },
    );
    expect(addMember.ok(), await addMember.text()).toBeTruthy();

    const binding = await pollBinding(page, first.definitionId, firstKey);
    expect(binding.definitionId).toBe(first.definitionId);
    expect(binding.effectiveRevisionId).toBe(first.revisionId);

    const workbenchUrl = `${evidence.frontendOrigin}/parameter-admin/projects/${evidence.projectId}/configuration?configSet=${encodeURIComponent(configSetBody.item.id)}&file=${encodeURIComponent(fileId!)}`;
    await page.goto(workbenchUrl);
    await dismissXiaozeHint(page);
    const workbench = page.getByRole("region", { name: "项目配置工作台" });
    await expect(workbench).toBeVisible({ timeout: 30_000 });
    await page.getByRole("treeitem", { name: /charger/ }).first().click();
    await page.getByRole("treeitem", { name: new RegExp(firstKey) }).click();
    const inspector = page.getByRole("complementary", { name: "配置检查器" });
    await expect(inspector).toBeVisible();
    const integerInput = inspector.getByRole("textbox", { name: "数值 1" });
    await expect(integerInput).toBeVisible();
    await integerInput.fill("24");
    const tasks = page.getByRole("region", { name: "配置任务" });
    await expect(tasks).toBeVisible();
    await tasks.getByLabel("变更原因").fill("RA-04 workbench official save");
    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await assertNoPageOverflow(page);
      await catalogScreenshot(page, testInfo, `ra04-workbench-${viewport.name}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await tasks.getByRole("button", { name: /提交所选/ }).click();
    const submitPanel = page.getByRole("region", { name: "参数修改提交" });
    if (await submitPanel.isVisible().catch(() => false)) {
      await submitPanel.getByRole("button", { name: "提交审核" }).click();
      await expect(page.getByText(/已提交正式审核/)).toBeVisible({ timeout: 30_000 });
    }

    const draft = await page.request.post(
      `${evidence.apiOrigin}/api/v2/projects/${evidence.projectId}/parameter-bindings/${binding.id}/drafts`,
      {
        headers,
        data: {
          action: "set",
          reason: "RA-04 official value 24",
          baseRevisionId: first.revisionId,
          targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "24", value: "24" }]] },
        },
      },
    );
    expect(draft.status(), await draft.text()).toBe(201);
    const draftBody = (await draft.json()) as {
      item: { draftId: string; parameterSpecId?: string; projectParameterBindingId?: string; candidateRevisionId?: string };
    };
    const submitted = await page.request.post(`${evidence.apiOrigin}/api/v1/parameter-submission-rounds`, {
      headers,
      data: {
        projectId: evidence.projectId,
        items: [
          {
            draftId: draftBody.item.draftId,
            projectParameterBindingId: binding.id,
            parameterSpecId: draftBody.item.parameterSpecId,
            action: "set",
            targetValue: "24",
            reason: "RA-04 official value 24",
          },
        ],
        reason: "RA-04 official value 24",
        assignees: {
          hardwareCommitterId: evidence.publisherUserId,
          softwareCommitterId: evidence.publisherUserId,
          softwareUserId: evidence.publisherUserId,
        },
      },
    });
    expect(submitted.status(), await submitted.text()).toBe(201);
    const submittedBody = (await submitted.json()) as {
      item: { items: Array<{ requestId: string; status?: string }> };
    };
    const requestId = submittedBody.item.items[0]?.requestId;
    expect(requestId).toBeTruthy();
    let reviewStatus = submittedBody.item.items[0]?.status ?? "";
    for (let step = 0; step < 6 && reviewStatus !== "merged"; step += 1) {
      const review = await page.request.post(
        `${evidence.apiOrigin}/api/v1/parameter-change-requests/${requestId}/review`,
        {
          headers,
          data: {
            decision: "advance",
            note: reviewStatus === "software_merge" ? `https://example.com/ra04/${requestId}` : "RA-04 review advance",
          },
        },
      );
      expect(review.ok(), await review.text()).toBeTruthy();
      const reviewBody = (await review.json()) as { item: { status?: string } };
      reviewStatus = reviewBody.item.status ?? "";
    }
    expect(reviewStatus).toBe("merged");

    const bindingAfterSave = await pollBinding(page, first.definitionId, firstKey);
    expect(bindingAfterSave.currentValueId).toBeTruthy();
    expect(bindingAfterSave.currentValueId).not.toBe(binding.currentValueId);
    assertOfficialProjectValue(bindingAfterSave, {
      currentValueId: bindingAfterSave.currentValueId!,
      revisionId: first.revisionId,
    });

    const firstChain: CatalogIdentityChain = buildIdentityChain({
      candidateId: first.candidateId,
      jobId: first.jobId,
      releaseId: first.releaseId,
      releaseDigest: first.releaseDigest,
      predecessorReleaseId: evidence.adoptedReleaseId,
      subjectId: evidence.subjectId,
      definition: { id: first.definitionId, currentRevisionId: first.revisionId, propertyKey: firstKey, subjectId: evidence.subjectId },
      binding: bindingAfterSave,
      propertyKey: firstKey,
    });

    const secondKey = `ra04b_${Date.now().toString(36).slice(-6)}`;
    const second = await publishDefinition(page, testInfo, secondKey, "RA04 第二次定义");
    expect(second.jobId).not.toBe(first.jobId);
    expect(second.releaseId).not.toBe(first.releaseId);
    expect(second.definitionId).not.toBe(first.definitionId);
    const catalogAfterSecond = catalogReleaseOf(await readCatalog(page));
    expect(catalogAfterSecond.id).toBe(second.releaseId);
    assertJobSuperseded(await readJob(page, first.jobId), { jobId: first.jobId, candidateId: first.candidateId });
    assertJobSucceeded(await readJob(page, second.jobId), { jobId: second.jobId, candidateId: second.candidateId });
    const bindingPinned = await pollBinding(page, first.definitionId, firstKey);
    expect(bindingPinned.effectiveRevisionId).toBe(first.revisionId);
    expect(bindingPinned.currentValueId).toBe(bindingAfterSave.currentValueId);

    const restart = process.env.WISEEFF_CATALOG_DELIVERY_RESTART_CMD?.trim();
    expect(restart).toBeTruthy();
    const restarted = spawnSync("bash", [restart!], { encoding: "utf8" });
    expect(restarted.status, restarted.stderr).toBe(0);
    await expect
      .poll(async () => {
        const live = await page.request.get(`${evidence.apiOrigin}/health/live`);
        return live.status();
      })
      .toBe(200);
    await expect
      .poll(async () => {
        const ready = await page.request.get(`${evidence.apiOrigin}/health/ready`);
        return ready.status();
      })
      .toBe(200);

    const restartedFirst = await readJob(page, first.jobId);
    assertJobSuperseded(restartedFirst, { jobId: first.jobId, candidateId: first.candidateId });
    assertJobSucceeded(await readJob(page, second.jobId), { jobId: second.jobId, candidateId: second.candidateId });
    const definitionAfterRestart = await readDefinition(page, firstKey);
    expect(definitionAfterRestart.id).toBe(first.definitionId);
    expect(definitionAfterRestart.currentRevisionId).toBe(first.revisionId);
    const bindingAfterRestart = await pollBinding(page, first.definitionId, firstKey);
    assertOfficialProjectValue(bindingAfterRestart, {
      currentValueId: bindingAfterSave.currentValueId!,
      revisionId: first.revisionId,
    });

    await page.goto(`${evidence.frontendOrigin}/parameter-admin/specs`);
    await dismissXiaozeHint(page);
    await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(secondKey)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(firstKey)).toBeVisible({ timeout: 30_000 });
    await catalogScreenshot(page, testInfo, "ra04-after-restart");

    const chainPath = join(dirname(process.env.WISEEFF_CATALOG_DELIVERY_EVIDENCE!), "identity-chain.json");
    const chain = {
      first: firstChain,
      second: {
        candidateId: second.candidateId,
        jobId: second.jobId,
        releaseId: second.releaseId,
        releaseDigest: second.releaseDigest,
        predecessorReleaseId: first.releaseId,
        definitionId: second.definitionId,
        revisionId: second.revisionId,
      },
      restart: {
        firstJob: restartedFirst,
        firstBinding: bindingAfterRestart,
        firstDefinition: definitionAfterRestart,
      },
      ingest: ingestBody,
      denials: {
        bindingGetMustBe200: true,
        uniqueDefinitionRequired: true,
        uniqueBindingRequired: true,
        receiptEffectiveMustBeTrue: true,
        draftsOnlyIsNotOfficialSave: true,
      },
    };
    writeFileSync(chainPath, `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
    await testInfo.attach("identity-chain.json", {
      body: Buffer.from(JSON.stringify(chain, null, 2)),
      contentType: "application/json",
    });
  });
});
