import type { Queryable } from "../../shared/database/client";
import type { OverlayLifecycle, PropertyValueShape } from "./types";

export type DriverSchemaOverlayRow = {
  id: string;
  organization_id: string | null;
  compatible: string;
  display_name: string;
  notes: string;
  lifecycle: OverlayLifecycle;
  version: number;
  superseded_by_schema_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

export type DriverSchemaOverlayPropertyRow = {
  id: string;
  driver_schema_overlay_id: string;
  parameter_spec_id: string;
  parameter_spec_version_id: string | null;
  property_key: string;
  sort_order: number;
  created_at: string;
  value_shape: PropertyValueShape | Record<string, unknown> | null;
  units: string | null;
  constraints: Record<string, unknown> | null;
  example_value: unknown;
  documentation: string | null;
  spec_lifecycle: OverlayLifecycle | null;
};

export type DriverSchemaOverlayPropertyInput = {
  id: string;
  parameterSpecId: string;
  propertyKey: string;
  sortOrder?: number;
};

export type DriverSchemaOverlayRecord = {
  id: string;
  organizationId: string | null;
  compatible: string;
  displayName: string;
  notes: string;
  lifecycle: OverlayLifecycle;
  version: number;
  supersededBySchemaId: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  properties: Array<{
    id: string;
    parameterSpecId: string;
    parameterSpecVersionId: string | null;
    propertyKey: string;
    valueShape: PropertyValueShape | Record<string, unknown>;
    units: string | null;
    constraints: Record<string, unknown>;
    exampleValue: unknown;
    documentation: string;
    specLifecycle: OverlayLifecycle | null;
    sortOrder: number;
  }>;
};

/** @deprecated Use DriverSchemaOverlayRecord — org-scoped overlays always carry organizationId. */
export type OrganizationDriverSchemaRecord = DriverSchemaOverlayRecord & { organizationId: string };
export type OrganizationDriverSchemaPropertyInput = DriverSchemaOverlayPropertyInput;
export type OrganizationDriverSchemaRow = DriverSchemaOverlayRow & { organization_id: string };
export type OrganizationDriverSchemaPropertyRow = DriverSchemaOverlayPropertyRow;

const OVERLAY_SELECT =
  "id, organization_id, compatible, display_name, notes, lifecycle, version, superseded_by_schema_id, created_by_user_id, updated_by_user_id, created_at::text, updated_at::text, activated_at::text";

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function mapProperty(row: DriverSchemaOverlayPropertyRow) {
  return {
    id: row.id,
    parameterSpecId: row.parameter_spec_id,
    parameterSpecVersionId: row.parameter_spec_version_id ?? null,
    propertyKey: row.property_key,
    valueShape: parseJsonb(row.value_shape, { kind: "unknown" as const }),
    units: row.units ?? null,
    constraints: parseJsonb(row.constraints, {}),
    exampleValue: row.example_value ?? null,
    documentation: row.documentation ?? "",
    specLifecycle: row.spec_lifecycle ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

function mapSchema(
  row: DriverSchemaOverlayRow,
  properties: DriverSchemaOverlayPropertyRow[],
): DriverSchemaOverlayRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    compatible: row.compatible,
    displayName: row.display_name,
    notes: row.notes ?? "",
    lifecycle: row.lifecycle,
    version: row.version,
    supersededBySchemaId: row.superseded_by_schema_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at ?? null,
    properties: properties
      .slice()
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order || left.property_key.localeCompare(right.property_key),
      )
      .map(mapProperty),
  };
}

async function loadProperties(
  db: Queryable,
  schemaIds: string[],
): Promise<Map<string, DriverSchemaOverlayPropertyRow[]>> {
  const bySchema = new Map<string, DriverSchemaOverlayPropertyRow[]>();
  if (schemaIds.length === 0) return bySchema;
  const result = await db.query<DriverSchemaOverlayPropertyRow>(
    `
    select
      odp.id,
      odp.driver_schema_overlay_id,
      odp.parameter_spec_id,
      odp.property_key,
      odp.sort_order,
      odp.created_at::text,
      psv.id as parameter_spec_version_id,
      psv.value_shape,
      psv.lifecycle as spec_lifecycle,
      psv.example_value,
      dps.units,
      dps.constraints,
      dps.documentation
    from driver_schema_overlay_properties odp
    left join lateral (
      select id, value_shape, lifecycle, example_value
      from parameter_spec_versions
      where parameter_spec_id = odp.parameter_spec_id
      order by version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = odp.parameter_spec_id
    where odp.driver_schema_overlay_id = any($1::text[])
    order by odp.sort_order asc, odp.property_key asc
    `,
    [schemaIds],
  );
  for (const row of result.rows) {
    const list = bySchema.get(row.driver_schema_overlay_id) ?? [];
    list.push(row);
    bySchema.set(row.driver_schema_overlay_id, list);
  }
  return bySchema;
}

