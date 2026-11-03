import type { Queryable } from "../../shared/database/client";
import { loadOwnedProjectValueSourcePin, readOwnedCurrentBinding, readOwnedProjectValueIdentity, type CanonicalSourceBindingPin } from "../parameter-bindings/values";
import type { SourceRevisionCohort } from "./sourceRevisionService";

/** Retained provenance is historical evidence, never an assertion about new source bytes. */
export type ExcludedSourceBinding = Pick<SourceRevisionCohort,
  "bindingId" | "oldValueId" | "sourcePinId" | "sourceOccurrenceId" | "definitionId" |
  "effectiveRevisionId" | "catalogReleaseId" | "valueDigest"> & {
  registrationId: string;
  subjectId: string;
  configRevisionId: string;
  fileId: string;
  fileVersionId: string;
  format: "dts" | "json";
  reason: "registration-inactive" | "subject-inactive" | "owner-inactive" | "definition-inactive" | "source-absent";
};

/** Only a committed, exact suspension receipt can explain a historical current tip. */
export async function findSourceSuspension(tx: Queryable,
  scope: { organizationId: string; projectId: string; configSetId: string; baseConfigRevisionId: string },
  binding: Omit<ExcludedSourceBinding, "reason">): Promise<string | null> {
  const row = (await tx.query<{ id: string }>(`select request.id
    from public.project_parameter_value_change_requests request
    join public.dts_config_revisions suspended on suspended.id=request.applied_source_result->>'configRevisionId'
      and suspended.organization_id=request.organization_id and suspended.project_id=request.project_id
      and suspended.config_set_id=request.source_revision_config_set_id
    join public.dts_config_revisions base on base.id=$4 and base.organization_id=request.organization_id
      and base.project_id=request.project_id and base.config_set_id=suspended.config_set_id
    join public.dts_config_revisions previous on previous.id=$5 and previous.config_set_id=base.config_set_id
    where request.organization_id=$1 and request.project_id=$2 and request.source_revision_config_set_id=$3
      and request.request_kind='source_revision' and request.status='approved' and request.apply_outcome='committed'
      and suspended.revision_number>previous.revision_number and suspended.revision_number<=base.revision_number
      and request.source_revision_context->'excludedBindings' @> $6::jsonb
    order by suspended.revision_number desc,request.id limit 1`,
  [scope.organizationId, scope.projectId, scope.configSetId, scope.baseConfigRevisionId,
    binding.configRevisionId, JSON.stringify([binding])])).rows[0];
  return row?.id ?? null;
}

/**
 * Active source operations leave previously suspended history untouched. A stale
 * pin by itself is never sufficient: retain unexplained or mismatched entries so
 * the caller's existing freshness/identity guards still reject them.
 */
export async function filterPreviouslySuspendedSourceBindings<T extends Pick<CanonicalSourceBindingPin,
  "bindingId" | "oldValueId" | "sourcePinId" | "sourceOccurrenceId" | "definitionId" |
  "effectiveRevisionId" | "catalogReleaseId" | "valueDigest">>(
  tx: Queryable,
  scope: { organizationId: string; projectId: string; configSetId: string; baseConfigRevisionId: string },
  cohort: readonly T[],
): Promise<T[]> {
  const included: T[] = [];
  for (const entry of cohort) {
    const pin = await loadOwnedProjectValueSourcePin(tx, { ...scope, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (!pin || pin.configRevisionId === scope.baseConfigRevisionId || pin.configSetId !== scope.configSetId
      || pin.valueState !== "present" || pin.sourcePinId !== entry.sourcePinId
      || pin.sourceOccurrenceId !== entry.sourceOccurrenceId || pin.definitionId !== entry.definitionId) {
      included.push(entry); continue;
    }
    const current = await readOwnedCurrentBinding(tx, { ...scope, bindingId: entry.bindingId });
    const old = await readOwnedProjectValueIdentity(tx, { ...scope, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (current.status !== "current" || current.binding.currentValueId !== entry.oldValueId
      || current.binding.sourceOccurrenceId !== entry.sourceOccurrenceId || current.binding.definitionId !== entry.definitionId
      || current.binding.effectiveRevisionId !== entry.effectiveRevisionId || current.binding.catalogReleaseId !== entry.catalogReleaseId
      || !old || old.value.valueDigest !== entry.valueDigest) {
      included.push(entry); continue;
    }
    const suspension = await findSourceSuspension(tx, scope, {
      bindingId: entry.bindingId, oldValueId: entry.oldValueId, sourcePinId: entry.sourcePinId,
      sourceOccurrenceId: entry.sourceOccurrenceId, definitionId: entry.definitionId,
      effectiveRevisionId: entry.effectiveRevisionId, catalogReleaseId: entry.catalogReleaseId, valueDigest: entry.valueDigest,
      registrationId: current.binding.registrationId, subjectId: current.binding.subjectId,
      configRevisionId: pin.configRevisionId, fileId: pin.fileId, fileVersionId: pin.fileVersionId, format: pin.format,
    });
    if (!suspension) included.push(entry);
  }
  return included;
}
