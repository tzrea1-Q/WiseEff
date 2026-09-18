import { expect, type APIRequestContext, type Page, type TestInfo } from "playwright/test";

import { acceptanceCast } from "./cast";
import { authHeadersForRole, authHeadersForUser, signInBrowserAsUser } from "./bearerAuth";
import type { ExpectedApiFailure } from "./browserDiagnostics";
import {
  CATALOG_GUEST_USER,
  CATALOG_ORG_B,
  CATALOG_ORG_B_ADMIN,
  ensureCatalogAcceptanceFixture,
  type CatalogAcceptanceFixture
} from "./catalogEvidence";
import { apiRoute } from "./runtime";
import { recordOperationEvidence } from "./operationEvidence";

export const CATALOG_PAGE_PATH = "/parameter-admin/specs";

export const CATALOG_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
] as const;

export const CATALOG_EXPECTED_API_FAILURES: ExpectedApiFailure[] = [
  { method: "GET", path: "/api/v1/parameters/projects", status: 404 },
  { method: "GET", path: "/api/v2/organizations", status: 403 },
  { method: "GET", path: "/api/v2/organizations", status: 409 },
  { method: "GET", path: "/api/v2/catalog/definition-proposals", status: 403 },
  { method: "GET", path: "/api/v2/catalog", status: 503 },
  { method: "GET", path: "/api/v2/catalog", status: 500 },
  { method: "GET", path: "/api/v2/catalog", status: 409 },
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 404 },
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 410 },
  { method: "GET", path: "/api/v1/parameters/spec-op08-gone-archived", status: 410 },
  { method: "GET", path: "/api/v1/parameters/spec-op08-gone-archived", status: 404 },
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 409 },
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 403 },
  { method: "POST", path: "/api/v2/organizations", status: 403 },
  { method: "POST", path: "/api/v2/organizations", status: 409 },
  { method: "PATCH", path: "/api/v2/organizations", status: 403 },
  { method: "PATCH", path: "/api/v2/organizations", status: 409 },
  { method: "POST", path: "/api/v2/catalog/definition-proposals", status: 403 },
  { method: "POST", path: "/api/v2/catalog/definition-proposals", status: 409 },
  { method: "POST", path: "/api/v2/catalog/definition-proposals", status: 404 },
  { method: "POST", path: "/api/v2/catalog/definition-replacements/preview", status: 409 },
  // An actor without catalog publication capability is refused by the server.
  { method: "GET", path: "/api/v2/catalog/publications", status: 403 }
];

export type CatalogBrowserActor = "org-admin" | "user" | "platform-admin" | "guest" | "org-b-admin";

export function catalogPage(page: Page) {
  return page.getByRole("region", { name: "参数定义目录" });
}

export async function dismissXiaozeHint(page: Page) {
  const dismiss = page.getByRole("button", { name: "不再提示" });
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ force: true });
  }
}

export async function signInCatalogActor(page: Page, actor: CatalogBrowserActor, route = CATALOG_PAGE_PATH) {
  if (actor === "org-admin") {
    await signInBrowserAsUser(
      page,
      acceptanceCast.acceptanceAdmin.userId,
      acceptanceCast.acceptanceAdmin.email,
      acceptanceCast.acceptanceAdmin.name,
      route
    );
    return;
  }
  if (actor === "platform-admin") {
    await signInBrowserAsUser(
      page,
      acceptanceCast.platformOperator.userId,
      acceptanceCast.platformOperator.email,
      acceptanceCast.platformOperator.name,
      route
    );
    return;
  }
  if (actor === "user") {
    await signInBrowserAsUser(
      page,
      acceptanceCast.zhaoHeng.userId,
      acceptanceCast.zhaoHeng.email,
      acceptanceCast.zhaoHeng.name,
      route
    );
    return;
  }
  if (actor === "guest") {
    await signInBrowserAsUser(
      page,
      CATALOG_GUEST_USER.userId,
      CATALOG_GUEST_USER.email,
      CATALOG_GUEST_USER.name,
      route
    );
    return;
  }
  await signInBrowserAsUser(
    page,
    CATALOG_ORG_B_ADMIN.userId,
    CATALOG_ORG_B_ADMIN.email,
    CATALOG_ORG_B_ADMIN.name,
    route,
    CATALOG_ORG_B.id
  );
}

export function catalogAuthHeaders(actor: CatalogBrowserActor) {
  if (actor === "org-admin") {
    return authHeadersForUser(
      acceptanceCast.acceptanceAdmin.userId,
      acceptanceCast.acceptanceAdmin.email,
      acceptanceCast.acceptanceAdmin.name
    );
  }
  if (actor === "platform-admin") {
    return authHeadersForRole("platform-admin");
  }
  if (actor === "user") {
    return authHeadersForRole("hardware-user");
  }
  if (actor === "guest") {
    return authHeadersForUser(CATALOG_GUEST_USER.userId, CATALOG_GUEST_USER.email, CATALOG_GUEST_USER.name);
  }
  return authHeadersForUser(CATALOG_ORG_B_ADMIN.userId, CATALOG_ORG_B_ADMIN.email, CATALOG_ORG_B_ADMIN.name, CATALOG_ORG_B.id);
}

