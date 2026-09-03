import { describe, expect, it } from "vitest";

import type { CurrentCatalogSnapshot } from "../../catalog-kernel/interface";
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
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";
import { handleCatalogRead, matchCatalogReadRoute } from "./handlers";
import { kernelOnlyTimelineComposer, unregisteredProjection, zeroUsageProjection } from "./ports";
import type {
  CatalogDocumentFacts,
  CatalogReadPorts,
  CatalogReadRequest,
  TrustedCatalogScope,
} from "./types";

const digest = CatalogReleaseDigest(`sha256:${"a".repeat(64)}`);
const pin = { id: CatalogReleaseId("crel_acme_2"), digest };
const fingerprint = `sha256:${"b".repeat(64)}`;
const release = { id: pin.id, version: "1.1.0", digest };
const cursor = CatalogCursor("opaque-kernel-cursor");

const selectedRevision = {
  id: DefinitionRevisionId("drev_acme_power_iin_max_1"),
  definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"),
  revisionNumber: 1,
  contentDigest: `sha256:${"c".repeat(64)}`,
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
    examples: [],
    matching: {
      sourceProperty: "iin_max",
      selectorKind: "driver-compatible" as const,
      notes: { kind: "absent" as const },
    },
  },
};

const definition = {
  id: ParameterDefinitionId("pdef_acme_power_iin_max"),
  subjectId: CatalogSubjectId("csub_acme_power"),
  propertyKey: "iin_max",
  selectedRevision,
};

const subject = {
  id: CatalogSubjectId("csub_acme_power"),
  kind: "driver" as const,
  canonicalKey: "driver:acme,power",
  membership: {
    release,
    lifecycle: "active" as const,
    selector: { kind: "driver-compatible" as const, values: ["acme,power"] },
    tombstone: { kind: "absent" as const },
  },
  aliases: [
    {
      id: "cali_acme_power_v1",
      selector: { kind: "driver-compatible" as const, value: "acme,power-v1" },
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
  canonicalKey: "driver:zeta,last",
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
  canRegister: true,
  subjects: { kind: "all" },
  definitions: { kind: "all" },
};

const page = <T>(items: readonly T[], next: typeof cursor | null = cursor) => ({
  items,
  next: next ? { kind: "present" as const, value: next } : { kind: "absent" as const },
  release,
});

function createHarness(options: {
  readonly snapshotCalls?: string[];
  readonly runtimeCalls?: string[];
  readonly listSubjectsItems?: Array<typeof subject>;
  readonly getRevisionStatus?: "found" | "revision-unavailable";
  readonly loadError?: boolean;
  readonly fingerprint?: string;
  readonly authenticate?: CatalogReadPorts["authenticate"];
  readonly scope?: TrustedCatalogScope;
} = {}) {
  const snapshotCalls = options.snapshotCalls ?? [];
  const runtimeCalls = options.runtimeCalls ?? [];
  const listItems = options.listSubjectsItems ?? [otherSubject, subject];
  const snapshot = {
    release,
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
      return { status: "found" as const, scope: { kind: "all" as const }, page: page([definition]) };
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
            id: "fact-1",
            definitionId: definition.id,
            revisionId: selectedRevision.id,
            revisionNumber: 1,
            release,
            releaseSequence: 2,
            publishedAt: "2026-09-02T00:00:00Z",
            previousRevisionId: { kind: "absent" as const },
            changes: ["introduced" as const],
          },
        ], null),
      };
    },
  };
  const current = Object.assign(snapshot, {
    snapshotKind: "current" as const,
    materializationFingerprint: options.fingerprint ?? fingerprint,
  }) as CurrentCatalogSnapshot;

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

describe("S8-READ nine canonical catalog read routes", () => {
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
    expect(body.item.usageSummary).toEqual({ policyCount: 0, projectCount: 0, currentValueCount: 0 });
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
