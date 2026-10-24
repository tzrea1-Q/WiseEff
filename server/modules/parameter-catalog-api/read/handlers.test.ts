import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import { registerCatalogReadRoutes } from "./routes";

import { DriverCompatible, PropertyKey, type CurrentCatalogSnapshot, type CatalogSubjectDetailSnapshot, type CatalogSnapshot, type DefinitionContentDigest, type DefinitionRevisionSnapshot, type ParameterDefinitionSnapshot } from "../../catalog-kernel/interface";
import { CapturedCatalogSnapshot } from "../../catalog-kernel/runtime/currentSnapshot";
import {
  CATALOG_RELEASE_HEADER,
  catalogDocumentResponseSchema,
  catalogSubjectListResponseSchema,
  catalogDefinitionResponseSchema,
  catalogDefinitionRevisionResponseSchema,
  parameterCatalogKernelReadByRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogCursor,
  CatalogAliasId,
  CatalogCanonicalKey,
  CatalogEventTime,
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseSequence,
  CatalogReleaseVersion,
  CatalogSubjectId,
  CatalogTimelineFactId,
  DefinitionRevisionId,
  ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";
import { handleCatalogRead, matchCatalogReadRoute } from "./handlers";
import { createUsageProjectionFromQueries, createRegistrationProjectionFromQueries, kernelOnlyTimelineComposer, unregisteredProjection, zeroUsageProjection } from "./ports";
import { createUsageQueries, USAGE_CURRENT_PROJECTION_SEMANTICS } from "../../parameter-bindings/usage";
import { createGovernanceCatalogQueries, GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "../../parameter-governance/queries";
import type {
  CatalogDocumentFacts,
  CatalogReadPorts,
  CatalogReadRequest,
  TrustedCatalogScope,
} from "./types";

const digest = CatalogReleaseDigest(`sha256:${"a".repeat(64)}`);
const pin = { id: CatalogReleaseId("crel_acme_2"), digest };
const fingerprint = CatalogMaterializationFingerprint(`sha256:${"b".repeat(64)}`);
const release = { id: pin.id, version: CatalogReleaseVersion("1.1.0"), digest };
const cursor = CatalogCursor("opaque-kernel-cursor");

const selectedRevision: DefinitionRevisionSnapshot = {
  id: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  revisionNumber: 1,
  contentDigest: `sha256:${"c".repeat(64)}` as DefinitionContentDigest,
  publishedIn: release,
  content: {
    lifecycle: "active" as const,
    displayName: "Input current limit",
    description: { kind: "absent" as const },
    documentation: { kind: "present" as const, value: "Maximum accepted input current." },
    valueShape: { kind: "json-schema" as const, schema: { type: "integer" } },
    constraints: { kind: "none" as const },
    unit: { kind: "absent" as const },
    schemaDefault: { kind: "absent" as const },
    examples: [100, 200],
    matching: {
      sourceProperty: "iin_max",
      selectorKind: "driver-compatible" as const,
      notes: { kind: "absent" as const },
    },
  },
};

const definition: ParameterDefinitionSnapshot = {
  id: ParameterDefinitionId("pdef_acme_power_iin_max"),
  subjectId: CatalogSubjectId("csub_acme_power"),
  propertyKey: PropertyKey("iin_max"),
  selectedRevision,
};

const subject: CatalogSubjectDetailSnapshot = {
  id: CatalogSubjectId("csub_acme_power"),
  kind: "driver" as const,
  canonicalKey: CatalogCanonicalKey("driver:acme,power"),
  membership: {
    release,
    lifecycle: "active" as const,
    selector: { kind: "driver-compatible" as const, values: [DriverCompatible("acme,power")] },
    tombstone: { kind: "absent" as const },
  },
  aliases: [
    {
      id: CatalogAliasId("cali_acme_power_v1"),
      selector: { kind: "driver-compatible" as const, value: DriverCompatible("acme,power-v1") },
      subjectId: CatalogSubjectId("csub_acme_power"),
      membership: {
        release,
        lifecycle: "active" as const,
        tombstone: { kind: "absent" as const },
      },
    },
  ],
  definitionCounts: { active: 2, deprecated: 0, retired: 0 },
};

const otherSubject = {
  ...subject,
  id: CatalogSubjectId("csub_zeta"),
  canonicalKey: CatalogCanonicalKey("driver:zeta,last"),
  aliases: [],
};

const facts: CatalogDocumentFacts = {
  pin,
  snapshotKind: "current",
  releaseSequence: 2,
  publishedAt: "2026-09-02T00:00:00Z",
  materializedAt: "2026-09-02T00:01:00Z",
  materializationFingerprint: fingerprint,
};

const scope: TrustedCatalogScope = {
  principalId: "user-org-admin",
  organizationId: "org-s8-read",
  actorKind: "org-admin",
  canReadCatalog: true,
  projectScope: { kind: "all" },
  canRegister: true,
  subjects: { kind: "all" },
  definitions: { kind: "all" },
};

const page = <T>(items: readonly T[], next: typeof cursor | null = cursor) => ({
  items,
  next: next ? { kind: "present" as const, value: next } : { kind: "absent" as const },
  release,
  pageInfo: { totalCount: items.length, hasMore: next !== null },
});

describe("definition owner lifecycle filtering", () => {
  function lifecycleHarness(subjectCount = 3, trustedScope = scope) {
    const subjects: CatalogSubjectDetailSnapshot[] = Array.from({ length: subjectCount }, (_, index) => ({
      ...subject,
      id: CatalogSubjectId(`csub_owner_${index}`),
      canonicalKey: CatalogCanonicalKey(`driver:owner,${String(index).padStart(4, "0")}`),
      membership: {
        ...subject.membership,
        lifecycle: index === 0 ? "retired" : "active",
      },
      aliases: [],
    }));
    const definitions = subjects.map((owner, index) => ({
      ...definition,
      id: ParameterDefinitionId(`pdef_owner_${index}`),
      subjectId: owner.id,
      propertyKey: PropertyKey("iin_max"),
      selectedRevision: {
        ...selectedRevision,
        id: DefinitionRevisionId(`drev_owner_${index}`),
        definitionId: ParameterDefinitionId(`pdef_owner_${index}`),
      },
    }));
    const snapshot = Object.assign(new CapturedCatalogSnapshot({
      release,
      sequence: CatalogReleaseSequence(2),
      publishedAt: CatalogEventTime(facts.publishedAt),
      materializedAt: CatalogEventTime(facts.materializedAt),
      compiledFingerprint: CatalogMaterializationFingerprint(fingerprint),
      databaseFingerprint: CatalogMaterializationFingerprint(fingerprint),
      subjects,
      definitions,
      revisions: definitions.map((entry) => entry.selectedRevision),
      facts: [],
    }), { snapshotKind: "current" as const, materializationFingerprint: fingerprint });
    const { ports } = createHarness({ scope: trustedScope });
    ports.runtime.loadCurrentCatalog = async () => ({ ok: true, value: snapshot });
    return { ports, subjects, definitions };
  }

  it("leaves the unfiltered default intact and filters/counts the complete set before pagination", async () => {
    const { ports } = lifecycleHarness(503);
    const all = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", { query: { limit: "1" } }));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ totalCount: 503, hasMore: true, items: [{ subject: { id: "csub_owner_0" } }] });
    const first = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", {
      query: { subjectLifecycle: "active", limit: "1" },
    }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ totalCount: 502, hasMore: true, items: [{ subject: { id: "csub_owner_1" } }] });
    const nextCursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", {
      query: { subjectLifecycle: "active", limit: "1", cursor: nextCursor },
    }));
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ totalCount: 502, items: [{ subject: { id: "csub_owner_2" } }] });
    const changedQueries: NonNullable<CatalogReadRequest["query"]>[] = [{ cursor: nextCursor }, { cursor: nextCursor, subjectLifecycle: "retired" }];
    for (const query of changedQueries) {
      const changed = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", { query }));
      expect(changed.status).toBe(400);
      expect(changed.body).toMatchObject({ error: { details: { field: "cursor" } } });
    }
  });

  it("passes not-retired to the registration selection before counting or paging", async () => {
    const { ports, definitions } = lifecycleHarness(4);
    const select = vi.fn(async () => ({ kind: "only" as const,
      ids: definitions.slice(2).map((item) => item.id), fingerprint: "without-org-retired" }));
    const result = await handleCatalogRead({ ...ports, registration: { ...ports.registration, selectDefinitionIds: select } }, get("/api/v2/catalog/definitions", {
      query: { registration: "not-retired", limit: "1" },
    }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ totalCount: 2, hasMore: true, items: [{ subject: { id: "csub_owner_2" } }] });
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ registration: "not-retired", catalogDefinitions: expect.arrayContaining(definitions.map((item) => ({ id: item.id, subjectId: item.subjectId }))) }));
  });

  it("distinguishes owner retirement from the definition lifecycle and keeps direct subject scope", async () => {
    const { ports } = lifecycleHarness();
    const retired = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", {
      query: { subjectLifecycle: "retired", lifecycle: "active" },
    }));
    expect(retired.status).toBe(200);
    expect(retired.body).toMatchObject({ totalCount: 1, items: [{ subject: { id: "csub_owner_0" } }] });
    const scoped = await handleCatalogRead(ports, get("/api/v2/catalog/subjects/csub_owner_0/definitions", {
      query: { subjectLifecycle: "active" },
    }));
    expect(scoped.status).toBe(200);
    expect(scoped.body).toMatchObject({ totalCount: 0, items: [] });
    const historical = await handleCatalogRead(ports, get("/api/v2/catalog/subjects/csub_owner_0/definitions"));
    expect(historical.status).toBe(200);
    expect(historical.body).toMatchObject({ totalCount: 1, items: [{ subject: { id: "csub_owner_0" } }] });
    const intersected = await handleCatalogRead(ports, get("/api/v2/catalog/subjects/csub_owner_1/definitions", {
      query: { subjectLifecycle: "active", subjectId: "csub_owner_2" },
    }));
    expect(intersected.status).toBe(200);
    expect(intersected.body).toMatchObject({ totalCount: 0, items: [] });
  });

  it("intersects module, explicit subjects, tenant subjects, definitions and registration selections", async () => {
    const { ports } = lifecycleHarness(5, {
      ...scope,
      subjects: { kind: "only", ids: [CatalogSubjectId("csub_owner_1"), CatalogSubjectId("csub_owner_2")], fingerprint: "subjects" },
      definitions: { kind: "only", ids: [ParameterDefinitionId("pdef_owner_1"), ParameterDefinitionId("pdef_owner_4")], fingerprint: "definitions" },
    });
    const selectModule = vi.fn(async () => ({
      subjectIds: [CatalogSubjectId("csub_owner_1"), CatalogSubjectId("csub_owner_3"), CatalogSubjectId("csub_owner_4")],
      moduleName: "Power",
    }));
    const filteredPorts = { ...ports, registration: {
      ...ports.registration,
      selectPlacementSubtreeSubjectIds: selectModule,
      selectDefinitionIds: async () => ({ kind: "only" as const, ids: [ParameterDefinitionId("pdef_owner_1"), ParameterDefinitionId("pdef_owner_2"), ParameterDefinitionId("pdef_owner_4")], fingerprint: "registrations" }),
    } };
    const query = { subjectLifecycle: "active", placementModuleId: "mod_power", registration: "active" };
    const result = await handleCatalogRead(filteredPorts, get("/api/v2/catalog/definitions", { query }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ totalCount: 1, items: [{ subject: { id: "csub_owner_1" } }], placementModuleName: "Power" });
    expect(selectModule).toHaveBeenCalledWith(expect.objectContaining({ organizationId: scope.organizationId, principalId: scope.principalId }));
    const extraQueries: NonNullable<CatalogReadRequest["query"]>[] = [{ subjectIds: ["csub_owner_2"] }, { subjectId: "csub_owner_2" }];
    for (const extra of extraQueries) {
      const empty = await handleCatalogRead(filteredPorts, get("/api/v2/catalog/definitions", { query: { ...query, ...extra } }));
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({ totalCount: 0, items: [] });
    }
  });

  it("rejects invalid owner lifecycle values at the HTTP boundary", async () => {
    const { ports } = lifecycleHarness();
    for (const subjectLifecycle of ["all", "deprecated", ""]) {
      const response = await handleCatalogRead(ports, get("/api/v2/catalog/definitions", { query: { subjectLifecycle } }));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { details: { field: "subjectLifecycle" } } });
    }
  });
});