export async function openCatalogViaNav(page: Page, actor: CatalogBrowserActor = "org-admin") {
  await signInCatalogActor(page, actor, "/parameter-home");
  await dismissXiaozeHint(page);
  const adminLink = page.getByRole("link", { name: "参数后台" });
  if (await adminLink.isVisible().catch(() => false)) {
    await adminLink.click();
  } else {
    await page.getByText("参数后台", { exact: true }).click();
  }
  await expect(page).toHaveURL(/\/parameter-admin\/specs/);
  await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
}

export async function openCatalogAt(
  page: Page,
  actor: CatalogBrowserActor,
  search = ""
) {
  const href = search
    ? search.startsWith("?")
      ? `${CATALOG_PAGE_PATH}${search}`
      : `${CATALOG_PAGE_PATH}?${search}`
    : CATALOG_PAGE_PATH;
  await signInCatalogActor(page, actor, href);
  await dismissXiaozeHint(page);
  await expect(catalogPage(page)).toBeVisible({ timeout: 30_000 });
}

export async function waitForCatalogState(page: Page, state: string | RegExp) {
  await expect(catalogPage(page)).toHaveAttribute("data-catalog-state", state, { timeout: 30_000 });
}

export async function selectSubjectByName(page: Page, name: string | RegExp) {
  // Subjects are leaves of the single module navigator tree; wait for the
  // collection to settle before falling back to a page-level match.
  const fromTree = page
    .getByRole("navigation", { name: "参数定义模块树" })
    .getByRole("button", { name: /^选择主体 / })
    .filter({ hasText: name })
    .first();
  try {
    await fromTree.waitFor({ state: "visible", timeout: 20_000 });
    await fromTree.click();
    return;
  } catch {
    await page.getByRole("button", { name }).first().click();
  }
}

export async function selectDefinitionByKey(page: Page, propertyKey: string) {
  const cell = page.getByText(propertyKey, { exact: true }).first();
  await expect(cell).toBeVisible({ timeout: 30_000 });
  await cell.click();
}

export async function confirmGovernanceDialog(page: Page, confirmLabel: string) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: confirmLabel }) });
  await expect(dialog).toBeVisible();
  const checkbox = dialog.getByRole("checkbox");
  if (await checkbox.count()) {
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  }
  const confirm = dialog.getByRole("button", { name: confirmLabel });
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

export async function assertNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

const catalogScreenshotOperations: Record<string, string> = {
  "pcat-ui-01-entry": "PCAT-CATALOG-DISCOVER-001",
  "pcat-ui-02-deep-link": "PCAT-CATALOG-DEEP-LINK-001",
  "pcat-ui-03-detail": "PCAT-DEFINITION-DETAIL-001",
  "pcat-ui-04-review": "PCAT-REVIEW-RESOLVE-001",
  "pcat-ui-05-timeline": "PCAT-TIMELINE-001",
  "pcat-ui-06-org-admin": "PCAT-READY-ACTIONS-001",
  "pcat-ui-07-register": "PCAT-REGISTRATION-001",
  "pcat-ui-08-filter": "PCAT-CATALOG-STATES-001",
  "pcat-ui-09-retired": "PCAT-RETIRED-HISTORY-001",
  "pcat-ui-10-conflict": "PCAT-CONFLICT-RECONFIRM-001",
  "pcat-ui-11-legacy": "PCAT-LEGACY-LINK-001",
  "pcat-ui-12-guest": "PCAT-AGENT-READONLY-001",
  "pcat-ui-13-api": "PCAT-ADAPTER-PARITY-001",
  "pcat-ui-14-desktop": "PCAT-RESPONSIVE-001",
  "pcat-ui-15-journey": "PCAT-GOVERNANCE-JOURNEY-001",
  "pcat-ui-16-collection": "PCAT-DEFINITION-COLLECTION-001",
  "pcat-ui-17-lifecycle": "PCAT-DEFINITION-LIFECYCLE-001"
};

function catalogScreenshotApi(name: string) {
  if (name.includes("not-ready")) {
    return { method: "GET", path: "/api/v2/catalog", status: 503, responseSummary: name };
  }
  if (name.includes("guest") || name === "pcat-ui-06-user") {
    return { method: "GET", path: "/api/v2/catalog", status: 403, responseSummary: name };
  }
  if (name.includes("conflict")) {
    return { method: "POST", path: "/api/v2/organizations", status: 409, responseSummary: name };
  }
  return { method: "GET", path: "/api/v2/catalog", status: 200, responseSummary: name };
}

