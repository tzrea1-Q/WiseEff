import { parameterOrganizationId } from "../parameters/operatingScope";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { offsetToLineColumn } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { parseCanonicalCompatibleSelector } from "../parameter-catalog-contract";
import { canonicalSourceConfigSetRole } from "../parameter-files/canonicalSource";
import { loadExactSourceRevisionForProof, lockExactSourceRevisionsForProof } from "../parameter-files/sourceVersion";
import { requireCanViewProject } from "./service";
import { proveExactDtsProperty, type ExactDtsSourceProof } from "./sourcePropertyProof";

export type DtsObservationLocator = {
  kind: "dts-property"; fileVersionId: string; nodeOccurrenceId: string;
  propertyOccurrenceId: string; propertyName: string;
};
export type CurrentDtsCompatibleSourceInput = {
  organizationId: string; projectId: string;
  /** Catalog owner must load and authorize this exact observation provenance; never populate it from an HTTP body. */
  observationId: string; catalogReleaseId: string; matcherRevision: string;
  configSetId: string; fileId: string;
  configRevisionId: string; logicalNodeId: string; locator: DtsObservationLocator;
};
export type CurrentDtsCompatibleSourceResult =
  | { status: "unavailable"; reason: string }
  | {
      status: "current" | "historical";
      observationId: string; catalogReleaseId: string; matcherRevision: string;
      logicalNodeId: string; configSetId: string;
      configRevisionId: string; currentConfigRevisionId: string;
      members: Array<{ fileId: string; fileVersionId: string; sourceName: string;
        format: "dts" | "json"; role: string; sortOrder: number; checksum: string; sizeBytes: number }>;
      compatibles: string[]; observationProof: ExactDtsSourceProof; compatibleProof: ExactDtsSourceProof;
      compatibleLine: number;
    };

type CompatibleEffect = {
  id: string; sourceOrder: number; kind: string; propertyOccurrenceId: string | null;
  nodeOccurrenceId: string | null; fileVersionId: string | null; rawText: string | null;
};
type CurrentFile = {
  id: string; current_version_id: string | null; config_set_role: string | null;
  config_set_sort_order: number; format: string;
};
const unavailable = (reason: string): CurrentDtsCompatibleSourceResult => ({ status: "unavailable", reason });
const boundedId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256
  && !/[\u0000-\u001f\u007f]/.test(value);

