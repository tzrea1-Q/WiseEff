import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { decodeCatalogCursor, encodeCatalogCursor } from "../../catalog-kernel/runtime/cursors";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogProposalResponseSchema,
  catalogRegistrationResponseSchema,
  catalogRegistrationListResponseSchema,
  catalogReviewResolutionResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../../parameter-governance/evidence/index";
import type { IngestEvidenceCommand } from "../../parameter-governance/evidence/types";
import { executeProposal } from "../../parameter-governance/proposals/index";
import { executeRegistration } from "../../parameter-governance/registration/index";
import { createGovernanceCatalogQueries } from "../../parameter-governance/queries/index";
import { resolveReviewItem } from "../../parameter-governance/resolveReviewItem/index";
import { createReviewQueueReader } from "../../parameter-governance/review/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { listenCatalogGovernanceHttpServer } from "./http";
import { bindCatalogGovernanceCommands, bindGovernanceCatalogQueryPorts, emptyGovernanceQueryPorts } from "./ports";
import type { CatalogGovernancePorts, TrustedGovernanceScope } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S8-GOV requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S8-GOV requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s8-gov";
const ATTR_ID = "attr-s8-gov";
const MODULE_ID = "pmod-s8-gov-driver";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const MATCHER_REVISION = "matcher-s8-gov-1";

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