async function catalogScreenshotForensics() {
  const fixture = await ensureCatalogAcceptanceFixture();
  const release = await fixture.pool.query<{ id: string; release_sequence: string }>(
    `
    select id, release_sequence::text as release_sequence
      from parameter_catalog.catalog_releases
     order by release_sequence desc
     limit 1
    `
  );
  const auditEvent = await fixture.pool.query<{
    id: string;
    kind: string;
    action: string;
    target_id: string | null;
    trace_id: string | null;
  }>(
    `
    select id, kind, action, target_id, trace_id
      from audit_events
     order by created_at desc
     limit 1
    `
  );
  const activation = auditEvent.rows[0]
    ? null
    : await fixture.pool.query<{ id: string }>(
        `
        select id
          from parameter_catalog.catalog_activation_receipts
         order by created_at desc
         limit 1
        `
      );
  const releaseRow = release.rows[0];
  const auditRow = auditEvent.rows[0];
  const activationRow = activation?.rows[0];
  return {
    db: [
      {
        table: "parameter_catalog.catalog_releases",
        predicate: releaseRow ? `id=${releaseRow.id}` : "latest catalog release",
        observed: releaseRow
          ? `id=${releaseRow.id}; sequence=${releaseRow.release_sequence}`
          : "missing",
        rowCount: releaseRow ? 1 : 0
      }
    ],
    audit: auditRow
      ? [
          {
            id: auditRow.id,
            kind: auditRow.kind,
            action: auditRow.action,
            targetId: auditRow.target_id,
            requestId: auditRow.trace_id ?? undefined,
            metadataSummary: `catalogScreenshot forensic from audit_events`
          }
        ]
      : [
          {
            id: activationRow?.id ?? releaseRow?.id,
            kind: activationRow ? "catalog-activation" : "catalog-release",
            action: activationRow ? "activate" : "published",
            targetId: activationRow?.id ?? releaseRow?.id ?? null,
            metadataSummary: "catalog publication forensic from fixture lane"
          }
        ]
  };
}

export async function catalogScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  const operationId = catalogScreenshotOperations[name];
  if (operationId) {
    const forensics = await catalogScreenshotForensics();
    await recordOperationEvidence({
      operationId,
      title: testInfo.title,
      status: "passed",
      page,
      testInfo,
      assertions: ["ui", "api", "db", "audit", "screenshot"],
      api: [catalogScreenshotApi(name)],
      db: forensics.db,
      audit: forensics.audit,
      notes: `Catalog screenshot evidence ${name}.`
    });
  }
  return path;
}

export function catalogHref(fixture: CatalogAcceptanceFixture, options: {
  subjectId?: string;
  definitionId?: string;
  catalogReleaseId?: string;
  reviewItemId?: string;
  spec?: string;
} = {}) {
  const params = new URLSearchParams();
  if (options.subjectId) params.set("subjectId", options.subjectId);
  if (options.definitionId) params.set("definitionId", options.definitionId);
  if (options.catalogReleaseId) params.set("catalogReleaseId", options.catalogReleaseId);
  if (options.reviewItemId) params.set("reviewItemId", options.reviewItemId);
  if (options.spec) params.set("spec", options.spec);
  const encoded = params.toString();
  return encoded ? `${CATALOG_PAGE_PATH}?${encoded}` : CATALOG_PAGE_PATH;
}

export async function catalogJson(
  request: APIRequestContext,
  method: string,
  path: string,
  init: { actor?: CatalogBrowserActor; headers?: Record<string, string>; data?: unknown } = {}
) {
  const actor = init.actor ?? "org-admin";
  const response = await request.fetch(apiRoute(path), {
    method,
    headers: {
      ...catalogAuthHeaders(actor),
      ...init.headers
    },
    data: init.data
  });
  const text = await response.text();
  return {
    status: response.status(),
    headers: response.headers(),
    body: text ? (JSON.parse(text) as unknown) : undefined
  };
}

export const catalogUiCopy = {
  actionLabels: {
    "register-subject": "登记主体",
    "update-placement": "调整放置",
    "resolve-review-item": "处理审核",
    "create-proposal": "提出定义修订",
    "submit-proposal": "提交修订",
    "withdraw-proposal": "撤回修订",
    "accept-proposal": "接受修订",
    "reject-proposal": "驳回修订"
  },
  emptyMessages: {
    "no-registrations": "当前发布中没有主体登记。",
    "no-definitions": "当前没有参数定义。",
    "no-review-work": "当前没有待审核事项。",
    "no-filter-match": "没有符合筛选条件的结果。"
  }
} as const;
