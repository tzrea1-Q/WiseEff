import { applyMigrations } from "../../shared/database/migrations";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigrationHarness, integerContent, MIGRATION_PRINCIPAL, migrationTrustedActor,
  PREDECESSOR_DEFINITION_ID, PREDECESSOR_SUBJECT_ID, type MigrationHarness } from "./testing/harness";
import { createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/service";
import {
  deriveHistoryEventId,
  deriveProjectValueId,
  deriveSuccessAuditId,
  digestProjectValuePayload,
  insertBindingHistoryEvent,
  insertSuccessAudit,
} from "../parameter-bindings/values/repositories";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { SubjectRegistrationId, ParameterDefinitionId, DefinitionRevisionId } from "../parameter-catalog-contract";

const organizationId = "org-replacement-root", projectId = "project-replacement-root";

async function seedReplacement(harness: MigrationHarness) {
  const foreignTargets: Array<{ bindingId: string; valueId: string }> = [];
    await harness.seedOrganization(organizationId);
    await harness.seedProject(organizationId,projectId,"Replacement root");
    const registrationId = await harness.registerSubject({ organizationId,subjectId: PREDECESSOR_SUBJECT_ID,
      subjectKind: "driver",moduleId: "module-replacement-root" });
    await harness.seedOrganization("org-other-root");
    const foreignRegistration = await harness.registerSubject({ organizationId: "org-other-root",
      subjectId: PREDECESSOR_SUBJECT_ID,subjectKind: "driver",moduleId: "module-foreign-root" });
    const old = await harness.seedBindingValue({ organizationId,projectId,logicalNodeId: "root-original",registrationId,
      sources: [{ sourceRef: "config/root.dts",configRevisionId: "revision-root-original" }],propertyKeys: ["iin_guard_max"],values: [5] });
    const oldBindingId = old.bindingId;
    const context = { actorKind: "org-admin" as const,principalId: MIGRATION_PRINCIPAL,organizationId };
    const preview = await harness.migration.previewDefinitionReplacement({ organizationId,oldDefinitionId: PREDECESSOR_DEFINITION_ID,
      newSubjectId: PREDECESSOR_SUBJECT_ID,newPropertyKey: "iin_guard_max",proposedContent: integerContent("Guard max",0),
      projectIds: [projectId],reason: "Source occurrence guard",expectedRelease: harness.pin(),context });
    if (!preview.ok) throw new Error(JSON.stringify(preview.error));
    const created = await harness.migration.createDefinitionReplacement({ organizationId,previewId: preview.value.previewId,
      previewFingerprint: preview.value.previewFingerprint,idempotencyKey: "replacement-root",expectedRelease: harness.pin(),
      context,trustedActor: migrationTrustedActor() });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(created.value.status).toBe("completed");
    const replacementId = created.value.id;
    const newBindingId = created.value.projects[0]!.newBindingId!;
    const newValueId = created.value.projects[0]!.newValueId!;
    const snapshot = await loadPublishedCatalog(harness.pool);
    if (!snapshot) throw new Error("Current Catalog missing");
    const other = await createSourceBackedBindingService(harness.pool,{ objectStore: harness.objectStore }).stabilize({
      snapshot,organizationId,projectId,logicalNodeId: "root-other",registrationId: SubjectRegistrationId(registrationId),
      definitionId: ParameterDefinitionId(created.value.newIdentity.definitionId),
      effectiveRevisionId: DefinitionRevisionId(created.value.newIdentity.revisionId),expectedEffectiveRevisionId: null,
    });
    if (!other.ok) throw new Error(JSON.stringify(other.error));
    const otherBindingId = other.value.binding.id;
    const otherValueId = other.value.binding.currentValueId;
    for (const [owner,project] of [[organizationId,"project-other-root"],["org-other-root","project-foreign-root"]]) {
      await harness.seedOrganization(owner!);
      await harness.seedProject(owner!,project!,"Foreign source");
      const registration = owner === organizationId ? registrationId : foreignRegistration;
      const target = await createSourceBackedBindingService(harness.pool,{ objectStore: harness.objectStore }).stabilize({
        snapshot,organizationId: owner!,projectId: project!,logicalNodeId: `root-${project}`,
        registrationId: SubjectRegistrationId(registration),
        definitionId: ParameterDefinitionId(created.value.newIdentity.definitionId),
        effectiveRevisionId: DefinitionRevisionId(created.value.newIdentity.revisionId),expectedEffectiveRevisionId: null,
      });
      if (!target.ok) throw new Error(JSON.stringify(target.error));
      foreignTargets.push({ bindingId: target.value.binding.id,valueId: target.value.binding.currentValueId });
    }

  return { replacementId,oldBindingId,newBindingId,newValueId,otherBindingId,otherValueId,foreignTargets };
}

/**
 * Build the smallest valid pre-0153 graph.  The historical upgrade test must
 * not call the current value service: it selects value_state, which is added
 * by 0161 and is intentionally absent at the 0152 boundary.
 */
async function seedHistoricalBinding(input: {
  readonly harness: MigrationHarness;
  readonly snapshot: Awaited<ReturnType<MigrationHarness["snapshot"]>>;
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly registrationId: string;
  readonly definitionId: string;
  readonly revisionId: string;
  readonly value: number;
}) {
  const { harness, snapshot } = input;
  const definition = snapshot.getDefinitionById(input.definitionId);
  if (definition.status !== "found") throw new Error("Historical definition missing");
  const client = await harness.pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    const sourceRef = `config/${input.logicalNodeId}.dts`;
    const source = await harness.seedSourceFacts({
      organizationId: input.organizationId,
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId,
      definitionId: input.definitionId,
      propertyKey: definition.definition.propertyKey,
      propertyKeys: ["iin_guard_max"],
      sourceRef,
      configRevisionId: `revision-${input.logicalNodeId}`,
    });
    const stabilized = await stabilizeCanonicalBinding(client, {
      snapshot,
      organizationId: input.organizationId,
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId,
      sourceOccurrenceId: source.sourceOccurrenceId,
      registrationId: SubjectRegistrationId(input.registrationId),
      definitionId: ParameterDefinitionId(input.definitionId),
      effectiveRevisionId: DefinitionRevisionId(input.revisionId),
      expectedEffectiveRevisionId: null,
    });
    if (!stabilized.ok) throw new Error(JSON.stringify(stabilized.error));
    const binding = stabilized.value.binding;
    const payload = { kind: "number" as const, value: input.value };
    const valueDigest = digestProjectValuePayload(payload);
    const valueId = deriveProjectValueId({
      bindingId: binding.id,
      definitionRevisionId: input.revisionId,
      sourceRef,
      configRevisionId: source.configRevisionId,
      valueKind: payload.kind,
      valueDigest,
      expectedTip: binding.currentValueId,
    });
    await client.query(
      `insert into parameter_catalog.project_parameter_values (
         id, binding_id, definition_id, definition_revision_id,
         source_ref, config_revision_id, value_digest, value_kind, value
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [valueId, binding.id, input.definitionId, input.revisionId, sourceRef,
        source.configRevisionId, valueDigest, payload.kind, JSON.stringify(payload.value)],
    );
    const updated = await client.query(
      `update parameter_catalog.project_parameter_bindings
          set current_value_id = $2, updated_at = now()
        where id = $1 and current_value_id = $3
          and not parameter_catalog.is_replaced_current_binding(id)
          and exists (
            select 1 from parameter_catalog.project_parameter_values initial
             where initial.id = $3 and initial.binding_id = $1
               and initial.source_ref = 'canonical-binding-identity'
          )`,
      [binding.id, valueId, binding.currentValueId],
    );
    if (updated.rowCount !== 1) throw new Error("historical value tip update failed");
    const auditRef = deriveSuccessAuditId({ bindingId: binding.id, newCurrentValueId: valueId });
    await insertSuccessAudit(client, {
      id: auditRef,
      organizationId: input.organizationId,
      projectId: input.projectId,
      valueId,
      bindingId: binding.id,
    });
    await insertBindingHistoryEvent(client, {
      id: deriveHistoryEventId({
        bindingId: binding.id,
        oldCurrentValueId: binding.currentValueId,
        newCurrentValueId: valueId,
      }),
      bindingId: binding.id,
      effectiveRevisionId: input.revisionId,
      oldCurrentValueId: binding.currentValueId,
      newCurrentValueId: valueId,
      successAuditRef: auditRef,
      catalogReleaseId: binding.catalogRelease.id,
    });
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: source.propertyOccurrenceId,
      nodeOccurrenceId: source.nodeOccurrenceId,
      fileVersionId: source.fileVersionId,
      propertyName: definition.definition.propertyKey,
    };
    await client.query(
      `insert into parameter_catalog.project_value_source_pins (
         id, project_value_id, binding_id, definition_id, organization_id, project_id,
         source_occurrence_id, config_revision_id, file_id, file_version_id, format,
         property_occurrence_id, locator, locator_digest
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,
         parameter_catalog.canonical_dts_parameter_locator_digest($12::jsonb))`,
      [`src_pin_historical_${valueId.slice("pval_".length)}`, valueId, binding.id,
        input.definitionId, input.organizationId, input.projectId, source.sourceOccurrenceId,
        source.configRevisionId, source.fileId, source.fileVersionId, source.propertyOccurrenceId,
        JSON.stringify(locator)],
    );
    await client.query("set constraints all immediate");
    await client.query("commit");
    return { bindingId: binding.id, valueId };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seedHistoricalReplacement(harness: MigrationHarness) {
  await harness.seedOrganization(organizationId);
  await harness.seedProject(organizationId, projectId, "Replacement root");
  const registrationId = await harness.registerSubject({ organizationId, subjectId: PREDECESSOR_SUBJECT_ID,
    subjectKind: "driver", moduleId: "module-replacement-root" });
  const snapshot = harness.snapshot();
  const old = await seedHistoricalBinding({ harness, snapshot, organizationId, projectId,
    logicalNodeId: "root-original", registrationId, definitionId: PREDECESSOR_DEFINITION_ID,
    revisionId: "drev_acme_power_iin_max_1", value: 5 });
  const context = { actorKind: "org-admin" as const, principalId: MIGRATION_PRINCIPAL, organizationId };
  const preview = await harness.migration.previewDefinitionReplacement({ organizationId,
    oldDefinitionId: PREDECESSOR_DEFINITION_ID, newSubjectId: PREDECESSOR_SUBJECT_ID,
    newPropertyKey: "iin_guard_max", proposedContent: integerContent("Guard max", 0),
    projectIds: [projectId], reason: "Source occurrence guard", expectedRelease: harness.pin(), context });
  if (!preview.ok) throw new Error(JSON.stringify(preview.error));
  if (preview.value.projects[0]?.status !== "pending") throw new Error(JSON.stringify(preview.value));
  const created = await harness.migration.createDefinitionReplacement({ organizationId,
    previewId: preview.value.previewId, previewFingerprint: preview.value.previewFingerprint,
    idempotencyKey: "replacement-root", expectedRelease: harness.pin(), context,
    trustedActor: migrationTrustedActor() });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  if (created.value.status !== "completed") throw new Error(JSON.stringify(created.value));
  const replacementId = created.value.id;
  const newDefinitionId = created.value.newIdentity.definitionId;
  const newRevisionId = created.value.newIdentity.revisionId;
  const published = await loadPublishedCatalog(harness.pool);
  if (!published) throw new Error("Current Catalog missing");
  const other = await seedHistoricalBinding({ harness, snapshot: published, organizationId, projectId,
    logicalNodeId: "root-other", registrationId, definitionId: newDefinitionId,
    revisionId: newRevisionId, value: 5 });
  const completed = created.value.projects[0]!;
  return {
    replacementId,
    oldBindingId: old.bindingId,
    newBindingId: completed.newBindingId!,
    newValueId: completed.newValueId!,
    otherBindingId: other.bindingId,
    otherValueId: other.valueId,
  };
}

describe("completed replacement source occurrence guard", () => {
  let harness: MigrationHarness;
  let replacementId: string, oldBindingId: string, newBindingId: string, newValueId: string;
  let otherBindingId: string, otherValueId: string;
  let foreignTargets: Array<{ bindingId: string; valueId: string }>;

  beforeAll(async () => {
    harness = await createMigrationHarness();
    ({ replacementId,oldBindingId,newBindingId,newValueId,otherBindingId,otherValueId,foreignTargets } = await seedReplacement(harness));
  },120_000);

  afterAll(async () => { await harness?.close(); });

  it("refuses cross-project and cross-tenant completed endpoints", async () => {
    for (const target of foreignTargets) {
      await expect(harness.db.transaction(async (tx) => {
        await tx.query("set local role catalog_migration_owner");
        await tx.query(`update parameter_catalog.definition_replacement_projects set new_binding_id=$2,new_value_id=$3 where replacement_id=$1`,
          [replacementId,target.bindingId,target.valueId]);
        await tx.query("set constraints all immediate");
      })).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("keeps the guard and resolvers unavailable to runtime roles", async () => {
    const privileges = await harness.pool.query(`select role,function,
      has_function_privilege(role,function,'execute') as allowed
      from unnest(array['catalog_synchronizer_role','parameter_governance_writer_role',
        'catalog_publication_coordinator_role','catalog_baseline_reader_role']) role
      cross join unnest(array['parameter_catalog.assert_replacement_source_occurrence()',
        'parameter_catalog.protect_source_occurrence_identity()',
        'parameter_catalog.resolve_current_binding(text,text,text)',
        'parameter_catalog.resolve_current_binding_by_source_occurrence(text,text,text)']) function`);
    expect(privileges.rows).toHaveLength(16);
    expect(privileges.rows.every((row) => row.allowed === false)).toBe(true);
  });

  it.each(["immediate","commit"])("refuses another root at %s without changing the completed projection", async (mode) => {
    await expect(harness.db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      await tx.query(`update parameter_catalog.definition_replacement_projects set new_binding_id=$2,new_value_id=$3 where replacement_id=$1`,
        [replacementId,otherBindingId,otherValueId]);
      if (mode === "immediate") await tx.query("set constraints all immediate");
    })).rejects.toMatchObject({ code: "23514" });
    expect((await harness.pool.query(`select new_binding_id,new_value_id from parameter_catalog.definition_replacement_projects where replacement_id=$1`,
      [replacementId])).rows).toEqual([{ new_binding_id: newBindingId,new_value_id: newValueId }]);
  });

  it.each(["logical","occurrence"])("refuses a torn %s resolver projection before deferred constraints run", async (kind) => {
    await expect(harness.db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      await tx.query(`update parameter_catalog.definition_replacement_projects set new_binding_id=$2,new_value_id=$3 where replacement_id=$1`,
        [replacementId,otherBindingId,otherValueId]);
      if (kind === "logical") {
        await tx.query(`select parameter_catalog.resolve_current_binding($1,'root-original',$2)`,[projectId,PREDECESSOR_DEFINITION_ID]);
      } else {
        await tx.query(`select parameter_catalog.resolve_current_binding_by_source_occurrence($1,
          (select source_occurrence_id from parameter_catalog.project_parameter_bindings where id=$2),$3)`,
        [projectId,oldBindingId,PREDECESSOR_DEFINITION_ID]);
      }
      throw new Error("Resolver accepted another source occurrence");
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("checks the final transaction row and retains both valid resolver projections", async () => {
    await harness.db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      for (const [bindingId,valueId] of [[otherBindingId,otherValueId],[newBindingId,newValueId]]) {
        await tx.query(`update parameter_catalog.definition_replacement_projects set new_binding_id=$2,new_value_id=$3 where replacement_id=$1`,
          [replacementId,bindingId,valueId]);
      }
      await tx.query("set constraints all immediate");
      const result = await tx.query(`select parameter_catalog.resolve_current_binding($1,'root-original',$3) as logical,
        parameter_catalog.resolve_current_binding_by_source_occurrence($1,
        (select source_occurrence_id from parameter_catalog.project_parameter_bindings where id=$2),$3) as occurrence`,
      [projectId,oldBindingId,PREDECESSOR_DEFINITION_ID]);
      expect(result.rows).toEqual([{ logical: newBindingId,occurrence: newBindingId }]);
    });
  });
});

describe("0153 populated upgrade", () => {
  it.each(["valid","cross-root"])("preserves or atomically refuses the %s historical projection", async (kind) => {
    await withTempDatabase({ prefix: "srcintegrityupgrade",migrate: false },async ({ db,connectionString }) => {
      await applyMigrations(db,migrationsDir,{ through: "0152_pinned_source_graph_immutability.sql" });
      expect((await db.query(`select column_name from information_schema.columns
        where table_schema = 'parameter_catalog'
          and table_name = 'project_parameter_values' and column_name = 'value_state'`)).rows).toEqual([]);
      // The outer helper owns this database; the harness owns only its connections/storage.
      const harness = await createMigrationHarness({ database: { url: connectionString,drop: async () => {} } });
      try {
        const fixture = await seedHistoricalReplacement(harness);
        if (kind === "cross-root") {
          await db.query(`update parameter_catalog.definition_replacement_projects
            set new_binding_id=$2,new_value_id=$3 where replacement_id=$1`,
          [fixture.replacementId,fixture.otherBindingId,fixture.otherValueId]);
        }
        const before = (await db.query("select * from parameter_catalog.definition_replacement_projects order by id")).rows;
        if (kind === "cross-root") {
          await expect(applyMigrations(db,migrationsDir)).rejects.toMatchObject({ code: "23514" });
          expect((await db.query("select name from schema_migrations where name like '0153%'")).rows).toEqual([]);
          expect((await db.query(`select to_regprocedure('parameter_catalog.assert_replacement_source_occurrence()') as guard`)).rows[0]?.guard).toBeNull();
        } else {
          await applyMigrations(db,migrationsDir);
          expect((await db.query("select name from schema_migrations where name like '0153%'")).rows).toHaveLength(1);
          expect((await db.query("select name from schema_migrations where name like '0161%'")).rows).toHaveLength(1);
        }
        expect((await db.query("select * from parameter_catalog.definition_replacement_projects order by id")).rows).toEqual(before);
      } finally { await harness.close(); }
    });
  },120_000);
});
