import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCatalogKernel } from "../../catalog-kernel/interface";
import { seedCompiledCatalogProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import {
  CATALOG_RELEASE_HEADER,
  catalogDefinitionListResponseSchema,
  catalogDefinitionResponseSchema,
  catalogDefinitionRevisionListResponseSchema,
  catalogDefinitionRevisionResponseSchema,
  catalogDefinitionTimelineResponseSchema,
  catalogDocumentResponseSchema,
  catalogSubjectListResponseSchema,
  catalogSubjectResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { requestJson } from "../../../test/testClient";
import { createCatalogReadHttpServer } from "./http";
import { kernelOnlyTimelineComposer, unregisteredProjection, zeroUsageProjection } from "./ports";
import type { CatalogReadPorts, TrustedCatalogScope } from "./types";

const scope: TrustedCatalogScope = {
  principalId: "user-org-admin",
  organizationId: "org-s8-read",
  actorKind: "org-admin",
  canReadCatalog: true,
  canRegister: true,
  subjects: { kind: "all" },
  definitions: { kind: "all" },
};

describe("S8-READ HTTP against a real catalog snapshot", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let ports: CatalogReadPorts;
  let releaseId: string;
  let previousReleaseId: string;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s8read");
    const pins = await seedCompiledCatalogProjection(database.url);
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const runtime = createCatalogKernel(pool);
    const loaded = await runtime.loadCurrentCatalog(pins.current);
    if (!loaded.ok) {
      throw new Error("seeded current catalog must load");
    }
    releaseId = loaded.value.release.id;
    previousReleaseId = pins.previous.id;
    const document = {
      pin: pins.current,
      snapshotKind: "current" as const,
      releaseSequence: 2,
      publishedAt: "2026-09-02T00:00:00Z",
      materializedAt: "2026-09-02T00:01:00Z",
      materializationFingerprint: loaded.value.materializationFingerprint,
    };
    ports = {
      runtime,
      readiness: {
        async current() {
          return { status: "ready", document };
        },
        async named(catalogReleaseId) {
          if (catalogReleaseId === pins.current.id) {
            return { status: "ready", document };
          }
          if (catalogReleaseId === pins.previous.id) {
            return {
              status: "ready",
              document: {
                ...document,
                pin: pins.previous,
                snapshotKind: "pinned",
                releaseSequence: 1,
                publishedAt: "2026-09-01T00:00:00Z",
              },
            };
          }
          return { status: "unknown" };
        },
      },
      registration: unregisteredProjection,
      usage: zeroUsageProjection,
      timeline: kernelOnlyTimelineComposer,
      authenticate: async () => ({ ok: true, scope }),
    };
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("closes all nine GET routes through Kernel over HTTP with the release header", async () => {
    const server = createCatalogReadHttpServer(ports);

    const catalog = await requestJson(server, "/api/v2/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get(CATALOG_RELEASE_HEADER)).toBe(releaseId);
    const document = catalogDocumentResponseSchema.parse(catalog.body);
    expect(document.item.status).toBe("ready");
    expect(document.item.catalogReleaseId).toBe(releaseId);
    expect(document.item.digest).toMatch(/^sha256:/);
    expect(document.item.materializationFingerprint).toMatch(/^sha256:/);

    const subjects = await requestJson(server, "/api/v2/catalog/subjects");
    expect(subjects.status).toBe(200);
    expect(subjects.headers.get(CATALOG_RELEASE_HEADER)).toBe(releaseId);
    const subjectList = catalogSubjectListResponseSchema.parse(subjects.body);
    expect(subjectList.items.some((item) => item.id === "csub_acme_power")).toBe(true);
    expect(subjectList.items[0]?.registration.status).toBe("unregistered");

    const subject = await requestJson(server, "/api/v2/catalog/subjects/csub_acme_power");
    expect(subject.status).toBe(200);
    const subjectBody = catalogSubjectResponseSchema.parse(subject.body);
    expect(subjectBody.item.canonicalName).toContain("acme");
    expect(subjectBody.item.definitionCounts.active).toBeGreaterThan(0);

    const subjectDefinitions = await requestJson(
      server,
      `/api/v2/catalog/subjects/csub_acme_power/definitions?catalogReleaseId=${previousReleaseId}`,
    );
    expect(subjectDefinitions.status, JSON.stringify(subjectDefinitions.body)).toBe(200);
    const subjectDefinitionList = catalogDefinitionListResponseSchema.parse(subjectDefinitions.body);
    expect(subjectDefinitionList.items.length).toBeGreaterThan(0);

    const definitions = await requestJson(
      server,
      `/api/v2/catalog/definitions?catalogReleaseId=${previousReleaseId}`,
    );
    expect(definitions.status).toBe(200);
    const definitionList = catalogDefinitionListResponseSchema.parse(definitions.body);
    const firstDefinition = definitionList.items[0];
    expect(firstDefinition).toBeDefined();

    const currentDefinition = await requestJson(
      server,
      "/api/v2/catalog/definitions/pdef_acme_power_iin_min",
    );
    expect(currentDefinition.status).toBe(200);
    catalogDefinitionResponseSchema.parse(currentDefinition.body);

    const definition = await requestJson(
      server,
      `/api/v2/catalog/definitions/${firstDefinition!.id}?catalogReleaseId=${previousReleaseId}`,
    );
    expect(definition.status).toBe(200);
    const definitionBody = catalogDefinitionResponseSchema.parse(definition.body);
    expect(definitionBody.item.currentRevision.id).toBeTruthy();

    const revisions = await requestJson(
      server,
      `/api/v2/catalog/definitions/${firstDefinition!.id}/revisions?catalogReleaseId=${previousReleaseId}`,
    );
    expect(revisions.status).toBe(200);
    const revisionList = catalogDefinitionRevisionListResponseSchema.parse(revisions.body);
    expect(revisionList.items[0]?.id).toBe(definitionBody.item.currentRevision.id);

    const revision = await requestJson(
      server,
      `/api/v2/catalog/definitions/${firstDefinition!.id}/revisions/${definitionBody.item.currentRevision.id}?catalogReleaseId=${previousReleaseId}`,
    );
    expect(revision.status).toBe(200);
    const revisionBody = catalogDefinitionRevisionResponseSchema.parse(revision.body);
    expect(revisionBody.item.id).toBe(definitionBody.item.currentRevision.id);

    const missingRevision = await requestJson(
      server,
      `/api/v2/catalog/definitions/${firstDefinition!.id}/revisions/drev_does_not_exist?catalogReleaseId=${previousReleaseId}`,
    );
    expect(missingRevision.status).toBe(404);
    expect(
      (missingRevision.body as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe("definition-not-found");

    const currentRevisions = await requestJson(
      server,
      "/api/v2/catalog/definitions/pdef_acme_power_iin_min/revisions",
    );
    expect(currentRevisions.status).toBe(200);
    catalogDefinitionRevisionListResponseSchema.parse(currentRevisions.body);

    const timeline = await requestJson(
      server,
      `/api/v2/catalog/definitions/${firstDefinition!.id}/timeline?catalogReleaseId=${previousReleaseId}`,
    );
    expect(timeline.status).toBe(200);
    const timelineBody = catalogDefinitionTimelineResponseSchema.parse(timeline.body);
    expect(timelineBody.items.every((item) => item.kind === "catalog-publication")).toBe(true);

    const unknown = await requestJson(server, "/api/v2/catalog/subjects/csub_missing");
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "subject-not-published",
    );

    const stale = await requestJson(server, "/api/v2/catalog/subjects", {
      headers: { [CATALOG_RELEASE_HEADER]: "crel_stale" },
    });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { details: { reason: string } } }).error.details.reason).toBe(
      "release-drift",
    );
  });
});
