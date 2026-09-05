import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, type Page, type Request, type TestInfo } from "playwright/test";

import { hashLocalAccountPassword } from "../../../server/modules/auth/localAccountCredentials";
import { compileOrThrow, extraDefinitionSuccessorBundle, installPublishedCatalogMatchChain, installPublishedReleaseA, X_DEFINITION_ID, X_REVISION_2 } from "../../../server/modules/catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../../server/modules/catalog-kernel/interface";
import { createApiParameterCatalogGovernanceRepository } from "../../../src/application/parameter-catalog/apiAdapter";
import { createMockCatalogPorts } from "../../../src/application/parameter-catalog/mockAdapter";
import { CATALOG_DEFINITION_ID, CATALOG_RELEASE_ID, CATALOG_REVISION_ID } from "../../../src/application/parameter-catalog/fixtures";
import { proposalContractVectors } from "../../../src/application/parameter-catalog/proposalContractVectors";
import { createParameterCatalogClient } from "../../../src/infrastructure/http/parameterCatalogClient";
import { registerGate0GeneratedSecrets } from "../../../scripts/gate0-secret-registry";
import { acceptanceCast } from "./cast";
import { catalogLaneConnectionString } from "./catalogAcceptanceEnvironment";
import { assertNoPageOverflow, confirmGovernanceDialog, dismissXiaozeHint } from "./catalogBrowser";
import { startDisposablePostCutoverRuntime } from "./disposablePostCutoverRuntime";