describe("S8-GOV HTTP against real PostgreSQL", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  let scope: TrustedGovernanceScope;

  const request = async (
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ) => {
    const canSendBody = method !== "GET" && method !== "HEAD";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      body: !canSendBody || init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s8gov");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S8 GOV')`, [ORG_ID]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S8 GOV driver', 'compatible:acme,power')`,
      [ATTR_ID, ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR_ID],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE_ID, ORG_ID, ATTR_ID],
    );

    scope = {
      principalId: "user-org-admin",
      organizationId: ORG_ID,
      actorKind: "org-admin",
      canReadGovernance: true,
      canMutateOrganization: true,
      canReviewProposals: false,
      defaultDestinationModuleId: MODULE_ID,
      defaultSubjectKind: "driver",
    };
    const reader = createReviewQueueReader(pool);
    const ports: CatalogGovernancePorts = {
      authenticate: async () => ({ ok: true, scope }),
      currentRelease: async () => pin,
      ...bindCatalogGovernanceCommands({
        executeRegistration: (command) => executeRegistration(pool, command),
        resolveReviewItem: (command) => resolveReviewItem(pool, command),
        executeProposal: (command) => executeProposal(pool, command),
        listReviewQueue: (query) => reader.list(query),
        getReviewItem: (query) => reader.get(query),
      }),
      ...emptyGovernanceQueryPorts,
    };
    const server = await listenCatalogGovernanceHttpServer(ports);
    baseUrl = server.baseUrl;
    close = server.close;
  }, 60_000);

  afterAll(async () => {
    await close();
    await pool?.end();
    await database?.drop();
  });

  it("registers a subject through HTTP and writes one Registration/Placement pair", async () => {
    const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations`, {
      headers: {
        [CATALOG_RELEASE_HEADER]: pin.id,
        [CATALOG_IDEMPOTENCY_HEADER]: `reg:${randomUUID()}`,
      },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
        reason: "explicit HTTP registration",
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.headers.get(CATALOG_RELEASE_HEADER)).toBe(pin.id);
    expect(result.headers.get("etag")).toBeTruthy();
    const body = catalogRegistrationResponseSchema.parse(result.body);
    expect(body.item.subjectId).toBe(SUBJECT_ID);
    expect(body.item.status).toBe("active");
    expect(body.item.organizationId).toBe(ORG_ID);

    const stored = await pool.query<{ registrations: string; placements: string }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $1 and subject_id = $2) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $1) as placements
      `,
      [ORG_ID, SUBJECT_ID],
    );
    expect(stored.rows[0]).toEqual({ registrations: "1", placements: "1" });
  });

  it("does not invoke a domain write when Idempotency-Key is missing", async () => {
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.governance_command_idempotency
        where organization_id = $1`,
      [ORG_ID],
    );
    const result = await request("POST", `/api/v2/organizations/${ORG_ID}/subject-registrations`, {
      headers: { [CATALOG_RELEASE_HEADER]: pin.id },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
      },
    });
    expect(result.status).toBe(409);
    expect((result.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "revision-conflict",
    );
    const after = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.governance_command_idempotency
        where organization_id = $1`,
      [ORG_ID],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("creates a proposal over HTTP and appends a trusted audit event", async () => {
    const result = await request("POST", "/api/v2/catalog/definition-proposals", {
      headers: {
        [CATALOG_RELEASE_HEADER]: pin.id,
        [CATALOG_IDEMPOTENCY_HEADER]: `prop:${randomUUID()}`,
      },
      body: {
        base: {
          catalogReleaseId: pin.id,
          definitionId: "pdef_acme_power_iin_max",
          definitionRevisionId: "drev_acme_power_iin_max_1",
        },
        requestedChange: { kind: "revise-definition", note: "s8-gov" },
        reason: "field measurement requires a higher limit",
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const body = catalogProposalResponseSchema.parse(result.body);
    expect(body.item.status).toBe("draft");
    expect(body.item.organizationId).toBe(ORG_ID);
    const audits = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and action = 'proposal-create-draft'`,
      [ORG_ID],
    );
    expect(Number(audits.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("resolves a review item over HTTP with If-Match and records success audit", async () => {
    const ingest = createEvidenceIngest(pool);
    const reader = createReviewQueueReader(pool);
    const command: IngestEvidenceCommand = {
      organizationId: ORG_ID,
      sourceIdentity: `unknown:${randomUUID()}`,
      catalogReleaseId: pin.id,
      matcherRevision: MATCHER_REVISION,
      matcherOutput: { status: "unknown" },
      evidence: { propertyKey: `iin_max_${randomUUID()}` },
      provenance: null,
    };
    const ingested = await ingest.ingest(command);
    expect(ingested.ok).toBe(true);
    const listed = await reader.list({
      organizationId: ORG_ID,
      capturedRelease: pin,
      context: {
        actorKind: "org-admin",
        principalId: scope.principalId,
        organizationId: ORG_ID,
      },
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const item = listed.value.items[0];
    expect(item).toBeDefined();
    if (!item) return;

    const result = await request(
      "POST",
      `/api/v2/organizations/${ORG_ID}/parameter-review-items/${item.id}/resolve`,
      {
        headers: {
          [CATALOG_RELEASE_HEADER]: pin.id,
          [CATALOG_IDEMPOTENCY_HEADER]: `resolve:${randomUUID()}`,
          [CATALOG_IF_MATCH_HEADER]: `"${item.etag}"`,
        },
        body: {
          resolution: { type: "mark-out-of-scope" },
          reason: "unknown",
        },
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    catalogReviewResolutionResponseSchema.parse(result.body);
    const audits = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and action = 'review-item-resolved'`,
      [ORG_ID],
    );
    expect(Number(audits.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("ignores spoofed identity headers on a real HTTP read", async () => {
    const result = await request("GET", `/api/v2/organizations/${ORG_ID}/parameter-review-items`, {
      headers: {
        "X-WiseEff-Role": "platform-admin",
        "X-WiseEff-Organization": "org-attacker",
        "X-WiseEff-Actor-Kind": "agent",
        "X-WiseEff-Agent": "true",
      },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get(CATALOG_RELEASE_HEADER)).toBe(pin.id);
  });
});

describe("registration pagination through public HTTP and real PostgreSQL", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let scope: TrustedGovernanceScope;
  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;
  const organizationId = "org-registration-pages";
  const emptyOrganizationId = "org-registration-pages-empty";
  const expected = new Map<string, { subjectId: string; placementId: string }>();
  const path = (org = organizationId) => `/api/v2/organizations/${org}/subject-registrations`;
  const get = async (query: Record<string, string> = {}, org = organizationId, headers: Record<string, string> = {}) => {
    const response = await fetch(`${baseUrl}${path(org)}?${new URLSearchParams(query)}`, { headers });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("registration_pages");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const bundle = firstReleaseBundle();
    const release = structuredClone(bundle.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
    const subject = release.documents.find((document) => document.kind === "subject")!;
    if (subject.kind !== "subject") throw new Error("missing fixture subject");
    for (let index = 1; index <= 100; index += 1) {
      const document = structuredClone(subject);
      document.content.id = `csub_page_${index}`;
      document.content.canonicalKey = `driver:acme,page-${index}`;
      document.content.selector.value = `acme,page-${index}`;
      release.documents.push(document);
    }
    refreshAuthoritativeSource(release);
    const expanded = { ...bundle, releases: [release] };
    const compiled = compileOrThrow(expanded);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(expanded), expectedTargetDigest: compiled.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.release.id, digest: compiled.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Pagination'), ($2, 'Empty')`, [organizationId, emptyOrganizationId]);
    await pool.query(`insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
      values ('attr-registration-pages', $1, 'driver-registration', 'Pages', 'compatible:acme,pages')`, [organizationId]);
    await pool.query(`insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
      values ('attr-registration-pages', 'physical-device', 'multiple')`);
    await pool.query(`insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
      values ('pmod-registration-pages', $1, 'Pages', 'pmod-registration-pages', 1, 'driver-group', 'curated', 'attr-registration-pages')`, [organizationId]);
    scope = { principalId: "user-registration-pages", organizationId, actorKind: "org-admin", canReadGovernance: true,
      canMutateOrganization: true, canReviewProposals: false, defaultDestinationModuleId: "pmod-registration-pages", defaultSubjectKind: "driver" };
    for (const document of release.documents) {
      if (document.kind !== "subject") continue;
      const moduleId = `pmod_${document.content.id}`;
      await pool.query(`insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
        values ($1, $2, $1, $1, 1, 'driver-group', 'curated', 'attr-registration-pages')`, [moduleId, organizationId]);
      const result = await executeRegistration(pool, {
        kind: "register", organizationId, subjectId: CatalogSubjectId(document.content.id), subjectKind: "driver",
        expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
        method: "explicit", proof: {}, idempotencyKey: `page:${document.content.id}`,
        context: { actorKind: "org-admin", principalId: scope.principalId },
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw new Error("registration failed");
      expected.set(result.value.registrationId, { subjectId: result.value.subjectId, placementId: result.value.placementId });
    }
    const reader = createReviewQueueReader(pool);
    const server = await listenCatalogGovernanceHttpServer({
      authenticate: async () => ({ ok: true, scope }), currentRelease: async () => pin,
      ...bindCatalogGovernanceCommands({ executeRegistration: (command) => executeRegistration(pool, command),
        executeProposal: (command) => executeProposal(pool, command), resolveReviewItem: (command) => resolveReviewItem(pool, command),
        listReviewQueue: (query) => reader.list(query), getReviewItem: (query) => reader.get(query) }),
      ...bindGovernanceCatalogQueryPorts(createGovernanceCatalogQueries(pool)),
    });
    baseUrl = server.baseUrl;
    close = server.close;
  }, 60_000);

  afterAll(async () => { await close(); await pool?.end(); await database?.drop(); });

  it("returns all 101 guarded registrations with truthful bounded pages and bound public cursors", async () => {
    expect(expected.size).toBe(101);
    const first100 = await get({ limit: "100", catalogReleaseId: pin.id });
    expect(first100.status, JSON.stringify(first100.body)).toBe(200);
    const page100 = catalogRegistrationListResponseSchema.parse(first100.body);
    expect(page100.items).toHaveLength(100);
    expect(page100.totalCount).toBe(101);
    expect(page100.hasMore).toBe(true);
    expect(page100.nextCursor).toBeTruthy();
    const tail = catalogRegistrationListResponseSchema.parse((await get({ limit: "100", cursor: page100.nextCursor! })).body);
    expect(tail.items).toHaveLength(1);
    expect(tail.totalCount).toBe(101);
    expect(tail.hasMore).toBe(false);
    expect(tail.nextCursor).toBeNull();
    const all = [...page100.items, ...tail.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(101);
    expect(all.map((item) => item.id).sort()).toEqual([...expected.keys()].sort());
    for (const item of all) expect({ subjectId: item.subjectId, placementId: item.placement.id }).toEqual(expected.get(item.id));
    const defaultPages = [];
    let cursor: string | undefined;
    do {
      const response = await get(cursor ? { cursor } : {});
      expect(response.status).toBe(200);
      const page = catalogRegistrationListResponseSchema.parse(response.body);
      expect(page.totalCount).toBe(101);
      expect(page.hasMore).toBe(page.nextCursor !== null);
      defaultPages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(defaultPages.map((page) => page.items.length)).toEqual([50, 50, 1]);
    expect(defaultPages.flatMap((page) => page.items.map((item) => item.id))).toEqual(all.map((item) => item.id));
    const last = all.at(-1)!;
    const detail = await fetch(`${baseUrl}${path()}/${last.id}`);
    expect(detail.status).toBe(200);
    expect(catalogRegistrationResponseSchema.parse(await detail.json()).item).toEqual({ ...last, impact: { bindingCount: 0, projectCount: 0 } });
    const placement = await fetch(`${baseUrl}${path()}/${last.id}/placement`);
    expect(placement.status).toBe(200);
    expect((await placement.json()).item.id).toBe(last.placement.id);
    const decoded = decodeCatalogCursor(page100.nextCursor!);
    if ("malformed" in decoded) throw new Error("public cursor malformed");
    expect(decoded.releaseId).toBe(pin.id);
    expect(decoded.digest).toBe(pin.digest);
    expect(decoded.last).toHaveLength(1);
    const changedPageSize = catalogRegistrationListResponseSchema.parse((await get({ cursor: defaultPages[0]!.nextCursor!, limit: "100" })).body);
    expect(changedPageSize.items).toHaveLength(51);
    expect(changedPageSize.totalCount).toBe(101);
    for (const limit of ["0", "-1", "1.5", "nope", "101", ""]) expect((await get({ limit })).status).toBe(400);
    for (const bad of ["malformed", String(decoded.last[0]), encodeCatalogCursor({ ...decoded, queryFingerprint: "wrong" }),
      encodeCatalogCursor({ ...decoded, last: [] }), encodeCatalogCursor({ ...decoded, last: [""] })]) {
      expect((await get({ cursor: bad })).status).toBe(400);
    }
    for (const bad of [encodeCatalogCursor({ ...decoded, releaseId: "crel_stale" }), encodeCatalogCursor({ ...decoded, digest: "sha256:wrong" })]) {
      expect((await get({ cursor: bad })).status).toBe(409);
    }
    expect((await get({ catalogReleaseId: "crel_stale" })).status).toBe(409);
    expect((await get({}, organizationId, { [CATALOG_RELEASE_HEADER]: "crel_stale" })).status).toBe(409);
    expect((await get({ catalogReleaseId: "crel_stale" }, organizationId, { [CATALOG_RELEASE_HEADER]: pin.id })).status).toBe(409);
    expect((await get({ catalogReleaseId: pin.id }, organizationId, { [CATALOG_RELEASE_HEADER]: pin.id })).status).toBe(200);
    const originalPin = pin;
    pin = { ...pin, digest: `${pin.digest}-changed` as CatalogReleasePin["digest"] };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(409);
    pin = { ...originalPin, id: "crel_changed" as CatalogReleasePin["id"] };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(409);
    pin = originalPin;
    expect((await get({}, emptyOrganizationId)).status).toBe(404);
    const originalScope = scope;
    scope = { ...scope, principalId: "user-other" };
    expect((await get({ cursor: page100.nextCursor! })).status).toBe(400);
    scope = { ...originalScope, organizationId: emptyOrganizationId };
    expect((await get({ cursor: page100.nextCursor! }, emptyOrganizationId)).status).toBe(400);
    const empty = catalogRegistrationListResponseSchema.parse((await get({}, emptyOrganizationId)).body);
    expect(empty).toMatchObject({ items: [], totalCount: 0, nextCursor: null, hasMore: false, emptyReason: "no-registrations" });
    scope = originalScope;
    const inner = JSON.parse(Buffer.from(String(decoded.last[0]), "base64url").toString("utf8"));
    const foreignInner = Buffer.from(JSON.stringify({ ...inner, principalId: "user-other" })).toString("base64url");
    expect((await get({ cursor: encodeCatalogCursor({ ...decoded, last: [foreignInner] }) })).status).toBe(400);
    inner.lastId = last.id;
    const exhausted = catalogRegistrationListResponseSchema.parse((await get({ cursor: encodeCatalogCursor({ ...decoded,
      last: [Buffer.from(JSON.stringify(inner)).toString("base64url")] }) })).body);
    expect(exhausted).toMatchObject({ items: [], totalCount: 101, nextCursor: null, hasMore: false, emptyReason: "no-filter-match" });
  });
});