async function mapRows(
  db: Queryable,
  rows: DriverSchemaOverlayRow[],
): Promise<DriverSchemaOverlayRecord[]> {
  const propertiesBySchema = await loadProperties(db, rows.map((row) => row.id));
  return rows.map((row) => mapSchema(row, propertiesBySchema.get(row.id) ?? []));
}

export async function listOrganizationDriverSchemas(
  db: Queryable,
  input: { organizationId: string; lifecycle?: OverlayLifecycle | OverlayLifecycle[] },
): Promise<OrganizationDriverSchemaRecord[]> {
  const lifecycles = input.lifecycle
    ? Array.isArray(input.lifecycle)
      ? input.lifecycle
      : [input.lifecycle]
    : null;
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id = $1
      and ($2::text[] is null or lifecycle = any($2::text[]))
    order by updated_at desc, id asc
    `,
    [input.organizationId, lifecycles],
  );
  const mapped = await mapRows(db, result.rows);
  return mapped as OrganizationDriverSchemaRecord[];
}

export async function listActivePlatformDriverSchemaOverlays(
  db: Queryable,
): Promise<DriverSchemaOverlayRecord[]> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id is null
      and lifecycle = 'active'
    order by compatible asc, id asc
    `,
  );
  return mapRows(db, result.rows);
}

export async function listActiveOrganizationDriverSchemaOverlays(
  db: Queryable,
): Promise<OrganizationDriverSchemaRecord[]> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id is not null
      and lifecycle = 'active'
    order by lower(compatible) asc, organization_id asc, id asc
    `,
  );
  const mapped = await mapRows(db, result.rows);
  return mapped as OrganizationDriverSchemaRecord[];
}

export async function getOrganizationDriverSchema(
  db: Queryable,
  input: { organizationId: string; schemaId: string },
): Promise<OrganizationDriverSchemaRecord | null> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id = $1 and id = $2
    limit 1
    `,
    [input.organizationId, input.schemaId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const propertiesBySchema = await loadProperties(db, [row.id]);
  return mapSchema(row, propertiesBySchema.get(row.id) ?? []) as OrganizationDriverSchemaRecord;
}

export async function getDriverSchemaOverlay(
  db: Queryable,
  schemaId: string,
): Promise<DriverSchemaOverlayRecord | null> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where id = $1
    limit 1
    `,
    [schemaId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const propertiesBySchema = await loadProperties(db, [row.id]);
  return mapSchema(row, propertiesBySchema.get(row.id) ?? []);
}

export async function findActiveOrganizationDriverSchemaByCompatible(
  db: Queryable,
  input: { organizationId: string; compatible: string },
): Promise<OrganizationDriverSchemaRecord | null> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id = $1
      and lower(compatible) = lower($2)
      and lifecycle = 'active'
    limit 1
    `,
    [input.organizationId, input.compatible],
  );
  const row = result.rows[0];
  if (!row) return null;
  const propertiesBySchema = await loadProperties(db, [row.id]);
  return mapSchema(row, propertiesBySchema.get(row.id) ?? []) as OrganizationDriverSchemaRecord;
}

