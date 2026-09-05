import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogDefinitionResponseSchema,
  catalogDocumentResponseSchema,
  catalogObservationListResponseSchema,
  catalogObservationResponseSchema,
  catalogPlacementResponseSchema,
  catalogProposalListResponseSchema,
  catalogProposalResponseSchema,
  catalogRegistrationResponseSchema,
  catalogSubjectResponseSchema,
} from "../contracts/dtoSchemas/parameterCatalog";
import {
  A_RELEASE_ID,
  SUBJECT_ID,
  X_DEFINITION_ID,
  X_REVISION_2,
  installPublishedCatalogChain,
} from "../catalog-kernel/runtime/catalogChain.fixture";
import { createEvidenceIngest } from "../parameter-governance/evidence";
import type { AuthContext } from "../auth/types";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";

const ORG_A = "org-op06-a";
const ORG_B = "org-op06-b";
const ADMIN_A = "user-op06-admin-a";
const GUEST_A = "user-op06-guest-a";
const PLATFORM_A = "user-op06-platform-a";
const AGENT_A = "agt-op06-agent-a";
const ADMIN_B = "user-op06-admin-b";
const ATTR_A = "attr-op06-a";
const MODULE_A = "pmod-op06-driver";
const MODULE_A2 = "pmod-op06-driver-b";

const tokens = {
  "token-admin-a": { id: ADMIN_A, organizationId: ORG_A, email: "admin-a@op06.test", name: "Admin A" },
  "token-guest-a": { id: GUEST_A, organizationId: ORG_A, email: "guest-a@op06.test", name: "Guest A" },
  "token-platform-a": {
    id: PLATFORM_A,
    organizationId: ORG_A,
    email: "platform-a@op06.test",
    name: "Platform A",
  },
  "token-agent-a": { id: AGENT_A, organizationId: ORG_A, email: "agent-a@op06.test", name: "Agent A" },
  "token-admin-b": { id: ADMIN_B, organizationId: ORG_B, email: "admin-b@op06.test", name: "Admin B" },
} as const;

const authContext = (token: keyof typeof tokens): AuthContext => {
  const user = tokens[token];
  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      name: user.name,
      email: user.email,
      emailVerified: true,
      title: token === "token-agent-a" ? "WiseEff Agent" : user.name,
      isActive: true,
    },
    organization: { id: user.organizationId, name: user.organizationId },
    roles: [],
    permissions: [],
  };
};