/** Source-owned read proof. The Catalog owner binds observationId to the supplied provenance first. */
export async function readCurrentDtsCompatibleSource(
  db: Database, objectStore: ObjectStore, auth: AuthContext, input: CurrentDtsCompatibleSourceInput,
): Promise<CurrentDtsCompatibleSourceResult> {
  if (parameterOrganizationId(auth) !== input.organizationId) throw new ApiError("NOT_FOUND", "DTS source observation is not available.");
  requireCanViewProject(auth, input.projectId);
  const locator = input.locator;
  if (![input.organizationId,input.projectId,input.observationId,input.catalogReleaseId,
    input.matcherRevision,input.configSetId,input.fileId,
    input.configRevisionId,input.logicalNodeId,
    locator?.fileVersionId,locator?.nodeOccurrenceId,locator?.propertyOccurrenceId,locator?.propertyName].every(boundedId)
    || locator.kind !== "dts-property"
    || Object.keys(locator).sort().join(",") !== "fileVersionId,kind,nodeOccurrenceId,propertyName,propertyOccurrenceId") {
    return unavailable("invalid-input");
  }
  try {
    return await db.transaction(async (tx) => {
      const identity = { organizationId: input.organizationId, projectId: input.projectId,
        configSetId: input.configSetId, configRevisionId: input.configRevisionId,
        fileId: input.fileId, fileVersionId: locator.fileVersionId };
      await lockExactSourceRevisionsForProof(tx, [identity]);
      const source = await loadExactSourceRevisionForProof(tx, objectStore, identity);
      const observationProof = await proveExactDtsProperty(tx, objectStore, {
        ...identity, logicalNodeId: input.logicalNodeId, nodeOccurrenceId: locator.nodeOccurrenceId,
        propertyOccurrenceId: locator.propertyOccurrenceId, propertyName: locator.propertyName,
      }, { purpose: "review-evidence" });
      const effects = (await tx.query<CompatibleEffect>(
        `select effect.id,effect.source_order as "sourceOrder",effect.effect_kind as kind,
          effect.property_occurrence_id as "propertyOccurrenceId",effect.node_occurrence_id as "nodeOccurrenceId",
          property.file_version_id as "fileVersionId",property.raw_text as "rawText"
         from dts_occurrence_effects effect
         join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
           and logical.config_revision_id=effect.config_revision_id
         left join dts_property_occurrences property on property.id=effect.property_occurrence_id
           and property.config_revision_id=effect.config_revision_id
         where effect.config_revision_id=$1 and logical.logical_node_id=$2 and effect.property_name='compatible'
         order by effect.source_order desc,effect.id desc limit 2`,
        [input.configRevisionId,input.logicalNodeId],
      )).rows;
      const final = effects[0];
      if (!final || final.kind === "delete") return unavailable("compatible-absent");
      if (effects[1]?.sourceOrder === final.sourceOrder || !final.propertyOccurrenceId
        || !final.nodeOccurrenceId || !final.fileVersionId || final.rawText === null) {
        return unavailable("compatible-source-ambiguous");
      }
      const compatibleMember = source.members.find((member) => member.fileVersionId === final.fileVersionId);
      if (!compatibleMember || compatibleMember.format !== "dts") return unavailable("compatible-source-ambiguous");
      const compatibleProof = locator.propertyName==="compatible" && locator.propertyOccurrenceId===final.propertyOccurrenceId
        && locator.nodeOccurrenceId===final.nodeOccurrenceId && locator.fileVersionId===final.fileVersionId ? observationProof : await proveExactDtsProperty(tx, objectStore, {
        ...identity, fileId: compatibleMember.fileId, fileVersionId: final.fileVersionId,
        logicalNodeId: input.logicalNodeId, propertyName: "compatible",
        propertyOccurrenceId: final.propertyOccurrenceId, nodeOccurrenceId: final.nodeOccurrenceId,
      }, { purpose: "review-evidence" });
      const parsed = compatibleProof.value;
      if (parsed.kind !== "strings" || !parsed.values.length
        || parsed.values.some((value) => !parseCanonicalCompatibleSelector(value).ok)) {
        return unavailable("compatible-invalid");
      }
      const current = (await tx.query<CurrentFile>(
        `select id,current_version_id,config_set_role,config_set_sort_order,format
         from project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3 order by id`,
        [input.organizationId,input.projectId,input.configSetId],
      )).rows;
      if (current.length !== source.members.length || source.members.some((member) => {
        const file = current.find((candidate) => candidate.id === member.fileId);
        return !file || file.config_set_role !== canonicalSourceConfigSetRole(member.role)
          || file.config_set_sort_order !== member.sortOrder || file.format !== member.format;
      })) return unavailable("source-membership-drift");
      let matching = (await tx.query<{ id: string }>(
        `select revision.id from dts_config_revisions revision
         where revision.organization_id=$1 and revision.project_id=$2 and revision.config_set_id=$3
           and revision.manifest_state='complete'
           and revision.status in ('resolved','validated','compiled','pending_approval','needs_mapping')
           and (select count(*) from dts_config_revision_members member where member.config_revision_id=revision.id)=$4
           and not exists (
             select 1 from dts_config_revision_members member
             left join project_parameter_files file on file.id=member.file_id
               and file.organization_id=revision.organization_id and file.project_id=revision.project_id
               and file.config_set_id=revision.config_set_id
             where member.config_revision_id=revision.id and (file.id is null
               or file.current_version_id is distinct from member.file_version_id
               or file.config_set_role is distinct from case when member.role='include' then 'misc' else member.role end
               or file.config_set_sort_order is distinct from member.sort_order
               or (member.shared_reference is not null) is distinct from exists(
                 select 1 from public.project_shared_dtsi_snapshots snapshot where snapshot.file_id=member.file_id
                   and snapshot.file_version_id=member.file_version_id)
               or member.shared_reference is not null and not exists(
                 select 1 from public.project_shared_dtsi_snapshots snapshot
                 join public.project_shared_dtsi_references reference on reference.id=snapshot.reference_id
                 join public.shared_dtsi_revisions upstream on upstream.id=reference.revision_id
                 where snapshot.file_id=member.file_id and snapshot.file_version_id=member.file_version_id
                   and snapshot.reference_id=member.shared_reference->>'referenceId'
                   and reference.resource_id=member.shared_reference->>'resourceId' and reference.revision_id=member.shared_reference->>'versionId'
                   and snapshot.member_id=member.shared_reference->>'memberId' and upstream.digest=member.shared_reference->>'digest'))
           ) order by revision.id limit 2`,
        [input.organizationId,input.projectId,input.configSetId,current.length],
      )).rows;
      if(matching.length>1){
        // Identical private versions may return through a governed historical restore.
        // Duplicate unreceipted revisions remain ambiguous; a locator/latest timestamp is never identity proof.
        matching=(await tx.query<{id:string}>(`select revision.id from public.dts_config_revisions revision
          where revision.organization_id=$1 and revision.project_id=$2 and revision.config_set_id=$3
            and revision.id=(select id from public.dts_config_revisions where organization_id=$1 and project_id=$2
              and config_set_id=$3 and status='resolved' order by revision_number desc limit 1)
            and exists(select 1 from public.project_parameter_value_change_requests request
              where request.organization_id=$1 and request.project_id=$2 and request.source_revision_config_set_id=$3
                and request.request_kind='configuration_restore' and request.source_revision_application_mode='administrator_direct'
                and (request.status='approved' and request.apply_outcome='committed' and request.applied_source_result->>'configRevisionId'=revision.id
                  or request.status='pending' and revision.id=$4
                    and exists(select 1 from public.dts_config_revisions base where base.id=request.source_revision_context->>'baseConfigRevisionId'
                      and base.organization_id=$1 and base.project_id=$2 and base.config_set_id=$3 and base.revision_number+1=revision.revision_number)
                    and (select count(*) from public.dts_config_revision_members where config_revision_id=revision.id)
                      =jsonb_array_length(request.source_revision_context->'members')
                    and not exists(select 1 from public.dts_config_revision_members member where member.config_revision_id=revision.id
                      and (member.shared_reference is not null or not exists(select 1 from jsonb_array_elements(request.source_revision_context->'members') planned
                        join public.dts_config_revision_members historical on historical.config_revision_id=request.source_revision_context->>'snapshotConfigRevisionId'
                          and historical.file_id=planned->>'fileId' and historical.file_version_id=planned->>'fileVersionId' and historical.shared_reference is null
                        where planned->>'fileId'=member.file_id and planned->>'fileVersionId'=member.file_version_id
                          and planned->>'sourceName'=member.source_name and planned->>'role'=member.role and (planned->>'sortOrder')::integer=member.sort_order)))))`,
          [input.organizationId,input.projectId,input.configSetId,input.configRevisionId])).rows;
        if(matching.length!==1)return unavailable("ambiguous-current-revision");
      }
      if (matching.length !== 1) return unavailable(matching.length ? "ambiguous-current-revision" : "current-revision-unavailable");
      if (matching[0]!.id !== input.configRevisionId) {
        const member = current[0]!;
        await loadExactSourceRevisionForProof(tx, objectStore, {
          ...identity, configRevisionId: matching[0]!.id,
          fileId: member.id, fileVersionId: member.current_version_id!,
        });
      }
      return {
        status: matching[0]!.id === input.configRevisionId ? "current" : "historical",
        observationId: input.observationId, catalogReleaseId: input.catalogReleaseId,
        matcherRevision: input.matcherRevision, logicalNodeId: input.logicalNodeId,
        configSetId: input.configSetId, configRevisionId: input.configRevisionId,
        currentConfigRevisionId: matching[0]!.id,
        members: source.members.map(({ fileId,fileVersionId,sourceName,format,role,sortOrder,checksum,sizeBytes }) =>
          ({ fileId,fileVersionId,sourceName,format,role,sortOrder,checksum,sizeBytes })),
        compatibles: parsed.values, observationProof, compatibleProof,
        compatibleLine:offsetToLineColumn(source.members.find(member=>member.fileId===compatibleProof.fileId)!.content,compatibleProof.sourceSpan.start).line,
      };
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "CONFLICT") {
      return unavailable(typeof error.details.reason === "string" ? error.details.reason : "source-proof-invalid");
    }
    throw error;
  }
}