/** Catalog uses the production installer; identity uses password hashes and real session persistence. */
export async function startCatalogScenarioRuntime(mode: "api" | "mock" = "api", initialRelease: "A" | "F" = "F") {
  const baseLane = await catalogLaneConnectionString();
  const runtime = await startDisposablePostCutoverRuntime(baseLane, {
    label: "catalog819",
    markerPurpose: "catalog-r2-819",
    apiEnv: { AUTH_PROVIDER: "local" },
    frontendEnv: { VITE_WISEEFF_RUNTIME_MODE: mode },
  });
  const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
  try {
    const chain = initialRelease === "A" ? await installPublishedReleaseA(pool) : await installPublishedCatalogMatchChain(pool);
    const release = "pinF" in chain ? chain.pinF : chain.pinA;
    const password = `R2-${randomUUID()}-local`;
    await registerGate0GeneratedSecrets([password]);
    await pool.query(
      "insert into user_password_credentials (user_id, username, password_hash) values ($1, $2, $3)",
      [acceptanceCast.xuYun.userId, "catalog-r2-author", await hashLocalAccountPassword(password)],
    );
    const login = async () => {
      const response = await fetch(`${runtime.apiUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "catalog-r2-author", password }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.auth.user.id).toBe(acceptanceCast.xuYun.userId);
      await registerGate0GeneratedSecrets([body.token, `Bearer ${body.token}`]);
      return body.token as string;
    };
    const tokenA = await login();
    const tokenB = await login();
    expect(tokenA === tokenB, "independent login sessions").toBe(false);
    return { runtime, pool, release, tokenA, tokenB };
  } catch (error) {
    await pool.end();
    try { await runtime.dispose("failure"); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Catalog scenario initialization and cleanup failed."); }
    throw error;
  }
}

/** Two password-authenticated sessions perform a real command conflict through the root HTTP API. */
export async function verifyRealProposalConflict(page: Page, testInfo: TestInfo, releaseDrift = false) {
  const { runtime, pool, release, tokenA, tokenB } = await startCatalogScenarioRuntime("api", releaseDrift ? "A" : "F");
  await testInfo.attach("r2-runtime-identity", {
    body: Buffer.from(JSON.stringify({ parentLaneIssue: process.env.WISEEFF_CATALOG_ACCEPTANCE_ISSUE ?? "810", nestedDatabase: runtime.databaseName, apiUrl: runtime.apiUrl, frontendUrl: runtime.frontendUrl, markerPurpose: runtime.markerPurpose }, null, 2)),
    contentType: "application/json",
  });
  let outcome: "success" | "failure" = "failure";
  let primaryFailure: unknown;
  try {
    const command = async (token: string, path: string, body: unknown, etag?: string) => {
      const response = await fetch(`${runtime.apiUrl}/api/v2/catalog/definition-proposals${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-WiseEff-Catalog-Release": release.id,
          "Idempotency-Key": randomUUID(),
          ...(etag ? { "If-Match": etag } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    await page.goto(`${runtime.frontendUrl}/favicon.svg`);
    await page.evaluate((token) => localStorage.setItem("wiseeff.localAuthToken", token), tokenA);
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs`);
    await dismissXiaozeHint(page);
    const panel = page.getByRole("region", { name: "定义修订", exact: true });
    const reason = panel.getByRole("textbox", { name: "原因" });
    await reason.fill("R2 keep author input across refresh");
    const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v2/catalog/definition-proposals" && response.request().method() === "POST");
    await panel.getByRole("button", { name: "继续确认", exact: true }).click();
    await confirmGovernanceDialog(page, "确认提出修订");
    const created = await creation;
    expect(created.status()).toBe(201);
    const proposal = (await created.json()).item as { id: string; etag: string };
    const operationPath = `/api/v2/catalog/definition-proposals/${proposal.id}/withdraw`;
    const requests: Array<{ ifMatch: string | undefined; release: string | undefined; key: string | undefined }> = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || new URL(request.url()).pathname !== operationPath) return;
      const headers = request.headers();
      requests.push({ ifMatch: headers["if-match"], release: headers["x-wiseeff-catalog-release"], key: headers["idempotency-key"] });
    });
    await expect(panel.getByRole("cell", { name: "草稿", exact: true })).toBeVisible();
    await reason.fill("R2 keep author input across refresh");
    await panel.getByRole("button", { name: "撤回修订", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "确认撤回修订" })).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role='dialog']")))).toBe(true);

    const submitted = await command(tokenB, `/${proposal.id}/submit`, {}, proposal.etag);
    expect(submitted.status).toBe(200);
    expect(submitted.body.item.status).toBe("submitted");
    expect(submitted.body.item.etag).not.toBe(proposal.etag);
    let refreshedRelease = release.id;
    if (releaseDrift) {
      const bundle = extraDefinitionSuccessorBundle();
      const compiled = compileOrThrow(bundle);
      const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "advance", source: jsonCatalogReleaseSource(bundle), expectedCurrent: release, expectedTargetDigest: compiled.aggregateDigest });
      expect(installed.ok).toBe(true);
      refreshedRelease = compiled.release.id;
    }
    const state = async () => (await pool.query(
      "select status, current_proposal_revision_id from parameter_catalog.definition_proposals where id = $1", [proposal.id],
    )).rows;
    const submittedState = await state();
    const auditCount = async () => (await pool.query(
      "select count(*)::integer as count from public.audit_events where target_id = $1 and kind = 'definition-proposal' and severity = 'info'", [proposal.id],
    )).rows[0].count;
    const beforeAudit = await auditCount();
    const conflict = page.waitForResponse((response) => new URL(response.url()).pathname === operationPath && response.request().method() === "POST");
    await confirmGovernanceDialog(page, "确认撤回");
    const rejected = await conflict;
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).error.details.reason).toBe(releaseDrift ? "release-drift" : "revision-conflict");
    expect(await state()).toEqual(submittedState);
    expect(await auditCount()).toBe(beforeAudit);
    expect(requests).toHaveLength(1);
    expect(requests[0].ifMatch).toBe(proposal.etag);
    await expect(reason).toHaveValue("R2 keep author input across refresh");
    await expect(panel.getByRole("alert")).toBeVisible();

    await panel.getByRole("button", { name: "刷新证据", exact: true }).click();
    await expect(panel.getByRole("cell", { name: "已提交", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "参数定义目录", exact: true })).toHaveAttribute("data-catalog-release", refreshedRelease);
    await expect(reason).toHaveValue("R2 keep author input across refresh");
    expect(requests).toHaveLength(1);
    expect(await state()).toEqual(submittedState);
    await panel.getByRole("button", { name: "撤回修订", exact: true }).click();
    const success = page.waitForResponse((response) => new URL(response.url()).pathname === operationPath && response.request().method() === "POST");
    await confirmGovernanceDialog(page, "确认撤回");
    expect((await success).status()).toBe(200);
    await expect(panel.getByRole("cell", { name: "已撤回", exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1].ifMatch).toBe(submitted.body.item.etag);
    expect(requests[1].release).toBe(refreshedRelease);
    expect(requests[1].key).not.toBe(requests[0].key);
    expect((await state())[0].status).toBe("withdrawn");
    expect(await auditCount()).toBe(beforeAudit + 1);
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await assertNoPageOverflow(page);
    await testInfo.attach("r2-real-conflict-snapshot", { body: await page.locator("body").ariaSnapshot(), contentType: "text/plain" });
    await testInfo.attach("r2-real-conflict-evidence", {
      body: Buffer.from(JSON.stringify({ layer: "browser-real/root-HTTP/real-PG", parentLaneIssue: process.env.WISEEFF_CATALOG_ACCEPTANCE_ISSUE ?? "810", nestedDatabase: runtime.databaseName, sessions: "two real local login sessions of one org-admin author", writes: requests, statuses: [409, 200] }, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("r2-real-conflict.png"), fullPage: true });
    outcome = "success";
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await pool.end();
    try {
      await runtime.dispose(outcome);
    } catch (error) {
      if (primaryFailure) throw new AggregateError([primaryFailure, error], "Catalog conflict check and owned runtime cleanup both failed.");
      throw error;
    }
  }
}

/** Fault is injected after root HTTP/PG commit; the replay retains the actual original request. */
export async function verifyCommittedProposalResponseFailure(page: Page, testInfo: TestInfo) {
  const { runtime, pool, tokenA } = await startCatalogScenarioRuntime();
  let outcome: "success" | "failure" = "failure";
  let primaryFailure: unknown;
  try {
    await page.goto(`${runtime.frontendUrl}/favicon.svg`);
    await page.evaluate((token) => localStorage.setItem("wiseeff.localAuthToken", token), tokenA);
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs`);
    await dismissXiaozeHint(page);
    const panel = page.getByRole("region", { name: "定义修订", exact: true });
    const reason = panel.getByRole("textbox", { name: "原因" });
    await reason.fill("R2 retain input after committed response failure");
    let original: Request | undefined;
    let firstSnapshot: unknown;
    let committedEvidence: unknown;
    let writeCount = 0;
    const evidence = async () => ({
      proposals: (await pool.query("select id,status,current_proposal_revision_id from parameter_catalog.definition_proposals order by id")).rows,
      revisions: (await pool.query("select id,proposal_id,revision_number from parameter_catalog.definition_proposal_revisions order by id")).rows,
      intents: (await pool.query("select id from parameter_catalog.catalog_publication_intents order by id")).rows,
      successAudits: (await pool.query("select id from public.audit_events where kind='definition-proposal' and severity='info' order by id")).rows,
      dedupe: (await pool.query("select command_family,idempotency_key,state,result_ref from parameter_catalog.governance_command_idempotency order by command_family,idempotency_key")).rows,
    });
    await page.route("**/api/v2/catalog/definition-proposals", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      writeCount += 1;
      original = route.request();
      const actual = await route.fetch();
      expect(actual.status()).toBe(201);
      firstSnapshot = await actual.json();
      committedEvidence = await evidence();
      expect((committedEvidence as Awaited<ReturnType<typeof evidence>>).proposals).toHaveLength(1);
      expect((committedEvidence as Awaited<ReturnType<typeof evidence>>).successAudits).toHaveLength(1);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Controlled response-phase failure after verified commit", details: { reason: "catalog-not-ready" } } }) });
    });
    await panel.getByRole("button", { name: "继续确认", exact: true }).click();
    await confirmGovernanceDialog(page, "确认提出修订");
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(reason).toHaveValue("R2 retain input after committed response failure");
    expect(writeCount).toBe(1);
    await page.unroute("**/api/v2/catalog/definition-proposals");
    if (!original) throw new Error("Original committed request was not captured.");
    const replay = await page.request.fetch(original);
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(firstSnapshot);
    expect(await evidence()).toEqual(committedEvidence);
    const headers = original.headers();
    await testInfo.attach("r2-response-phase-replay", {
      body: Buffer.from(JSON.stringify({ layer: "browser-real UI / root-HTTP replay / real-PG", fault: "503 injected only after route.fetch returned 201 and committed PG state/success audit were read", responseStatuses: [503, 201], originalContext: { release: headers["x-wiseeff-catalog-release"], key: headers["idempotency-key"], ifMatch: headers["if-match"] ?? null }, firstSnapshot, committedEvidence, nestedDatabase: runtime.databaseName }, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath("r2-response-phase-replay.png"), fullPage: true });
    outcome = "success";
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await pool.end();
    try { await runtime.dispose(outcome); }
    catch (cleanupError) {
      if (primaryFailure) throw new AggregateError([primaryFailure, cleanupError], "Catalog response-failure check and cleanup both failed.");
      throw cleanupError;
    }
  }
}

/** Browser steps use AppRuntime's selected adapter; shared contract vectors additionally test replay and stale ETags. */
export async function collectProposalOperationTrace(page: Page, testInfo: TestInfo, mode: "api" | "mock") {
  const { runtime, pool, release, tokenA } = await startCatalogScenarioRuntime(mode);
  let outcome: "success" | "failure" = "failure";
  let primaryFailure: unknown;
  try {
    await page.goto(`${runtime.frontendUrl}/favicon.svg`);
    if (mode === "api") await page.evaluate((token) => localStorage.setItem("wiseeff.localAuthToken", token), tokenA);
    await page.goto(`${runtime.frontendUrl}/parameter-admin/specs`);
    await dismissXiaozeHint(page);
    const panel = page.getByRole("region", { name: "定义修订", exact: true });
    await panel.getByRole("combobox", { name: "变更类型" }).selectOption("content");
    await panel.getByRole("textbox", { name: "原因" }).fill("R2 identical browser operation trace");
    await panel.getByRole("button", { name: "继续确认", exact: true }).click();
    await confirmGovernanceDialog(page, "确认提出修订");
    const row = panel.getByRole("row").filter({ has: page.getByRole("cell", { name: "内容", exact: true }) });
    const trace: Array<{ status: string; version: number; actions: string[] }> = [];
    const record = async (status: string) => {
      await expect(row.getByRole("cell", { name: status, exact: true })).toBeVisible();
      const cells = await row.getByRole("cell").allTextContents();
      trace.push({ status, version: Number(cells[2]), actions: await row.getByRole("button").allTextContents() });
    };
    await record("草稿");
    await row.getByRole("button", { name: "提交修订", exact: true }).click();
    await confirmGovernanceDialog(page, "确认提交");
    await record("已提交");
    await row.getByRole("button", { name: "撤回修订", exact: true }).click();
    await confirmGovernanceDialog(page, "确认撤回");
    await record("已撤回");
    expect(trace.map((step) => step.version)).toEqual([1, 2, 3]);
    expect(trace[2].actions).toEqual([]);
    await expect(panel.getByRole("alert")).toHaveCount(0);

    const vectors = proposalContractVectors.filter((vector) => ["R2-PROP-01", "R2-PROP-02", "R2-PROP-04", "R2-PROP-05", "R2-PROP-08"].includes(vector.id));
    expect(vectors).toHaveLength(5);
    const governance = mode === "api"
      ? createApiParameterCatalogGovernanceRepository(createParameterCatalogClient({ baseUrl: runtime.apiUrl, authorization: `Bearer ${tokenA}` }))
      : createMockCatalogPorts({ getSession: () => ({ personId: acceptanceCast.xuYun.userId, organizationId: "org_acme", actorKind: "org-admin", isActive: true }) }).governance;
    for (const vector of vectors) {
      await vector.run({ governance, authorId: acceptanceCast.xuYun.userId, releaseId: mode === "api" ? release.id : CATALOG_RELEASE_ID, definitionId: mode === "api" ? X_DEFINITION_ID : CATALOG_DEFINITION_ID, revisionId: mode === "api" ? X_REVISION_2 : CATALOG_REVISION_ID });
    }
    await testInfo.attach(`r2-operation-trace-${mode}`, {
      body: Buffer.from(JSON.stringify({ browser: { mode, trace, adapter: "product AppRuntime" }, contract: { vectors: vectors.map((vector) => vector.id), layer: mode === "api" ? "actual API adapter / root-HTTP / real-PG / real login" : "product mock adapter / in-process" } }, null, 2)),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`r2-operation-trace-${mode}.png`), fullPage: true });
    outcome = "success";
    return trace;
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await pool.end();
    try { await runtime.dispose(outcome); }
    catch (cleanupError) {
      if (primaryFailure) throw new AggregateError([primaryFailure, cleanupError], "Catalog operation trace and cleanup both failed.");
      throw cleanupError;
    }
  }
}
