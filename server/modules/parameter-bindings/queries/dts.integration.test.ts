import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import {
  refreshAuthoritativeSource,
  validCatalogReleaseBundle,
} from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle, CatalogReleaseDefinitionDocument } from "../catalog-kernel/compiler/types";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogSnapshot,
} from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import {
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  type CatalogReleasePin,
} from "../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import {
  dropLabRuntimeLogins,
  provisionPublicationRuntimeLogins,
  type ProvisionedRuntimeLogins,
} from "../catalog-publication/runtime/provisionRuntimeLogins";
import { casEffectiveRevision } from "../parameter-bindings/binding/repositories";
import { appendSourceCommittedValue, createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { getBindingCompare, getBindingHistory } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("Issue #899 canonical topology query requires real PostgreSQL; skipping is forbidden");
}

const ORG = "org-899-topology";
const FOREIGN_ORG = "org-899-topology-foreign";
const PROJECT_A = "project-899-topology-a";
const PROJECT_B = "project-899-topology-b";
const FOREIGN_PROJECT = "project-899-topology-foreign";
const ATTR = "attr-899-topology";
const MODULE = "pmod-899-topology";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const REVISION_2 = DefinitionRevisionId("drev_acme_power_iin_max_2");

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const successorWithNewRevisionBundle = (): CatalogReleaseBundle => {
  const bundle = structuredClone(validCatalogReleaseBundle());
  const release = bundle.releases.find((candidate) => candidate.manifest.release.id === bundle.targetReleaseId);
  if (!release) throw new Error("successor release missing");
  const definition = release.documents.find(
    (document): document is CatalogReleaseDefinitionDocument => document.kind === "definition",
  );
  if (!definition) throw new Error("successor Definition missing");
  definition.content.revision.id = REVISION_2;
  definition.content.revision.number = 2;
  definition.content.revision.documentation = "Issue #899 successor revision.";
  refreshAuthoritativeSource(release);
  return bundle;
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  return compiled.value;
};

