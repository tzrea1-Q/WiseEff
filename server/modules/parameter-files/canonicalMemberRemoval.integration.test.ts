import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, serializeContract, SubjectRegistrationId,
  type ContractJsonValue } from "../parameter-catalog-contract";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { asValueClient, loadPublishedCatalog, readCanonicalBindingChangeHistory,
  syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/service";
import { loadBindingById, loadHistoryByRevision, loadOwnedProjectValueSourcePin } from "../parameter-bindings/values/repositories";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { applyReviewedCanonicalMemberRemoval, prepareCanonicalMemberRemoval,
  type CanonicalMemberRemovalProof, type ReviewedCanonicalMemberRemoval } from "./canonicalMemberRemoval";
import { insertFileVersion } from "./repository";
import { createParameterModuleForAuth } from "../parameters/service";
import { executeRegistration } from "../parameter-governance/registration";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { submitCanonicalBatchValueChange } from "../parameter-bindings/drafts/batchChangeService";
import { getCanonicalSourceWorkflow, prepareCanonicalManualSyncBatchCandidate } from "./canonicalFileWorkflow";

const organizationId = "org-906-member-cohort";
const projectId = "project-906-member-cohort";
const adminId = "user-906-member-admin";
const reviewerId = "user-906-member-reviewer";
const schemaId = "wiseeff.906.member.cohort";
const definitionId = "pdef_acme_power_iin_max";

const admin = makeTestAuthContext({
  userId: adminId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

const MIXED_ORG = "org-906-member-dts-mixed";
const MIXED_PROJECT = "project-906-member-dts-mixed";
const MIXED_ADMIN_ID = "user-906-member-dts-admin";
const MIXED_REVIEWER_ID = "user-906-member-dts-reviewer";
const MIXED_SCHEMA = "wiseeff.mixed906";
const MIXED_JSON_DEFINITION = "pdef_member_dts_json_limit";
const MIXED_EVIDENCE_EXPORT_PATH = "/tmp/wiseeff-member-dts-removal-transaction-implementation-20261003/mixed-success-fixture-final-r3-20261003.json";
const mixedAdmin = makeTestAuthContext({ userId: MIXED_ADMIN_ID, organizationId: MIXED_ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const mixedReviewer = makeTestAuthContext({ userId: MIXED_REVIEWER_ID, organizationId: MIXED_ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: MIXED_PROJECT }] });

type Mutable<Value> = Value extends readonly (infer Item)[] ? Mutable<Item>[]
  : Value extends object ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> } : Value;

async function objectInventory(directory: string) {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile());
  return Promise.all(files.map(async (entry) => {
    const filePath = join(directory, relative(directory, entry.parentPath), entry.name);
    const bytes = await readFile(filePath);
    return { key: relative(directory, filePath),
      size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  })).then((rows) => rows.sort((left, right) => left.key.localeCompare(right.key)));
}

async function installMixedDtsJsonCatalog(db: ReturnType<typeof createPostgresDatabase>) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Mixed DTS/JSON fixture requires native PostgreSQL");
  const full = structuredClone(validCatalogReleaseBundle()) as Mutable<CatalogReleaseBundle>;
  const firstRelease = full.releases.find((release) => release.manifest.release.id === "crel_acme_1");
  const secondRelease = full.releases.find((release) => release.manifest.release.id === "crel_acme_2");
  if (!firstRelease || !secondRelease) throw new Error("Mixed Catalog release chain is incomplete");
  const source = firstRelease.documents[0]!.source;
  const configSubjectId = "csub_member_dts_json";
  const configSubject = {
    source, kind: "subject" as const, normalizedDigest: "",
    content: { id: configSubjectId, kind: "configuration-schema" as const,
      canonicalKey: MIXED_SCHEMA, lifecycle: "active" as const,
      selector: { kind: "configuration-schema-id" as const, value: MIXED_SCHEMA,
        provenance: { source: "issue-906-mixed-source" } }, subtype: {}, tombstone: null }
  };
  const configAlias = {
    source, kind: "alias" as const, normalizedDigest: "",
    content: { id: "cali_member_dts_json_v1", subjectId: configSubjectId,
      selectorKind: "configuration-schema-id" as const, normalizedSelector: `${MIXED_SCHEMA}.v1`,
      lifecycle: "active" as const, selectorProvenance: { source: "catalog-review" }, tombstone: null }
  };
  const configDefinition = {
    source, kind: "definition" as const, normalizedDigest: "",
    content: { id: MIXED_JSON_DEFINITION, subjectId: configSubjectId, propertyKey: "limit",
      revision: { id: "drev_member_dts_json_limit_1", number: 1, contentDigest: "",
        lifecycle: "active" as const, displayName: "JSON limit", documentation: "Mixed source survivor.",
        valueSchema: { type: "number", minimum: 0 },
        matching: { sourceProperty: "limit", selectorKind: "configuration-schema-id" as const } } }
  };
  for (const release of full.releases) {
    release.documents.push(structuredClone(configSubject), structuredClone(configAlias), structuredClone(configDefinition));
    refreshAuthoritativeSource(release);
  }
  secondRelease.manifest.release.predecessor = {
    id: firstRelease.manifest.release.id, digest: firstRelease.manifest.release.digest
  };
  refreshAuthoritativeSource(secondRelease);
  const successorBundle = structuredClone(full) as Mutable<CatalogReleaseBundle>;
  const successorRelease = successorBundle.releases.find((release) => release.manifest.release.id === "crel_acme_2");
  const successorDefinition = successorRelease?.documents.find((document) => document.kind === "definition"
    && document.content.id === definitionId);
  if (!successorRelease || !successorDefinition || successorDefinition.kind !== "definition") {
    throw new Error("Mixed Catalog successor Definition is unavailable");
  }
  successorDefinition.content.revision.id = "drev_acme_power_iin_max_2";
  successorDefinition.content.revision.number = 2;
  successorDefinition.content.revision.documentation = "Issue #906 successor revision for replay verification.";
  refreshAuthoritativeSource(successorRelease);
  const bundle: CatalogReleaseBundle = { schemaVersion: full.schemaVersion,
    targetReleaseId: firstRelease.manifest.release.id, releases: [firstRelease] };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, { mode: "bootstrap",
    source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));

  const business = await createParameterModuleForAuth(db, mixedAdmin, { name: "Mixed driver business", kind: "business" });
  const driver = await createParameterModuleForAuth(db, mixedAdmin, { name: "Mixed driver", kind: "driver-group",
    parentId: business.id, compatibles: ["acme,power"] });
  const config = await createParameterModuleForAuth(db, mixedAdmin, { name: "Mixed JSON configuration", kind: "business" });
  const baseCommand = {
    kind: "register" as const, organizationId: MIXED_ORG, expectedRelease: compiled.value.release,
    placement: { mode: "use-default" as const }, method: "explicit" as const,
    context: { actorKind: "org-admin" as const, principalId: MIXED_ADMIN_ID }
  };
  const driverRegistration = await executeRegistration(pool, { ...baseCommand,
    subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver",
    destinationModuleId: driver.id, proof: { reason: "Issue 906 mixed DTS source" },
    idempotencyKey: "906-member-dts-driver-registration" });
  if (!driverRegistration.ok) throw new Error(JSON.stringify(driverRegistration.error));
  const configRegistration = await executeRegistration(pool, { ...baseCommand,
    subjectId: CatalogSubjectId(configSubjectId), subjectKind: "configuration-schema",
    destinationModuleId: config.id, proof: { reason: "Issue 906 mixed JSON source" },
    idempotencyKey: "906-member-dts-config-registration" });
  if (!configRegistration.ok) throw new Error(JSON.stringify(configRegistration.error));
  return { configSubjectId, successorBundle };
}

