import type { KnowledgeEmbeddingClient } from "../../../knowledge/indexing/embeddingClient";
import { searchPublishedKnowledgeForLogAnalysis } from "../../../knowledge/logDomainRetrieval";
import type { Queryable } from "../../../../shared/database/client";
import { listLogDomainKnowledgeLinkEntryIds } from "../../domainsRepository";
import type { LogAnalysisToolContext, RelatedParameterContext } from "./toolContext";

type ParameterContextRow = {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  project_id: string;
  current_value: string | null;
  policy_target: string | null;
  schema_default: string | null;
};

type ParameterRevisionRow = {
  value: string | null;
  created_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Reuses the query shape of `perception.searchParameters` (the Xiaoze read tool)
 * but keyed by one binding id — this stays an internal worker function and never
 * enters the ToolRegistry (ADR-0022). Organization scope is bound in the SQL.
 */
async function loadRelatedParameter(
  db: Queryable,
  input: { organizationId: string; parameterId: string }
): Promise<RelatedParameterContext | null> {
  const { rows } = await db.query<ParameterContextRow>(
    `
select b.id,
       coalesce(psv.display_name, dps.property_key, ps.specification_key) as name,
       psv.description,
       dps.units as unit,
       b.project_id,
       coalesce(bpr.raw_value, bpr.canonical_value #>> '{}') as current_value,
       ppt.target_value #>> '{}' as policy_target,
       psv.schema_default #>> '{}' as schema_default
from project_parameter_bindings b
inner join parameter_specs ps
  on ps.id = b.parameter_spec_id
left join dts_property_specs dps
  on dps.parameter_spec_id = ps.id
left join parameter_spec_versions psv
  on psv.parameter_spec_id = ps.id
 and psv.id = (
   select psv2.id from parameter_spec_versions psv2
   where psv2.parameter_spec_id = ps.id
   order by psv2.version desc
   limit 1
 )
left join lateral (
  select raw_value, canonical_value
  from project_parameter_binding_revisions
  where binding_id = b.id
  order by created_at desc
  limit 1
) bpr on true
left join parameter_policy_targets ppt
  on ppt.parameter_spec_id = ps.id
 and ppt.organization_id = b.organization_id
where b.organization_id = $1
  and b.id = $2
limit 1
    `,
    [input.organizationId, input.parameterId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const revisions = await db.query<ParameterRevisionRow>(
    `
select coalesce(r.raw_value, r.canonical_value #>> '{}') as value,
       r.created_at
from project_parameter_binding_revisions r
inner join project_parameter_bindings b
  on b.id = r.binding_id
 and b.organization_id = $1
where r.binding_id = $2
order by r.created_at desc
limit 5
    `,
    [input.organizationId, input.parameterId]
  );

  return {
    parameterId: row.id,
    name: row.name,
    description: row.description ?? undefined,
    unit: row.unit ?? undefined,
    projectId: row.project_id,
    currentValue: row.current_value ?? undefined,
    schemaDefault: row.schema_default ?? undefined,
    policyTarget: row.policy_target ?? undefined,
    recentChanges: revisions.rows.map((revision) => ({
      value: revision.value ?? undefined,
      changedAt: dateTimeToIso(revision.created_at)
    }))
  };
}

/**
 * Binds the two database-backed tool seams for one analysis run. The closures
 * capture the organization id from the worker snapshot, so the tools cannot be
 * steered across tenants no matter what the model asks for.
 */
export function createDbLogAnalysisToolBackends(input: {
  db: Queryable;
  organizationId: string;
  logDomainId?: string;
  relatedParameterId?: string;
  embeddingClient?: KnowledgeEmbeddingClient;
}): Pick<LogAnalysisToolContext, "searchDomainKnowledge" | "loadRelatedParameterContext"> {
  return {
    searchDomainKnowledge: async (query: string) => {
      const linkedEntryIds = input.logDomainId
        ? await listLogDomainKnowledgeLinkEntryIds(input.db, {
            organizationId: input.organizationId,
            domainId: input.logDomainId
          })
        : [];
      return searchPublishedKnowledgeForLogAnalysis(input.db, {
        organizationId: input.organizationId,
        query,
        linkedEntryIds,
        embeddingClient: input.embeddingClient
      });
    },
    ...(input.relatedParameterId
      ? {
          loadRelatedParameterContext: () =>
            loadRelatedParameter(input.db, {
              organizationId: input.organizationId,
              parameterId: input.relatedParameterId!
            })
        }
      : {})
  };
}
