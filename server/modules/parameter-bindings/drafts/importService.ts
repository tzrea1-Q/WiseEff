import type { Database } from "../../../shared/database/client";
import { createHash } from "node:crypto";
import { ApiError } from "../../../shared/http/errors";
import type { AuthContext } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import { canAdminParameters, canEditParameters } from "../../parameter-kernel/policy";
import { asAuditTx, writeTrustedAuditEventInTx } from "../../audit/auditedWrite";
import { getImportBatchForUpdate, type PersistedImportBatchItem } from "../../parameters/importBatchRepository";
import { loadCanonicalSourceSnapshot, requireCanonicalUserInvocation, recordCanonicalPermissionRefusal, type CanonicalSourceSecurityContext } from "../../parameter-files/canonicalSource";
import { withCanonicalSourceAttemptTransaction } from "../../parameter-files/canonicalSourceAttemptTransaction";
import { MAX_PARAMETER_SOURCE_BYTES } from "../../parameter-files/jsonSource";
import { getCanonicalValueDraftForUpdate } from "./repository";
import { findCatalogBindingRow, importTextToDtsValue } from "../catalogProjectValueSync";
import { createCanonicalValueDraft } from "./service";
import { createBindingDraft as createTopologyBindingDraft } from "../../parameter-topology/editService";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";

