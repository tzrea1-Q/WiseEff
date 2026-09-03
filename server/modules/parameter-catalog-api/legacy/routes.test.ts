import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAgentInvocation,
  createUserInvocation,
  type TrustedInvocationContext,
} from "../../auth/trustedInvocation";
import type { AuthContext } from "../../auth/types";
import type { MappingQueryable, ProtectedLookupResult } from "../../catalog-cutover/mapping";
import { createRouter } from "../../../shared/http/router";
import {
  CATALOG_DEPRECATION_HEADER,
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_IF_MATCH_HEADER,
  CATALOG_LEGACY_CONTRACT_HEADER,
  CATALOG_LINK_HEADER,
  CATALOG_RELEASE_HEADER,
  CATALOG_SUNSET_HEADER,
  CATALOG_WARNING_HEADER,
  catalogLegacyGoneResponseSchema,
  catalogLegacyIdentifierResponseSchema,
  parameterCatalogBoundedLegacyReadRouteIds,
  parameterCatalogCanonicalRoutes,
  parameterCatalogLegacyWriteRouteIds,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "../../contracts/routeManifest";

import {
  LEGACY_SPEC_CONTRACT,
  LEGACY_SPEC_WARNING,
  LEGACY_SUCCESSOR_LINK,
} from "./headers";
import { listenLegacyCatalogHttpServer } from "./httpServer";
import { legacyWriteRouteManifest, registerCatalogLegacyRoutes } from "./routes";
import { LEGACY_SUCCESSOR_PATH } from "./types";
import type { LegacyCatalogOptions, LegacyLookupFn } from "./types";

const SUNSET = "Wed, 01 Dec 2026 00:00:00 GMT";
const RELEASE = "crel_01K42";
const ARCHIVE_TOKEN = "archive-secret-token-do-not-leak";

const mappedHead = {
  legacyIdentityId: "lid-mapped",
  currentVersionId: "lmap-1",
  casVersion: 1,
  version: {
    id: "lmap-1",
    legacyIdentityId: "lid-mapped",
    cutoverRunId: "run",
    versionNumber: 1,
    sourceChecksum: "sha256:mapped",
    graphFingerprint: "fp",
    rClass: "R4" as const,
    targetKind: "parameter-definition" as const,
    targetId: "pdef_01KGPIOINT",
    archiveId: null,
    evidenceArchiveId: null,
    supersedesVersionId: null,
  },
};

const mappedResult = {
  outcome: "mapped",
  head: mappedHead,
  targetKind: "parameter-definition",
  targetId: "pdef_01KGPIOINT",
} as const satisfies Extract<ProtectedLookupResult, { outcome: "mapped" }>;

const authFor = (organizationId: string, permissions: AuthContext["permissions"] = ["parameter:view"]): AuthContext => ({
  user: {
    id: `user-${organizationId}`,
    organizationId,
    name: "Legacy Tester",
    title: "Engineer",
    isActive: true,
  },
  organization: { id: organizationId, name: organizationId },
  roles: [{ projectId: null, roleId: "software-user" }],
  permissions,
});

const fillPath = (path: string) => path.replace(/:([^/]+)/g, "fixture-id");

const frozenLegacyIds = new Set<string>([
  "catalog.getLegacyIdentifier",
  ...parameterCatalogBoundedLegacyReadRouteIds,
  ...parameterCatalogLegacyWriteRouteIds,
]);

const frozenLegacyKeys = routeManifest
  .filter((route) => frozenLegacyIds.has(route.id))
  .map((route) => `${route.method} ${route.path}`);

describe("S8-LEG WiseEff router registration", () => {
  it("registers frozen S8-CON legacy catalog paths on createRouter().listRoutes()", () => {
    const router = createRouter();
    registerCatalogLegacyRoutes(router, {} as LegacyCatalogOptions);
    expect(parameterCatalogCanonicalRoutes.some((route) => route.id === "catalog.getLegacyIdentifier")).toBe(
      true,
    );
    expect(frozenLegacyKeys).toEqual(expect.arrayContaining([
      "GET /api/v2/catalog/legacy-identifiers/:legacyType/:legacyId",
    ]));
    expect(frozenLegacyKeys.length).toBe(
      1 + parameterCatalogBoundedLegacyReadRouteIds.length + parameterCatalogLegacyWriteRouteIds.length,
    );
    expect(router.listRoutes().map((route) => `${route.method} ${route.pattern}`).sort()).toEqual(
      [...frozenLegacyKeys].sort(),
    );
  });
});

describe("S8-LEG HTTP seam", () => {
  const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as MappingQueryable;
  let invocation: TrustedInvocationContext | null = createUserInvocation(authFor("org_acme"));
  let lookupCalls = 0;
  const lookup: LegacyLookupFn = async (input) => {
    lookupCalls += 1;
    const identity = input.identity;
    if (identity.kind !== "source-tuple") {
      return { ok: false, error: { code: "PCAT-MAP-UNKNOWN-IDENTITY", detail: "missing" } };
    }
    if (identity.sourceId === "spec-mapped" && identity.ownerScopeKind === "platform") {
      return { ok: true, value: mappedResult };
    }
    if (identity.sourceId === "spec-archived" && identity.ownerScopeKind === "platform") {
      return {
        ok: true,
        value: { outcome: "archived", archiveId: ARCHIVE_TOKEN, head: mappedHead },
      };
    }
    if (identity.sourceId === "spec-blocked") {
      return { ok: true, value: { outcome: "blocked", identityId: "lid-r0", rClass: "R0" } };
    }
    if (
      identity.sourceId === "spec-org" &&
      identity.ownerScopeKind === "organization" &&
      identity.ownerScopeId === "org_acme"
    ) {
      return { ok: true, value: mappedResult };
    }
    return { ok: false, error: { code: "PCAT-MAP-UNKNOWN-IDENTITY", detail: "missing" } };
  };

  let baseUrl = "";
  let close: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    const server = await listenLegacyCatalogHttpServer({
      catalogReleaseId: RELEASE,
      sunsetHttpDate: SUNSET,
      getQueryable: () => client,
      resolveInvocation: () => invocation,
      lookup,
    });
    baseUrl = server.baseUrl;
    close = server.close;
  });

  afterAll(async () => {
    await close();
  });

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
      text,
    };
  };

  it("returns mapped lookup with bounded-legacy headers", async () => {
    lookupCalls = 0;
    invocation = createUserInvocation(authFor("org_acme"));
    const result = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-mapped");
    expect(result.status).toBe(200);
    expect(catalogLegacyIdentifierResponseSchema.safeParse(result.body).success).toBe(true);
    expect(result.headers.get(CATALOG_DEPRECATION_HEADER)).toBe("true");
    expect(result.headers.get(CATALOG_SUNSET_HEADER)).toBe(SUNSET);
    expect(result.headers.get(CATALOG_LINK_HEADER)).toBe(LEGACY_SUCCESSOR_LINK);
    expect(result.headers.get(CATALOG_WARNING_HEADER)).toBe(LEGACY_SPEC_WARNING);
    expect(result.headers.get(CATALOG_LEGACY_CONTRACT_HEADER)).toBe(LEGACY_SPEC_CONTRACT);
    expect(result.headers.get(CATALOG_RELEASE_HEADER)).toBe(RELEASE);
    expect(lookupCalls).toBeGreaterThan(0);
  });

  it("returns 410 archived without archive payload", async () => {
    const result = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-archived");
    expect(result.status).toBe(410);
    expect(result.text).not.toContain(ARCHIVE_TOKEN);
    expect((result.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "legacy-id-archived",
    );
  });

  it("returns 409 for blocked mapping and 404 for unknown or reverse ids", async () => {
    const blocked = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-blocked");
    expect(blocked.status).toBe(409);
    expect((blocked.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "legacy-id-ambiguous",
    );
    expect(JSON.stringify(blocked.body)).not.toContain("lid-r0");

    const unknown = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-missing");
    expect(unknown.status).toBe(404);

    const reverse = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/pdef_01KGPIOINT");
    expect(reverse.status).toBe(404);

    const invalidType = await request("GET", "/api/v2/catalog/legacy-identifiers/driver-schema/schema-1");
    expect(invalidType.status).toBe(404);
  });

  it("scope-hides org mappings and ignores spoofed role headers", async () => {
    invocation = createUserInvocation(authFor("org_other"));
    const hidden = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-org", {
      headers: {
        "X-WiseEff-Role": "platform-admin",
        "X-WiseEff-Organization": "org_acme",
        "X-WiseEff-Actor-Kind": "system",
        "X-WiseEff-Agent": "agent-1",
      },
    });
    expect(hidden.status).toBe(404);

    invocation = createUserInvocation(authFor("org_acme"));
    const visible = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-org");
    expect(visible.status).toBe(200);
  });

  it("retires every frozen legacy write, including idempotent replay", async () => {
    expect(legacyWriteRouteManifest.length).toBeGreaterThan(0);
    invocation = createUserInvocation(authFor("org_acme", ["parameter:view", "admin:access"]));
    for (const route of legacyWriteRouteManifest) {
      const first = await request(route.method, fillPath(route.path), {
        headers: {
          [CATALOG_IDEMPOTENCY_HEADER]: "replay-key",
          [CATALOG_IF_MATCH_HEADER]: '"etag-1"',
          [CATALOG_RELEASE_HEADER]: RELEASE,
        },
        body: { name: "should-not-write" },
      });
      expect(first.status, route.id).toBe(410);
      expect(catalogLegacyGoneResponseSchema.safeParse(first.body).success, route.id).toBe(true);
      expect(
        (first.body as { error: { details: { successor: string; retryable: boolean } } }).error.details
          .successor,
      ).toBe(LEGACY_SUCCESSOR_PATH);
      const replay = await request(route.method, fillPath(route.path), {
        headers: {
          [CATALOG_IDEMPOTENCY_HEADER]: "replay-key",
          [CATALOG_IF_MATCH_HEADER]: '"etag-2"',
        },
        body: { name: "different-fingerprint" },
      });
      expect(replay.status, `${route.id} replay`).toBe(410);
      expect(catalogLegacyGoneResponseSchema.safeParse(replay.body).success, `${route.id} replay`).toBe(
        true,
      );
    }
  });

  it("keeps eligible effective reads and retires governance/raw and inference", async () => {
    invocation = createUserInvocation(authFor("org_acme"));
    lookupCalls = 0;
    const listed = await request("GET", "/api/v2/parameter-specs?view=effective");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [] });
    expect(listed.headers.get(CATALOG_DEPRECATION_HEADER)).toBe("true");
    expect(listed.headers.get(CATALOG_SUNSET_HEADER)).toBe(SUNSET);
    expect(lookupCalls).toBe(0);

    const governance = await request("GET", "/api/v2/parameter-specs?view=governance");
    expect(governance.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.safeParse(governance.body).success).toBe(true);

    lookupCalls = 0;
    const inferred = await request("GET", "/api/v2/parameter-specs?propertyKey=gpio-int");
    expect(inferred.status).toBe(404);
    expect(lookupCalls).toBe(0);

    const exact = await request("GET", "/api/v2/parameter-specs/spec-mapped");
    expect(exact.status).toBe(200);
    expect(catalogLegacyIdentifierResponseSchema.safeParse(exact.body).success).toBe(true);
  });

  it("keeps Agent read-only and refuses operator diagnostics on the public seam", async () => {
    invocation = createAgentInvocation(authFor("org_acme"), {
      sessionId: "sess-1",
      toolCallId: "tool-1",
      approval: { required: false },
    });
    const read = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-mapped");
    expect(read.status).toBe(200);
    const write = await request("POST", "/api/v2/parameter-specs", { body: { name: "agent-write" } });
    expect(write.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.safeParse(write.body).success).toBe(true);

    invocation = null;
    const unauthenticatedWrite = await request("POST", "/api/v2/parameter-specs", {
      body: { name: "anon" },
    });
    expect(unauthenticatedWrite.status).toBe(410);

    const unauthenticatedRead = await request(
      "GET",
      "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-mapped",
    );
    expect(unauthenticatedRead.status).toBe(401);

    invocation = createUserInvocation(authFor("org_acme"));
    const operator = await request("GET", "/api/v2/operator/parameter-catalog/diagnostics");
    expect(operator.status).toBe(404);
    expect(
      (operator.body as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe("migration-diagnostics-not-public");

    const drifted = await request("GET", "/api/v2/catalog/legacy-identifiers/parameter-spec/spec-mapped", {
      headers: { [CATALOG_RELEASE_HEADER]: "crel_stale" },
    });
    expect(drifted.status).toBe(409);
    expect((drifted.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "release-drift",
    );
  });
});