describe("OP-06 production Catalog composition", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let baseUrl = "";
  let currentReleaseId = "";
  let currentDigest = "";
  let pinA: { id: string; digest: string };
  let pinC: { id: string; digest: string };

  const json = async (
    method: string,
    path: string,
    init: { token?: keyof typeof tokens; headers?: Record<string, string>; body?: unknown } = {},
  ) => {
    const token = init.token ?? "token-admin-a";
    const canSendBody = method !== "GET" && method !== "HEAD";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
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
    database = await createDisposableParameterCatalogDatabase("op06wire");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) {
      throw new Error("OP-06 composition requires a root PostgreSQL pool");
    }
    const installed = await installPublishedCatalogChain(pool);
    pinA = installed.pinA;
    pinC = installed.pinC;
    currentReleaseId = installed.pinC.id;
    currentDigest = installed.pinC.digest;

    await pool.query(`insert into public.organizations (id, name) values ($1, 'OP06 A'), ($2, 'OP06 B')`, [
      ORG_A,
      ORG_B,
    ]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values ($1, $2, 'OP06', 'OP6')`,
      ["project-op06", ORG_A],
    );
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values
         ($1, $6, 'Admin A', 'admin-a@op06.test', 'Admin', true),
         ($2, $6, 'Guest A', 'guest-a@op06.test', 'Guest', true),
         ($3, $6, 'Platform A', 'platform-a@op06.test', 'Platform', true),
         ($4, $6, 'Agent A', 'agent-a@op06.test', 'WiseEff Agent', true),
         ($5, $7, 'Admin B', 'admin-b@op06.test', 'Admin', true)`,
      [ADMIN_A, GUEST_A, PLATFORM_A, AGENT_A, ADMIN_B, ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values
         ('urb-op06-admin-a', $1, $6, null, 'admin'),
         ('urb-op06-guest-a', $2, $6, null, 'guest'),
         ('urb-op06-platform-a', $3, $6, null, 'platform-admin'),
         ('urb-op06-agent-a', $4, $6, null, 'guest'),
         ('urb-op06-admin-b', $5, $7, null, 'admin')`,
      [ADMIN_A, GUEST_A, PLATFORM_A, AGENT_A, ADMIN_B, ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'OP06 driver', 'compatible:acme,power'),
                ($3, $2, 'driver-registration', 'OP06 driver b', 'compatible:acme,power-b')`,
      [ATTR_A, ORG_A, `${ATTR_A}-b`],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple'), ($2, 'physical-device', 'multiple')`,
      [ATTR_A, `${ATTR_A}-b`],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver', $1, 1, 'driver-group', 'curated', $4),
         ($2, $3, 'Driver B', $2, 1, 'driver-group', 'curated', $5)`,
      [MODULE_A, MODULE_A2, ORG_A, ATTR_A, `${ATTR_A}-b`],
    );

    server = createWiseEffServer({
      db: root,
      auth: {
        mode: "production",
        verifier: {
          verify: async (authorization) => {
            const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
            if (!(token in tokens)) {
              throw new Error("Authorization bearer token is required.");
            }
            return authContext(token as keyof typeof tokens);
          },
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await root?.close();
    await database?.close();
  });

  it("reads current and pinned A/C metadata from the real Kernel pin", async () => {
    const current = await json("GET", "/api/v2/catalog");
    expect(current.status, JSON.stringify(current.body)).toBe(200);
    const currentBody = catalogDocumentResponseSchema.parse(current.body);
    expect(currentBody.item.catalogReleaseId).toBe(pinC.id);
    expect(currentBody.item.digest).toBe(currentDigest);
    expect(currentBody.item.releaseSequence).toBeGreaterThan(0);
    expect(new Date(currentBody.item.publishedAt).getTime()).toBeGreaterThan(0);
    expect(currentBody.item.publishedAt).not.toBe("1970-01-01T00:00:00.000Z");
    expect(current.headers.get(CATALOG_RELEASE_HEADER)).toBe(pinC.id);

    const pinned = await json("GET", `/api/v2/catalog?catalogReleaseId=${pinA.id}`);
    expect(pinned.status, JSON.stringify(pinned.body)).toBe(200);
    const pinnedBody = catalogDocumentResponseSchema.parse(pinned.body);
    expect(pinnedBody.item.catalogReleaseId).toBe(pinA.id);
    expect(pinnedBody.item.digest).toBe(pinA.digest);
    expect(pinnedBody.item.digest).not.toBe(currentDigest);
    expect(pinnedBody.item.publishedAt).not.toBe(currentBody.item.publishedAt);
    expect(pinned.headers.get(CATALOG_RELEASE_HEADER)).toBe(pinA.id);

    const mismatch = await json(
      "GET",
      `/api/v2/catalog?catalogReleaseId=${A_RELEASE_ID}&catalogReleaseDigest=${currentDigest}`,
    );
    expect(mismatch.status).toBe(409);
    expect((mismatch.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "release-drift",
    );
  });

  it("registers, rereads, and updates Placement through the production root", async () => {
    const created = await json("POST", `/api/v2/organizations/${ORG_A}/subject-registrations`, {
      headers: {
        [CATALOG_RELEASE_HEADER]: currentReleaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: `reg:${randomUUID()}`,
      },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
        reason: "op06 register",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const registration = catalogRegistrationResponseSchema.parse(created.body);
    expect(registration.item.subjectId).toBe(SUBJECT_ID);
    expect(registration.item.id).toMatch(/^sreg_/);
    expect(registration.item.placement.id).toMatch(/^spla_/);

    const subject = await json("GET", `/api/v2/catalog/subjects/${SUBJECT_ID}`);
    expect(subject.status).toBe(200);
    const subjectBody = catalogSubjectResponseSchema.parse(subject.body);
    expect(subjectBody.item.registration.status).toBe("active");
    if (subjectBody.item.registration.status !== "active") return;
    expect(subjectBody.item.registration.id).toBe(registration.item.id);
    expect(subjectBody.item.registration.placement?.id).toBe(registration.item.placement.id);

    const moved = await json(
      "PATCH",
      `/api/v2/organizations/${ORG_A}/subject-registrations/${registration.item.id}/placement`,
      {
        headers: {
          [CATALOG_RELEASE_HEADER]: currentReleaseId,
          [CATALOG_IDEMPOTENCY_HEADER]: `move:${randomUUID()}`,
          [CATALOG_IF_MATCH_HEADER]: created.headers.get("etag") ?? "",
        },
        body: { placement: { mode: "use-default" } },
      },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    catalogPlacementResponseSchema.parse(moved.body);

    const definition = await json("GET", `/api/v2/catalog/definitions/${X_DEFINITION_ID}`);
    expect(definition.status).toBe(200);
    const definitionBody = catalogDefinitionResponseSchema.parse(definition.body);
    expect(definitionBody.item.id).toBe(X_DEFINITION_ID);
    expect(definitionBody.item.registration.status).toBe("active");
    if (definitionBody.item.registration.status !== "active") return;
    expect(definitionBody.item.registration.id).toBe(registration.item.id);
  });

  it("lists Observation and Proposal detail after real writes", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("missing pool");
    const ingest = createEvidenceIngest(pool);
    const observation = await ingest.ingest({
      organizationId: ORG_A,
      sourceIdentity: `obs:${randomUUID()}`,
      catalogReleaseId: currentReleaseId,
      matcherRevision: "matcher-op06",
      matcherOutput: { status: "matched" },
      provenance: {
        projectId: "project-op06",
        logicalNodeId: "logical-op06",
        configRevisionId: "config-op06-1",
        sourceLocator: { path: "/soc/charger", property: "iin_max" },
      },
    });
    expect(observation.ok).toBe(true);
    if (!observation.ok) return;

    const listed = await json("GET", `/api/v2/organizations/${ORG_A}/parameter-observations`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const listBody = catalogObservationListResponseSchema.parse(listed.body);
    expect(listBody.items.some((item) => item.id === observation.value.id)).toBe(true);

    const detail = await json(
      "GET",
      `/api/v2/organizations/${ORG_A}/parameter-observations/${observation.value.id}`,
    );
    expect(detail.status).toBe(200);
    const detailBody = catalogObservationResponseSchema.parse(detail.body);
    expect(detailBody.item.id).toBe(observation.value.id);
  });

  it("runs create-draft → submit-existing → accept without writing Catalog definitions", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("missing pool");
    const before = await pool.query<{ heads: string }>(
      `select count(*)::text as heads from parameter_catalog.catalog_release_definition_heads`,
    );

    const created = await json("POST", "/api/v2/catalog/definition-proposals", {
      headers: {
        [CATALOG_RELEASE_HEADER]: currentReleaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: `draft:${randomUUID()}`,
      },
      body: {
        base: {
          catalogReleaseId: currentReleaseId,
          definitionId: X_DEFINITION_ID,
          definitionRevisionId: X_REVISION_2,
        },
        requestedChange: { kind: "revise-definition", note: "op06" },
        reason: "op06 proposal lifecycle",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = catalogProposalResponseSchema.parse(created.body);
    expect(draft.item.status).toBe("draft");
    expect(draft.item.id).toMatch(/^dprop_/);

    const listed = await json("GET", "/api/v2/catalog/definition-proposals");
    expect(listed.status).toBe(200);
    const listBody = catalogProposalListResponseSchema.parse(listed.body);
    expect(listBody.items.some((item) => item.id === draft.item.id)).toBe(true);

    const loaded = await json("GET", `/api/v2/catalog/definition-proposals/${draft.item.id}`);
    expect(loaded.status).toBe(200);
    expect(catalogProposalResponseSchema.parse(loaded.body).item.id).toBe(draft.item.id);

    const submitted = await json("POST", `/api/v2/catalog/definition-proposals/${draft.item.id}/submit`, {
      headers: {
        [CATALOG_RELEASE_HEADER]: currentReleaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: `submit:${randomUUID()}`,
        [CATALOG_IF_MATCH_HEADER]: created.headers.get("etag") ?? "",
      },
      body: { reason: "submit existing" },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const submittedBody = catalogProposalResponseSchema.parse(submitted.body);
    expect(submittedBody.item.id).toBe(draft.item.id);
    expect(submittedBody.item.status).toBe("submitted");

    const accepted = await json("POST", `/api/v2/catalog/definition-proposals/${draft.item.id}/accept`, {
      token: "token-platform-a",
      headers: {
        [CATALOG_RELEASE_HEADER]: currentReleaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: `accept:${randomUUID()}`,
        [CATALOG_IF_MATCH_HEADER]: submitted.headers.get("etag") ?? "",
      },
      body: { repositoryReference: "repo://wiseeff-catalog/op06.yaml" },
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const acceptedBody = catalogProposalResponseSchema.parse(accepted.body);
    expect(acceptedBody.item.id).toBe(draft.item.id);
    expect(acceptedBody.item.status).toBe("accepted");
    expect(acceptedBody.item.publicationIntentRef).toBeTruthy();

    const after = await pool.query<{ heads: string }>(
      `select count(*)::text as heads from parameter_catalog.catalog_release_definition_heads`,
    );
    expect(after.rows[0]?.heads).toBe(before.rows[0]?.heads);
  });

  it("hides cross-organization writes and refuses Agent governance writes", async () => {
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("missing pool");
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.organization_subject_registrations`,
    );

    const leaked = await json("GET", `/api/v2/organizations/${ORG_A}/subject-registrations`, {
      token: "token-admin-b",
    });
    expect(leaked.status).toBe(404);

    const agentWrite = await json("POST", `/api/v2/organizations/${ORG_A}/subject-registrations`, {
      token: "token-agent-a",
      headers: {
        [CATALOG_RELEASE_HEADER]: currentReleaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: `agent:${randomUUID()}`,
      },
      body: {
        subjectId: SUBJECT_ID,
        placement: { mode: "use-default" },
        reason: "agent must not write",
      },
    });
    expect(agentWrite.status).toBe(403);
    const after = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.organization_subject_registrations`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("returns catalog-not-ready when required internals are missing", async () => {
    const unavailable = createWiseEffServer();
    await new Promise<void>((resolve) => unavailable.listen(0, "127.0.0.1", resolve));
    try {
      const address = unavailable.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/catalog`);
      const body = (await response.json()) as {
        error?: { details?: { reason?: string } };
        items?: unknown;
      };
      expect(response.status).toBe(503);
      expect(body.error?.details?.reason).toBe("catalog-not-ready");
      expect(body.items).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        unavailable.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("resolves an old release id without borrowing the current digest", async () => {
    const unknown = await json("GET", "/api/v2/catalog?catalogReleaseId=crel_missing_op06");
    expect(unknown.status).toBe(404);

    const pinned = await json("GET", `/api/v2/catalog/definitions/${X_DEFINITION_ID}?catalogReleaseId=${A_RELEASE_ID}`);
    expect(pinned.status).toBe(200);
    const body = catalogDefinitionResponseSchema.parse(pinned.body);
    expect(body.item.currentRevision.publishedInCatalogReleaseId).toBe(A_RELEASE_ID);
    expect(pinned.headers.get(CATALOG_RELEASE_HEADER)).toBe(A_RELEASE_ID);
    expect(pinned.headers.get(CATALOG_RELEASE_HEADER)).not.toBe(currentReleaseId);
  });
});