describe("Issue #899 canonical topology queries", () => {
  let database: EphemeralTestDatabase;
  let adminPool: pg.Pool;
  let apiDb: RootDatabase;
  let runtime: ProvisionedRuntimeLogins;
  let snapshot: CatalogSnapshot;
  let firstPin: CatalogReleasePin;
  let successorPin: CatalogReleasePin;
  let registrationId: string;
  let sourceBinding: ReturnType<typeof createSourceBackedBindingService>;
  let bindingA: { id: string; currentValueId: string };
  let bindingASibling: { id: string; currentValueId: string };
  let bindingB: { id: string; currentValueId: string };
  let changedValueId: string;
  let unpinnedValueId: string;
  let deletedValueId: string;

  const orgAdmin = makeTestAuthContext({
    userId: "user-899-org-admin",
    organizationId: ORG,
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "admin:access"],
  });
  const projectAReader = makeTestAuthContext({
    userId: "user-899-project-a",
    organizationId: ORG,
    roles: [{ projectId: PROJECT_A, roleId: "hardware-user" }],
    permissions: ["parameter:view"],
  });
  const projectBReader = makeTestAuthContext({
    userId: "user-899-project-b",
    organizationId: ORG,
    roles: [{ projectId: PROJECT_B, roleId: "hardware-user" }],
    permissions: ["parameter:view"],
  });
  const foreignReader = makeTestAuthContext({
    userId: "user-899-foreign",
    organizationId: FOREIGN_ORG,
    roles: [{ projectId: FOREIGN_PROJECT, roleId: "hardware-user" }],
    permissions: ["parameter:view"],
  });

  const register = (pin: CatalogReleasePin): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease: pin,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "issue-899 canonical topology query" },
    idempotencyKey: `issue899:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: "user-899-org-admin" },
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue899topology");
    adminPool = new pg.Pool({ connectionString: database.url, max: 6 });

    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const installed = await installPublishedRelease(adminPool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstBundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    firstPin = { id: first.release.id, digest: first.release.digest };

    await adminPool.query(
      `insert into public.organizations (id, name) values ($1, 'Issue 899'), ($2, 'Issue 899 foreign')`,
      [ORG, FOREIGN_ORG],
    );
    await adminPool.query(
      `insert into public.projects (id, organization_id, name, code) values
         ($1, $4, 'Issue 899 A', 'I899A'),
         ($2, $4, 'Issue 899 B', 'I899B'),
         ($3, $5, 'Issue 899 foreign', 'I899F')`,
      [PROJECT_A, PROJECT_B, FOREIGN_PROJECT, ORG, FOREIGN_ORG],
    );
    await adminPool.query(
      `insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
       values ($1, $2, 'driver-registration', 'Issue 899 driver', 'compatible:acme,power')`,
      [ATTR, ORG],
    );
    await adminPool.query(
      `insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
       values ($1, 'physical-device', 'multiple')`,
      [ATTR],
    );
    await adminPool.query(
      `insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
       values ($1, $2, 'Issue 899 driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR],
    );

    const registeredClient = await adminPool.connect();
    try {
      await registeredClient.query("begin");
      await registeredClient.query("set constraints all deferred");
      const registered = await writeGuardedRegistration(registeredClient, register(firstPin));
      expect(registered.ok).toBe(true);
      if (!registered.ok) throw new Error(JSON.stringify(registered.error));
      registrationId = registered.value.registrationId;
      await registeredClient.query("set constraints all immediate");
      await registeredClient.query("commit");
    } catch (error) {
      await registeredClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      registeredClient.release();
    }

    const loaded = await createCatalogKernel(adminPool).loadPinnedCatalog(firstPin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("first Catalog snapshot unavailable");
    snapshot = loaded.value;
    sourceBinding = createSourceBackedBindingService(adminPool);

    const seed = async (projectId: string, logicalNodeId: string) => {
      const result = await sourceBinding.stabilize({
        snapshot,
        organizationId: ORG,
        projectId,
        logicalNodeId,
        registrationId: registrationId as never,
        definitionId: DEFINITION_ID,
        effectiveRevisionId: REVISION_1,
        expectedEffectiveRevisionId: null,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      return result.value.binding;
    };
    bindingA = await seed(PROJECT_A, "issue899-node-a");
    bindingASibling = await seed(PROJECT_A, "issue899-node-a-sibling");
    bindingB = await seed(PROJECT_B, "issue899-node-b");

    const currentSource = await adminPool.query<{ source_ref: string }>(
      `select source_ref from parameter_catalog.project_parameter_values where id = $1`,
      [bindingA.currentValueId],
    );
    const changed = await appendSourceCommittedValue(adminPool, {
      snapshot,
      binding: bindingA as never,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: currentSource.rows[0]!.source_ref, configRevisionId: "issue899-change-revision" },
      payload: { kind: "number", value: 7 },
      expectedTip: bindingA.currentValueId as never,
    });
    expect(changed.ok, JSON.stringify(changed)).toBe(true);
    if (!changed.ok) throw new Error(JSON.stringify(changed.error));
    changedValueId = changed.value.currentTip;

    const successorBundle = successorWithNewRevisionBundle();
    const successor = compileOrThrow(successorBundle);
    const advanced = await installPublishedRelease(adminPool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(successorBundle),
      expectedCurrent: firstPin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    successorPin = { id: successor.release.id, digest: successor.release.digest };
    expect(await casEffectiveRevision(adminPool, {
      id: bindingB.id,
      expectedEffectiveRevisionId: REVISION_1,
      nextEffectiveRevisionId: REVISION_2,
      nextCatalogReleaseId: successorPin.id,
    })).toBe(true);

    unpinnedValueId = "pval_issue899_unpinned";
    await adminPool.query(
      `insert into parameter_catalog.project_parameter_values (
         id, binding_id, definition_id, definition_revision_id, source_ref, config_revision_id,
         value_digest, value_kind, value, value_state
       ) select $1, binding_id, definition_id, definition_revision_id, 'issue899-unpinned', config_revision_id,
                'sha256:issue899-unpinned', 'number', '8'::jsonb, 'present'
           from parameter_catalog.project_parameter_values
          where id = $2 and binding_id = $3`,
      [unpinnedValueId, changedValueId, bindingA.id],
    );
    await adminPool.query(
      `insert into parameter_catalog.binding_history_events (
         id, binding_id, old_effective_revision_id, new_effective_revision_id,
         old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
       ) values ($1, $2, $3, $3, $4, $5, 'issue899-unpinned', 'issue899-unpinned-audit', $6)`,
      ["issue899-unpinned-event", bindingA.id, REVISION_1, changedValueId, unpinnedValueId, firstPin.id],
    );

    deletedValueId = "pval_issue899_deleted";
    await adminPool.query(
      `insert into parameter_catalog.project_parameter_values (
         id, binding_id, definition_id, definition_revision_id, source_ref, config_revision_id,
         value_digest, value_kind, value, value_state
       ) select $1, binding_id, definition_id, definition_revision_id, source_ref, config_revision_id,
                'sha256:issue899-deleted', value_kind, value, 'deleted'
           from parameter_catalog.project_parameter_values
          where id = $2 and binding_id = $3`,
      [deletedValueId, changedValueId, bindingA.id],
    );
    await adminPool.query(
      `insert into parameter_catalog.binding_history_events (
         id, binding_id, old_effective_revision_id, new_effective_revision_id,
         old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
       ) values ($1, $2, $3, $3, $4, $5, 'issue899-delete', 'issue899-delete-audit', $6)`,
      ["issue899-delete-event", bindingA.id, REVISION_1, changedValueId, deletedValueId, firstPin.id],
    );
    await adminPool.query(
      `insert into parameter_catalog.binding_history_events (
         id, binding_id, old_effective_revision_id, new_effective_revision_id,
         old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
       ) values ($1, $2, $3, $4, $5, $5, 'issue899-revision-only', 'issue899-revision-audit', $6)`,
      ["issue899-revision-event", bindingA.id, REVISION_1, REVISION_2, changedValueId, successorPin.id],
    );

    const runToken = `issue899${process.pid}`.slice(0, 24);
    runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken });
    apiDb = createPostgresDatabase(runtime.apiUrl);
  }, 120_000);

  afterAll(async () => {
    await apiDb?.close();
    await adminPool?.end();
    if (runtime?.runToken) {
      const cleanup = await dropLabRuntimeLogins(database.url, runtime.runToken);
      if (cleanup.failed.length > 0) throw new Error(`runtime login cleanup failed: ${cleanup.failed.join(",")}`);
    }
    await database?.drop();
  });

  it("reads canonical history by exact immutable IDs, including unpinned, delete, and revision-only events", async () => {
    const history = await getBindingHistory(apiDb, orgAdmin, { projectId: PROJECT_A, bindingId: bindingA.id });
    const unpinned = history.items.find((item) => item.newCurrentValueId === unpinnedValueId);
    expect(unpinned).toMatchObject({
      bindingId: bindingA.id,
      sourceOccurrenceId: expect.any(String),
      sourceAvailable: false,
      toRawValue: "<8>",
    });
    expect(history.items.find((item) => item.id === "issue899-delete-event")).toMatchObject({
      oldCurrentValueId: changedValueId,
      newCurrentValueId: deletedValueId,
      valueState: "deleted",
      toRawValue: "",
      sourceAvailable: false,
    });
    expect(history.items.find((item) => item.id === "issue899-revision-event")).toMatchObject({
      oldDefinitionRevisionId: REVISION_1,
      newDefinitionRevisionId: REVISION_2,
      oldCurrentValueId: changedValueId,
      newCurrentValueId: changedValueId,
      definitionRevisionId: REVISION_1,
      effectiveRevisionId: REVISION_2,
    });
  });

  it("returns each canonical source instance and applies project scope before compare", async () => {
    const scoped = await getBindingCompare(apiDb, projectAReader, { projectId: PROJECT_A, bindingId: bindingA.id });
    expect(scoped.items.map((item) => item.bindingId)).toEqual([bindingASibling.id]);
    expect(scoped.items[0]).toMatchObject({
      projectId: PROJECT_A,
      definitionId: DEFINITION_ID,
      sourceOccurrenceId: expect.any(String),
      sourceIdentity: expect.any(String),
    });

    const orgWide = await getBindingCompare(apiDb, orgAdmin, { projectId: PROJECT_A, bindingId: bindingA.id });
    expect(orgWide.items.map((item) => item.bindingId).sort()).toEqual([bindingASibling.id, bindingB.id].sort());
    expect(orgWide.items.every((item) => item.bindingId !== bindingA.id)).toBe(true);
    expect(new Set(orgWide.items.map((item) => item.sourceIdentity)).size).toBe(2);
    expect(orgWide.items.find((item) => item.bindingId === bindingB.id)).toMatchObject({
      effectiveRevisionId: REVISION_2,
      definitionRevisionId: REVISION_1,
    });
  });

  it("rejects project and tenant scope through the service on the production-like reader connection", async () => {
    await expect(getBindingCompare(apiDb, projectAReader, { projectId: PROJECT_B, bindingId: bindingB.id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBindingHistory(apiDb, projectBReader, { projectId: PROJECT_A, bindingId: bindingA.id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBindingCompare(apiDb, foreignReader, { projectId: FOREIGN_PROJECT, bindingId: bindingA.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getBindingHistory(apiDb, foreignReader, { projectId: FOREIGN_PROJECT, bindingId: bindingA.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