function createHarness(options: {
  readonly snapshotCalls?: string[];
  readonly runtimeCalls?: string[];
  readonly listSubjectsItems?: Array<typeof subject>;
  readonly listDefinitionsItems?: Array<typeof definition>;
  readonly getRevisionStatus?: "found" | "revision-unavailable";
  readonly loadError?: boolean;
  readonly fingerprint?: string;
  readonly authenticate?: CatalogReadPorts["authenticate"];
  readonly scope?: TrustedCatalogScope;
} = {}) {
  const snapshotCalls = options.snapshotCalls ?? [];
  const runtimeCalls = options.runtimeCalls ?? [];
  const listItems = options.listSubjectsItems ?? [otherSubject, subject];
  const snapshot: CatalogSnapshot = {
    release,
    sequence: CatalogReleaseSequence(2),
    publishedAt: CatalogEventTime(facts.publishedAt),
    materializedAt: CatalogEventTime(facts.materializedAt),
    compiledFingerprint: fingerprint,
    databaseFingerprint: fingerprint,
    getSubject: (subjectId: ReturnType<typeof CatalogSubjectId>) => {
      snapshotCalls.push("getSubject");
      if (subjectId === subject.id) {
        return { status: "found" as const, subject };
      }
      if (subjectId === otherSubject.id) {
        return { status: "found" as const, subject: otherSubject };
      }
      return { status: "unknown" as const, target: "subject" as const };
    },
    listSubjects: (query: { lifecycles: readonly string[]; selection: { kind: string } }) => {
      snapshotCalls.push("listSubjects");
      expect(query.lifecycles).toEqual(["active"]);
      return { status: "found" as const, page: page(listItems) };
    },
    resolveSubject: () => {
      snapshotCalls.push("resolveSubject");
      return { status: "unknown" as const, reason: "no-candidate" as const };
    },
    getDefinition: () => {
      snapshotCalls.push("getDefinition");
      return { status: "found" as const, definition };
    },
    getDefinitionById: (definitionId: ReturnType<typeof ParameterDefinitionId>) => {
      snapshotCalls.push("getDefinitionById");
      if (definitionId !== definition.id) {
        return { status: "unknown" as const, target: "definition" as const };
      }
      return { status: "found" as const, definition };
    },
    listDefinitions: () => {
      snapshotCalls.push("listDefinitions");
      return { status: "found" as const, scope: { kind: "all" as const }, page: page(options.listDefinitionsItems ?? [definition]) };
    },
    getDefinitionRevision: () => {
      snapshotCalls.push("getDefinitionRevision");
      if (options.getRevisionStatus === "revision-unavailable") {
        return {
          status: "revision-unavailable" as const,
          definitionId: definition.id,
          revisionId: DefinitionRevisionId("drev_missing"),
          reason: "not-in-snapshot" as const,
        };
      }
      return { status: "found" as const, revision: selectedRevision };
    },
    listDefinitionRevisions: () => {
      snapshotCalls.push("listDefinitionRevisions");
      return { status: "found" as const, definition, page: page([selectedRevision], null) };
    },
    listDefinitionTimelineFacts: () => {
      snapshotCalls.push("listDefinitionTimelineFacts");
      return {
        status: "found" as const,
        definition,
        page: page([
          {
            id: CatalogTimelineFactId("fact-1"),
            definitionId: definition.id,
            revisionId: selectedRevision.id,
            revisionNumber: 1,
            release,
            releaseSequence: CatalogReleaseSequence(2),
            publishedAt: CatalogEventTime("2026-09-02T00:00:00Z"),
            previousRevisionId: { kind: "absent" as const },
            changes: ["introduced" as const],
          },
        ], null),
      };
    },
  };
  const current: CurrentCatalogSnapshot = { ...snapshot,
    snapshotKind: "current" as const,
    materializationFingerprint: CatalogMaterializationFingerprint(options.fingerprint ?? fingerprint),
  };

  const ports: CatalogReadPorts = {
    runtime: {
      async loadCurrentCatalog(expected) {
        runtimeCalls.push("loadCurrentCatalog");
        if (options.loadError || expected.id !== pin.id || expected.digest !== pin.digest) {
          return {
            ok: false,
            error: { kind: "release-mismatch", expected, actual: release },
          };
        }
        return { ok: true, value: current };
      },
      async loadPinnedCatalog(expected) {
        runtimeCalls.push("loadPinnedCatalog");
        if (expected.id !== pin.id) {
          return {
            ok: false,
            error: { kind: "historical-release-unavailable", pin: expected },
          };
        }
        return {
          ok: true,
          value: Object.assign(snapshot, { snapshotKind: "pinned" as const, pin: expected }),
        };
      },
    },
    readiness: {
      async current() {
        return { status: "ready" as const, document: facts };
      },
      async named(catalogReleaseId) {
        if (catalogReleaseId !== pin.id) {
          return { status: "unknown" as const };
        }
        return { status: "ready" as const, document: facts };
      },
    },
    registration: unregisteredProjection,
    usage: zeroUsageProjection,
    timeline: kernelOnlyTimelineComposer,
    authenticate: options.authenticate
      ?? (async () => ({ ok: true as const, scope: options.scope ?? scope })),
  };

  return { ports, snapshotCalls, runtimeCalls, current };
}