export async function findActivePlatformDriverSchemaOverlayByCompatible(
  db: Queryable,
  compatible: string,
): Promise<DriverSchemaOverlayRecord | null> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where organization_id is null
      and lower(compatible) = lower($1)
      and lifecycle = 'active'
    limit 1
    `,
    [compatible],
  );
  const row = result.rows[0];
  if (!row) return null;
  const propertiesBySchema = await loadProperties(db, [row.id]);
  return mapSchema(row, propertiesBySchema.get(row.id) ?? []);
}

export async function insertOrganizationDriverSchema(
  db: Queryable,
  input: {
    id: string;
    organizationId: string;
    compatible: string;
    displayName: string;
    notes?: string;
    lifecycle?: OverlayLifecycle;
    version?: number;
    createdByUserId?: string | null;
    properties: DriverSchemaOverlayPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord> {
  const lifecycle = input.lifecycle ?? "draft";
  const version = input.version ?? 1;
  await db.query(
    `
    insert into driver_schema_overlays (
      id, organization_id, compatible, display_name, notes, lifecycle, version,
      created_by_user_id, updated_by_user_id, activated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
    `,
    [
      input.id,
      input.organizationId,
      input.compatible.trim(),
      input.displayName.trim(),
      input.notes ?? "",
      lifecycle,
      version,
      input.createdByUserId ?? null,
      lifecycle === "active" ? new Date().toISOString() : null,
    ],
  );
  for (const [index, property] of input.properties.entries()) {
    await db.query(
      `
      insert into driver_schema_overlay_properties (
        id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order
      ) values ($1, $2, $3, $4, $5)
      `,
      [
        property.id,
        input.id,
        property.parameterSpecId,
        property.propertyKey.trim(),
        property.sortOrder ?? index,
      ],
    );
  }
  const created = await getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.id,
  });
  if (!created) {
    throw new Error(`Failed to load driver schema overlay ${input.id}`);
  }
  return created;
}

export async function insertPlatformDriverSchemaOverlay(
  db: Queryable,
  input: {
    id: string;
    compatible: string;
    displayName: string;
    notes?: string;
    version?: number;
    createdByUserId?: string | null;
    properties: DriverSchemaOverlayPropertyInput[];
  },
): Promise<DriverSchemaOverlayRecord> {
  const version = input.version ?? 1;
  await db.query(
    `
    insert into driver_schema_overlays (
      id, organization_id, compatible, display_name, notes, lifecycle, version,
      created_by_user_id, updated_by_user_id, activated_at
    ) values ($1, null, $2, $3, $4, 'active', $5, $6, $6, now())
    `,
    [
      input.id,
      input.compatible.trim(),
      input.displayName.trim(),
      input.notes ?? "",
      version,
      input.createdByUserId ?? null,
    ],
  );
  for (const [index, property] of input.properties.entries()) {
    await db.query(
      `
      insert into driver_schema_overlay_properties (
        id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order
      ) values ($1, $2, $3, $4, $5)
      `,
      [
        property.id,
        input.id,
        property.parameterSpecId,
        property.propertyKey.trim(),
        property.sortOrder ?? index,
      ],
    );
  }
  const created = await getDriverSchemaOverlay(db, input.id);
  if (!created) {
    throw new Error(`Failed to load platform driver schema overlay ${input.id}`);
  }
  return created;
}

export async function replaceOrganizationDriverSchemaProperties(
  db: Queryable,
  input: {
    organizationId: string;
    schemaId: string;
    updatedByUserId?: string | null;
    properties: DriverSchemaOverlayPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord | null> {
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
  if (!existing) return null;
  await db.query(
    `delete from driver_schema_overlay_properties where driver_schema_overlay_id = $1`,
    [input.schemaId],
  );
  for (const [index, property] of input.properties.entries()) {
    await db.query(
      `
      insert into driver_schema_overlay_properties (
        id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order
      ) values ($1, $2, $3, $4, $5)
      `,
      [
        property.id,
        input.schemaId,
        property.parameterSpecId,
        property.propertyKey.trim(),
        property.sortOrder ?? index,
      ],
    );
  }
  await db.query(
    `
    update driver_schema_overlays
    set updated_by_user_id = $3, updated_at = now()
    where organization_id = $1 and id = $2
    `,
    [input.organizationId, input.schemaId, input.updatedByUserId ?? null],
  );
  return getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
}

export async function updateOrganizationDriverSchemaMeta(
  db: Queryable,
  input: {
    organizationId: string;
    schemaId: string;
    displayName?: string;
    notes?: string;
    updatedByUserId?: string | null;
  },
): Promise<OrganizationDriverSchemaRecord | null> {
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
  if (!existing) return null;
  await db.query(
    `
    update driver_schema_overlays
    set display_name = coalesce($3, display_name),
        notes = coalesce($4, notes),
        updated_by_user_id = $5,
        updated_at = now()
    where organization_id = $1 and id = $2
    `,
    [
      input.organizationId,
      input.schemaId,
      input.displayName?.trim() ?? null,
      input.notes ?? null,
      input.updatedByUserId ?? null,
    ],
  );
  return getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
}

export async function setOrganizationDriverSchemaLifecycle(
  db: Queryable,
  input: {
    organizationId: string;
    schemaId: string;
    lifecycle: OverlayLifecycle;
    updatedByUserId?: string | null;
    supersededBySchemaId?: string | null;
  },
): Promise<OrganizationDriverSchemaRecord | null> {
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
  if (!existing) return null;
  await db.query(
    `
    update driver_schema_overlays
    set lifecycle = $3,
        updated_by_user_id = $4,
        updated_at = now(),
        superseded_by_schema_id = case when $3 = 'superseded' then coalesce($5, superseded_by_schema_id) else superseded_by_schema_id end,
        activated_at = case
          when $3 = 'active' then coalesce(activated_at, now())
          else activated_at
        end,
        version = case when $3 = 'active' and lifecycle <> 'active' then version + 1 else version end
    where organization_id = $1 and id = $2
    `,
    [
      input.organizationId,
      input.schemaId,
      input.lifecycle,
      input.updatedByUserId ?? null,
      input.supersededBySchemaId ?? null,
    ],
  );
  return getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
}

export async function setPlatformDriverSchemaOverlayLifecycle(
  db: Queryable,
  input: {
    schemaId: string;
    lifecycle: OverlayLifecycle;
    updatedByUserId?: string | null;
  },
): Promise<DriverSchemaOverlayRecord | null> {
  await db.query(
    `
    update driver_schema_overlays
    set lifecycle = $2,
        updated_by_user_id = $3,
        updated_at = now()
    where organization_id is null and id = $1
    `,
    [input.schemaId, input.lifecycle, input.updatedByUserId ?? null],
  );
  return getDriverSchemaOverlay(db, input.schemaId);
}

export async function restoreSupersededContributors(
  db: Queryable,
  platformSchemaId: string,
): Promise<OrganizationDriverSchemaRecord[]> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    update driver_schema_overlays
    set lifecycle = 'active',
        superseded_by_schema_id = null,
        updated_at = now()
    where superseded_by_schema_id = $1
      and lifecycle = 'superseded'
    returning ${OVERLAY_SELECT}
    `,
    [platformSchemaId],
  );
  const mapped = await mapRows(db, result.rows);
  return mapped as OrganizationDriverSchemaRecord[];
}

