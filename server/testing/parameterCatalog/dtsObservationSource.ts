import type { Queryable } from "../../shared/database/client";
import { parseStoredEvidence } from "../../modules/parameter-governance/review/query";

export async function captureDtsReviewEvidenceStateFixture(db: Queryable, input: {
  organizationId: string; projectId: string;
}) {
  const evidence = (await db.query<{ id: string; observationId: string | null; evidence: unknown }>(
    `select id,observation_id as "observationId",evidence from parameter_catalog.parameter_review_evidence
     where organization_id=$1 order by id`, [input.organizationId],
  )).rows.map((row) => ({ ...row, evidence: parseStoredEvidence(row.evidence) }));
  const items = (await db.query<{ id: string; status: string }>(
    `select id,status from parameter_catalog.parameter_review_items where organization_id=$1 order by id`,
    [input.organizationId],
  )).rows;
  const observations = (await db.query<{ id: string }>(
    `select id from parameter_catalog.parameter_observations where organization_id=$1 and project_id=$2 order by id`,
    [input.organizationId,input.projectId],
  )).rows;
  return { evidence, items, observations };
}

/** Test-only Catalog provenance setup; production reads use the Catalog owner's typed seam. */
export async function insertDtsObservationSourceFixture(db: Queryable, input: {
  organizationId: string; projectId: string; configSetId: string; fileId: string;
  logicalNodeId: string; configRevisionId: string; occurrenceId: string;
  observationId: string; catalogReleaseId: string;
  locator: { kind: "dts-property"; fileVersionId: string; nodeOccurrenceId: string;
    propertyOccurrenceId: string; propertyName: string };
}) {
  await db.query(`insert into parameter_catalog.project_parameter_source_occurrences
    (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id)
    values ($1,$2,$3,$4,$5,'dts',$6) on conflict (id) do nothing`,
    [input.occurrenceId,input.organizationId,input.projectId,input.configSetId,input.fileId,input.logicalNodeId]);
  await db.query(`insert into parameter_catalog.parameter_observations
    (id,organization_id,project_id,logical_node_id,config_revision_id,source_identity,source_locator,
     catalog_release_id,matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'matcher-d897','fingerprint-d897',$9,
      parameter_catalog.canonical_dts_parameter_locator_digest($7::jsonb))`,
    [input.observationId,input.organizationId,input.projectId,input.logicalNodeId,input.configRevisionId,
      input.observationId,JSON.stringify(input.locator),input.catalogReleaseId,input.occurrenceId]);
}

/** Mirrors the exact Catalog-owner handoff without adding a production query in the DTS owner. */
export async function loadDtsObservationSourceFixture(db: Queryable, input: {
  organizationId: string; projectId: string; observationId: string;
}) {
  const rows = (await db.query<{ observationId: string; catalogReleaseId: string;
    matcherRevision: string; configSetId: string; fileId: string;
    configRevisionId: string; logicalNodeId: string; locator: {
      kind: "dts-property"; fileVersionId: string; nodeOccurrenceId: string;
      propertyOccurrenceId: string; propertyName: string;
    } }>(
    `select observation.id as "observationId",observation.catalog_release_id as "catalogReleaseId",
      observation.matcher_revision as "matcherRevision",occurrence.config_set_id as "configSetId",
      occurrence.file_id as "fileId",observation.config_revision_id as "configRevisionId",
      observation.logical_node_id as "logicalNodeId",observation.source_locator as locator
     from parameter_catalog.parameter_observations observation
     join parameter_catalog.project_parameter_source_occurrences occurrence
       on occurrence.id=observation.source_occurrence_id and occurrence.organization_id=observation.organization_id
       and occurrence.project_id=observation.project_id and occurrence.occurrence_kind='dts'
     where observation.id=$1 and observation.organization_id=$2 and observation.project_id=$3`,
    [input.observationId,input.organizationId,input.projectId],
  )).rows;
  if (rows.length !== 1) throw new Error("Exact DTS observation fixture is unavailable");
  return { organizationId: input.organizationId,projectId: input.projectId,...rows[0]! };
}

export async function loadDtsReviewEvidenceSourceFixture(db: Queryable, input: {
  organizationId: string; projectId: string; reviewEvidenceId: string;
}) {
  const rows = (await db.query<{ evidence: unknown; observationId: string; configRevisionId: string;
    logicalNodeId: string; sourceOccurrenceId: string; fileId: string; configSetId: string }>(
    `select evidence.evidence,observation.id as "observationId",
      observation.config_revision_id as "configRevisionId",observation.logical_node_id as "logicalNodeId",
      occurrence.id as "sourceOccurrenceId",occurrence.file_id as "fileId",occurrence.config_set_id as "configSetId"
     from parameter_catalog.parameter_review_evidence evidence
     join parameter_catalog.parameter_observations observation
       on observation.id=evidence.observation_id and observation.organization_id=evidence.organization_id
     join parameter_catalog.project_parameter_source_occurrences occurrence
       on occurrence.id=observation.source_occurrence_id and occurrence.organization_id=observation.organization_id
       and occurrence.project_id=observation.project_id and occurrence.logical_node_id=observation.logical_node_id
     where evidence.id=$1 and evidence.organization_id=$2 and observation.project_id=$3`,
    [input.reviewEvidenceId,input.organizationId,input.projectId],
  )).rows;
  if (rows.length !== 1) throw new Error("Exact DTS review evidence fixture is unavailable");
  const evidence = parseStoredEvidence(rows[0]!.evidence);
  if (!evidence) throw new Error("Exact DTS review evidence fixture is invalid");
  return { ...rows[0]!, evidence };
}
