import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogProposalResponseSchema,
  catalogRegistrationResponseSchema,
  catalogReviewResolutionResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../../parameter-governance/evidence/index";
import type { IngestEvidenceCommand } from "../../parameter-governance/evidence/types";
import { executeProposal } from "../../parameter-governance/proposals/index";
import { executeRegistration } from "../../parameter-governance/registration/index";
import { resolveReviewItem } from "../../parameter-governance/resolveReviewItem/index";
import { createReviewQueueReader } from "../../parameter-governance/review/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { listenCatalogGovernanceHttpServer } from "./http";
import { bindCatalogGovernanceCommands, emptyGovernanceQueryPorts } from "./ports";
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
          definitionRevisionId: "drev_acme_power_iin_max_1",
        },
        requestedChange: { kind: "revise-definition", note: "s8-gov" },
        reason: "field measurement requires a higher limit",
      },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const body = catalogProposalResponseSchema.parse(result.body);
    expect(body.item.status).toBe("submitted");
    expect(body.item.organizationId).toBe(ORG_ID);
    const audits = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1
          and action = 'proposal-submit'`,
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