export async function listSupersededContributors(
  db: Queryable,
  platformSchemaId: string,
): Promise<OrganizationDriverSchemaRecord[]> {
  const result = await db.query<DriverSchemaOverlayRow>(
    `
    select ${OVERLAY_SELECT}
    from driver_schema_overlays
    where superseded_by_schema_id = $1
      and lifecycle = 'superseded'
    order by organization_id asc, id asc
    `,
    [platformSchemaId],
  );
  const mapped = await mapRows(db, result.rows);
  return mapped as OrganizationDriverSchemaRecord[];
}

export type DriverSchemaOverlayPromotionRow = {
  id: string;
  platform_schema_id: string;
  source_schema_id: string;
  source_organization_id: string;
  promoted_by_user_id: string | null;
  promoted_at: string;
  documentation_source: string | null;
};

export async function insertDriverSchemaOverlayPromotion(
  db: Queryable,
  input: {
    id: string;
    platformSchemaId: string;
    sourceSchemaId: string;
    sourceOrganizationId: string;
    promotedByUserId: string | null;
    documentationSource?: string | null;
  },
): Promise<DriverSchemaOverlayPromotionRow> {
  const result = await db.query<DriverSchemaOverlayPromotionRow>(
    `
    insert into driver_schema_overlay_promotions (
      id, platform_schema_id, source_schema_id, source_organization_id,
      promoted_by_user_id, documentation_source
    ) values ($1, $2, $3, $4, $5, $6)
    returning id, platform_schema_id, source_schema_id, source_organization_id,
              promoted_by_user_id, promoted_at::text, documentation_source
    `,
    [
      input.id,
      input.platformSchemaId,
      input.sourceSchemaId,
      input.sourceOrganizationId,
      input.promotedByUserId,
      input.documentationSource ?? null,
    ],
  );
  return result.rows[0];
}

export async function getDriverSchemaOverlayPromotion(
  db: Queryable,
  promotionId: string,
): Promise<DriverSchemaOverlayPromotionRow | null> {
  const result = await db.query<DriverSchemaOverlayPromotionRow>(
    `
    select id, platform_schema_id, source_schema_id, source_organization_id,
           promoted_by_user_id, promoted_at::text, documentation_source
    from driver_schema_overlay_promotions
    where id = $1
    limit 1
    `,
    [promotionId],
  );
  return result.rows[0] ?? null;
}

export async function listPromotionsForPlatformSchema(
  db: Queryable,
  platformSchemaId: string,
): Promise<DriverSchemaOverlayPromotionRow[]> {
  const result = await db.query<DriverSchemaOverlayPromotionRow>(
    `
    select id, platform_schema_id, source_schema_id, source_organization_id,
           promoted_by_user_id, promoted_at::text, documentation_source
    from driver_schema_overlay_promotions
    where platform_schema_id = $1
    order by promoted_at desc, id asc
    `,
    [platformSchemaId],
  );
  return result.rows;
}

export async function promoteParameterSpecsToPlatform(
  db: Queryable,
  parameterSpecIds: readonly string[],
): Promise<void> {
  if (parameterSpecIds.length === 0) return;
  await db.query(
    `
    update parameter_specs
    set organization_id = null
    where id = any($1::text[])
    `,
    [parameterSpecIds],
  );
}
