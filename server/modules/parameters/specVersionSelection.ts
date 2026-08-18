/**
 * D6 / TD-049 spec-version selection.
 * Pin to a binding/CR version when one exists. Rank only for unmatched specs:
 * definition_lifecycle active → deprecated → draft, then version_status
 * active → superseded → draft, then version desc.
 */
import type { Queryable } from "../../shared/database/client";

/** Prefer version_status; fall back to the dual-write lifecycle column. */
export const SPEC_VERSION_STATUS_RANK_SQL = `
  case coalesce(psv.version_status, psv.lifecycle)
    when 'active' then 0
    when 'superseded' then 1
    when 'deprecated' then 1
    else 2
  end`;

export const DEFINITION_LIFECYCLE_RANK_SQL = `
  case ps.definition_lifecycle
    when 'active' then 0
    when 'deprecated' then 1
    else 2
  end`;

/**
 * Pin when a binding revision is in scope (`b`); otherwise rank version_status.
 * Used by dashboard identity laterals.
 */
export const PINNED_OR_RANKED_SPEC_VERSION_LATERAL = `
  left join lateral (
    select psv.*
    from parameter_spec_versions psv
    where psv.id = (
      select tip.parameter_spec_version_id
      from project_parameter_binding_revisions tip
      where tip.binding_id = b.id
      order by tip.created_at desc
      limit 1
    )
    or (
      psv.parameter_spec_id = ps.id
      and not exists (
        select 1 from project_parameter_binding_revisions tip where tip.binding_id = b.id
      )
    )
    order by ${SPEC_VERSION_STATUS_RANK_SQL}, psv.version desc
    limit 1
  ) psv on true
`;

/**
 * Pin to `pcr.binding_revision_id` when present; otherwise rank version_status.
 */
export const PINNED_OR_RANKED_SPEC_VERSION_FROM_CR_LATERAL = `
  left join lateral (
    select psv.*
    from parameter_spec_versions psv
    where psv.parameter_spec_id = ps.id
      and (
        pcr.binding_revision_id is null
        or psv.id = (
          select tip.parameter_spec_version_id
          from project_parameter_binding_revisions tip
          where tip.id = pcr.binding_revision_id
        )
      )
    order by ${SPEC_VERSION_STATUS_RANK_SQL}, psv.version desc
    limit 1
  ) psv on true
`;

/** Pin display laterals to the tip binding revision. Requires a `bpr` alias already in scope. */
export const PINNED_SPEC_VERSION_JOIN_FROM_BPR = `
  left join parameter_spec_versions psv on psv.id = bpr.parameter_spec_version_id
`;

/**
 * Pin to the tip revision of `inserted.project_parameter_binding_id` when present;
 * otherwise rank version_status.
 */
export const PINNED_OR_RANKED_SPEC_VERSION_FROM_INSERTED_BINDING_LATERAL = `
  left join lateral (
    select psv.*
    from parameter_spec_versions psv
    where psv.parameter_spec_id = ps.id
      and (
        inserted.project_parameter_binding_id is null
        or psv.id = (
          select tip.parameter_spec_version_id
          from project_parameter_binding_revisions tip
          where tip.binding_id = inserted.project_parameter_binding_id
          order by tip.created_at desc
          limit 1
        )
      )
    order by ${SPEC_VERSION_STATUS_RANK_SQL}, psv.version desc
    limit 1
  ) psv on true
`;

export async function loadPinnedSpecVersionId(
  db: Queryable,
  bindingRevisionId: string
): Promise<string | null> {
  const result = await db.query<{ parameter_spec_version_id: string }>(
    `
    select parameter_spec_version_id
    from project_parameter_binding_revisions
    where id = $1
    `,
    [bindingRevisionId]
  );
  return result.rows[0]?.parameter_spec_version_id ?? null;
}