/** The old apply URL now stages pending work only. One batch is one atomic, replayable staging unit. */
export async function stageCanonicalImportBatch(
  db: Database, storage: ObjectStore, auth: AuthContext,
  input: { batchId: string; selectedItemIds?: string[] },security: CanonicalSourceSecurityContext,
) {
  const initial = (await db.query<{ project_id: string; items: PersistedImportBatchItem[] }>(
    `select project_id,items from parameter_import_batches where id=$1 and organization_id=$2`, [input.batchId,auth.organization.id])).rows[0];
  if (!initial) throw new ApiError("NOT_FOUND", "Parameter import batch was not found.");
  const projectId = initial.project_id;
  const operation = { projectId,operation: "canonical import staging",targetType: "parameter-import-batch",targetId: input.batchId };
  const invocation = await requireCanonicalUserInvocation(auth,security,operation);
  if (!canAdminParameters(auth) || !canEditParameters(auth,projectId)) {
    await recordCanonicalPermissionRefusal(security,operation);
    throw new ApiError("FORBIDDEN", "Project import administration is required.");
  }
  const selectedIds = (input.selectedItemIds ?? initial.items.filter((item) => item.classification === "updated").map((item) => item.id)).slice().sort();
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !initial.items.some((item) => item.id === id))) {
    throw new ApiError("VALIDATION_FAILED", "Select distinct known import rows.");
  }
  const selected = initial.items.filter((item) => selectedIds.includes(item.id));
  const bindingIds = selected.map((item) => item.projectParameterValueId);
  if (selected.some((item) => item.classification !== "updated" || !item.projectParameterValueId)
    || new Set(bindingIds).size !== bindingIds.length) throw new ApiError("CONFLICT", "Import rows require distinct exact canonical source mappings.");
  return withCanonicalSourceAttemptTransaction(db, storage, async (tx, attempt) => {
    const attemptStorage = attempt.objectStore;
    const roots = await tx.query<{ config_set_id: string }>(`select distinct occurrence.config_set_id
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      where binding.organization_id=$1 and binding.project_id=$2 and binding.id=any($3::text[])
      union
      select distinct revision.config_set_id
      from project_parameter_bindings binding
      join project_parameter_binding_revisions head on head.binding_id=binding.id
      join dts_config_revisions revision on revision.id=head.config_revision_id
      where binding.organization_id=$1 and binding.project_id=$2 and binding.id=any($3::text[])`, [auth.organization.id,projectId,bindingIds]);
    const setIds = roots.rows.map((row) => row.config_set_id);
    await tx.query(`select id from dts_config_set where id=any($1::text[]) order by id for update`, [setIds]);
    await tx.query(`select id from project_parameter_files where config_set_id=any($1::text[]) order by id for update`, [setIds]);
    await tx.query(`select binding.id from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      where occurrence.config_set_id=any($1::text[]) order by binding.id for update of binding`, [setIds]);
    const batch = await getImportBatchForUpdate(tx,{ organizationId: auth.organization.id,batchId: input.batchId });
    if (!batch || batch.projectId !== projectId) throw new ApiError("CONFLICT", "Import batch changed during staging.");
    if (batch.status === "staged") {
      if (batch.summary.stagedByUserId !== auth.user.id || JSON.stringify(batch.summary.stagedItemIds) !== JSON.stringify(selectedIds)
        || batch.summary.staged !== selectedIds.length) throw new ApiError("CONFLICT", "Staged batch actor or selection differs from this request.");
      for (const item of batch.items.filter((row) => selectedIds.includes(row.id))) {
        const proof = item.stagedDraft;
        if (!proof || proof.bindingId !== item.projectParameterValueId
          || (item.baseCurrentValueId && proof.baseCurrentValueId !== item.baseCurrentValueId)
          || (item.baseRevisionId && proof.baseRevisionId !== item.baseRevisionId)) {
          throw new ApiError("CONFLICT", "Staged batch proof is incomplete.");
        }
        const draft = await getCanonicalValueDraftForUpdate(tx,{ organizationId: auth.organization.id,projectId,userId: auth.user.id,draftId: proof.draftId });
        if (!draft) {
          const topologyDraft = await tx.query<{ id: string }>(
            `select id from parameter_drafts where id=$1 and organization_id=$2 and project_id=$3 and project_parameter_binding_id=$4`,
            [proof.draftId, auth.organization.id, projectId, proof.bindingId]
          );
          if (!topologyDraft.rows[0]) {
            throw new ApiError("CONFLICT", "Staged draft was consumed, removed or edited; it cannot be replayed as pending work.");
          }
          continue;
        }
        if (draft.binding_id !== proof.bindingId || draft.base_current_value_id !== proof.baseCurrentValueId
          || draft.config_revision_id !== proof.baseRevisionId || draft.source_pin_id !== proof.sourcePinId || draft.candidate_id !== proof.candidateId
          || draft.candidate_base_digest !== proof.baseDigest || draft.candidate_proposed_digest !== proof.proposedDigest || draft.candidate_diff_digest !== proof.diffDigest) {
          throw new ApiError("CONFLICT", "Staged draft was consumed, removed or edited; it cannot be replayed as pending work.");
        }
        const candidate = await tx.query<{ storage_key: string; size_bytes: number; checksum: string; frozen_member_manifest: unknown; frozen_binding_manifest: unknown }>(
          `select candidate.storage_key,candidate.size_bytes::float8 as size_bytes,candidate.checksum,candidate.frozen_member_manifest,candidate.frozen_binding_manifest from project_parameter_file_candidates candidate
          join parameter_catalog.project_value_source_pins pin on pin.id=$4 and pin.file_id=candidate.file_id and pin.file_version_id=candidate.base_version_id
          where candidate.id=$1 and candidate.organization_id=$2 and candidate.project_id=$3
            and candidate.status='ready' and pin.binding_id=$5 and pin.project_value_id=$6 and candidate.base_digest=$7 and candidate.proposed_digest=$8 and candidate.diff_digest=$9 for share of candidate`,
        [proof.candidateId,auth.organization.id,projectId,proof.sourcePinId,proof.bindingId,proof.baseCurrentValueId,proof.baseDigest,proof.proposedDigest,proof.diffDigest]);
        if (candidate.rows.length !== 1) throw new ApiError("CONFLICT", "Staged source proof no longer agrees with its candidate.");
        const stored = candidate.rows[0]!;
        const same = (left: unknown,right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
        if (!same(stored.frozen_member_manifest,draft.candidate_member_manifest) || !same(stored.frozen_binding_manifest,draft.candidate_binding_manifest)
          || !attemptStorage.getBounded || !Number.isSafeInteger(stored.size_bytes) || stored.size_bytes < 0 || stored.size_bytes > MAX_PARAMETER_SOURCE_BYTES) {
          throw new ApiError("CONFLICT", "Staged artifact has invalid frozen source evidence.");
        }
        const base = await loadCanonicalSourceSnapshot(tx,attemptStorage,{ organizationId: auth.organization.id,projectId,bindingId: proof.bindingId,projectValueId: proof.baseCurrentValueId });
        const members = base.manifest.members.map((member) => ({ ...member,configSetId: base.manifest.configSetId,isCandidateFile: member.fileId === base.manifest.fileId }))
          .sort((left,right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0);
        let bytes: Buffer;
        let after: string;
        try {
          bytes = await attemptStorage.getBounded(stored.storage_key,MAX_PARAMETER_SOURCE_BYTES);
          after = new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes);
        } catch { throw new ApiError("CONFLICT", "Staged source bytes are missing or unreadable."); }
        const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
        const before = base.files[base.manifest.members.findIndex((member) => member.fileId === base.manifest.fileId)]!.content;
        if (!same(members,stored.frozen_member_manifest) || bytes.length !== stored.size_bytes || digest(bytes) !== stored.checksum.replace(/^sha256:/,"")
          || digest(bytes) !== proof.proposedDigest || digest(before) !== proof.baseDigest
          || digest(serializeContract({ before,after,sourcePinId: proof.sourcePinId,bindings: draft.candidate_binding_manifest } as ContractJsonValue)) !== proof.diffDigest) {
          throw new ApiError("CONFLICT", "Staged source bytes failed integrity verification.");
        }
      }
      return batch;
    }
    if (batch.status !== "previewed" || serializeContract(batch.items as unknown as ContractJsonValue) !== serializeContract(initial.items as unknown as ContractJsonValue)) {
      throw new ApiError("CONFLICT", "Import preview changed or has already been consumed.");
    }
    const pending = await tx.query(`select id from project_parameter_value_drafts where organization_id=$1 and project_id=$2 and binding_id=any($3::text[])
      union all select id from project_parameter_value_change_requests where organization_id=$1 and project_id=$2 and binding_id=any($3::text[]) and status='pending'
      union all select id from parameter_drafts where organization_id=$1 and project_id=$2 and project_parameter_binding_id=any($3::text[])`,
    [auth.organization.id,projectId,bindingIds]);
    if (pending.rows.length) throw new ApiError("CONFLICT", "Import cannot replace existing pending drafts or reviews.");
    for (const item of batch.items.filter((row) => selectedIds.includes(row.id))) {
      const catalogBinding = await findCatalogBindingRow(tx, {
        organizationId: auth.organization.id,
        projectId,
        bindingId: item.projectParameterValueId!
      });
      const sourceText = item.currentValue ?? item.recommendedValue ?? "";
      if (catalogBinding) {
        if (!item.definitionId || !item.baseCurrentValueId || !item.baseRevisionId) {
          throw new ApiError("CONFLICT", "Import rows require distinct exact canonical source mappings.");
        }
        const pin = (await tx.query<{ format: "dts" | "json"; property_name: string | null }>(`select pin.format,pin.locator->>'propertyName' as property_name
          from parameter_catalog.current_project_parameter_bindings binding
          join parameter_catalog.project_value_source_pins pin on pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
          where binding.organization_id=$1 and binding.project_id=$2 and binding.id=$3 and binding.definition_id=$4
            and binding.current_value_id=$5 and pin.config_revision_id=$6`,
        [auth.organization.id,projectId,item.projectParameterValueId,item.definitionId,item.baseCurrentValueId,item.baseRevisionId])).rows[0];
        if (!pin || (item.configFormat && item.configFormat.toLowerCase() !== pin.format)) throw new ApiError("CONFLICT", "Import source is stale or its format is unsupported.");
        if (pin.format === "dts" && !pin.property_name) throw new ApiError("CONFLICT", "DTS import has no exact property locator.");
        const draft = await createCanonicalValueDraft(tx,auth,{
          projectId,bindingId: item.projectParameterValueId!,baseRevisionId: item.baseRevisionId,baseCurrentValueId: item.baseCurrentValueId,reason: `Import: ${batch.sourceName}`,
          ...(pin.format === "json" ? { sourceTarget: { format: "json" as const,sourceText } } : { targetValue: importTextToDtsValue(pin.property_name!,sourceText) })
        },{ objectStore: attemptStorage,...security });
        const proof = (await tx.query<{ base_digest: string; proposed_digest: string; diff_digest: string }>(
          `select base_digest,proposed_digest,diff_digest from project_parameter_file_candidates where id=$1`, [draft.candidateId])).rows[0]!;
        if (!draft.candidateId || !draft.sourcePinId || !proof) throw new ApiError("CONFLICT", "Import did not create a prepared source draft.");
        item.stagedDraft = { draftId: draft.id,candidateId: draft.candidateId,sourcePinId: draft.sourcePinId,bindingId: draft.bindingId,
          baseRevisionId: item.baseRevisionId,baseCurrentValueId: item.baseCurrentValueId,baseDigest: proof.base_digest,proposedDigest: proof.proposed_digest,diffDigest: proof.diff_digest };
        continue;
      }
      const head = await tx.query<{ config_revision_id: string }>(
        `select br.config_revision_id
           from project_parameter_bindings b
           join project_parameter_binding_revisions br on br.binding_id=b.id
          where b.organization_id=$1 and b.project_id=$2 and b.id=$3
          order by br.created_at desc
          limit 1`,
        [auth.organization.id, projectId, item.projectParameterValueId]
      );
      const baseRevisionId = item.baseRevisionId ?? head.rows[0]?.config_revision_id;
      if (!baseRevisionId) throw new ApiError("CONFLICT", "Import rows require distinct exact canonical source mappings.");
      const topologyDraft = await createTopologyBindingDraft(
        tx,
        auth,
        {
          bindingId: item.projectParameterValueId!,
          baseRevisionId,
          targetValue: importTextToDtsValue(item.name, sourceText),
          reason: `Import: ${batch.sourceName}`
        },
        { objectStore: attemptStorage },
        { invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink }
      );
      const digest = (value: string) => createHash("sha256").update(value).digest("hex");
      item.stagedDraft = {
        draftId: topologyDraft.draftId,
        candidateId: topologyDraft.workingCandidateRevisionId || topologyDraft.candidateRevisionId,
        sourcePinId: topologyDraft.overlayFileId || topologyDraft.draftId,
        bindingId: topologyDraft.projectParameterBindingId,
        baseRevisionId,
        baseCurrentValueId: topologyDraft.projectParameterBindingId,
        baseDigest: digest(topologyDraft.baseContent),
        proposedDigest: digest(topologyDraft.candidateOverlayContent),
        diffDigest: digest(topologyDraft.rawText)
      };
    }
    const summary = { ...batch.summary,staged: selectedIds.length,stagedByUserId: auth.user.id,stagedItemIds: selectedIds };
    await tx.query(`update parameter_import_batches set status='staged',summary=$3::jsonb,items=$4::jsonb where id=$1 and organization_id=$2 and status='previewed'`,
      [input.batchId,auth.organization.id,JSON.stringify(summary),JSON.stringify(batch.items)]);
    await writeTrustedAuditEventInTx(asAuditTx(tx),{ invocation,app: "parameter-management",kind: "batch-import",action: "stage",severity: "High",
      projectId,targetType: "parameter-import-batch",targetId: input.batchId,metadata: { staged: selectedIds.length,selectedItemIds: selectedIds },traceId: security.requestId });
    return { ...batch,status: "staged" as const,summary };
  });
}
