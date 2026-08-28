import type { Queryable } from "../../shared/database/client";

export type EffectiveDefinitionVerificationReport = {
  status: "ready" | "blocked";
  organizationId: string | null;
  checks: Array<{ code: string; count: number }>;
};

async function count(
  db: Queryable,
  text: string,
  values: unknown[],
): Promise<number> {
  const result = await db.query<{ count: string | number }>(text, values);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Read-only post-reconciliation gate. It intentionally validates the stored
 * catalog and observed binding tips rather than trusting the reconciliation
 * run report, so operators can run it independently before contract/cutover.
 */
export async function verifyEffectiveDriverParameterDefinitions(
  db: Queryable,
  input: { organizationId?: string; configRevisionId?: string },
): Promise<EffectiveDefinitionVerificationReport> {
  // Platform rows are part of every organization's fallback catalog, so the
  // catalog checks always include them alongside the requested tenant rows.
  const scope = input.organizationId
    ? "and (ps.organization_id = $1 or ps.organization_id is null)"
    : "";
  const values = input.organizationId ? [input.organizationId] : [];
  const bindingValues: unknown[] = [...values];
  const bindingScopeParts: string[] = [];
  if (input.organizationId) bindingScopeParts.push("and b.organization_id = $1");
  if (input.configRevisionId) {
    bindingValues.push(input.configRevisionId);
    bindingScopeParts.push(`and br.config_revision_id = $${bindingValues.length}`);
  }
  const bindingScope = bindingScopeParts.join("\n        ");
  const checks: Array<{ code: string; count: number }> = [];

  checks.push({
    code: "active-driver-definition-incomplete",
    count: await count(
      db,
      `
      select count(*)::text as count
      from parameter_specs ps
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join driver_schemas ds on ds.id = dps.driver_schema_id
      left join attribution_subjects asub on asub.id = ps.attribution_subject_id
      left join driver_registrations dr on dr.attribution_subject_id = ps.attribution_subject_id
      left join lateral (
        select 1
        from parameter_spec_versions psv
        where psv.parameter_spec_id = ps.id
          and psv.version_status = 'active'
          and psv.lifecycle = 'active'
        order by psv.version desc
        limit 1
      ) active_version on true
      where (
          (
            ps.source_kind = 'dts'
            and asub.subject_kind = 'driver-registration'
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
          or (
            ps.attribution_subject_id is not null
            and asub.subject_kind = 'driver-registration'
            -- Legacy surface rows have a subject and a dts_property_specs row,
            -- but no linked driver schema. They are intentionally provisional;
            -- only driver-backed/manual rows without a surface row participate
            -- in the recognized-definition gate.
            and (dps.parameter_spec_id is null or dps.driver_schema_id is not null)
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
        )
        and ps.definition_lifecycle = 'active'
        ${scope}
        and (
          ps.attribution_subject_id is null
          or active_version is null
          or (
            ps.source_kind = 'dts'
            and (
              dps.driver_schema_id is null
              or ds.attribution_subject_id is distinct from ps.attribution_subject_id
              or dr.attribution_subject_id is null
              or not exists (
                select 1
                from driver_schema_versions active_schema_version
                where active_schema_version.driver_schema_id = dps.driver_schema_id
                  and active_schema_version.lifecycle = 'active'
              )
            )
          )
        )
      `,
      values,
    ),
  });

  checks.push({
    code: "active-driver-identity-duplicate",
    count: await count(
      db,
      `
      select count(*)::text as count
      from (
        select ps.organization_id,
               lower(asub.source_key) as driver_identity_key,
               coalesce(ps.property_key, dps.property_key) as property_key
        from parameter_specs ps
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
        where (
            (
              ps.source_kind = 'dts'
              and asub.subject_kind = 'driver-registration'
              and not exists (
                select 1 from driver_schemas driver_root
                where driver_root.parameter_spec_id = ps.id
              )
            )
            or (
              ps.attribution_subject_id is not null
              and asub.subject_kind = 'driver-registration'
              and not exists (
                select 1 from driver_schemas driver_root
                where driver_root.parameter_spec_id = ps.id
              )
            )
          )
          and ps.definition_lifecycle = 'active'
          and exists (
            select 1 from parameter_spec_versions psv
            where psv.parameter_spec_id = ps.id
              and psv.version_status = 'active'
              and psv.lifecycle = 'active'
          )
          ${scope}
        group by ps.organization_id, lower(asub.source_key), coalesce(ps.property_key, dps.property_key)
        having count(*) > 1
      ) duplicates
      `,
      values,
    ),
  });

  checks.push({
    code: "active-driver-version-duplicate",
    count: await count(
      db,
      `
      select count(*)::text as count
      from parameter_specs ps
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join attribution_subjects asub on asub.id = ps.attribution_subject_id
        where (
          (
              ps.source_kind = 'dts'
              and asub.subject_kind = 'driver-registration'
              and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
          or (
            ps.attribution_subject_id is not null
            and asub.subject_kind = 'driver-registration'
            and (dps.parameter_spec_id is null or dps.driver_schema_id is not null)
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
        )
        and ps.definition_lifecycle = 'active'
        ${scope}
        and (
          select count(*)
          from parameter_spec_versions psv
          where psv.parameter_spec_id = ps.id
            and psv.version_status = 'active'
            and psv.lifecycle = 'active'
        ) > 1
      `,
      values,
    ),
  });

  checks.push({
    code: "active-driver-placement-missing",
    count: await count(
      db,
      `
      select count(*)::text as count
      from (
        select distinct target.organization_id, target.parameter_spec_id
        from (
          select ps.organization_id, ps.id as parameter_spec_id, ps.attribution_subject_id
          from parameter_specs ps
          inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
          where ps.organization_id is not null
            and (
              (
                ps.source_kind = 'dts'
                and asub.subject_kind = 'driver-registration'
                and not exists (
                  select 1 from driver_schemas driver_root
                  where driver_root.parameter_spec_id = ps.id
                )
              )
              or (
                ps.attribution_subject_id is not null
                and asub.subject_kind = 'driver-registration'
                and not exists (
                  select 1 from driver_schemas driver_root
                  where driver_root.parameter_spec_id = ps.id
                )
              )
            )
            and ps.definition_lifecycle = 'active'
            and exists (
              select 1 from parameter_spec_versions psv
              where psv.parameter_spec_id = ps.id
                and psv.version_status = 'active'
                and psv.lifecycle = 'active'
            )
            ${scope}
          union all
          select org.id, ps.id, ps.attribution_subject_id
          from organizations org
          cross join parameter_specs ps
          inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
          where ps.organization_id is null
            and ps.source_kind = 'dts'
            and asub.subject_kind = 'driver-registration'
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
            and ps.definition_lifecycle = 'active'
            and exists (
              select 1 from parameter_spec_versions psv
              where psv.parameter_spec_id = ps.id
                and psv.version_status = 'active'
                and psv.lifecycle = 'active'
            )
            ${input.organizationId ? "and org.id = $1" : ""}
        ) target
        inner join attribution_subjects asub on asub.id = target.attribution_subject_id
          where asub.subject_kind = 'driver-registration'
          and not exists (
            select 1
            from driver_registration_placements drp
            inner join parameter_modules dgm
              on dgm.id = drp.driver_group_module_id
             and dgm.organization_id = drp.organization_id
             and dgm.kind = 'driver-group'
             and dgm.attribution_subject_id = drp.attribution_subject_id
            left join parameter_modules category
              on category.id = drp.default_business_category_module_id
            where drp.organization_id = target.organization_id
              and drp.attribution_subject_id = target.attribution_subject_id
              and (
                drp.default_business_category_module_id is null
                or (category.id is not null and category.organization_id = drp.organization_id and category.kind = 'business')
              )
          )
      ) missing
      `,
      values,
    ),
  });

  checks.push({
    code: "active-node-type-placement-missing",
    count: await count(
      db,
      `
      select count(*)::text as count
      from (
        select ps.organization_id as target_organization_id,
               ps.id as parameter_spec_id,
               ps.attribution_subject_id,
               asub.source_key
        from parameter_specs ps
        inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
        where ps.organization_id is not null
          and asub.subject_kind = 'node-type-definition'
          and ps.definition_lifecycle = 'active'
          and exists (
            select 1 from parameter_spec_versions psv
            where psv.parameter_spec_id = ps.id
              and psv.version_status = 'active'
              and psv.lifecycle = 'active'
          )
          ${input.organizationId ? "and ps.organization_id = $1" : ""}
        union all
        select org.id,
               ps.id,
               ps.attribution_subject_id,
               asub.source_key
        from organizations org
        cross join parameter_specs ps
        inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
        where ps.organization_id is null
          and asub.subject_kind = 'node-type-definition'
          and ps.definition_lifecycle = 'active'
          and exists (
            select 1 from parameter_spec_versions psv
            where psv.parameter_spec_id = ps.id
              and psv.version_status = 'active'
              and psv.lifecycle = 'active'
          )
          ${input.organizationId ? "and org.id = $1" : ""}
      ) target
      where not exists (
        select 1
        from parameter_modules node_type
        where node_type.organization_id = target.target_organization_id
          and node_type.kind = 'node-type'
          and (
            node_type.attribution_subject_id = target.attribution_subject_id
            or lower(coalesce(node_type.source_key, '')) = lower(coalesce(target.source_key, ''))
          )
      )
      `,
      values,
    ),
  });

  checks.push({
    code: "active-node-type-definition-incomplete",
    count: await count(
      db,
      `
      select count(*)::text as count
      from (
        select ps.organization_id as target_organization_id,
               ps.source_kind,
               ps.id as parameter_spec_id,
               ps.attribution_subject_id,
               asub.source_key,
               dps.driver_schema_id,
               ds.attribution_subject_id as schema_subject_id
        from parameter_specs ps
        inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        left join driver_schemas ds on ds.id = dps.driver_schema_id
        where ps.organization_id is not null
          and asub.subject_kind = 'node-type-definition'
          and ps.definition_lifecycle = 'active'
          and exists (
            select 1 from parameter_spec_versions psv
            where psv.parameter_spec_id = ps.id
              and psv.version_status = 'active'
              and psv.lifecycle = 'active'
          )
          ${input.organizationId ? "and ps.organization_id = $1" : ""}
        union all
        select org.id,
               ps.source_kind,
               ps.id,
               ps.attribution_subject_id,
               asub.source_key,
               dps.driver_schema_id,
               ds.attribution_subject_id
        from organizations org
        cross join parameter_specs ps
        inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        left join driver_schemas ds on ds.id = dps.driver_schema_id
        where ps.organization_id is null
          and asub.subject_kind = 'node-type-definition'
          and ps.definition_lifecycle = 'active'
          and exists (
            select 1 from parameter_spec_versions psv
            where psv.parameter_spec_id = ps.id
              and psv.version_status = 'active'
              and psv.lifecycle = 'active'
          )
          ${input.organizationId ? "and org.id = $1" : ""}
      ) target
      where not exists (
        select 1
        from node_type_definitions ntd
        where ntd.attribution_subject_id = target.attribution_subject_id
      )
      or not exists (
        select 1
        from parameter_modules node_type
        where node_type.organization_id = target.target_organization_id
          and node_type.kind = 'node-type'
          and (
            node_type.attribution_subject_id = target.attribution_subject_id
            or lower(coalesce(node_type.source_key, '')) = lower(coalesce(target.source_key, ''))
          )
      )
      or (
        target.source_kind = 'dts'
        and (
          target.driver_schema_id is null
          or target.schema_subject_id is null
          or target.schema_subject_id is distinct from target.attribution_subject_id
          or not exists (
            select 1
            from driver_schema_versions active_schema_version
            where active_schema_version.driver_schema_id = target.driver_schema_id
              and active_schema_version.lifecycle = 'active'
          )
        )
      )
      `,
      values,
    ),
  });

  checks.push({
    code: "active-node-type-version-duplicate",
    count: await count(
      db,
      `
      select count(*)::text as count
      from parameter_specs ps
      inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
      where asub.subject_kind = 'node-type-definition'
        and ps.definition_lifecycle = 'active'
        ${scope}
        and (
          select count(*)
          from parameter_spec_versions psv
          where psv.parameter_spec_id = ps.id
            and psv.version_status = 'active'
            and psv.lifecycle = 'active'
        ) > 1
      `,
      values,
    ),
  });

  checks.push({
    code: "recognized-binding-definition-incomplete",
    count: await count(
      db,
      `
      select count(distinct b.id)::text as count
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      inner join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join driver_schemas ds on ds.id = dps.driver_schema_id
      left join parameter_modules binding_module on binding_module.id = b.module_id
      left join attribution_subjects asub on asub.id = ps.attribution_subject_id
      left join driver_registrations dr on dr.attribution_subject_id = ps.attribution_subject_id
      left join driver_registration_placements binding_placement
        on binding_placement.organization_id = b.organization_id
       and binding_placement.attribution_subject_id = ps.attribution_subject_id
      left join parameter_modules placement_module
        on placement_module.id = binding_placement.driver_group_module_id
      left join parameter_modules placement_category
        on placement_category.id = binding_placement.default_business_category_module_id
      where (
          (
            ps.source_kind = 'dts'
            and asub.subject_kind = 'driver-registration'
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
          or (
            ps.attribution_subject_id is not null
            and asub.subject_kind = 'driver-registration'
            and (dps.parameter_spec_id is null or dps.driver_schema_id is not null)
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
        )
        ${bindingScope}
        and (
          ps.definition_lifecycle <> 'active'
          or psv.version_status <> 'active'
          or psv.lifecycle <> 'active'
          or ps.attribution_subject_id is null
          or dr.attribution_subject_id is null
          or (
            ps.source_kind = 'dts'
            and (
              dps.driver_schema_id is null
              or ds.attribution_subject_id is distinct from ps.attribution_subject_id
              or not exists (
                select 1
                from driver_schema_versions active_schema_version
                where active_schema_version.driver_schema_id = dps.driver_schema_id
                  and active_schema_version.lifecycle = 'active'
              )
            )
          )
          or (
            ps.attribution_subject_id is not null
            and (
              b.module_id is null
              or binding_module.id is null
              or binding_module.organization_id is distinct from b.organization_id
              or (
                ps.source_kind = 'dts'
                and binding_module.kind <> 'driver-group'
              )
              or binding_module.kind not in ('driver-group', 'node-type')
              or binding_module.attribution_subject_id is null
              or binding_module.attribution_subject_id is distinct from ps.attribution_subject_id
            )
          )
          or binding_placement.id is null
          or placement_module.id is null
          or placement_module.organization_id is distinct from b.organization_id
          or placement_module.kind <> 'driver-group'
          or placement_module.attribution_subject_id is distinct from ps.attribution_subject_id
          or (
            binding_placement.default_business_category_module_id is not null
            and (
              placement_category.id is null
              or placement_category.organization_id is distinct from b.organization_id
              or placement_category.kind <> 'business'
            )
          )
        )
      `,
      bindingValues,
    ),
  });

  checks.push({
    code: "recognized-node-type-binding-incomplete",
    count: await count(
      db,
      `
      select count(distinct b.id)::text as count
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
      inner join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
      inner join attribution_subjects asub on asub.id = ps.attribution_subject_id
      left join dts_property_specs dps on dps.parameter_spec_id = ps.id
      left join driver_schemas ds on ds.id = dps.driver_schema_id
      left join parameter_modules binding_module on binding_module.id = b.module_id
      where asub.subject_kind = 'node-type-definition'
        and ps.definition_lifecycle = 'active'
        and psv.version_status = 'active'
        and psv.lifecycle = 'active'
        ${bindingScope}
        and (
          b.module_id is null
          or binding_module.id is null
          or binding_module.organization_id is distinct from b.organization_id
          or binding_module.kind <> 'node-type'
          or not (
            binding_module.attribution_subject_id = ps.attribution_subject_id
            or lower(coalesce(binding_module.source_key, '')) = lower(coalesce(asub.source_key, ''))
          )
          or not exists (
            select 1
            from node_type_definitions ntd
            where ntd.attribution_subject_id = ps.attribution_subject_id
          )
          or dps.driver_schema_id is null
          or ds.attribution_subject_id is distinct from ps.attribution_subject_id
          or not exists (
            select 1
            from driver_schema_versions active_schema_version
            where active_schema_version.driver_schema_id = dps.driver_schema_id
              and active_schema_version.lifecycle = 'active'
          )
        )
      `,
      bindingValues,
    ),
  });

  checks.push({
    code: "unreviewed-driver-tip",
    count: await count(
      db,
      `
      select count(distinct br.binding_id)::text as count
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join parameter_specs ps on ps.id = b.parameter_spec_id
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        left join driver_schemas ds on ds.id = dps.driver_schema_id
        left join attribution_subjects asub on asub.id = ps.attribution_subject_id
        inner join parameter_spec_versions psv on psv.id = br.parameter_spec_version_id
      where coalesce(br.schema_state, 'unreviewed') = 'unreviewed'
        and (
          (
            ps.source_kind = 'dts'
            and asub.subject_kind = 'driver-registration'
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
          or (
            ps.attribution_subject_id is not null
            and asub.subject_kind = 'driver-registration'
            and (dps.parameter_spec_id is null or dps.driver_schema_id is not null)
            and not exists (
              select 1 from driver_schemas driver_root
              where driver_root.parameter_spec_id = ps.id
            )
          )
        )
        ${bindingScope}
      `,
      bindingValues,
    ),
  });

  const blockers = checks.filter((check) => check.count > 0);
  return {
    status: blockers.length > 0 ? "blocked" : "ready",
    organizationId: input.organizationId ?? null,
    checks,
  };
}
