import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../../testing/parameterCatalog";
import type { AuthContext } from "../../auth/types";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { CatalogReleaseId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../../parameter-governance/evidence/index";
import { createReviewQueueReader } from "../../parameter-governance/review/index";

const ORG = "review-closure-org";
const OTHER_ORG = "review-closure-other";
const MATCHER = "review-closure-fixture-matcher";

describe("Review Queue closed item through authenticated root HTTP", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let server: Server;
  let baseUrl: string;
  let pin: CatalogReleasePin;
  let historicalReleaseId: string;

  const request = async (actor: "admin" | "member" | "other", method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer review-closure-${actor}`, "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("reviewclosure");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    const bundle = validCatalogReleaseBundle();
    historicalReleaseId = bundle.releases[0]!.manifest.release.id;
    const firstBundle = { schemaVersion: bundle.schemaVersion, targetReleaseId: historicalReleaseId, releases: [structuredClone(bundle.releases[0]!)] };
    const firstCompiled = compileCatalogRelease(firstBundle);
    if (!firstCompiled.ok) throw new Error(JSON.stringify(firstCompiled.error));
    const firstInstalled = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(firstBundle), expectedTargetDigest: firstCompiled.value.aggregateDigest,
    });
    if (!firstInstalled.ok) throw new Error(JSON.stringify(firstInstalled.error));
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const installed = await installPublishedRelease(pool, {
      mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: { id: firstCompiled.value.release.id, digest: firstCompiled.value.release.digest },
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    await pool.query("insert into public.organizations(id,name) values ($1,'Review closure'),($2,'Other')", [ORG, OTHER_ORG]);
    for (const [actor, org, role] of [["admin", ORG, "admin"], ["member", ORG, "software-user"], ["other", OTHER_ORG, "admin"]] as const) {
      await pool.query("insert into public.users(id,organization_id,name,email,title,is_active) values ($1,$2,$1,$3,'Review fixture',true)", [actor, org, `${actor}@review.test`]);
      await pool.query("insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,null,$4)", [`role-${actor}`, actor, org, role]);
    }
    server = createWiseEffServer({ db: root, auth: { mode: "production", verifier: { verify: async (authorization): Promise<AuthContext> => {
      const actor = authorization?.replace("Bearer review-closure-", "");
      if (actor !== "admin" && actor !== "member" && actor !== "other") throw new Error("invalid fixture token");
      const organizationId = actor === "other" ? OTHER_ORG : ORG;
      return { user: { id: actor, organizationId, name: actor, email: `${actor}@review.test`, emailVerified: true, title: "Review fixture", isActive: true }, organization: { id: organizationId, name: organizationId }, roles: [{ roleId: "admin", projectId: null }], permissions: ["parameter:view"] };
    } } } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await root?.close();
    await database?.close();
  });

  it("does not re-project an out-of-scope item as open while a sibling stays open", async () => {
    const ingest = createEvidenceIngest(pool);
    for (const propertyKey of ["closed-key", "closed-key", "sibling-key"]) {
      const result = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
        matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey, compatible: "vendor,device" }, provenance: null });
      expect(result.ok).toBe(true);
    }
    const historical = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: CatalogReleaseId(historicalReleaseId),
      matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(historical.ok).toBe(true);
    expect(historicalReleaseId).not.toBe(pin.id);
    const path = `/api/v2/organizations/${ORG}/parameter-review-items`;
    const before = await request("admin", "GET", path);
    expect(before.status).toBe(200);
    const closed = before.body.items.find((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:closed-key");
    const sibling = before.body.items.find((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:sibling-key");
    expect(closed?.candidates).toHaveLength(2);
    expect(sibling?.status).toBe("open");
    const count = async () => (await pool.query<{ count: number }>(
      "select count(distinct id)::int as count from parameter_catalog.parameter_review_items where organization_id=$1 and catalog_release_id=$2 and status='out-of-scope'", [ORG, pin.id],
    )).rows[0]!.count;
    const reader = createReviewQueueReader(pool);
    const queueQuery = { organizationId: ORG, capturedRelease: pin,
      context: { actorKind: "org-admin" as const, principalId: "admin", organizationId: ORG } };
    expect(before.body.items[0].candidateState.capturedRelease).toEqual(pin);
    expect(await count()).toBe(0);
    const beforeQuery = await reader.list(queueQuery);
    expect(beforeQuery.ok && beforeQuery.value.ignoredReviewItemCount).toBe(0);

    const resolveHeaders = { "X-WiseEff-Catalog-Release": pin.id, "Idempotency-Key": `ignore:${randomUUID()}`, "If-Match": `"${closed.etag}"` };
    const resolved = await request("admin", "POST", `${path}/${closed.id}/resolve`, {
      headers: resolveHeaders,
      body: { resolution: { type: "mark-out-of-scope" }, reason: "reviewed irrelevant observation" },
    });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const replay = await request("admin", "POST", `${path}/${closed.id}/resolve`, {
      headers: resolveHeaders,
      body: { resolution: { type: "mark-out-of-scope" }, reason: "reviewed irrelevant observation" },
    });
    expect(replay.status).toBe(200);
    const repeated = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
      matcherRevision: MATCHER, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(repeated.ok).toBe(true);
    const differentMatcher = await ingest.ingest({ organizationId: ORG, sourceIdentity: `source:${randomUUID()}`, catalogReleaseId: pin.id,
      matcherRevision: `${MATCHER}-next`, matcherOutput: { status: "unknown" }, evidence: { propertyKey: "closed-key", compatible: "vendor,device" }, provenance: null });
    expect(differentMatcher.ok).toBe(true);
    const stored = (await pool.query("select id,evidence_fingerprint,catalog_release_id,matcher_revision,status,etag_version,current_resolution_id from parameter_catalog.parameter_review_items where organization_id=$1 order by id", [ORG])).rows;
    const audits = (await pool.query("select id,action,organization_id from public.audit_events where organization_id=$1 and action='review-item-resolved'", [ORG])).rows;
    const refreshed = await request("admin", "GET", path);
    const detail = await request("admin", "GET", `${path}/${closed.id}`);
    if (process.env.WISEEFF_REVIEW_CLOSURE_PROOF === "1") {
      console.log("REVIEW_CLOSURE_PROOF", JSON.stringify({ pin, before: before.body.items.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status })),
        stored, audits, after: refreshed.body.items.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status })),
        detailStatus: detail.status, ignoredReviewItemCount: await count() }));
    }
    expect(stored.find((item: { id: string }) => item.id === closed.id)?.status).toBe("out-of-scope");
    expect(audits).toHaveLength(1);
    expect(await count()).toBe(1);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.items.find((item: { id: string }) => item.id === closed.id)).toBeUndefined();
    expect(refreshed.body.items.find((item: { id: string }) => item.id === sibling.id)?.status).toBe("open");
    expect(refreshed.body.items.filter((item: { observation?: { propertyKey: string } }) => item.observation?.propertyKey === "property:closed-key")).toHaveLength(1);
    const afterQuery = await reader.list(queueQuery);
    expect(afterQuery.ok && afterQuery.value.ignoredReviewItemCount).toBe(1);
    expect(afterQuery.ok && afterQuery.value.items.some((item) => item.id === closed.id)).toBe(false);
    const otherQuery = await reader.list({ ...queueQuery, organizationId: OTHER_ORG,
      context: { actorKind: "org-admin", principalId: "other", organizationId: OTHER_ORG } });
    expect(otherQuery.ok && otherQuery.value.ignoredReviewItemCount).toBe(0);
    expect(detail.status).toBe(404);
    expect((await request("member", "GET", path)).status).toBe(403);
    expect((await request("other", "GET", path)).status).toBe(404);
  });
});
