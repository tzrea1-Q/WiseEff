import type { Queryable } from "../../server/shared/database/client";
import type { SeedReconciliationManifest } from "./seedReconciliation";
import { seedRebuildDigest } from "./seedRebuildPlan";

const targets = ["atlas", "aurora", "nebula"];
const dtsLocator = (file: string, node: string) => `${file}!/${node.replace(/^\/+/, "")}`;

export function reviewedSeedIdentities(manifest: Pick<SeedReconciliationManifest, "boardOccurrences">): string[] {
  return targets.flatMap((project) => [
    ...manifest.boardOccurrences.filter((row) => row.board === project && row.scope === "current")
      .map((row) => {
        const kind = row.formalSubject.kind === "driver" ? "driver" : "node-type";
        return [project, "dts", dtsLocator("board.dts", row.nodePath), kind,
          `${kind}:${row.formalSubject.value}`, row.propertyKey].join("|");
      }),
    ...["fast-charge-profile-matrix", "battery-thermal-derate-curve"].map((property) =>
      `${project}|dts|${dtsLocator("charging-thermal.dts", "wiseeff_node_type_demo/charging_core")}|node-type|node-type:charging_core|${property}`),
    ...["charger.cv.limitMv", "battery.thermal.targetTempC"].map((property) =>
      `${project}|json|/${property}|configuration-schema|configuration-schema:wiseeff.power-config|${property}`),
  ]).sort();
}

/** Inner joins deliberately exclude bindings with a missing value, source pin, or revision member. */
export async function verifySeedIdentities(db: Queryable, organizationId: string, expected: string[]) {
  const result = await db.query<{
    project_id: string; binding_id: string; occurrence_kind: string; logical_node_id: string | null;
    node_locator: string | null; source_ref: string; source_name: string; locator: { pointer?: string };
    subject_kind: string; subject_key: string; property_key: string;
  }>(`select b.project_id,b.id as binding_id,o.occurrence_kind,o.logical_node_id,n.node_locator,
       v.source_ref,m.source_name,p.locator,s.kind as subject_kind,s.canonical_key as subject_key,d.property_key
     from parameter_catalog.current_project_parameter_bindings b
     join parameter_catalog.project_parameter_source_occurrences o on o.id=b.source_occurrence_id
     join parameter_catalog.project_parameter_values v on v.id=b.current_value_id
     join parameter_catalog.project_value_source_pins p on p.binding_id=b.id and p.project_value_id=b.current_value_id
     left join public.dts_logical_node_revisions n on n.logical_node_id=o.logical_node_id and n.config_revision_id=p.config_revision_id
     join parameter_catalog.catalog_subjects s on s.id=b.subject_id
     join parameter_catalog.parameter_definitions d on d.id=b.definition_id
     join public.dts_config_revision_members m on m.config_revision_id=p.config_revision_id
       and m.file_id=p.file_id and m.file_version_id=p.file_version_id
     where b.organization_id=$1 and b.project_id=any($2::text[])`, [organizationId, targets]);
  const actual = result.rows.map((row) => {
    const json = row.occurrence_kind === "json";
    const [file, node = ""] = row.source_ref.split("!", 2);
    const locator = json ? row.locator?.pointer : dtsLocator(file!, node);
    if (json ? row.logical_node_id !== null || row.node_locator !== null
      : !row.logical_node_id || row.node_locator === null || locator !== dtsLocator(row.source_name, row.node_locator)) {
      throw new Error("seed-rebuild-source-pin-mismatch");
    }
    return [row.project_id, row.occurrence_kind, locator, row.subject_kind,
      `${row.subject_kind}:${row.subject_key}`, row.property_key].join("|");
  }).sort();
  const counts = await db.query<{ count: string }>(`select count(*)::text as count
    from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=any($2::text[])`,
  [organizationId, targets]);
  if (Number(counts.rows[0]?.count) !== expected.length || new Set(actual).size !== actual.length
    || seedRebuildDigest(actual) !== seedRebuildDigest(expected)) throw new Error("seed-rebuild-identity-set-mismatch");
  return { bindings: actual.length, identityDigest: seedRebuildDigest(actual) };
}
