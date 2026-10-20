import type { Queryable } from "../../shared/database/client";
import { parseDtsValue } from "../dts/valueAst";
import { parseCanonicalNodeName } from "../parameter-catalog-contract";

/** Current source instances, including nodes that have no parameter Binding yet. */
export async function listModuleRecognitionInstances(db: Queryable, organizationId: string, input: {
  compatibles: readonly string[]; nodeTypeName: string | null;
  projectId?: string; configRevisionId?: string;
}): Promise<Array<{ projectId: string; logicalNodeId: string }>> {
  const nodes = (await db.query<{ projectId: string; logicalNodeId: string; name: string; compatible: string | null }>(
    `select revision.project_id as "projectId", logical.logical_node_id as "logicalNodeId", logical.name,
       coalesce((select case when effect.effect_kind in ('set','override') then property.raw_text else '' end
         from public.dts_occurrence_effects effect
         left join public.dts_property_occurrences property on property.id=effect.property_occurrence_id
         where effect.logical_node_revision_id=logical.id and effect.config_revision_id=revision.id
           and effect.property_name='compatible'
         order by effect.source_order desc limit 1), to_json(logical.compatible)::text) as compatible
     from public.dts_logical_node_revisions logical
     join public.dts_config_revisions revision on revision.id=logical.config_revision_id
       and revision.organization_id=$1
     join public.dts_config_set config on config.id=revision.config_set_id and config.organization_id=$1
       and config.project_id=revision.project_id
     where ($2::text is null or revision.project_id=$2)
       and (($3::text is not null and revision.id=$3)
         or ($3::text is null and revision.id=(select current.id from public.dts_config_revisions current
           where current.organization_id=$1 and current.config_set_id=config.id
             and current.status in ('resolved','validated','compiled','pending_approval')
             and not exists (select 1 from public.dts_config_revision_members member
               join public.project_parameter_files file on file.id=member.file_id
               where member.config_revision_id=current.id and member.file_version_id is distinct from file.current_version_id)
           order by current.revision_number desc limit 1)))`,
    [organizationId, input.projectId ?? null, input.configRevisionId ?? null],
  )).rows;
  const aliases = new Set(input.compatibles);
  return nodes.filter((node) => {
    const value = parseDtsValue("compatible", node.compatible ?? "").value;
    const compatibles = value.kind === "strings" ? value.values : [];
    if (compatibles.some((compatible) => aliases.has(compatible))) return true;
    const name = parseCanonicalNodeName(node.name);
    return compatibles.length === 0 && input.nodeTypeName !== null && name.ok && name.value === input.nodeTypeName;
  }).map(({ projectId, logicalNodeId }) => ({ projectId, logicalNodeId }));
}