function get(path: string, init: Partial<CatalogReadRequest> = {}): CatalogReadRequest {
  return {
    method: "GET",
    path,
    params: {},
    query: {},
    headers: {},
    requestId: "req-s8-read",
    ...init,
  };
}

const unavailableResponse = {
  status: 503,
  body: { error: { code: "SERVICE_UNAVAILABLE", message: "Catalog is not ready.", details: { reason: "catalog-not-ready", retryable: true }, requestId: "req-s8-read" } },
  headers: { "X-Request-Id": "req-s8-read", "Retry-After": "5" },
};

describe("R2-ASYNC dispatcher rejection contract", () => {
  const definitionPaths = [
    "/api/v2/catalog/definitions",
    `/api/v2/catalog/subjects/${subject.id}/definitions`,
    `/api/v2/catalog/definitions/${definition.id}`,
  ];
  for (const outcome of ["query-unavailable", "missing-result"] as const) {
    it.each(definitionPaths)(`actual usage adapter ${outcome} maps the complete 503 response for %s`, async (path) => {
      const { ports } = createHarness();
      const queries = createUsageQueries({ query: vi.fn(async () => { throw new Error("unexpected SQL"); }) });
      vi.spyOn(queries, "summarize").mockResolvedValue(outcome === "query-unavailable"
        ? { ok: false, error: { kind: "query-unavailable", operation: "summarizeUsage" } }
        : { ok: true, value: { semantics: USAGE_CURRENT_PROJECTION_SEMANTICS, summaries: [] } });
      const response = await handleCatalogRead({ ...ports, usage: createUsageProjectionFromQueries(queries) }, get(path));
      expect(response).toEqual(unavailableResponse);
    });
    it.each([...definitionPaths, "/api/v2/catalog/subjects", `/api/v2/catalog/subjects/${subject.id}`])(`actual registration adapter ${outcome} maps the complete 503 response for %s`, async (path) => {
      const { ports } = createHarness();
      const queries = createGovernanceCatalogQueries({ query: vi.fn(async () => { throw new Error("unexpected SQL"); }) });
      vi.spyOn(queries, "projectRegistrations").mockResolvedValue(outcome === "query-unavailable"
        ? { ok: false, error: { kind: "query-unavailable", operation: "projectRegistrations" } }
        : { ok: true, value: { semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS, projections: [] } });
      const response = await handleCatalogRead({ ...ports, registration: { ...ports.registration, ...createRegistrationProjectionFromQueries(queries), selectSubjectIds: ports.registration.selectSubjectIds, selectDefinitionIds: ports.registration.selectDefinitionIds } }, get(path));
      expect(response).toEqual(unavailableResponse);
    });
  }
  it.each([new Error("unexpected adapter defect"), new TypeError("unexpected adapter type defect")])("does not disguise unknown rejection %s as Catalog readiness", async (error) => {
    const { ports } = createHarness();
    await expect(handleCatalogRead({ ...ports, usage: { ...ports.usage, summarizeMany: async () => { throw error; } } }, get("/api/v2/catalog/definitions"))).rejects.toBe(error);
  });
  it.each([new Error("private defect details"), new TypeError("private type details")])("registered HTTP routes retain generic 500 for %s", async (error) => {
    const { ports } = createHarness();
    const router = createRouter();
    registerCatalogReadRoutes(router, { ...ports, usage: { ...ports.usage, summarizeMany: async () => { throw error; } } });
    const server = createHttpServer(router);
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/catalog/definitions`, { headers: { "x-request-id": "r2-unexpected" } });
      expect(response.status).toBe(500);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(response.headers.get("x-request-id")).toBe("r2-unexpected");
      expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: {}, requestId: "r2-unexpected" } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe("S8-READ nine canonical catalog read routes", () => {
  it("returns an unpublished document without a release pin or runtime snapshot", async () => {
    const { ports, runtimeCalls } = createHarness();
    ports.readiness.current = async () => ({ status: "unpublished" });
    const response = await handleCatalogRead(ports, get("/api/v2/catalog"));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ item: null, publicationState: "unpublished" });
    expect(catalogDocumentResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers[CATALOG_RELEASE_HEADER]).toBeUndefined();
    expect(runtimeCalls).toEqual([]);
    const detail = await handleCatalogRead(ports, get("/api/v2/catalog/subjects/csub_unknown"));
    expect(detail.status).toBe(404);
  });
  it("R2-SCOPE forwards the same trusted project selection for list and detail", async () => {
    const projectScope = { kind: "only" as const, ids: ["project-visible"] };
    const { ports } = createHarness({ scope: { ...scope, projectScope } });
    const summarizeMany = vi.fn(ports.usage.summarizeMany);
    const summarize = vi.fn(ports.usage.summarize);
    const scoped = { ...ports, usage: { ...ports.usage, summarizeMany, summarize } };
    expect((await handleCatalogRead(scoped, get("/api/v2/catalog/definitions"))).status).toBe(200);
    expect((await handleCatalogRead(scoped, get(`/api/v2/catalog/definitions/${definition.id}`))).status).toBe(200);
    expect(summarizeMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectScope }));
    expect(summarize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectScope }));
  });
  it("R2-BATCH deduplicates each projection kind after the Kernel page", async () => {
    const other = { ...definition, id: ParameterDefinitionId("pdef_second") };
    const { ports } = createHarness({ listDefinitionsItems: [definition, other, definition] });
    const project = vi.fn(ports.registration.projectSubjects);
    const summarize = vi.fn(ports.usage.summarizeMany);
    const response = await handleCatalogRead({ ...ports,
      registration: { ...ports.registration, projectSubjects: project, projectDefinition: vi.fn(() => { throw new Error("single-row projection forbidden"); }) },
      usage: { ...ports.usage, summarizeMany: summarize, summarize: vi.fn(() => { throw new Error("single-row usage forbidden"); }) },
    }, get("/api/v2/catalog/definitions"));
    expect(response.status).toBe(200);
    expect(project).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subjectIds: [definition.subjectId], organizationId: scope.organizationId }));
    expect(summarize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ definitionIds: [definition.id, other.id], organizationId: scope.organizationId }));
  });

  it.each(["registration", "usage"] as const)("R2-BATCH missing %s result rejects the entire page", async (missing) => {
    const { ports } = createHarness();
    const response = await handleCatalogRead({ ...ports,
      registration: { ...ports.registration, projectSubjects: missing === "registration" ? async () => new Map() : ports.registration.projectSubjects },
      usage: { ...ports.usage, summarizeMany: missing === "usage" ? async () => new Map() : ports.usage.summarizeMany },
    }, get("/api/v2/catalog/definitions"));
    expect(response).toEqual(unavailableResponse);
  });

  it("R2-BATCH an empty Definition page does not invoke either projection", async () => {
    const { ports } = createHarness({ listDefinitionsItems: [] });
    const project = vi.fn(ports.registration.projectSubjects);
    const summarize = vi.fn(ports.usage.summarizeMany);
    const response = await handleCatalogRead({ ...ports,
      registration: { ...ports.registration, projectSubjects: project },
      usage: { ...ports.usage, summarizeMany: summarize },
    }, get("/api/v2/catalog/definitions"));
    expect(response.status).toBe(200);
    expect(project).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });
  it("matches the frozen S8-CON paths onto Kernel operations", () => {
    expect(matchCatalogReadRoute("/api/v2/catalog")?.id).toBe("catalog.get");
    expect(matchCatalogReadRoute("/api/v2/catalog/subjects")?.id).toBe("catalog.listSubjects");
    expect(matchCatalogReadRoute("/api/v2/catalog/subjects/csub_acme_power")?.id).toBe("catalog.getSubject");
    expect(matchCatalogReadRoute("/api/v2/catalog/subjects/csub_acme_power/definitions")?.id).toBe(
      "catalog.listSubjectDefinitions",
    );
    expect(matchCatalogReadRoute("/api/v2/catalog/definitions")?.id).toBe("catalog.listDefinitions");
    expect(matchCatalogReadRoute("/api/v2/catalog/definitions/pdef_acme_power_iin_max")?.id).toBe(
      "catalog.getDefinition",
    );
    expect(
      matchCatalogReadRoute("/api/v2/catalog/definitions/pdef_acme_power_iin_max/revisions")?.id,
    ).toBe("catalog.listDefinitionRevisions");
    expect(
      matchCatalogReadRoute("/api/v2/catalog/definitions/pdef_acme_power_iin_max/revisions/drev_1")?.id,
    ).toBe("catalog.getDefinitionRevision");
    expect(
      matchCatalogReadRoute("/api/v2/catalog/definitions/pdef_acme_power_iin_max/timeline")?.id,
    ).toBe("catalog.listDefinitionTimeline");
    expect(parameterCatalogKernelReadByRouteId["catalog.get"]).toBe("loadCurrentCatalog");
  });

  it("returns the verify-backed catalog document with the release header", async () => {
    const { ports, runtimeCalls, snapshotCalls } = createHarness();
    const response = await handleCatalogRead(ports, get("/api/v2/catalog"));
    expect(runtimeCalls).toEqual(["loadCurrentCatalog"]);
    expect(snapshotCalls).toEqual([]);
    expect(response.status).toBe(200);
    expect(response.headers[CATALOG_RELEASE_HEADER]).toBe(pin.id);
    const body = catalogDocumentResponseSchema.parse(response.body);
    expect(body.item).not.toBeNull();
    if (!body.item) throw new Error("ready document missing");
    expect(body.item.status).toBe("ready");
    expect(body.item.digest).toBe(digest);
    expect(body.item.materializationFingerprint).toBe(fingerprint);
    expect(body.item.links).toEqual({
      subjects: "/api/v2/catalog/subjects",
      definitions: "/api/v2/catalog/definitions",
    });
  });

  it("returns 503 catalog-not-ready when the current pin disagrees", async () => {
    const { ports } = createHarness({ loadError: true });
    const response = await handleCatalogRead(ports, get("/api/v2/catalog"));
    expect(response.status).toBe(503);
    expect((response.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "catalog-not-ready",
    );
    expect(response.headers["Retry-After"]).toBe("5");
  });

  it("passes Kernel subject pages through without reordering and projects unregistered", async () => {
    const { ports, snapshotCalls } = createHarness();
    const response = await handleCatalogRead(ports, get("/api/v2/catalog/subjects"));
    expect(snapshotCalls).toEqual(["listSubjects"]);
    expect(response.status).toBe(200);
    const body = catalogSubjectListResponseSchema.parse(response.body);
    expect(body.items.map((item) => item.id)).toEqual(["csub_zeta", "csub_acme_power"]);
    expect(body.nextCursor).toBe(cursor);
    expect(body.items[1]?.registration).toEqual({ status: "unregistered" });
    expect(body.items[1]?.availableActions).toEqual(["register"]);
    expect(body.items[1]?.aliases).toEqual(["acme,power-v1"]);
  });

  it("hides out-of-scope subject IDs before calling Kernel", async () => {
    const { ports, snapshotCalls } = createHarness({
      scope: {
        ...scope,
        subjects: { kind: "only", ids: [CatalogSubjectId("csub_visible")], fingerprint: "sha256:scope" },
      },
    });
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/subjects/csub_acme_power"),
    );
    expect(snapshotCalls).toEqual([]);
    expect(response.status).toBe(404);
    expect((response.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "subject-not-published",
    );
  });

  it("strips spoofed org/role headers before authentication", async () => {
    const seen: string[] = [];
    const { ports } = createHarness({
      authenticate: async (request) => {
        seen.push(
          String(request.headers["x-wiseeff-organization"] ?? request.headers["X-WiseEff-Organization"] ?? ""),
        );
        seen.push(String(request.headers["X-WiseEff-Role"] ?? ""));
        return { ok: true as const, scope };
      },
    });
    await handleCatalogRead(
      ports,
      get("/api/v2/catalog", {
        headers: {
          "X-WiseEff-Organization": "org-attacker",
          "X-WiseEff-Role": "platform-admin",
          "X-WiseEff-Actor-Kind": "agent",
          "X-WiseEff-Agent": "true",
        },
      }),
    );
    expect(seen).toEqual(["", ""]);
  });

  it("does not substitute the selected revision when a pinned revision is unavailable", async () => {
    const { ports, snapshotCalls } = createHarness({ getRevisionStatus: "revision-unavailable" });
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/definitions/pdef_acme_power_iin_max/revisions/drev_missing"),
    );
    expect(snapshotCalls).toEqual(["getDefinitionRevision"]);
    expect(snapshotCalls).not.toContain("getDefinitionById");
    expect(response.status).toBe(404);
    expect((response.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "definition-not-found",
    );
  });

  it("maps an exact revision without using the selected head", async () => {
    const { ports, snapshotCalls } = createHarness();
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/definitions/pdef_acme_power_iin_max/revisions/drev_acme_power_iin_max_1"),
    );
    expect(snapshotCalls).toEqual(["getDefinitionRevision"]);
    const body = catalogDefinitionRevisionResponseSchema.parse(response.body);
    expect(body.item.id).toBe("drev_acme_power_iin_max_1");
    expect(body.item.publishedInCatalogReleaseId).toBe(pin.id);
    expect(body.item.examples).toEqual([100, 200]);
  });

  it("loads a definition through getDefinitionById and registration/usage seams", async () => {
    const { ports, snapshotCalls } = createHarness();
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/definitions/pdef_acme_power_iin_max"),
    );
    expect(snapshotCalls[0]).toBe("getDefinitionById");
    expect(snapshotCalls).toContain("getSubject");
    expect(snapshotCalls).not.toContain("getDefinitionRevision");
    const body = catalogDefinitionResponseSchema.parse(response.body);
    expect(body.item.currentRevision.id).toBe("drev_acme_power_iin_max_1");
    expect(body.item.registration).toEqual({ status: "unregistered" });
    expect(body.item.usageSummary).toEqual({ policyCount: null, projectCount: 0, currentValueCount: 0 });
  });

  it("rejects legacy spec identity instead of using it as a fallback", async () => {
    const { ports, runtimeCalls } = createHarness();
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/definitions", { query: { parameterSpecId: "spec-1" } }),
    );
    expect(runtimeCalls).toEqual([]);
    expect(response.status).toBe(400);
  });

  it("returns release-drift when a non-document read observes a stale header", async () => {
    const { ports } = createHarness();
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/subjects", {
        headers: { [CATALOG_RELEASE_HEADER]: "crel_stale" },
      }),
    );
    expect(response.status).toBe(409);
    expect((response.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "release-drift",
    );
  });

  it("maps Kernel publication facts on the timeline without raw migration rows", async () => {
    const { ports, snapshotCalls } = createHarness();
    const response = await handleCatalogRead(
      ports,
      get("/api/v2/catalog/definitions/pdef_acme_power_iin_max/timeline"),
    );
    expect(snapshotCalls).toEqual(["listDefinitionTimelineFacts"]);
    expect(response.status).toBe(200);
    const body = response.body as { items: Array<{ kind: string; changes?: string[] }> };
    expect(body.items).toEqual([
      expect.objectContaining({
        kind: "catalog-publication",
        definitionId: definition.id,
        changes: ["introduced"],
      }),
    ]);
  });

  it("returns 401 before loading a snapshot", async () => {
    const { ports, runtimeCalls } = createHarness({
      authenticate: async () => ({ ok: false, status: 401 }),
    });
    const response = await handleCatalogRead(ports, get("/api/v2/catalog"));
    expect(runtimeCalls).toEqual([]);
    expect(response.status).toBe(401);
  });
});
