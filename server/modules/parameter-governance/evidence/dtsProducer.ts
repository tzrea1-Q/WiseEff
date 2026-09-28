import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Database } from "../../../shared/database/client";
import { getRootPostgresPool } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { createCatalogKernel, DriverCompatible } from "../../catalog-kernel/interface";
import { subjectMatcherRevision } from "../../catalog-kernel/runtime/subjectMatch";
import { captureCurrentCatalogPin, createPinCapturingCatalogRuntime } from "../../catalog-publication/runtime";
import { parseDtsValue } from "../../dts";
import { parseCanonicalCompatibleSelector } from "../../parameter-catalog-contract";
import { canAdminParameters } from "../../parameter-kernel/policy";
import type { ObjectStore } from "../../logs/objectStore";
import { readCurrentDtsCompatibleSource, type CurrentDtsCompatibleSourceInput,
  type DtsObservationLocator } from "../../parameter-topology/currentDtsCompatibleSource";
import { ingestSourceBoundEvidenceInTransaction } from "./ingest";
import { materializeReviewItemsInTransaction } from "../review/query";

type Property = {
  projectId: string; configSetId: string; fileId: string; logicalNodeId: string;
  fileVersionId: string; nodeOccurrenceId: string; propertyOccurrenceId: string;
  rawText: string;
};

