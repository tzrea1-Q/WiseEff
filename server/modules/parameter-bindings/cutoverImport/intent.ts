import type pg from "pg";
import type { ContractJsonValue } from "../../parameter-catalog-contract/index";
import { bindingImportDigest, captureBindingImportSource, captureDefinitionBindingImportSource } from "./index";

/** Deterministic P0 input. It contains no later-generated run, mapping or Archive ID. */
export type BindingImportIntent = {
  readonly version: "s6-binding-import-intent-v1";
  readonly sourceSnapshotFingerprint: string;
  readonly sourceInventoryFingerprint: string;
  readonly bindingInventoryDigest: string;
  readonly sourceAuthorityDigest: string;
  readonly bindings: readonly {
    readonly sourceBindingId: string;
    readonly sourceSpecId: string;
    readonly sourceChecksum: string;
    readonly definitionSourceChecksum: string;
    readonly sourceTipRevisionId: string;
    readonly sourceTipProofDigest: string;
  }[];
};

type Queryable = Pick<pg.PoolClient, "query">;
type JsonRow = { row: Record<string, ContractJsonValue> };
const rows = async (db: Queryable, sql: string, values: unknown[]) =>
  (await db.query<JsonRow>(sql,values)).rows.map(row => row.row);

/** Explicit file pointers prove a tip only when the complete member set matches uniquely. */
export async function readBindingTipProof(db: Queryable, bindingId: string): Promise<{
  sourceRevisionId: string;
  proofDigest: string;
}> {
  const binding = await captureBindingImportSource(db,bindingId);
  const nodes = await rows(db,"select to_jsonb(n) as row from public.dts_logical_nodes n where n.id=$1 and n.organization_id=$2 and n.project_id=$3",[binding.binding.logical_node_id,binding.binding.organization_id,binding.binding.project_id]);
  if (nodes.length !== 1) throw new Error("binding-tip-node-owner-unproved");
  const configSetId = nodes[0].config_set_id;
  const files = await rows(db,"select to_jsonb(f) as row from public.project_parameter_files f where f.config_set_id=$1 order by f.id",[configSetId]);
  // Empty file sets cannot make every revision a vacuous match.
  if (!files.length || files.some(f => f.enabled !== true || typeof f.current_version_id !== "string" || f.organization_id !== binding.binding.organization_id || f.project_id !== binding.binding.project_id)) throw new Error("binding-tip-file-pointers-unproved");
  const fileVersions = await rows(db,"select to_jsonb(v) as row from public.project_parameter_file_versions v join public.project_parameter_files f on f.current_version_id=v.id and f.id=v.file_id where f.config_set_id=$1 order by v.id",[configSetId]);
  if (fileVersions.length !== files.length) throw new Error("binding-tip-file-version-owner-unproved");
  const revisions = await rows(db,"select to_jsonb(r) as row from public.dts_config_revisions r where r.config_set_id=$1 order by r.id",[configSetId]);
  const members = await rows(db,"select to_jsonb(m) as row from public.dts_config_revision_members m join public.dts_config_revisions r on r.id=m.config_revision_id where r.config_set_id=$1 order by m.id",[configSetId]);
  const candidates = revisions.filter(revision => {
    if (revision.organization_id !== binding.binding.organization_id || revision.project_id !== binding.binding.project_id) return false;
    const set = members.filter(member => member.config_revision_id === revision.id);
    return set.length === files.length && files.every(file => set.filter(member => member.file_id === file.id && member.file_version_id === file.current_version_id).length === 1);
  });
  if (candidates.length !== 1) throw new Error("binding-tip-not-unique");
  const tips = binding.revisions.filter(revision => revision.config_revision_id === candidates[0].id);
  if (tips.length !== 1) throw new Error("binding-tip-value-unproved");
  const nodeRevisions = await rows(db,"select to_jsonb(n) as row from public.dts_logical_node_revisions n where n.logical_node_id=$1 and n.config_revision_id=$2",[binding.binding.logical_node_id,candidates[0].id]);
  if (nodeRevisions.length !== 1) throw new Error("binding-tip-locator-unproved");
  return {sourceRevisionId:tips[0].id,proofDigest:bindingImportDigest({nodes,files,fileVersions,revisions,members,nodeRevisions})};
}

/** Enumerates the complete source table; callers cannot select a convenient Definition subset. */
export async function captureBindingImportIntent(db: Queryable, pins: {
  sourceSnapshotFingerprint: string;
  sourceInventoryFingerprint: string;
}): Promise<BindingImportIntent> {
  const ids = await db.query<{ id: string }>("select id from public.project_parameter_bindings order by id");
  if (!ids.rows.length) throw new Error("binding-import-source-empty");
  const sources = [];
  const bindings: BindingImportIntent["bindings"][number][] = [];
  const definitionChecksums = new Map<string,string>();
  for (const row of ids.rows) {
    const source = await captureBindingImportSource(db,row.id);
    sources.push(source);
    const specId = source.binding.parameter_spec_id;
    if (!definitionChecksums.has(specId)) definitionChecksums.set(specId,bindingImportDigest(await captureDefinitionBindingImportSource(db,specId)));
    const tip = await readBindingTipProof(db,row.id);
    bindings.push({sourceBindingId:row.id,sourceSpecId:specId,sourceChecksum:bindingImportDigest(source),definitionSourceChecksum:definitionChecksums.get(specId)!,sourceTipRevisionId:tip.sourceRevisionId,sourceTipProofDigest:tip.proofDigest});
  }
  const authorities = [];
  for (const table of ["parameter_specs","parameter_spec_versions","attribution_subjects","driver_schemas","driver_schema_versions","driver_registrations","driver_registration_placements","parameter_modules","dts_property_specs"]) {
    // Names are a fixed server-owned allowlist. Complete rows preserve authority beyond display fields.
    authorities.push({table,rows:await rows(db,`select to_jsonb(source) as row from public.${table} source order by to_jsonb(source)::text`,[])});
  }
  return {version:"s6-binding-import-intent-v1",sourceSnapshotFingerprint:pins.sourceSnapshotFingerprint,sourceInventoryFingerprint:pins.sourceInventoryFingerprint,bindingInventoryDigest:bindingImportDigest(sources),sourceAuthorityDigest:bindingImportDigest(authorities),bindings};
}
