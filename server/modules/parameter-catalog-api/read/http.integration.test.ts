import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCatalogKernel } from "../../catalog-kernel/interface";
import { firstAcmePredecessor } from "../../catalog-publication/builder/predecessorHarness";
import { ParameterDefinitionId } from "../../parameter-catalog-contract/index";
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
  projectScope: { kind: "all" },
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
      loadRevisionExportSnapshot: async (pin) => pin.id === pins.previous.id ? firstAcmePredecessor().first : null,
    };
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.close();
  });

  it("exports only visible active definitions for the pinned release", async () => {
    const active = "pdef_acme_power_iin_max";
    const hidden = "pdef_acme_power_iin_min";
    const request = (readPorts: CatalogReadPorts) => requestJson<{ item: { document: string; skipped: { id: string; reason: string }[] } }>(
      createCatalogReadHttpServer(readPorts),
      `/api/v2/catalog/revision-document?catalogReleaseId=${previousReleaseId}&definitionId=${active}&definitionId=${hidden}&definitionId=unknown`,
    );
    const limited: CatalogReadPorts = { ...ports, authenticate: async () => ({ ok: true, scope: { ...scope,
      definitions: { kind: "only", ids: [ParameterDefinitionId(active)], fingerprint: "limited" } } }) };
    const exported = await request(limited);
    expect(exported.status).toBe(200);
    expect(exported.body.item.document).toContain("## `iin_max`");
    expect(exported.body.item.document).not.toContain("## `iin_min`");
    expect(exported.body.item.skipped).toEqual([{ id: hidden, reason: "not-visible" }, { id: "unknown", reason: "not-visible" }]);
    const forbidden = await request({ ...ports, authenticate: async () => ({ ok: true, scope: { ...scope, canReadCatalog: false } }) });
    expect(forbidden.status).toBe(403);
    const agent = await request({ ...limited, authenticate: async () => ({ ok: true, scope: { ...scope, actorKind: "agent",
      definitions: { kind: "only", ids: [ParameterDefinitionId(active)], fingerprint: "limited" } } }) });
    expect(agent.status).toBe(200);
    expect(agent.body.item).toEqual(exported.body.item);
    const tooMany = await requestJson(createCatalogReadHttpServer(ports),
      `/api/v2/catalog/revision-document?catalogReleaseId=${previousReleaseId}&${Array.from({ length: 129 }, () => `definitionId=${active}`).join("&")}`);
    expect(tooMany.status).toBe(400);
    const drift = await requestJson(createCatalogReadHttpServer(ports),
      `/api/v2/catalog/revision-document?catalogReleaseId=${previousReleaseId}&definitionId=${active}`,
      { headers: { [CATALOG_RELEASE_HEADER]: releaseId } });
    expect(drift.status).toBe(409);
  });

  it("skips individually when documentation or another field cannot round trip", async () => {
    const source = firstAcmePredecessor().first;
    const definition = source.documents.find((item) => item.kind === "definition");
    if (!definition || definition.kind !== "definition") throw new Error("fixture missing");
    for (const [revision, reason] of [
      [{ documentation: "第一段\n\n## 文档标题" }, "documentation-not-expressible"],
      [{ description: "第一行\n第二行" }, "not-round-trippable"],
    ] as const) {
      const changed = { ...source, documents: source.documents.map((item) => item === definition
        ? { ...definition, content: { ...definition.content, revision: { ...definition.content.revision, ...revision } } } : item) };
      const readPorts = { ...ports, loadRevisionExportSnapshot: async () => changed };
      const response = await requestJson<{ item: { document: string; skipped: { id: string; reason: string }[] } }>(
        createCatalogReadHttpServer(readPorts),
        `/api/v2/catalog/revision-document?catalogReleaseId=${previousReleaseId}&definitionId=${definition.content.id}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.item.document).not.toContain("## `iin_max`");
      expect(response.body.item.skipped).toEqual([{ id: definition.content.id, reason }]);
    }
  });

  it("exports valid entries alongside an unrepresentable definition", async () => {
    const source = firstAcmePredecessor().first;
    const original = source.documents.find((item) => item.kind === "definition");
    if (!original || original.kind !== "definition") throw new Error("fixture missing");
    const invalid = { ...original, content: { ...original.content, revision: { ...original.content.revision, documentation: "## 标题" } } };
    const valid = { ...original, content: { ...original.content, id: "pdef_acme_power_iin_min", propertyKey: "iin_min" } };
    const changed = { ...source, manifest: { ...source.manifest, release: { ...source.manifest.release, id: releaseId } },
      documents: [...source.documents.filter((item) => item !== original), invalid, valid] };
    const readPorts = { ...ports, loadRevisionExportSnapshot: async () => changed };
    const response = await requestJson<{ item: { document: string; skipped: { id: string; reason: string }[] } }>(
      createCatalogReadHttpServer(readPorts),
      `/api/v2/catalog/revision-document?catalogReleaseId=${releaseId}&definitionId=${invalid.content.id}&definitionId=${valid.content.id}&definitionId=unknown`,
    );
    expect(response.status).toBe(200);
    expect(response.body.item.document).toContain("## `iin_min`");
    expect(response.body.item.document).not.toContain("## `iin_max`");
    expect(response.body.item.skipped).toEqual([{ id: invalid.content.id, reason: "documentation-not-expressible" },
      { id: "unknown", reason: "unknown" }]);
  });

  it("closes all nine GET routes through Kernel over HTTP with the release header", async () => {
    const server = createCatalogReadHttpServer(ports);

    const catalog = await requestJson(server, "/api/v2/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get(CATALOG_RELEASE_HEADER)).toBe(releaseId);
    const document = catalogDocumentResponseSchema.parse(catalog.body);
    if (!document.item) throw new Error("expected published catalog");
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