/** File-activation producer. The caller's source revision and these writes commit or roll back together. */
export async function produceDtsCompatibleEvidenceInTransaction(
  tx: Database, root: Database, objectStore: ObjectStore, auth: AuthContext, configRevisionId: string,
): Promise<void> {
  if (!canAdminParameters(auth)) throw new Error("DTS evidence producer requires parameter administration");
  const revision = (await tx.query<{ projectId: string }>(
    `select project_id as "projectId" from dts_config_revisions
     where id=$1 and organization_id=$2`,[configRevisionId,auth.organization.id],
  )).rows;
  if (revision.length !== 1 || !auth.roles.some((role) => role.roleId === "admin"
    || role.roleId === "platform-admin" || role.projectId === revision[0]!.projectId)) {
    throw new Error("DTS evidence revision is outside the authorized organization or project");
  }
  const pool = getRootPostgresPool(root);
  if (!pool) throw new Error("Trusted DTS evidence producer requires the root PostgreSQL pool");
  const pin = await captureCurrentCatalogPin(pool);
  if (!pin) throw new Error("Current Catalog release is unavailable for DTS evidence production");
  const loaded = await createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool)).loadCurrentCatalog(pin);
  if (!loaded.ok) throw new Error(`Current Catalog snapshot unavailable: ${loaded.error.kind}`);

  const properties = (await tx.query<Property>(
    `select revision.project_id as "projectId",revision.config_set_id as "configSetId",
       file.id as "fileId",logical.logical_node_id as "logicalNodeId",
       property.file_version_id as "fileVersionId",property.node_occurrence_id as "nodeOccurrenceId",
       property.id as "propertyOccurrenceId",property.raw_text as "rawText"
     from dts_occurrence_effects effect
     join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       and logical.config_revision_id=effect.config_revision_id
     join dts_config_revisions revision on revision.id=effect.config_revision_id
     join dts_property_occurrences property on property.id=effect.property_occurrence_id
       and property.config_revision_id=effect.config_revision_id
     join project_parameter_file_versions version on version.id=property.file_version_id
     join project_parameter_files file on file.id=version.file_id
       and file.organization_id=revision.organization_id and file.project_id=revision.project_id
       and file.config_set_id=revision.config_set_id
     join dts_config_revision_members member on member.config_revision_id=revision.id
       and member.file_id=file.id and member.file_version_id=version.id
     where effect.config_revision_id=$1 and revision.organization_id=$2
       and effect.property_name='compatible' and effect.effect_kind in ('set','override')
       and not exists (select 1 from dts_occurrence_effects later
         where later.config_revision_id=effect.config_revision_id
           and later.logical_node_revision_id=effect.logical_node_revision_id
           and later.property_name=effect.property_name and later.source_order>effect.source_order)
     order by logical.logical_node_id,property.id limit 201`,
    [configRevisionId,auth.organization.id],
  )).rows;
  if (properties.length > 200) throw new Error("DTS compatible evidence source limit exceeded");
  const observationIds: string[] = [];
  for (const property of properties) {
    const parsed = parseDtsValue("compatible",property.rawText).value;
    if (parsed.kind !== "strings" || !parsed.values.length
      || parsed.values.some((value) => !parseCanonicalCompatibleSelector(value).ok)) {
      throw new Error("DTS compatible source has invalid complete selectors");
    }
    const matches = new Map([...new Set(parsed.values)].map((compatible) => [compatible,
      loaded.value.resolveSubject({driverCompatibles:[DriverCompatible(compatible)],
        nodeTypeFallback:{kind:"absent"}})]));
    const statuses = [...matches.values()].map((match) => match.status === "matched" && match.subject.kind !== "driver"
      ? "unknown" : match.status);
    const observationStatus = statuses.every((status) => status === "matched") ? "matched"
      : statuses.includes("unknown") ? "unknown"
      : statuses.includes("ambiguous") ? "ambiguous"
      : "retired-registration-observed";
    const locator: DtsObservationLocator = { kind: "dts-property",fileVersionId: property.fileVersionId,
      nodeOccurrenceId: property.nodeOccurrenceId,propertyOccurrenceId: property.propertyOccurrenceId,
      propertyName: "compatible" };
    await tx.query(
      `insert into parameter_catalog.project_parameter_source_occurrences
       (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id)
       values ($1,$2,$3,$4,$5,'dts',$6) on conflict do nothing`,
      [randomUUID(),auth.organization.id,property.projectId,property.configSetId,property.fileId,property.logicalNodeId],
    );
    const occurrences = (await tx.query<{ id: string }>(
      `select id from parameter_catalog.project_parameter_source_occurrences
       where organization_id=$1 and project_id=$2 and config_set_id=$3 and file_id=$4
         and occurrence_kind='dts' and logical_node_id=$5`,
      [auth.organization.id,property.projectId,property.configSetId,property.fileId,property.logicalNodeId],
    )).rows;
    if (occurrences.length !== 1) throw new Error("DTS compatible source occurrence is ambiguous");
    const sourceIdentity = `dts-compatible-property:${configRevisionId}:${property.propertyOccurrenceId}`;
    const observed = await ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:auth.organization.id,sourceIdentity,catalogReleaseId:pin.id,
      matcherRevision:subjectMatcherRevision,matcherOutput:{status:observationStatus},
      provenance:{projectId:property.projectId,logicalNodeId:property.logicalNodeId,
        configRevisionId,sourceOccurrenceId:occurrences[0]!.id,sourceLocator:locator},
    },{kind:"observation"});
    if (observed.kind !== "observation") throw new Error("DTS source observation was not written");
    observationIds.push(observed.id);

    // Re-read the persisted association. No client or caller-supplied provenance reaches the proof reader.
    const bound = (await tx.query<{ projectId: string; configSetId: string; fileId: string;
      configRevisionId: string; logicalNodeId: string; catalogReleaseId: string;
      matcherRevision: string; locator: DtsObservationLocator }>(
      `select observation.project_id as "projectId",occurrence.config_set_id as "configSetId",
         occurrence.file_id as "fileId",observation.config_revision_id as "configRevisionId",
         observation.logical_node_id as "logicalNodeId",observation.catalog_release_id as "catalogReleaseId",
         observation.matcher_revision as "matcherRevision",observation.source_locator as locator
       from parameter_catalog.parameter_observations observation
       join parameter_catalog.project_parameter_source_occurrences occurrence
         on occurrence.id=observation.source_occurrence_id and occurrence.organization_id=observation.organization_id
         and occurrence.project_id=observation.project_id and occurrence.logical_node_id=observation.logical_node_id
       where observation.id=$1 and observation.organization_id=$2 and observation.project_id=$3`,
      [observed.id,auth.organization.id,property.projectId],
    )).rows;
    if (bound.length !== 1) throw new Error("DTS observation provenance is unavailable");
    const input: CurrentDtsCompatibleSourceInput = {organizationId:auth.organization.id,
      observationId:observed.id,...bound[0]!};
    const source = await readCurrentDtsCompatibleSource(tx,objectStore,auth,input);
    if (source.status !== "current") throw new Error(`DTS evidence source is ${source.status}`);
    if (!isDeepStrictEqual(source.compatibles,parsed.values)) {
      throw new Error("DTS compatible source changed during evidence production");
    }
    for (const compatible of new Set(source.compatibles)) {
      const matched = matches.get(compatible)!;
      if (matched.status === "matched" && matched.subject.kind === "driver") continue;
      const status = matched.status === "ambiguous" ? "ambiguous"
        : matched.status === "retired" ? "retired-registration-observed" : "unknown";
      await ingestSourceBoundEvidenceInTransaction(tx,{
        organizationId:auth.organization.id,
        sourceIdentity:`dts-compatible:${observed.id}:${compatible}`,
        catalogReleaseId:pin.id,matcherRevision:subjectMatcherRevision,
        matcherOutput:{status},evidence:{compatible},
      },{kind:"review",observationId:observed.id,
        projectId:property.projectId,configRevisionId});
    }
  }
  const finalPin = await captureCurrentCatalogPin(pool);
  if (!finalPin || finalPin.id !== pin.id || finalPin.digest !== pin.digest) {
    throw new Error("Catalog release changed during DTS evidence production");
  }
  if (observationIds.length) {
    const materialized = await materializeReviewItemsInTransaction(tx,auth.organization.id,pin,observationIds);
    if (!materialized.ok) throw new Error(`Review evidence grouping failed: ${materialized.error.kind}`);
  }
}
