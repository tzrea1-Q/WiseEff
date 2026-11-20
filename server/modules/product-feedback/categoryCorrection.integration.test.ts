import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createTokenVerifier } from "../auth/tokenVerifier";
import type { ProductFeedbackAdminDto } from "./types";

const available = await isTestDatabaseAvailable();
const secret = "feedback-correction-test-only";
const home = "feedback-home";
const target = "feedback-target";
const path = "/api/v1/product-feedback";
const scope = `organizationId=${target}`;

function token(userId: string, organizationId: string) {
  const payload = Buffer.from(JSON.stringify({ iss: "feedback-correction", sub: userId, org: organizationId, exp: 9_999_999_999 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

describe.skipIf(!available)("feedback category correction over HTTP and PostgreSQL", () => {
  it("audits one correction in the selected organization and retains the submitted record", async () => {
    const fixture = await createEphemeralTestDatabase("feedback1584");
    const db = createPostgresDatabase(fixture.url);
    try {
      await seedCoreGraph(db, { organization: { id: home }, users: [{ id: "platform" }, { id: "foreign-admin" }] });
      await seedCoreGraph(db, { organization: { id: target }, users: [{ id: "submitter" }] });
      await seedBaselineAuthCatalog(db);
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
        ('fb-platform','platform',$1,'platform-admin'), ('fb-foreign','foreign-admin',$1,'admin'),
        ('fb-submitter','submitter',$2,'hardware-user')`, [home, target]);
      const server = createWiseEffServer({ db, objectStore: createMemoryObjectStore(), env: { AUTH_PROVIDER: "hmac" },
        auth: { mode: "production", verifier: createTokenVerifier({ issuer: "feedback-correction", secret }) } });
      const platform = token("platform", home), submitter = token("submitter", target);
      const request = <T,>(url: string, method = "GET", body?: unknown, bearer = platform) =>
        requestJson<T>(server, url, { method, headers: { Authorization: `Bearer ${bearer}` },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const description = "Original submitted feedback";
      const created = await request<{ item: ProductFeedbackAdminDto }>(path, "POST",
        { pagePath: "/knowledge", pageTitle: "Knowledge", feedbackType: "experience", description }, submitter);
      expect(created.status, created.bodyText).toBe(201);
      const original = created.body.item;
      const detail = `${path}/${original.id}`;
      const patch = { effectiveFeedbackType: "data" };
      expect((await request(detail, "PATCH", patch)).status).toBe(404);
      expect((await request(`${detail}?${scope}`, "PATCH", patch, submitter)).status).toBe(403);
      expect((await request(`${detail}?${scope}`, "PATCH", patch, token("foreign-admin", home))).status).toBe(403);
      const filtered = (type: string) => request<{ items: ProductFeedbackAdminDto[] }>(`${path}?${scope}&feedbackType=${type}`);
      expect((await filtered("experience")).body.items.map((item) => item.id)).toEqual([original.id]);
      const history = { feedbackType: "experience", description, submittedAt: original.submittedAt, progressEvents: original.progressEvents };
      const corrected = await request<{ item: ProductFeedbackAdminDto }>(`${detail}?${scope}`, "PATCH", patch);
      expect(corrected.status, corrected.bodyText).toBe(200);
      expect(corrected.body.item).toMatchObject({ ...history, effectiveFeedbackType: "data", organizationId: target, status: "open" });
      const repeated = await request<{ item: ProductFeedbackAdminDto }>(`${detail}?${scope}`, "PATCH", patch);
      expect(repeated.body.item).toEqual(corrected.body.item);
      expect((await filtered("experience")).body.items).toEqual([]);
      expect((await filtered("data")).body.items.map((item) => item.id)).toEqual([original.id]);
      expect((await request(`${path}/stats?${scope}`)).body).toMatchObject({ total: 1, byType: { experience: 0, data: 1, export_submit: 0, feature: 0 } });
      const mine = await request<{ item: { feedbackType: string; description: string; submittedAt: string } }>(`${path}/mine/${original.id}`, "GET", undefined, submitter);
      expect(mine.body.item).toMatchObject({ feedbackType: "experience", description, submittedAt: original.submittedAt });
      const audits = await request<{ items: unknown[] }>(`/api/v1/audit-events?${scope}&kind=product-feedback-update&targetId=${original.id}`);
      expect(audits.body.items).toMatchObject([{ actorUserId: "platform", metadata: { previousFeedbackType: "experience", nextFeedbackType: "data", operatingOrganizationId: target } }]);
    } finally {
      await db.close();
      await fixture.drop();
    }
  }, 120_000);
});