async function createMixedDtsJsonFixture(input: { chargerBaseFallback?: boolean; geometryNestedNode?: boolean;
  historicalSecondOverlay?: boolean } = {}) {
  const database = await createEphemeralTestDatabase("issue906-member-dts-mixed");
  const db = createPostgresDatabase(database.url);
  const storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-member-dts-mixed-"));
  const storage = createLocalObjectStore(storageDirectory);
  await db.query("insert into organizations(id,name) values ($1,'#906 mixed DTS member')", [MIXED_ORG]);
  await db.query(`insert into users(id,organization_id,name,title,is_active)
    values ($1,$3,'admin','Admin',true),($2,$3,'reviewer','Reviewer',true)`,
  [MIXED_ADMIN_ID, MIXED_REVIEWER_ID, MIXED_ORG]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Mixed DTS member','M906D','initialized')",
    [MIXED_PROJECT, MIXED_ORG]);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
    values ('role-906-member-dts-admin',$1,$2,null,'admin'),('role-906-member-dts-reviewer',$3,$2,$4,'software-committer')`,
  [MIXED_ADMIN_ID, MIXED_ORG, MIXED_REVIEWER_ID, MIXED_PROJECT]);
  const catalogFixture = await installMixedDtsJsonCatalog(db);
  const configSet = await createConfigSet(db, mixedAdmin, { projectId: MIXED_PROJECT, name: "mixed DTS removal" });
  const baseDts = `/dts-v1/;
/ {
  charger: device@0 { compatible = "acme,power"; status = "okay"; model = "charger";${input.chargerBaseFallback ? " iin_max = <35>;" : ""}${input.geometryNestedNode ? ' diagnostics: monitor@0 { status = "okay"; };' : ""} };
  backup: device@1 { compatible = "acme,power"; ${input.historicalSecondOverlay ? "" : "iin_max = <48>;"} status = "okay"; };
  reserve: device@2 { compatible = "acme,power"; iin_max = <60>; status = "okay"; };
};
`;
const removedDts = `/dts-v1/;
/plugin/;
&charger { iin_max = <36>; };
`;
  const survivorDts = `/dts-v1/;
/plugin/;
&backup { iin_max = <48>; };
`;
  const json = '{"limit":72}\n';
  const uploadedBase = await uploadProjectParameterFile(db, storage, mixedAdmin, {
    projectId: MIXED_PROJECT, fileName: "board.dts", bytes: Buffer.from(baseDts)
  });
  const uploadedOverlay = await uploadProjectParameterFile(db, storage, mixedAdmin, {
    projectId: MIXED_PROJECT, fileName: "retire.dts", bytes: Buffer.from(removedDts)
  });
  const uploadedSurvivorOverlay = input.historicalSecondOverlay ? await uploadProjectParameterFile(db, storage, mixedAdmin, {
    projectId: MIXED_PROJECT, fileName: "survivor.dts", bytes: Buffer.from(survivorDts)
  }) : undefined;
  const uploadedJson = await uploadProjectParameterFile(db, storage, mixedAdmin, {
    projectId: MIXED_PROJECT, fileName: "settings.json", bytes: Buffer.from(json)
  });
  await addConfigSetFile(db, mixedAdmin, { configSetId: configSet.id, fileId: uploadedBase.file.id, role: "base", sortOrder: 0 });
  if (uploadedSurvivorOverlay) {
    await addConfigSetFile(db, mixedAdmin, { configSetId: configSet.id, fileId: uploadedSurvivorOverlay.file.id,
      role: "overlay", sortOrder: 1 });
  }
  await addConfigSetFile(db, mixedAdmin, { configSetId: configSet.id, fileId: uploadedOverlay.file.id,
    role: "overlay", sortOrder: uploadedSurvivorOverlay ? 2 : 1 });
  await addConfigSetFile(db, mixedAdmin, { configSetId: configSet.id, fileId: uploadedJson.file.id,
    role: "overlay", sortOrder: uploadedSurvivorOverlay ? 3 : 2 });
  const overlayOrder = uploadedSurvivorOverlay ? ["survivor.dts", "retire.dts"] : ["retire.dts"];
  const members: ConfigRevisionManifest["members"] = [
    { fileId: uploadedBase.file.id, fileVersionId: uploadedBase.version.id, fileName: "board.dts",
      sourceName: "board.dts", role: "base", sortOrder: 0, content: baseDts, format: "dts" },
    ...(uploadedSurvivorOverlay ? [{ fileId: uploadedSurvivorOverlay.file.id,
      fileVersionId: uploadedSurvivorOverlay.version.id, fileName: "survivor.dts", sourceName: "survivor.dts",
      role: "overlay" as const, sortOrder: 1, content: survivorDts, format: "dts" as const }] : []),
    { fileId: uploadedOverlay.file.id, fileVersionId: uploadedOverlay.version.id, fileName: "retire.dts",
      sourceName: "retire.dts", role: "overlay", sortOrder: uploadedSurvivorOverlay ? 2 : 1,
      content: removedDts, format: "dts" },
    { fileId: uploadedJson.file.id, fileVersionId: uploadedJson.version.id, fileName: "settings.json",
      sourceName: "settings.json", role: "overlay", sortOrder: uploadedSurvivorOverlay ? 3 : 2,
      content: json, format: "json" }
  ];
  const manifest: ConfigRevisionManifest = { organizationId: MIXED_ORG, projectId: MIXED_PROJECT,
    configSetId: configSet.id, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder, members };
  const revision = await ingestConfigRevision(db, manifest, mixedAdmin, { legacyProjection: "skip" });
  if (revision.status !== "resolved") throw new Error("Mixed source fixture did not resolve.");
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Mixed Catalog fixture is unavailable");
  const dtsBindings = await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, {
    organizationId: MIXED_ORG, projectId: MIXED_PROJECT, configSetId: configSet.id, configRevisionId: revision.id
  }));
  if (dtsBindings !== 3) throw new Error(`Expected three DTS Bindings, got ${dtsBindings}`);
  const jsonRegistration = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, mixedAdmin, snapshot, {
    projectId: MIXED_PROJECT, configSetId: configSet.id, fileId: uploadedJson.file.id,
    fileVersionId: uploadedJson.version.id, configurationSchemaId: MIXED_SCHEMA, rootPointer: "",
    mappings: [{ definitionId: MIXED_JSON_DEFINITION, pointer: "/limit" }],
    invocation: createUserInvocation(mixedAdmin), requestId: "register:mixed-dts-json",
    refusalSink: createTrustedRefusalAuditSink(db)
  }));
  if (jsonRegistration.bindings.length !== 1) throw new Error("Expected one JSON Binding survivor.");
  return { database, db, storageDirectory, storage, configSetId: configSet.id, revisionId: revision.id,
    removedFileId: uploadedOverlay.file.id, baseFileId: uploadedBase.file.id, jsonFileId: uploadedJson.file.id,
    survivorOverlayFileId: uploadedSurvivorOverlay?.file.id ?? null,
    baseVersionId: uploadedBase.version.id, removedVersionId: uploadedOverlay.version.id,
    jsonVersionId: uploadedJson.version.id, catalogFixture, snapshot };
}

async function captureMixedState(fixture: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>, requestId?: string) {
  const { db, configSetId } = fixture;
  const queries = await Promise.all([
    db.query("select id,status,entry_file,include_search_paths,overlay_order from dts_config_revisions where config_set_id=$1 order by id", [configSetId]),
    db.query("select id,config_revision_id,file_id,file_version_id,role,sort_order,source_name from dts_config_revision_members where config_revision_id in (select id from dts_config_revisions where config_set_id=$1) order by id", [configSetId]),
    db.query("select id,current_value_id,source_occurrence_id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,binding_id,config_revision_id,value_digest,value_kind,value from parameter_catalog.project_parameter_values where binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2) order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,project_value_id,binding_id,config_revision_id,file_id,file_version_id,format,locator,locator_digest from parameter_catalog.project_value_source_pins where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,binding_id,old_current_value_id,new_current_value_id,success_audit_ref from parameter_catalog.binding_history_events where binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2) order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,config_set_id,current_version_id from project_parameter_files where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select * from project_parameter_file_candidates where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select * from project_parameter_value_drafts where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,file_id,binding_manifest,successor_config_revision_id,successor_binding_manifest,audit_event_id from parameter_catalog.project_source_member_tombstones where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,status,applied_at,applied_audit_ref,applied_source_result from project_parameter_value_change_requests where organization_id=$1 and project_id=$2 order by id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select * from project_parameter_value_change_targets where request_id in (select id from project_parameter_value_change_requests where organization_id=$1 and project_id=$2) order by request_id,binding_id", [MIXED_ORG, MIXED_PROJECT]),
    db.query("select id,action,metadata from audit_events where organization_id=$1 and project_id=$2 and ($3::text is null or metadata->>'reviewRequestId'=$3) order by id", [MIXED_ORG, MIXED_PROJECT, requestId ?? null]),
    db.query(`select id,config_revision_id,file_version_id,parent_occurrence_id,name,unit_address,labels,ref_target,
        is_overlay_root,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash
      from public.dts_node_occurrences where config_revision_id in
        (select id from public.dts_config_revisions where config_set_id=$1) order by id`, [configSetId]),
    db.query(`select id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,
        start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash
      from public.dts_property_occurrences where config_revision_id in
        (select id from public.dts_config_revisions where config_set_id=$1) order by id`, [configSetId]),
    db.query(`select id,config_revision_id,logical_node_revision_id,property_name,effect_kind,node_occurrence_id,
        property_occurrence_id,source_order from public.dts_occurrence_effects where config_revision_id in
        (select id from public.dts_config_revisions where config_set_id=$1) order by id`, [configSetId])
  ]);
  return queries.map((result) => result.rows);
}

type MixedGraphNode = { logical_node_id: string; node_locator: string; name: string; [key: string]: unknown };
type MixedGraphProperty = { logical_node_id: string; file_id: string; property_name: string; [key: string]: unknown };

async function mixedEffectiveGraph(db: ReturnType<typeof createPostgresDatabase>, revisionId: string) {
  const nodes = await db.query<MixedGraphNode>(`select logical.logical_node_id,logical.node_locator,logical.name,logical.unit_address,
      logical.compatible,logical.driver_schema_version_id,logical.parent_logical_node_id
    from dts_logical_node_revisions logical where logical.config_revision_id=$1 order by logical.logical_node_id`, [revisionId]);
  const properties = await db.query<MixedGraphProperty>(`select logical.logical_node_id,logical.node_locator,member.file_id,property.file_version_id,
      property.property_name,property.start_offset,property.end_offset,property.start_line,property.start_column,
      property.end_line,property.end_column,property.raw_text,property.ast_json,property.content_hash,
      node.node_path,node.name,node.unit_address,node.labels,node.ref_target,node.is_overlay_root,
      node.start_offset as node_start_offset,node.end_offset as node_end_offset,node.start_line as node_start_line,
      node.start_column as node_start_column,node.end_line as node_end_line,node.end_column as node_end_column,
      node.raw_text as node_raw_text,node.ast_json as node_ast_json,node.content_hash as node_content_hash,
      parent.node_path as parent_path,parent.name as parent_name,parent.unit_address as parent_unit_address,
      parent.labels as parent_labels,parent.ref_target as parent_ref_target,parent.is_overlay_root as parent_overlay_root,
      parent.start_offset as parent_start_offset,parent.end_offset as parent_end_offset,parent.start_line as parent_start_line,
      parent.start_column as parent_start_column,parent.end_line as parent_end_line,parent.end_column as parent_end_column,
      parent.raw_text as parent_raw_text,parent.ast_json as parent_ast_json,parent.content_hash as parent_content_hash
    from dts_occurrence_effects effect
    join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
    join dts_property_occurrences property on property.id=effect.property_occurrence_id
    join dts_node_occurrences node on node.id=effect.node_occurrence_id
    left join dts_node_occurrences parent on parent.id=node.parent_occurrence_id
    join dts_config_revision_members member on member.config_revision_id=effect.config_revision_id and member.file_version_id=property.file_version_id
    where effect.config_revision_id=$1 and effect.effect_kind in ('set','override')
      and not exists (select 1 from dts_occurrence_effects later where later.config_revision_id=effect.config_revision_id
        and later.logical_node_revision_id=effect.logical_node_revision_id and later.property_name=effect.property_name
        and later.source_order>effect.source_order)
    order by logical.logical_node_id,property.property_name`, [revisionId]);
  return { nodes: nodes.rows, properties: properties.rows };
}

describe("#906 reviewed mixed DTS member removal", () => {
  type DtsRemovalProof = Extract<CanonicalMemberRemovalProof, { proofVersion: 2; format: "dts" }>;
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

  async function fixture(input: { chargerBaseFallback?: boolean; geometryNestedNode?: boolean;
    historicalSecondOverlay?: boolean } = {}) {
    const created = await createMixedDtsJsonFixture(input);
    cleanups.push(async () => {
      await created.db.close(); await created.database.drop();
      await rm(created.storageDirectory, { recursive: true, force: true });
    });
    return created;
  }

  async function prepare(created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>,
    fileId = created.removedFileId): Promise<DtsRemovalProof> {
    const proof = await created.db.transaction((tx) => prepareCanonicalMemberRemoval(tx, created.storage, mixedAdmin, {
      projectId: MIXED_PROJECT, configSetId: created.configSetId, fileId,
      invocation: createUserInvocation(mixedAdmin), traceId: `prepare:${randomUUID()}`,
      refusalSink: createTrustedRefusalAuditSink(created.db)
    }));
    if (!("proofVersion" in proof) || proof.proofVersion !== 2 || proof.format !== "dts") {
      throw new Error("Expected a typed DTS V2 member-removal proof.");
    }
    return proof;
  }

  async function review(created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>, frozen: DtsRemovalProof,
    requestId = `review:${randomUUID()}`) {
    const value: ReviewedCanonicalMemberRemoval = { requestId, submitterUserId: MIXED_ADMIN_ID,
      reviewerUserId: MIXED_REVIEWER_ID, decision: "approve", frozen };
    await created.db.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,assigned_to_user_id,
       member_file_id,member_config_set_id,member_file_version_id,member_proof_digest,member_frozen_proof)
      values ($1,$2,$3,'member-removal','Remove one DTS overlay member','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [requestId, MIXED_ORG, MIXED_PROJECT, value.submitterUserId, value.reviewerUserId,
      frozen.fileId, frozen.configSetId, frozen.fileVersionId, frozen.proofDigest, JSON.stringify(frozen)]);
    return value;
  }

  async function apply(created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>,
    value: ReviewedCanonicalMemberRemoval, auth = mixedReviewer) {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(created.db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    return created.db.transaction((tx) => applyReviewedCanonicalMemberRemoval(tx, created.storage, auth,
      snapshot, value, { invocation: createUserInvocation(auth), traceId: value.requestId,
        refusalSink: createTrustedRefusalAuditSink(created.db) }));
  }

  type ReplayReaderFault = "foreign-revision" | "changed-manifest" | "foreign-member" | "missing-file"
    | "missing-version" | "omitted-member" | "duplicate-member" | "reordered-members" | "version-mismatch"
    | "bad-checksum" | "bad-size" | "missing-object" | "invalid-utf8" | "object-capacity"
    | "member-capacity" | "aggregate-capacity" | "metadata-capacity" | "native-geometry"
    | "history-mismatch" | "typed-value-mismatch";

  async function replayWithReaderFault(
    created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>,
    original: ReviewedCanonicalMemberRemoval,
    successorRevisionId: string,
    fault: ReplayReaderFault,
    observed: { hits: number },
  ) {
    let value = original;
    let proofChanged = false;
    let invalidBytes: Buffer | undefined;
    let invalidStorageKey: string | undefined;
    if (fault === "bad-checksum" || fault === "bad-size" || fault === "invalid-utf8") {
      const changedMember = original.frozen.members.find((member) => member.fileId !== original.frozen.fileId);
      if (!changedMember) throw new Error("Replay fault fixture has no historical survivor file.");
      invalidBytes = fault === "invalid-utf8" ? Buffer.from([0xc3, 0x28]) : undefined;
      const members = original.frozen.members.map((member) => member.fileId !== changedMember.fileId ? member : {
        ...member,
        ...(fault === "bad-checksum" ? { checksum: createHash("sha256").update("wrong-checksum").digest("hex") } : {}),
        ...(fault === "bad-size" ? { sizeBytes: member.sizeBytes + 1 } : {}),
        ...(fault === "invalid-utf8" ? { sizeBytes: invalidBytes!.length,
          checksum: createHash("sha256").update(invalidBytes!).digest("hex") } : {})
      });
      const { proofDigest: _proofDigest, ...unsigned } = original.frozen;
      const proofDigest = createHash("sha256").update(serializeContract(unsigned as unknown as ContractJsonValue)).digest("hex");
      value = { ...original, frozen: { ...unsigned, members, proofDigest } } as ReviewedCanonicalMemberRemoval;
      proofChanged = true;
    }
    const faultStorage = {
      ...created.storage,
      getBounded: async (key: string, maxBytes: number) => {
        if (fault === "missing-object" && key === invalidStorageKey) {
          observed.hits += 1;
          throw new Error("injected-missing-historical-object");
        }
        if (fault === "invalid-utf8" && key === invalidStorageKey) {
          observed.hits += 1;
          return invalidBytes!;
        }
        return created.storage.getBounded!(key, maxBytes);
      }
    };
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(created.db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    return created.db.transaction((tx) => {
      const injectedReader = {
        query: async <Row,>(text: string, values?: unknown[]) => {
          const result = await tx.query<Row>(text, values);
          const rows = result.rows as Array<Record<string, unknown>>;
          const rewrite = (next: Array<Record<string, unknown>>) => ({ ...result, rows: next as Row[] });
          if (proofChanged && text.includes("member_proof_digest,member_frozen_proof")) {
            observed.hits += 1;
            return rewrite(rows.map((row) => ({ ...row, member_proof_digest: value.frozen.proofDigest,
              member_frozen_proof: value.frozen })));
          }
          if (proofChanged && text.includes("from parameter_catalog.project_source_member_tombstones tombstone")) {
            observed.hits += 1;
            return rewrite(rows.map((row) => ({ ...row, metadata: {
              ...(row.metadata as Record<string, unknown>), proofDigest: value.frozen.proofDigest
            } })));
          }
          if (proofChanged && text.includes("select metadata from public.audit_events where id=$1")) {
            observed.hits += 1;
            return rewrite(rows.map((row) => ({ ...row, metadata: {
              ...(row.metadata as Record<string, unknown>), proofDigest: value.frozen.proofDigest
            } })));
          }
          if ((fault === "foreign-revision" || fault === "changed-manifest" || fault === "metadata-capacity")
            && text.includes('entry_file as "entryFile"')) {
            observed.hits += 1;
            return rewrite(rows.map((row) => fault === "foreign-revision"
              ? { ...row, projectId: "foreign-project" }
              : fault === "metadata-capacity" ? { ...row, includeSearchPaths: ["x".repeat(8 * 1024 * 1024)] }
                : { ...row, overlayOrder: [...(row.overlayOrder as string[]), "missing-overlay.dts"] }));
          }
          if (text.includes('from public.dts_config_revision_members member')
            && text.includes('version.storage_key as "storageKey"')) {
            if (["foreign-member", "missing-file", "missing-version", "omitted-member", "duplicate-member",
              "reordered-members", "version-mismatch", "bad-checksum", "bad-size", "invalid-utf8",
              "object-capacity", "member-capacity", "aggregate-capacity", "missing-object"].includes(fault)) {
              observed.hits += 1;
              if (fault === "foreign-member") return rewrite(rows.map((row, index) => index === 0
                ? { ...row, organizationId: "foreign-organization" } : row));
              if (fault === "missing-file") return rewrite(rows.map((row, index) => index === 0
                ? { ...row, ownedFileId: null } : row));
              if (fault === "missing-version") return rewrite(rows.map((row, index) => index === 0
                ? { ...row, versionId: null } : row));
              if (fault === "missing-object") {
                invalidStorageKey = String(rows[0]!.storageKey);
                return result;
              }
              if (fault === "omitted-member") return rewrite(rows.slice(0, -1));
              if (fault === "duplicate-member") return rewrite([...rows, { ...rows[0]! }]);
              if (fault === "reordered-members") return rewrite([...rows].reverse());
              if (fault === "version-mismatch") return rewrite(rows.map((row, index) => index === 0
                ? { ...row, versionFileId: "different-file" } : row));
              if (fault === "bad-checksum" || fault === "bad-size" || fault === "invalid-utf8") {
                const member = value.frozen.members.find((entry) => entry.fileId !== value.frozen.fileId)!;
                return rewrite(rows.map((row) => row.fileId !== member.fileId ? row : {
                  ...row, checksum: member.checksum, sizeBytes: member.sizeBytes,
                  ...(fault === "invalid-utf8" ? { storageKey: (invalidStorageKey = String(row.storageKey)) } : {})
                }));
              }
              if (fault === "object-capacity") return rewrite(rows.map((row, index) => index === 0
                ? { ...row, sizeBytes: 2 * 1024 * 1024 + 1 } : row));
              if (fault === "member-capacity") {
                const padded = [...rows];
                while (padded.length <= 128) padded.push({ ...rows[0]!, memberId: `injected-member-${padded.length}` });
                return rewrite(padded);
              }
              if (fault === "aggregate-capacity") {
                const template = rows[0]!;
                const extra = Array.from({ length: 16 }, (_, index) => ({ ...template,
                  memberId: `injected-member-${index}`, fileId: `injected-file-${index}`,
                  fileVersionId: `injected-version-${index}`, ownedFileId: `injected-file-${index}`,
                  versionId: `injected-version-${index}`, versionFileId: `injected-file-${index}`,
                  sourceName: `injected-${index}.dts`, role: "overlay", sortOrder: 20 + index,
                  checksum: "0".repeat(64), sizeBytes: 2 * 1024 * 1024,
                  storageKey: `injected-key-${index}` }));
                return rewrite([...rows, ...extra]);
              }
            }
          }
          if (fault === "history-mismatch" && text.includes("from parameter_catalog.binding_history_events where id=$1")) {
            observed.hits += 1;
            return rewrite(rows.map((row) => ({ ...row, new_current_value_id: "wrong-successor-value" })));
          }
          if (fault === "typed-value-mismatch" && text.includes("from parameter_catalog.project_parameter_values")
            && text.includes("where id = $1")) {
            observed.hits += 1;
            return rewrite(rows.map((row) => ({ ...row, value: null })));
          }
          if (fault === "native-geometry" && text.includes("as geometry")
            && String(values?.[0]) === successorRevisionId && rows.length > 0) {
            observed.hits += 1;
            return rewrite(rows.map((row) => {
              const geometry = row.geometry as Record<string, unknown>;
              const property = geometry.property as Record<string, unknown>;
              return { ...row, geometry: { ...geometry, property: { ...property, rawText: "forged historical source" } } };
            }));
          }
          return result;
        },
        transaction: tx.transaction.bind(tx)
      } as typeof tx;
      return applyReviewedCanonicalMemberRemoval(injectedReader, faultStorage, mixedReviewer, snapshot,
        value, { invocation: createUserInvocation(mixedReviewer), traceId: value.requestId,
          refusalSink: createTrustedRefusalAuditSink(created.db) });
    });
  }

  async function submitPendingFullSourceCandidate(
    created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>, suffix: string,
  ) {
    const workflow = await getCanonicalSourceWorkflow(created.db, mixedAdmin, {
      projectId: MIXED_PROJECT, fileId: created.baseFileId
    });
    if (!workflow.proofToken) throw new Error("Mixed DTS full-source candidate has no current workflow proof.");
    const source = (await created.db.query<{ storage_key: string; size_bytes: number }>(`
      select storage_key,size_bytes::float8 as size_bytes from project_parameter_file_versions
      where id=$1 and file_id=$2`, [created.baseVersionId, created.baseFileId])).rows[0];
    if (!source) throw new Error("Mixed DTS base source object is unavailable.");
    const original = await created.storage.getBounded!(source.storage_key, source.size_bytes);
    const text = original.toString("utf8");
    if (!text.includes("iin_max = <48>") || !text.includes("iin_max = <60>")) {
      throw new Error("Mixed DTS source candidate targets are not present in the exact base bytes.");
    }
    const bytes = Buffer.from(text.replace("iin_max = <48>", "iin_max = <49>")
      .replace("iin_max = <60>", "iin_max = <61>"), "utf8");
    const prepared = await prepareCanonicalManualSyncBatchCandidate(created.db, created.storage, mixedAdmin, {
      projectId: MIXED_PROJECT, fileId: created.baseFileId, bytes,
      expectedCurrentVersionId: created.baseVersionId, expectedWorkflowProofToken: workflow.proofToken,
      requestId: `member-removal-full-source-${suffix}`
    });
    if (prepared.targets.length < 2) throw new Error("Full-source candidate did not cover two survivor Bindings.");
    const pending = await submitCanonicalBatchValueChange(created.db, created.storage, mixedAdmin, {
      projectId: MIXED_PROJECT, candidateId: prepared.candidateId, expectedProofToken: prepared.proofToken,
      reason: "Review a full DTS source candidate during member-removal fencing",
      assignedToUserId: MIXED_REVIEWER_ID, invocation: createUserInvocation(mixedAdmin),
      requestId: `member-removal-batch-${suffix}`,
      refusalSink: createTrustedRefusalAuditSink(created.db)
    });
    return { prepared, pending };
  }

  async function advanceMixedCatalogBindings(created: Awaited<ReturnType<typeof createMixedDtsJsonFixture>>,
    survivors: CanonicalMemberRemovalProof["cohort"]) {
    const pool = getRootPostgresPool(created.db);
    if (!pool) throw new Error("Mixed Catalog upgrade requires native PostgreSQL");
    const bundle = created.catalogFixture.successorBundle;
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const advanced = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
      expectedCurrent: { id: created.snapshot.release.id, digest: created.snapshot.release.digest },
      expectedTargetDigest: compiled.value.aggregateDigest });
    if (!advanced.ok) throw new Error(JSON.stringify(advanced.error));
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Advanced Catalog snapshot is unavailable");
    expect(snapshot.release.id).toBe(bundle.targetReleaseId);
    for (const entry of survivors.filter((row) => row.format === "dts")) {
      const binding = await loadBindingById(asValueClient(created.db), entry.bindingId);
      if (!binding || !binding.source_occurrence_id) throw new Error("DTS survivor Binding is unavailable");
      const result = await stabilizeCanonicalBinding(pool, {
        snapshot, organizationId: MIXED_ORG, projectId: MIXED_PROJECT,
        logicalNodeId: binding.logical_node_id,
        sourceOccurrenceId: binding.source_occurrence_id,
        registrationId: SubjectRegistrationId(binding.registration_id),
        definitionId: ParameterDefinitionId(binding.definition_id),
        effectiveRevisionId: DefinitionRevisionId("drev_acme_power_iin_max_2"),
        expectedEffectiveRevisionId: DefinitionRevisionId(binding.effective_revision_id)
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value.outcome).toBe("committed");
      expect(result.value.binding.effectiveRevisionId).toBe("drev_acme_power_iin_max_2");
      expect(result.value.binding.catalogRelease.id).toBe(snapshot.release.id);
    }
    return snapshot;
  }

  it("removes one exclusive DTS member and re-pins two DTS plus one JSON survivor from actual successor rows", async () => {
    const created = await fixture();
    const beforeObjects = await objectInventory(created.storageDirectory);
    const frozen = await prepare(created);
    expect(frozen).toMatchObject({ proofVersion: 2, format: "dts", kind: "canonical-member-removal" });
    expect(frozen.cohort).toHaveLength(4);
    const removed = frozen.cohort.filter((entry) => entry.fileId === created.removedFileId);
    const survivors = frozen.cohort.filter((entry) => entry.fileId !== created.removedFileId);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.format).toBe("dts");
    expect(survivors.filter((entry) => entry.format === "dts")).toHaveLength(2);
    expect(survivors.filter((entry) => entry.format === "json")).toHaveLength(1);
    expect(frozen.members.map((member) => member.format).sort()).toEqual(["dts", "dts", "json"]);
    const oldGraph = await mixedEffectiveGraph(created.db, frozen.configRevisionId);
    expect(oldGraph.nodes).toHaveLength(4); // The complete native set includes `/` and all three device nodes.
    expect(oldGraph.properties.some((row) => row.property_name === "status")).toBe(true);
    expect(oldGraph.properties.some((row) => row.property_name === "model")).toBe(true);
    const value = await review(created, frozen);
    const beforeState = await captureMixedState(created, value.requestId);
    const committed = await apply(created, value);
    expect(committed).toMatchObject({ replayed: false });
    const laterSnapshot = await advanceMixedCatalogBindings(created, survivors);
    const laterTips = await created.db.query<{ id: string; effective_revision_id: string; catalog_release_id: string }>(`
      select id,effective_revision_id,catalog_release_id from parameter_catalog.project_parameter_bindings
      where id=any($1::text[]) order by id`, [survivors.filter((entry) => entry.format === "dts").map((entry) => entry.bindingId)]);
    expect(laterTips.rows).toHaveLength(2);
    expect(laterTips.rows.every((row) => row.effective_revision_id === "drev_acme_power_iin_max_2"
      && row.catalog_release_id === laterSnapshot.release.id)).toBe(true);
    const replayed = await apply(created, value);
    expect(replayed).toEqual({ ...committed, replayed: true });

    const afterGraph = await mixedEffectiveGraph(created.db, committed.successorConfigRevisionId);
    const removedEntry = removed[0];
    if (!removedEntry || removedEntry.format !== "dts") throw new Error("Expected one removed DTS Binding.");
    expect(afterGraph.nodes).toEqual(oldGraph.nodes);
    const expectedProperties = oldGraph.properties.filter((row) => !(row.logical_node_id === removedEntry.dtsGeometry.logical.logicalNodeId
      && row.file_id === created.removedFileId && row.property_name === removedEntry.dtsGeometry.property.name));
    expect(afterGraph.properties).toEqual(expectedProperties);
    expect(afterGraph.properties.some((row) => row.property_name === "status")).toBe(true);
    expect(afterGraph.properties.some((row) => row.property_name === "model")).toBe(true);

    const tombstone = (await created.db.query<{ binding_manifest: unknown; successor_binding_manifest: unknown; audit_event_id: string }>(`
      select binding_manifest,successor_binding_manifest,audit_event_id from parameter_catalog.project_source_member_tombstones
      where organization_id=$1 and project_id=$2 and file_id=$3`, [MIXED_ORG, MIXED_PROJECT, created.removedFileId])).rows[0]!;
    const receipts = tombstone.successor_binding_manifest as Array<Record<string, unknown>>;
    expect(receipts.map((row) => row.bindingId)).toEqual(survivors.map((entry) => entry.bindingId).sort());
    expect(receipts.filter((row) => row.format === "dts")).toHaveLength(2);
    expect(receipts.filter((row) => row.format === "json")).toHaveLength(1);
    for (const receipt of receipts) {
      const keys = Object.keys(receipt).sort();
      expect(keys).toEqual(receipt.format === "json"
        ? ["bindingId", "fileId", "fileVersionId", "format", "historyEventId", "newValueId", "oldValueId", "sourcePinId"].sort()
        : ["bindingId", "effectId", "fileId", "fileVersionId", "format", "historyEventId", "logicalNodeRevisionId",
          "newValueId", "nodeOccurrenceId", "oldValueId", "propertyOccurrenceId", "sourcePinId"].sort());
    }
    const audit = (await created.db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where id=$1", [tombstone.audit_event_id])).rows[0]!;
    expect(audit.metadata.successorBindings).toEqual(receipts);
    expect(await objectInventory(created.storageDirectory)).toEqual(beforeObjects);
    const afterState = await captureMixedState(created, value.requestId);
    expect(afterState[0]).toHaveLength(beforeState[0]!.length + 1);
    expect(afterState[1]).toHaveLength(beforeState[1]!.length + 2);
    const currentValues = await created.db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id`, [MIXED_ORG, MIXED_PROJECT]);
    for (const entry of frozen.cohort) {
      const current = currentValues.rows.find((row) => row.id === entry.bindingId)!;
      if (entry.fileId === created.removedFileId) {
        expect(current.current_value_id).toBe(entry.oldValueId);
        expect(await loadOwnedProjectValueSourcePin(created.db, { organizationId: MIXED_ORG,
          projectId: MIXED_PROJECT, bindingId: entry.bindingId, projectValueId: entry.oldValueId }))
          .toMatchObject({ sourcePinId: entry.sourcePinId, configRevisionId: frozen.configRevisionId });
        continue;
      }
      expect(current.current_value_id).not.toBe(entry.oldValueId);
      const receipt = receipts.find((row) => row.bindingId === entry.bindingId)!;
      const pin = await loadOwnedProjectValueSourcePin(created.db, { organizationId: MIXED_ORG,
        projectId: MIXED_PROJECT, bindingId: entry.bindingId, projectValueId: current.current_value_id });
      expect(pin).toMatchObject({ sourcePinId: receipt.sourcePinId, configRevisionId: committed.successorConfigRevisionId,
        fileId: entry.fileId, fileVersionId: entry.fileVersionId, format: entry.format,
        sourceOccurrenceId: entry.sourceOccurrenceId });
      const history = await created.db.query<{ old_current_value_id: string; new_current_value_id: string; success_audit_ref: string }>(`
        select old_current_value_id,new_current_value_id,success_audit_ref from parameter_catalog.binding_history_events where id=$1`,
      [receipt.historyEventId]);
      expect(history.rows).toEqual([{ old_current_value_id: entry.oldValueId,
        new_current_value_id: current.current_value_id, success_audit_ref: tombstone.audit_event_id }]);
      if (entry.format === "dts") {
        expect(pin?.locator).toMatchObject({ kind: "dts-property", propertyOccurrenceId: receipt.propertyOccurrenceId,
          nodeOccurrenceId: receipt.nodeOccurrenceId });
        expect(receipt.propertyOccurrenceId).not.toBe(entry.locator.propertyOccurrenceId);
        expect(receipt.nodeOccurrenceId).not.toBe(entry.locator.nodeOccurrenceId);
      } else {
        const identity = (await created.db.query<{ configuration_instance_id: string; configuration_schema_subject_id: string;
          root_pointer: string; root_pointer_digest: string }>(`select occurrence.configuration_instance_id,
            occurrence.configuration_schema_subject_id,occurrence.root_pointer,occurrence.root_pointer_digest
          from parameter_catalog.project_value_source_pins pin
          join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
          where pin.id=$1`, [receipt.sourcePinId])).rows[0]!;
        expect(identity).toEqual({ configuration_instance_id: (entry as Extract<typeof entry, { format: "json" }>).jsonIdentity.configurationInstanceId,
          configuration_schema_subject_id: (entry as Extract<typeof entry, { format: "json" }>).jsonIdentity.configurationSchemaSubjectId,
          root_pointer: (entry as Extract<typeof entry, { format: "json" }>).jsonIdentity.rootPointer,
          root_pointer_digest: (entry as Extract<typeof entry, { format: "json" }>).jsonIdentity.rootPointerDigest });
      }
    }
    expect((await created.db.query<{ config_set_id: string | null }>(
      "select config_set_id from project_parameter_files where id=$1", [created.removedFileId])).rows[0]!.config_set_id).toBeNull();
    expect((await created.db.query<{ count: number }>(`select count(*)::int as count from public.project_parameter_value_change_requests
      where id=$1 and status='approved' and applied_audit_ref=$2`, [value.requestId, tombstone.audit_event_id])).rows[0]!.count).toBe(1);
    if (process.env.WISEEFF_MEMBER_DTS_PROOF_EXPORT === "1") {
      const bindingIds = frozen.cohort.map((entry) => entry.bindingId);
      const [sourceRows, values, pins, history, requestRows, auditRows] = await Promise.all([
        created.db.query<{ file_id: string; file_name: string; file_version_id: string; storage_key: string; checksum: string; size_bytes: number }>(`
          select file.id as file_id,file.file_name,version.id as file_version_id,version.storage_key,version.checksum,version.size_bytes
          from project_parameter_files file join project_parameter_file_versions version on version.file_id=file.id
          where file.id=any($1::text[]) order by file.id,version.id`, [frozen.members.map((member) => member.fileId)]),
        created.db.query(`select id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,
          value_kind,value_digest,value_state,value from parameter_catalog.project_parameter_values
          where binding_id=any($1::text[]) order by binding_id,id`, [bindingIds]),
        created.db.query(`select pin.id,pin.project_value_id,pin.binding_id,pin.source_occurrence_id,pin.config_revision_id,
          pin.file_id,pin.file_version_id,pin.format,pin.locator,pin.locator_digest,pin.property_occurrence_id,
          occurrence.occurrence_kind,occurrence.logical_node_id,occurrence.configuration_instance_id,
          occurrence.configuration_schema_subject_id,occurrence.root_pointer,occurrence.root_pointer_digest
          from parameter_catalog.project_value_source_pins pin
          join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
          where pin.binding_id=any($1::text[]) order by pin.binding_id,pin.project_value_id`, [bindingIds]),
        created.db.query(`select id,binding_id,old_effective_revision_id,new_effective_revision_id,
          old_current_value_id,new_current_value_id,reason,success_audit_ref,catalog_release_id,applied_request_id
          from parameter_catalog.binding_history_events where binding_id=any($1::text[]) order by binding_id,id`, [bindingIds]),
        created.db.query(`select id,status,submitter_user_id,assigned_to_user_id,reviewer_user_id,member_proof_digest,
          applied_at,applied_audit_ref,applied_source_result from project_parameter_value_change_requests where id=$1`,
        [value.requestId]),
        created.db.query("select id,action,metadata from audit_events where id=$1", [tombstone.audit_event_id])
      ]);
      const sourceObjects = await Promise.all(sourceRows.rows.map(async (row) => {
        const bytes = await created.storage.getBounded!(row.storage_key, Number(row.size_bytes));
        return { fileId: row.file_id, fileName: row.file_name, fileVersionId: row.file_version_id,
          checksum: row.checksum, sizeBytes: Number(row.size_bytes), bytesBase64: bytes.toString("base64"),
          bytesSha256: createHash("sha256").update(bytes).digest("hex") };
      }));
      await writeFile(MIXED_EVIDENCE_EXPORT_PATH, JSON.stringify({
        fixture: { organizationId: MIXED_ORG, projectId: MIXED_PROJECT, configSetId: created.configSetId,
          oldConfigRevisionId: frozen.configRevisionId, successorConfigRevisionId: committed.successorConfigRevisionId,
          removedFileId: created.removedFileId },
        proof: frozen, reviewerDecision: { requestId: value.requestId, submitterUserId: value.submitterUserId,
          reviewerUserId: value.reviewerUserId, decision: value.decision },
        committedResult: committed, replayResult: replayed,
        currentBindingTips: (await created.db.query(`select id,definition_id,effective_revision_id,catalog_release_id,current_value_id
          from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2 order by id`,
        [MIXED_ORG, MIXED_PROJECT])).rows,
        sourceObjects, beforeObjects, afterObjects: await objectInventory(created.storageDirectory),
        oldGraph, successorGraph: afterGraph, tombstone, values: values.rows, pins: pins.rows,
        history: history.rows, request: requestRows.rows, audit: auditRows.rows,
        beforeDatabaseState: beforeState, afterDatabaseState: afterState
      }, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
  }, 120_000);

  it("replays R1 from its immutable source snapshot after legal R2 removes an R1 survivor", async () => {
    const created = await fixture({ historicalSecondOverlay: true });
    const r1Proof = await prepare(created);
    expect(r1Proof.members).toHaveLength(4);
    const r1Survivors = r1Proof.cohort.filter((entry) => entry.fileId !== created.removedFileId);
    expect(r1Survivors.filter((entry) => entry.format === "dts")).toHaveLength(2);
    expect(r1Survivors.filter((entry) => entry.format === "json")).toHaveLength(1);
    const r1Review = await review(created, r1Proof, `member:r1:${randomUUID()}`);
    const r1Result = await apply(created, r1Review);
    expect(r1Result.replayed).toBe(false);

    if (!created.survivorOverlayFileId) throw new Error("Historical replay fixture has no second DTS overlay.");
    const r2Proof = await prepare(created, created.survivorOverlayFileId);
    expect(r2Proof.members).toHaveLength(3);
    expect(r2Proof.cohort.filter((entry) => entry.fileId === created.survivorOverlayFileId)).toHaveLength(1);
    const r2Review = await review(created, r2Proof, `member:r2:${randomUUID()}`);
    const r2Result = await apply(created, r2Review);
    expect(r2Result.replayed).toBe(false);
    expect((await created.db.query<{ config_set_id: string | null }>(
      "select config_set_id from project_parameter_files where id=$1", [created.survivorOverlayFileId])).rows[0]!.config_set_id)
      .toBeNull();

    const beforeReplay = await captureMixedState(created);
    const objectsBeforeReplay = await objectInventory(created.storageDirectory);
    expect(await apply(created, r1Review)).toEqual({ ...r1Result, replayed: true });
    expect(await captureMixedState(created)).toEqual(beforeReplay);
    expect(await objectInventory(created.storageDirectory)).toEqual(objectsBeforeReplay);
  }, 120_000);

  it("fails closed on corrupted historical revision, member, bytes, native and receipt reads", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen, `member:historical-negative:${randomUUID()}`);
    const applied = await apply(created, removal);
    const before = await captureMixedState(created, removal.requestId);
    const objects = await objectInventory(created.storageDirectory);
    const faults: ReplayReaderFault[] = ["foreign-revision", "changed-manifest", "foreign-member", "missing-file",
      "missing-version", "omitted-member", "duplicate-member", "reordered-members", "version-mismatch",
      "bad-checksum", "bad-size", "missing-object", "invalid-utf8", "object-capacity", "member-capacity",
      "aggregate-capacity", "metadata-capacity", "native-geometry", "history-mismatch", "typed-value-mismatch"];
    for (const fault of faults) {
      const observed = { hits: 0 };
      const outcome = await replayWithReaderFault(created, removal, applied.successorConfigRevisionId, fault, observed)
        .then(() => null, (error: unknown) => error);
      expect(outcome, `${fault} should reject`).not.toBeNull();
      expect(outcome, fault).toMatchObject({ code: "CONFLICT" });
      expect(observed.hits, fault).toBeGreaterThan(0);
      expect(await captureMixedState(created, removal.requestId), fault).toEqual(before);
      expect(await objectInventory(created.storageDirectory), fault).toEqual(objects);
    }
  }, 120_000);

  it("checks current reviewer permission before returning immutable replay", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen, `member:historical-permission:${randomUUID()}`);
    await apply(created, removal);
    const limitedReviewer = makeTestAuthContext({ userId: MIXED_REVIEWER_ID, organizationId: MIXED_ORG,
      permissions: ["parameter:view", "parameter:edit"], roles: [{ roleId: "software-committer", projectId: MIXED_PROJECT }] });
    const before = await captureMixedState(created, removal.requestId);
    const objects = await objectInventory(created.storageDirectory);
    await expect(apply(created, removal, limitedReviewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await captureMixedState(created, removal.requestId)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("rejects at prepare when removing an overlay would expose a base fallback", async () => {
    const created = await fixture({ chargerBaseFallback: true });
    const before = await captureMixedState(created);
    const objects = await objectInventory(created.storageDirectory);
    await expect(prepare(created)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(created)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
    expect((await created.db.query<{ count: number }>(`select count(*)::int as count
      from public.project_parameter_value_change_requests where organization_id=$1 and project_id=$2
        and request_kind='member-removal'`, [MIXED_ORG, MIXED_PROJECT])).rows[0]?.count).toBe(0);
  }, 120_000);

  it("rejects a property paired with another real node and parent from the same source file", async () => {
    const created = await fixture({ geometryNestedNode: true });
    const before = await captureMixedState(created);
    const objects = await objectInventory(created.storageDirectory);
    let injected = false;
    await expect(created.db.transaction(async (tx) => {
      const injectedReader = {
        query: async <Row,>(text: string, values?: unknown[]) => {
          const result = await tx.query<Row>(text, values);
          if (!text.includes("as geometry") || !text.includes("from public.dts_occurrence_effects effect")) return result;
          type GeometryRow = { fileId: string; fileVersionId: string; propertyName: string; nodeLocator: string;
            geometry: { property: { span: readonly number[] }; node: unknown; parent: unknown } };
          const rows = result.rows as unknown as GeometryRow[];
          const target = rows.find((row) => row.fileId === created.baseFileId && row.propertyName === "iin_max"
            && row.nodeLocator === "/device@1");
          const alternate = rows.find((row) => row.fileId === created.baseFileId && row.propertyName === "status"
            && row.nodeLocator === "/device@0/monitor@0");
          if (!target || !alternate || target.fileVersionId !== alternate.fileVersionId) {
            throw new Error("Same-file physical ownership injection could not find two exact native rows.");
          }
          const altered = rows.map((row) => row === target ? { ...row, geometry: {
            ...row.geometry, node: alternate.geometry.node, parent: alternate.geometry.parent
          } } : row);
          injected = true;
          return { ...result, rows: altered as unknown as Row[] };
        }
      } as typeof tx;
      return prepareCanonicalMemberRemoval(injectedReader, created.storage, mixedAdmin, {
        projectId: MIXED_PROJECT, configSetId: created.configSetId, fileId: created.removedFileId,
        invocation: createUserInvocation(mixedAdmin), traceId: `prepare:misowned:${randomUUID()}`,
        refusalSink: createTrustedRefusalAuditSink(created.db)
      });
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(injected).toBe(true);
    expect(await captureMixedState(created)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("refuses an unsubmitted removed-member draft without changing its row or source objects", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removed = frozen.cohort.find((entry) => entry.fileId === created.removedFileId)!;
    const draft = await createCanonicalValueDraft(created.db, mixedAdmin, {
      projectId: MIXED_PROJECT, bindingId: removed.bindingId, targetValue: {
        kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "37", value: "37" }]]
      }, reason: "Keep an unsubmitted source draft", baseRevisionId: frozen.configRevisionId,
      baseCurrentValueId: removed.oldValueId
    }, { objectStore: created.storage, invocation: createUserInvocation(mixedAdmin), requestId: "draft:removed-dts",
      refusalSink: createTrustedRefusalAuditSink(created.db) });
    const storedDraft = (await created.db.query("select * from project_parameter_value_drafts where id=$1", [draft.id])).rows[0];
    const objects = await objectInventory(created.storageDirectory);
    await expect(prepare(created)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await created.db.query("select * from project_parameter_value_drafts where id=$1", [draft.id])).rows[0]).toEqual(storedDraft);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("blocks a pending single change before removal preparation", async () => {
    const created = await fixture();
    const initial = await created.db.query<{ binding_id: string; current_value_id: string; config_revision_id: string }>(`
      select binding.id as binding_id,binding.current_value_id,pin.config_revision_id
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.project_id=$2 and pin.file_id=$3`,
    [MIXED_ORG, MIXED_PROJECT, created.baseFileId]);
    const survivor = initial.rows[0]!;
    const draft = await createCanonicalValueDraft(created.db, mixedAdmin, {
      projectId: MIXED_PROJECT, bindingId: survivor.binding_id,
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "49", value: "49" }]] },
      reason: "Reserve a current DTS value", baseRevisionId: survivor.config_revision_id,
      baseCurrentValueId: survivor.current_value_id
    }, { objectStore: created.storage, invocation: createUserInvocation(mixedAdmin), requestId: "draft:pending-dts",
      refusalSink: createTrustedRefusalAuditSink(created.db) });
    const pending = await submitCanonicalValueChange(created.db, mixedAdmin, { projectId: MIXED_PROJECT,
      draftId: draft.id, assignedToUserId: MIXED_REVIEWER_ID, invocation: createUserInvocation(mixedAdmin),
      requestId: "single:pending-dts", refusalSink: createTrustedRefusalAuditSink(created.db) });
    await expect(prepare(created)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await created.db.query<{ status: string }>("select status from project_parameter_value_change_requests where id=$1",
      [pending.id])).rows).toEqual([{ status: "pending" }]);
  }, 120_000);

  it("rechecks a single request inserted after removal preparation before committing", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen);
    const survivor = frozen.cohort.find((entry) => entry.fileId !== created.removedFileId && entry.format === "dts")!;
    const draft = await createCanonicalValueDraft(created.db, mixedAdmin, {
      projectId: MIXED_PROJECT, bindingId: survivor.bindingId,
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "49", value: "49" }]] },
      reason: "Race a single DTS value review", baseRevisionId: frozen.configRevisionId,
      baseCurrentValueId: survivor.oldValueId
    }, { objectStore: created.storage, invocation: createUserInvocation(mixedAdmin), requestId: "draft:race-dts",
      refusalSink: createTrustedRefusalAuditSink(created.db) });
    const pending = await submitCanonicalValueChange(created.db, mixedAdmin, { projectId: MIXED_PROJECT,
      draftId: draft.id, assignedToUserId: MIXED_REVIEWER_ID, invocation: createUserInvocation(mixedAdmin),
      requestId: "single:race-dts", refusalSink: createTrustedRefusalAuditSink(created.db) });
    const before = await captureMixedState(created, removal.requestId);
    await expect(apply(created, removal)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(created, removal.requestId)).toEqual(before);
    expect((await created.db.query<{ status: string }>("select status from project_parameter_value_change_requests where id=$1",
      [pending.id])).rows).toEqual([{ status: "pending" }]);
  }, 120_000);

  it("blocks another pending member review at prepare and approval", async () => {
    const atPrepare = await fixture();
    const frozenAtPrepare = await prepare(atPrepare);
    const pendingAtPrepare = await review(atPrepare, frozenAtPrepare, `member:pending:prepare:${randomUUID()}`);
    const beforePrepare = await captureMixedState(atPrepare, pendingAtPrepare.requestId);
    const objectsBeforePrepare = await objectInventory(atPrepare.storageDirectory);
    await expect(prepare(atPrepare)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(atPrepare, pendingAtPrepare.requestId)).toEqual(beforePrepare);
    expect(await objectInventory(atPrepare.storageDirectory)).toEqual(objectsBeforePrepare);

    const atApproval = await fixture();
    const frozenAtApproval = await prepare(atApproval);
    const ownReview = await review(atApproval, frozenAtApproval, `member:own:${randomUUID()}`);
    const otherReview = await review(atApproval, frozenAtApproval, `member:other:${randomUUID()}`);
    const beforeApproval = await captureMixedState(atApproval, ownReview.requestId);
    const objectsBeforeApproval = await objectInventory(atApproval.storageDirectory);
    await expect(apply(atApproval, ownReview)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(atApproval, ownReview.requestId)).toEqual(beforeApproval);
    expect(await objectInventory(atApproval.storageDirectory)).toEqual(objectsBeforeApproval);
    const memberStatuses = (await atApproval.db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=any($1::text[]) order by id",
      [[ownReview.requestId, otherReview.requestId]])).rows;
    expect(memberStatuses).toHaveLength(2);
    expect(memberStatuses.every((row) => row.status === "pending")).toBe(true);
  }, 120_000);

  it("blocks a pending full-source batch candidate at prepare and approval", async () => {
    const atPrepare = await fixture();
    const pendingAtPrepare = await submitPendingFullSourceCandidate(atPrepare, randomUUID());
    const beforePrepare = await captureMixedState(atPrepare, pendingAtPrepare.pending.id);
    const objectsBeforePrepare = await objectInventory(atPrepare.storageDirectory);
    await expect(prepare(atPrepare)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(atPrepare, pendingAtPrepare.pending.id)).toEqual(beforePrepare);
    expect(await objectInventory(atPrepare.storageDirectory)).toEqual(objectsBeforePrepare);

    const atApproval = await fixture();
    const frozen = await prepare(atApproval);
    const ownReview = await review(atApproval, frozen, `member:batch-race:${randomUUID()}`);
    const pendingAtApproval = await submitPendingFullSourceCandidate(atApproval, randomUUID());
    const beforeApproval = await captureMixedState(atApproval, ownReview.requestId);
    const objectsBeforeApproval = await objectInventory(atApproval.storageDirectory);
    await expect(apply(atApproval, ownReview)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(atApproval, ownReview.requestId)).toEqual(beforeApproval);
    expect(await objectInventory(atApproval.storageDirectory)).toEqual(objectsBeforeApproval);
    const batchStatuses = (await atApproval.db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=any($1::text[]) order by id",
      [[ownReview.requestId, pendingAtApproval.pending.id]])).rows;
    expect(batchStatuses).toHaveLength(2);
    expect(batchStatuses.every((row) => row.status === "pending")).toBe(true);
  }, 120_000);

  it("rechecks a removed-member draft created after prepare before committing", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen, `member:draft-race:${randomUUID()}`);
    const removed = frozen.cohort.find((entry) => entry.fileId === created.removedFileId)!;
    const draft = await createCanonicalValueDraft(created.db, mixedAdmin, {
      projectId: MIXED_PROJECT, bindingId: removed.bindingId,
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "37", value: "37" }]] },
      reason: "Race an unsubmitted removed-member draft", baseRevisionId: frozen.configRevisionId,
      baseCurrentValueId: removed.oldValueId
    }, { objectStore: created.storage, invocation: createUserInvocation(mixedAdmin), requestId: `draft:race:${randomUUID()}`,
      refusalSink: createTrustedRefusalAuditSink(created.db) });
    const before = await captureMixedState(created, removal.requestId);
    const objects = await objectInventory(created.storageDirectory);
    await expect(apply(created, removal)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureMixedState(created, removal.requestId)).toEqual(before);
    expect((await created.db.query<{ id: string }>("select id from project_parameter_value_drafts where id=$1", [draft.id])).rows)
      .toEqual([{ id: draft.id }]);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("rolls back earlier successor writes when a later survivor CAS loses its current tip", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen, `member:partial-cas:${randomUUID()}`);
    const survivorIds = frozen.cohort.filter((entry) => entry.fileId !== created.removedFileId)
      .map((entry) => entry.bindingId);
    expect(survivorIds.length).toBeGreaterThanOrEqual(2);
    const before = await captureMixedState(created, removal.requestId);
    const objects = await objectInventory(created.storageDirectory);
    let successfulBindingIds: string[] = [];
    let rejectedBindingId: string | undefined;
    let rejectedCasAttempts = 0;
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(created.db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    await expect(created.db.transaction((tx) => {
      const casFailure = {
        query: async <Row,>(text: string, values?: unknown[]) => {
          const bindingId = String(values?.[0]);
          if (text.includes("set current_value_id = $3") && survivorIds.includes(bindingId)
            && successfulBindingIds.length > 0 && bindingId !== successfulBindingIds[0]) {
            rejectedBindingId = bindingId;
            rejectedCasAttempts += 1;
            return { rows: [], rowCount: 0 };
          }
          const result = await tx.query<Row>(text, values);
          if (text.includes("set current_value_id = $3") && survivorIds.includes(bindingId)
            && result.rowCount === 1 && !successfulBindingIds.includes(bindingId)) {
            successfulBindingIds = [...successfulBindingIds, bindingId];
          }
          return result;
        }
      } as typeof tx;
      return applyReviewedCanonicalMemberRemoval(casFailure, created.storage, mixedReviewer, snapshot,
        removal, { invocation: createUserInvocation(mixedReviewer), traceId: removal.requestId,
          refusalSink: createTrustedRefusalAuditSink(created.db) });
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(successfulBindingIds).toHaveLength(1);
    expect(survivorIds).toContain(rejectedBindingId);
    expect(rejectedBindingId).not.toBe(successfulBindingIds[0]);
    expect(rejectedCasAttempts).toBeGreaterThanOrEqual(1);
    expect(await captureMixedState(created, removal.requestId)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("rolls back the complete mixed successor when a deferred tombstone constraint fails at commit", async () => {
    const created = await fixture();
    const frozen = await prepare(created);
    const removal = await review(created, frozen, `member:deferred-rollback:${randomUUID()}`);
    const before = await captureMixedState(created, removal.requestId);
    const objects = await objectInventory(created.storageDirectory);
    await created.db.query(`create function public.t906_dts_member_deferred_fail() returns trigger
      language plpgsql as $$ begin raise exception 'injected-dts-deferred-commit-failure'; end $$`);
    await created.db.query(`create constraint trigger t906_dts_member_deferred_fail after insert
      on parameter_catalog.project_source_member_tombstones deferrable initially deferred
      for each row execute function public.t906_dts_member_deferred_fail()`);
    try {
      await expect(apply(created, removal)).rejects.toThrow("injected-dts-deferred-commit-failure");
    } finally {
      await created.db.query("drop trigger t906_dts_member_deferred_fail on parameter_catalog.project_source_member_tombstones");
      await created.db.query("drop function public.t906_dts_member_deferred_fail()");
    }
    expect(await captureMixedState(created, removal.requestId)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
  }, 120_000);

  it("records a trusted source-permission refusal without changing the mixed cohort", async () => {
    const created = await fixture();
    const limited = makeTestAuthContext({ userId: MIXED_REVIEWER_ID, organizationId: MIXED_ORG,
      permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: MIXED_PROJECT }] });
    const traceId = `member-refusal:${randomUUID()}`;
    const before = await captureMixedState(created, traceId);
    const objects = await objectInventory(created.storageDirectory);
    await expect(created.db.transaction((tx) => prepareCanonicalMemberRemoval(tx, created.storage, limited, {
      projectId: MIXED_PROJECT, configSetId: created.configSetId, fileId: created.removedFileId,
      invocation: createUserInvocation(limited), traceId,
      refusalSink: createTrustedRefusalAuditSink(created.db)
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await captureMixedState(created, traceId)).toEqual(before);
    expect(await objectInventory(created.storageDirectory)).toEqual(objects);
    const refusal = (await created.db.query<{ kind: string; action: string; severity: string; target_type: string;
      target_id: string; trace_id: string; metadata: Record<string, unknown> }>(`
      select kind,action,severity,target_type,target_id,trace_id,metadata from audit_events where trace_id=$1`,
    [traceId])).rows;
    expect(refusal).toHaveLength(1);
    expect(refusal).toMatchObject([{
      kind: "parameter-source-permission-denied", action: "deny", severity: "High",
      target_type: "project-parameter-file", target_id: created.removedFileId, trace_id: traceId,
      metadata: { code: "parameter-source-permission-denied", operation: "canonical member removal prepare", initiator: "user" }
    }]);
  }, 120_000);
});
const reviewer = makeTestAuthContext({
  userId: reviewerId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId }]
});
const foreignAdmin = makeTestAuthContext({
  userId: "user-906-member-foreign", organizationId: "org-906-member-foreign",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

describe("#906 reviewed canonical member removal cohort", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let configSetId: string;
  let removedFileId: string;
  let siblingFileId: string;

  async function submitReview(review: ReviewedCanonicalMemberRemoval): Promise<void> {
    await db.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
       assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,
       member_proof_digest,member_frozen_proof)
      values ($1,$2,$3,'member-removal','Remove source member','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [review.requestId, organizationId, projectId, review.submitterUserId,
      review.reviewerUserId, review.frozen.fileId, review.frozen.configSetId,
      review.frozen.fileVersionId, review.frozen.proofDigest, JSON.stringify(review.frozen)]);
  }

  async function cohortState(frozen: CanonicalMemberRemovalProof) {
    const pool = getRootPostgresPool(db)!;
    const bindings = await Promise.all(frozen.cohort.map(async (entry) => {
      const binding = await loadBindingById(asValueClient(db), entry.bindingId);
      expect(binding).toMatchObject({ organization_id: organizationId, project_id: projectId,
        source_occurrence_id: entry.sourceOccurrenceId });
      const values = await loadHistoryByRevision(asValueClient(db), entry.bindingId, entry.effectiveRevisionId);
      const history = await readCanonicalBindingChangeHistory(pool, {
        organizationId, projectId, bindingId: entry.bindingId, limit: 200
      });
      expect(history?.length).toBeLessThan(200);
      return {
        binding,
        values,
        pins: await Promise.all(values.map((value) => loadOwnedProjectValueSourcePin(db, {
          organizationId, projectId, bindingId: entry.bindingId, projectValueId: value.id
        }))),
        history
      };
    }));
    const revisions = (await db.query<{ count: number }>(
      "select count(*)::int as count from dts_config_revisions where config_set_id=$1", [configSetId]
    )).rows[0]!.count;
    return { bindings, revisions };
  }

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-member-cohort");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-member-cohort-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 cohort')", [organizationId]);
    await db.query("insert into organizations(id,name) values ($1,'#906 foreign')", [foreignAdmin.organization.id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [adminId, organizationId, reviewerId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'foreign','Admin',true)", [foreignAdmin.user.id, foreignAdmin.organization.id]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Member cohort','M906','initialized')", [projectId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-member-admin',$1,$2,null,'admin'),('role-906-member-reviewer',$3,$2,$4,'software-committer')", [adminId, organizationId, reviewerId, projectId]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_member_cohort", schemaId });
    configSetId = (await createConfigSet(db, admin, { projectId, name: "two members" })).id;
    const removed = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "removed.json", bytes: Buffer.from('{"limit":36}\n')
    });
    const sibling = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "sibling.json", bytes: Buffer.from('{"limit":48,"other":{"limit":49}}\n')
    });
    removedFileId = removed.file.id;
    siblingFileId = sibling.file.id;
    await addConfigSetFile(db, admin, { configSetId, fileId: removedFileId, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId, fileId: siblingFileId, role: "overlay", sortOrder: 1 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    for (const [fileId, fileVersionId] of [[removedFileId, removed.version.id], [siblingFileId, sibling.version.id]]) {
      await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId, configSetId, fileId, fileVersionId, configurationSchemaId: schemaId,
        rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `register:${fileId}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    }
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId, configSetId, fileId: siblingFileId, fileVersionId: sibling.version.id,
      configurationSchemaId: schemaId, rootPointer: "/other",
      mappings: [{ definitionId, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin), requestId: "register:sibling-other",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("records the current 0167 failure when a removed member has an active sibling", async () => {
    const before = (await db.query<{
      file_id: string; binding_id: string; value_id: string; pin_id: string;
      config_revision_id: string; file_version_id: string;
    }>(`select occurrence.file_id,binding.id as binding_id,binding.current_value_id as value_id,
        pin.id as pin_id,pin.config_revision_id,pin.file_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id
        and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
      order by occurrence.file_id,binding.id`, [organizationId, projectId, configSetId])).rows;
    expect(before.map((row) => row.file_id).sort())
      .toEqual([removedFileId, siblingFileId, siblingFileId].sort());
    const removed = before.find((row) => row.file_id === removedFileId)!;
    const auditId = randomUUID();
    const tombstoneId = randomUUID();
    const manifest = [{ bindingId: removed.binding_id, valueId: removed.value_id, sourcePinId: removed.pin_id }];
    await expect(db.transaction(async (tx) => {
      await writeAuditEventInTx(asAuditTx(tx), admin, { requestId: tombstoneId }, {
        id: auditId, app: "parameters", kind: "parameter-topology-governance",
        action: "source-member-removed", severity: "Medium", projectId,
        targetType: "project-parameter-file", targetId: removedFileId,
        metadata: { tombstoneId, configSetId, configRevisionId: removed.config_revision_id,
          fileVersionId: removed.file_version_id, bindings: manifest }
      });
      await tx.query(`insert into parameter_catalog.project_source_member_tombstones
        (id,organization_id,project_id,config_set_id,file_id,config_revision_id,
         file_version_id,binding_manifest,audit_event_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [tombstoneId, organizationId, projectId, configSetId, removedFileId,
        removed.config_revision_id, removed.file_version_id, JSON.stringify(manifest), auditId]);
      await tx.query(`update project_parameter_files set config_set_id=null,
        config_set_role=null,config_set_sort_order=0 where id=$1`, [removedFileId]);
    })).rejects.toThrow(/exact source cohort/);
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from parameter_catalog.project_source_member_tombstones where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(
      "select config_set_id from project_parameter_files where id=$1", [removedFileId]
    )).rows[0]!.config_set_id).toBe(configSetId);
    expect(await Promise.all(before.map(async (row) => ({
      id: row.binding_id,
      current_value_id: (await loadBindingById(asValueClient(db), row.binding_id))?.current_value_id
    })))).toEqual(before.map((row) => ({ id: row.binding_id, current_value_id: row.value_id })));
    expect((await db.query<{ id: string }>("select id from audit_events where id=$1", [auditId])).rows).toEqual([]);
  }, 120_000);

  it("keeps runtime roles away from direct tombstone writes and refuses a forged audited insert", async () => {
    const privileges = (await db.query<{ direct_insert: boolean; narrow_execute: boolean }>(`
      select has_table_privilege('parameter_governance_writer_role',
        'parameter_catalog.project_source_member_tombstones','INSERT') as direct_insert,
        has_function_privilege('parameter_governance_writer_role',
        'parameter_catalog.insert_reviewed_member_tombstone(text,text,text,text,text,text,text,jsonb,text,jsonb,text)',
        'EXECUTE') as narrow_execute`)).rows[0]!;
    expect(privileges).toEqual({ direct_insert: false, narrow_execute: true });
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role parameter_governance_writer_role");
      await tx.query("insert into parameter_catalog.project_source_member_tombstones(id) values ('forged')");
    })).rejects.toMatchObject({ code: "42501" });
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role parameter_governance_writer_role");
      await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
      [randomUUID(), organizationId, projectId, configSetId, removedFileId,
        randomUUID(), randomUUID(), "[]", randomUUID(), "[]", randomUUID()]);
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects incomplete frozen review identities at the PostgreSQL boundary", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-incomplete-review",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    for (const [digest, proof] of [
      [null, frozen],
      [frozen.proofDigest, { ...frozen, members: undefined, cohort: undefined }],
      [frozen.proofDigest, { ...frozen, organizationId: undefined }]
    ] as const) {
      await expect(db.query(`insert into public.project_parameter_value_change_requests
        (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
         assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,
         member_proof_digest,member_frozen_proof)
        values ($1,$2,$3,'member-removal','Incomplete proof','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [randomUUID(), organizationId, projectId, adminId, reviewerId,
        frozen.fileId, frozen.configSetId, frozen.fileVersionId, digest,
        JSON.stringify(proof)])).rejects.toMatchObject({ code: "23514" });
    }
  }, 120_000);

  it("rejects stale source, self review and other tenants before any cohort write", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-stale",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const review = { requestId: "reviewed-member-stale", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const apply = (auth: typeof reviewer, currentReview = review) => db.transaction((tx) =>
      applyReviewedCanonicalMemberRemoval(tx, storage, auth, snapshot, currentReview, {
        invocation: createUserInvocation(auth), traceId: currentReview.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    await expect(apply(reviewer, { ...review, frozen: { ...frozen, proofDigest: '0'.repeat(64) } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(apply(admin))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(apply(foreignAdmin)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, foreignAdmin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(foreignAdmin), traceId: "foreign-member-prepare",
      refusalSink: createTrustedRefusalAuditSink(db)
    }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const oldVersion = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(`
      select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index
      from project_parameter_file_versions where id=$1`, [frozen.fileVersionId])).rows[0]!;
    const drift = await insertFileVersion(db, {
      id: randomUUID(), fileId: removedFileId, storageKey: oldVersion.storage_key,
      checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
      parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload", createdByUserId: adminId
    });
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, drift.id]);
    try {
      await expect(apply(reviewer)).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, frozen.fileVersionId]);
    }
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ status: string; applied_at: Date | null }>(`
      select status,applied_at from project_parameter_value_change_requests where id=$1`,
    [review.requestId])).rows).toEqual([{ status: "pending", applied_at: null }]);
  }, 120_000);

  it("rolls back every sibling Value, pin, history, revision, tombstone and audit on a later fault", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const review = { requestId: "reviewed-member-fault", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const before = await cohortState(frozen);
    await expect(db.transaction(async (tx) => {
      await applyReviewedCanonicalMemberRemoval(tx, storage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      });
      throw new Error("injected-member-fault");
    })).rejects.toThrow("injected-member-fault");
    expect(await cohortState(frozen)).toEqual(before);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from audit_events where metadata->>'reviewRequestId'=$1`,
    [review.requestId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(`
      select config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows[0]!.config_set_id)
      .toBe(configSetId);
    const sibling = frozen.cohort.find((row) => row.fileId === siblingFileId)!;
    expect((await loadBindingById(asValueClient(db), sibling.bindingId))?.current_value_id)
      .toBe(sibling.oldValueId);
  }, 120_000);

  it("rolls back the complete cohort when PostgreSQL rejects the tombstone insert", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-pg-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const requestId = "reviewed-member-pg-fault";
    await submitReview({ requestId, submitterUserId: adminId, reviewerUserId: reviewerId,
      decision: "approve", frozen });
    const before = await cohortState(frozen);
    await db.query(`create function public.t906_member_tombstone_fail() returns trigger
      language plpgsql as $$ begin raise exception 'injected-member-tombstone-failure'; end $$`);
    await db.query(`create trigger t906_member_tombstone_fail before insert
      on parameter_catalog.project_source_member_tombstones for each row
      execute function public.t906_member_tombstone_fail()`);
    try {
      await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
        tx, storage, reviewer, snapshot,
        { requestId, submitterUserId: adminId, reviewerUserId: reviewerId,
          decision: "approve", frozen },
        { invocation: createUserInvocation(reviewer), traceId: requestId,
          refusalSink: createTrustedRefusalAuditSink(db) }
      ))).rejects.toThrow("injected-member-tombstone-failure");
    } finally {
      await db.query("drop trigger t906_member_tombstone_fail on parameter_catalog.project_source_member_tombstones");
      await db.query("drop function public.t906_member_tombstone_fail()");
    }
    expect(await cohortState(frozen)).toEqual(before);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from audit_events where metadata->>'reviewRequestId'=$1`,
    [requestId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(`
      select config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows[0]!.config_set_id)
      .toBe(configSetId);
  }, 120_000);

  it("leaves the reviewed request and source cohort untouched when object storage fails", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-storage-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const review = { requestId: "reviewed-member-storage-fault", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const before = await cohortState(frozen);
    const cohortQuery = `select binding.id,binding.current_value_id,pin.id as pin_id,
        pin.config_revision_id,pin.file_version_id,file.config_set_id,file.current_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin
        on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      join public.project_parameter_files file on file.id=occurrence.file_id
      where binding.organization_id=$1 and binding.project_id=$2
        and occurrence.config_set_id=$3 order by binding.id`;
    const cohortBefore = (await db.query(cohortQuery,
      [organizationId, projectId, configSetId])).rows;
    expect(cohortBefore).toHaveLength(3);
    let reads = 0;
    const failingStorage = { ...storage, getBounded: async (key: string, maxBytes: number) => {
      if (++reads === 2) throw new Error("injected-object-store-read-failure");
      return storage.getBounded!(key, maxBytes);
    } };
    await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, failingStorage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(reads).toBe(2);
    expect(await cohortState(frozen)).toEqual(before);
    expect((await db.query(cohortQuery,
      [organizationId, projectId, configSetId])).rows).toEqual(cohortBefore);
    expect((await db.query<{ status: string; applied_at: Date | null }>(`
      select status,applied_at from project_parameter_value_change_requests where id=$1`,
    [review.requestId])).rows).toEqual([{ status: "pending", applied_at: null }]);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
  }, 120_000);

  it("commits one reviewed removal with every surviving Value, pin, history and tombstone", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-removal",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    expect(frozen.cohort).toHaveLength(3);
    const review = { requestId: "reviewed-member-removal-1", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const otherReview = { requestId: "reviewed-member-other-author", submitterUserId: reviewerId,
      reviewerUserId: adminId, decision: "approve" as const, frozen };
    await submitReview(otherReview);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const apply = () => db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, storage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }
    ));
    const result = await apply();
    expect(result).toMatchObject({ requestId: review.requestId, replayed: false });
    expect(await apply()).toEqual({ ...result, replayed: true });
    await expect(db.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
       assigned_to_user_id,reviewer_user_id,member_file_id,member_config_set_id,
       member_file_version_id,member_proof_digest,member_frozen_proof,applied_at,
       apply_outcome,applied_audit_ref,applied_file_version_ids,applied_source_result)
      values ($1,$2,$3,'member-removal','Missing version receipt','approved',$4,$5,$5,
        $6,$7,$8,$9,$10::jsonb,now(),'committed',$11,null,$12::jsonb)`,
    [randomUUID(), organizationId, projectId, adminId, reviewerId, frozen.fileId,
      frozen.configSetId, frozen.fileVersionId, frozen.proofDigest,
      JSON.stringify(frozen), randomUUID(), JSON.stringify(result)]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await db.query<{ status: string; applied_audit_ref: string | null }>(`
      select status,applied_audit_ref from project_parameter_value_change_requests where id=$1`,
    [otherReview.requestId])).rows).toEqual([{ status: "pending", applied_audit_ref: null }]);
    await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, storage, admin, snapshot, otherReview, {
        invocation: createUserInvocation(admin), traceId: otherReview.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }))).rejects.toMatchObject({ code: "CONFLICT" });
    const current = (await db.query<{ file_id: string; id: string; current_value_id: string;
      config_revision_id: string; file_version_id: string }>(`
      select occurrence.file_id,binding.id,binding.current_value_id,
        pin.config_revision_id,pin.file_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin
        on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3`,
    [organizationId, projectId, configSetId])).rows;
    expect(current).toHaveLength(2);
    for (const binding of current) {
      const old = frozen.cohort.find((row) => row.bindingId === binding.id)!;
      expect(binding).toMatchObject({ file_id: siblingFileId,
        config_revision_id: result.successorConfigRevisionId,
        file_version_id: old.fileVersionId });
      expect(binding.current_value_id).not.toBe(old.oldValueId);
      const history = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!, {
        organizationId, projectId, bindingId: binding.id
      });
      expect(history?.filter((event) => event.newCurrentValueId === binding.current_value_id)).toHaveLength(1);
      const values = await loadHistoryByRevision(asValueClient(db), binding.id, old.effectiveRevisionId);
      const pins = await Promise.all(values.map((value) => loadOwnedProjectValueSourcePin(db, {
        organizationId, projectId, bindingId: binding.id, projectValueId: value.id
      })));
      expect(pins.filter(Boolean)).toHaveLength(2);
      expect(pins.find((pin) => pin?.projectValueId === old.oldValueId)).toMatchObject({
        sourcePinId: old.sourcePinId, fileId: siblingFileId, fileVersionId: old.fileVersionId
      });
      expect(pins.find((pin) => pin?.projectValueId === binding.current_value_id)).toMatchObject({
        configRevisionId: result.successorConfigRevisionId,
        fileId: siblingFileId, fileVersionId: old.fileVersionId
      });
    }
    expect((await db.query<{ id: string; config_set_id: string | null }>(`
      select id,config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows)
      .toEqual([{ id: removedFileId, config_set_id: null }]);
    expect(await loadBindingById(asValueClient(db),
      frozen.cohort.find((row) => row.fileId === removedFileId)!.bindingId)).not.toBeNull();
  }, 120_000);
});
