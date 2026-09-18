import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { NormalizedConfigurationSchemaId, type CatalogSnapshot } from "../catalog-kernel/interface";
import { stabilizeCanonicalBinding, readSourceRegistrationAgreement, type Binding } from "../parameter-bindings/binding";
import { writebackProtectedReference } from "../parameter-bindings/adapters";
import { asValueClient } from "../parameter-bindings/catalogProjectValueSync";
import { ParameterDefinitionId, SubjectRegistrationId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { canAdminParameters } from "../parameter-kernel/policy";
import { insertConfigRevision, insertConfigRevisionMembers } from "../parameter-topology/repository";
import { parseJsonSource, readJsonSourceValue } from "./jsonSource";
import type { ConfigSetRole } from "./types";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { loadCanonicalSourceCohort, loadCanonicalSourceSnapshot, requireCanonicalUserInvocation, recordCanonicalPermissionRefusal } from "./canonicalSource";
import { normalizeManifestLogicalPath, normalizePersistedManifest } from "../parameter-topology/configRevisionManifest";
import type { ConfigRevisionManifestMember } from "../parameter-topology/types";
import { discoverCurrentSourceRevisionPins, loadSourceValueReplay } from "../parameter-bindings/values";
import { loadExactSourceRevisionForProof, lockExactSourceRevisionsForProof, rethrowSourceTransactionError } from "./sourceVersion";

export async function registerCanonicalJsonSource(
  db: Queryable,
  storage: ObjectStore,
  auth: AuthContext,
  snapshot: CatalogSnapshot,
  input: {
    projectId: string; configSetId: string; fileId: string; fileVersionId: string;
    configurationSchemaId: string; rootPointer: string;
    mappings: Array<{ definitionId: string; pointer: string }>;
    invocation: TrustedInvocationContext; requestId: string; refusalSink: TrustedRefusalAuditSink;
  },
): Promise<{ bindings: Binding[] }> {
  try {
  const operation = { projectId: input.projectId,operation: "JSON source registration",targetType: "project-parameter-file",targetId: input.fileId };
  const invocation = await requireCanonicalUserInvocation(auth,input,operation);
  if (!canAdminParameters(auth)) {
    await recordCanonicalPermissionRefusal(input,operation);
    throw new ApiError("FORBIDDEN", "Parameter file administration is required.");
  }
  if (!input.requestId.trim() || input.mappings.length === 0 || new Set(input.mappings.map((mapping) => mapping.definitionId)).size !== input.mappings.length) {
    throw new ApiError("VALIDATION_FAILED", "Explicit unique Definition mappings are required.");
  }
  const subject = snapshot.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "absent" }, configurationSchemaIds: [NormalizedConfigurationSchemaId(input.configurationSchemaId)] });
  if (subject.status !== "matched" || subject.subject.kind !== "configuration-schema") throw new ApiError("CONFLICT", "A published ConfigurationSchema must be selected explicitly.");
  const definitions = input.mappings.map((mapping) => {
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(mapping.definitionId));
    if (definition.status !== "found" || definition.definition.subjectId !== subject.subject.id) throw new ApiError("CONFLICT", "Definition does not belong to the selected ConfigurationSchema.");
    return { ...mapping, definition: definition.definition };
  });
  const set = await db.query(`select id from dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update nowait`, [input.configSetId,auth.organization.id,input.projectId]);
  if (set.rows.length !== 1) throw new ApiError("NOT_FOUND", "Configuration set is unavailable.");
  await db.query(`select id from project_parameter_files where config_set_id=$1 order by id for update nowait`, [input.configSetId]);
  await db.query(`select version.id from project_parameter_file_versions version
    join project_parameter_files file on file.current_version_id=version.id and file.id=version.file_id
    where file.config_set_id=$1 order by version.id for update of version nowait`, [input.configSetId]);
  const members = await db.query<{
    fileId: string; fileVersionId: string; fileName: string; format: "dts" | "json";
    role: ConfigSetRole; sortOrder: number; storageKey: string; checksum: string; sizeBytes: number;
  }>(`select file.id as "fileId",file.current_version_id as "fileVersionId",file.file_name as "fileName",file.format,
      file.config_set_role as role,file.config_set_sort_order as "sortOrder",version.storage_key as "storageKey",
      version.checksum,version.size_bytes::float8 as "sizeBytes"
    from project_parameter_files file left join project_parameter_file_versions version on version.id=file.current_version_id and version.file_id=file.id
    where file.config_set_id=$1 and file.organization_id=$2 and file.project_id=$3 order by file.id`, [input.configSetId,auth.organization.id,input.projectId]);
  if (members.rows.some((member) => !member.fileVersionId || !member.storageKey || !["dts", "json"].includes(member.format))) throw new ApiError("CONFLICT", "Configuration membership is incomplete or unsupported.");
  const sourcePins = await discoverCurrentSourceRevisionPins(db,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId: input.configSetId });
  await lockExactSourceRevisionsForProof(db,sourcePins);
  let revisionId: string | undefined;
  if (new Set(sourcePins.map((pin) => pin.configRevisionId)).size > 1) throw new ApiError("CONFLICT", "Existing source cohort is not on one exact current member revision.");
  revisionId = sourcePins[0]?.configRevisionId;
  const file = members.rows.find((member) => member.fileId === input.fileId && member.fileVersionId === input.fileVersionId);
  if (!file || file.format !== "json") throw new ApiError("CONFLICT", "The selected JSON source version is stale or foreign.");
  if (!revisionId && members.rows.some((member) => member.format === "dts")) {
    // JSON registration must not manufacture a resolved DTS revision. Reuse only
    // a unique complete revision already produced by the DTS owner for these bytes.
    const revisions = await db.query<{ id: string }>(`select revision.id from dts_config_revisions revision
      where revision.organization_id=$1 and revision.project_id=$2 and revision.config_set_id=$3
        and revision.status='resolved' and revision.manifest_state='complete' and revision.entry_file is not null
        and (select count(*) from dts_config_revision_members member where member.config_revision_id=revision.id)=$4
        and not exists(select 1 from project_parameter_files file
          left join dts_config_revision_members member on member.config_revision_id=revision.id and member.file_id=file.id
          where file.config_set_id=$3 and (member.id is null or member.file_version_id<>file.current_version_id
            or member.role<>file.config_set_role or member.sort_order<>file.config_set_sort_order or member.source_name is null))`,
    [auth.organization.id,input.projectId,input.configSetId,members.rows.length]);
    if (revisions.rows.length !== 1) throw new ApiError("CONFLICT", "Mixed source registration requires one exact resolved DTS member revision.");
    revisionId = revisions.rows[0]!.id;
  }
  if (!revisionId) {
    const next = await db.query<{ next: number }>(`select coalesce(max(revision_number),0)+1 as next from dts_config_revisions where config_set_id=$1`, [input.configSetId]);
    revisionId = randomUUID();
    await insertConfigRevision(db, { id: revisionId,organizationId: auth.organization.id,projectId: input.projectId,configSetId: input.configSetId,
      revisionNumber: next.rows[0]!.next,status: "resolved",attribution: trustedDomainAttribution(invocation) });
    await insertConfigRevisionMembers(db, revisionId, members.rows.map((member) => ({ ...member,content: "" })));
  }
  await lockExactSourceRevisionsForProof(db,members.rows.map((member) => ({ ...member,organizationId: auth.organization.id,
    projectId: input.projectId,configSetId: input.configSetId,configRevisionId: revisionId })));
  const cohort = await loadCanonicalSourceCohort(db,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId: input.configSetId });
  if (cohort.length) {
    const existing = cohort[0]!;
    const source = await loadCanonicalSourceSnapshot(db,storage,{
      organizationId: auth.organization.id,projectId: input.projectId,bindingId: existing.bindingId,projectValueId: existing.oldValueId,
    });
    if (source.manifest.configRevisionId !== revisionId || source.manifest.members.length !== members.rows.length || members.rows.some((member) => !source.manifest.members.some((pinned) =>
      pinned.fileId===member.fileId && pinned.fileVersionId===member.fileVersionId && pinned.role===member.role && pinned.sortOrder===member.sortOrder && pinned.format===member.format))) {
      throw new ApiError("CONFLICT", "Existing source cohort is not on one exact current member revision.");
    }
  }
  const names = revisionId
    ? (await db.query<{ source_name: string }>(`select source_name from dts_config_revision_members where config_revision_id=$1`, [revisionId])).rows.map((row) => row.source_name)
    : members.rows.map((member) => member.fileName);
  if (names.length !== members.rows.length || new Set(names).size !== names.length
    || names.some((name) => !name || normalizeManifestLogicalPath(name) !== name)) throw new ApiError("CONFLICT", "Source member aliases are missing or ambiguous.");
  if (revisionId && members.rows.some((member) => member.format === "dts")) {
    const revision = (await db.query<{ entry_file: string; include_search_paths: string[]; overlay_order: string[] }>(
      `select entry_file,include_search_paths,overlay_order from dts_config_revisions
       where id=$1 and organization_id=$2 and project_id=$3 and status='resolved' and manifest_state='complete'`,
      [revisionId,auth.organization.id,input.projectId])).rows[0];
    const dtsMembers = await db.query<ConfigRevisionManifestMember>(`select member.file_id as "fileId",member.file_version_id as "fileVersionId",
      member.source_name as "fileName",member.source_name as "sourceName",member.role,member.sort_order as "sortOrder",'' as content
      from dts_config_revision_members member join project_parameter_files file on file.id=member.file_id
      where member.config_revision_id=$1 and file.format='dts'`, [revisionId]);
    if (!revision || !normalizePersistedManifest({ entryFile: revision.entry_file,includeSearchPaths: revision.include_search_paths,
      overlayOrder: revision.overlay_order,members: dtsMembers.rows }).ok) throw new ApiError("CONFLICT", "Mixed source registration has no complete resolved DTS entry manifest.");
  }
  const source = await loadExactSourceRevisionForProof(db,storage,{ organizationId: auth.organization.id,projectId: input.projectId,
    configSetId: input.configSetId,configRevisionId: revisionId,fileId: file.fileId,fileVersionId: file.fileVersionId });
  for (const member of source.members) if (member.format === "json") parseJsonSource(member.bytes);
  const bytes = source.members.find((member) => member.fileId === file.fileId)!.bytes;
  readJsonSourceValue(bytes, input.rootPointer);
  const values = definitions.map((definition) => ({ ...definition, value: readJsonSourceValue(bytes, definition.pointer, input.rootPointer) as ContractJsonValue }));
  const registration = await readSourceRegistrationAgreement(db,{ organizationId: auth.organization.id,subjectId: subject.subject.id });
  if (!registration) throw new ApiError("CONFLICT", "An active governed registration and placement are required.");
  await db.query(`insert into parameter_catalog.project_parameter_source_occurrences
    (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
    values ($1,$2,$3,$4,$5,'json',$6,$7,$8,$9) on conflict do nothing`,
  [randomUUID(),auth.organization.id,input.projectId,input.configSetId,input.fileId,randomUUID(),subject.subject.id,input.rootPointer,`sha256:${createHash("sha256").update(input.rootPointer).digest("hex")}`]);
  const occurrence = await db.query<{ id: string }>(`select id from parameter_catalog.project_parameter_source_occurrences
    where organization_id=$1 and project_id=$2 and config_set_id=$3 and file_id=$4 and occurrence_kind='json'
      and configuration_schema_subject_id=$5 and root_pointer=$6`,
  [auth.organization.id,input.projectId,input.configSetId,input.fileId,subject.subject.id,input.rootPointer]);
  if (occurrence.rows.length !== 1) throw new ApiError("CONFLICT", "JSON instance identity is ambiguous.");
  const occurrenceId = occurrence.rows[0]!.id;
  const bindings: Binding[] = [];
  for (const mapping of values) {
    const stabilized = await stabilizeCanonicalBinding(asValueClient(db), {
      snapshot,organizationId: auth.organization.id,projectId: input.projectId,logicalNodeId: null,sourceOccurrenceId: occurrenceId,
      registrationId: SubjectRegistrationId(registration.id),definitionId: mapping.definition.id,
      effectiveRevisionId: mapping.definition.selectedRevision.id,expectedEffectiveRevisionId: null,
    });
    if (!stabilized.ok) throw new ApiError("CONFLICT", "JSON source could not establish a canonical Binding.", { reason: stabilized.error });
    const binding = stabilized.value.binding;
    const pin = await loadSourceValueReplay(db,{ organizationId: auth.organization.id,projectId: input.projectId,
      projectValueId: binding.currentValueId,bindingId: binding.id,sourceOccurrenceId: occurrenceId });
    if (pin) {
      if (pin.fileVersionId !== input.fileVersionId || pin.locator.pointer !== mapping.pointer
        || serializeContract(pin.value as ContractJsonValue) !== serializeContract(mapping.value)) {
        throw new ApiError("CONFLICT", "Existing JSON instance requires a reviewed source change, not re-registration.");
      }
      bindings.push(binding);
      continue;
    }
    const appended = await writebackProtectedReference(asValueClient(db), {
      snapshot,binding,definitionRevisionId: binding.effectiveRevisionId,expectedTip: binding.currentValueId,
      source: { sourceRef: `json:${input.fileId}`,configRevisionId: revisionId },payload: { kind: "json",value: mapping.value },
    });
    if (!appended.ok) throw new ApiError("CONFLICT", "JSON source value could not be materialized.", { reason: appended.error });
    const locator = { kind: "json-pointer",pointer: mapping.pointer };
    await db.query(`insert into parameter_catalog.project_value_source_pins
      (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,locator,locator_digest)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'json',$11::jsonb,$12)`,
    [randomUUID(),appended.value.currentTip,binding.id,binding.definitionId,auth.organization.id,input.projectId,occurrenceId,revisionId,input.fileId,input.fileVersionId,
      JSON.stringify(locator),`sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`]);
    bindings.push({ ...binding,currentValueId: appended.value.currentTip });
  }
  await writeTrustedAuditEventInTx(asAuditTx(db), {
    invocation,app: "parameters",kind: "parameter-topology-governance",action: "binding-edited",severity: "Medium",projectId: input.projectId,
    targetType: "parameter-source-occurrence",targetId: occurrenceId,metadata: { fileId: input.fileId,sourceOccurrenceId: occurrenceId,bindingIds: bindings.map((binding) => binding.id) },traceId: input.requestId,
  });
  return { bindings };
  } catch (error) { rethrowSourceTransactionError(error); }
}
