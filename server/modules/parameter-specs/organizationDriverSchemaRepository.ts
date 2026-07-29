import type { Queryable } from "../../shared/database/client";
import type { PropertyValueShape, SpecLifecycle } from "./types";

export type OrganizationDriverSchemaRow = {
  id: string;
  organization_id: string;
  compatible: string;
  display_name: string;
  notes: string;
  lifecycle: SpecLifecycle;
  version: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

export type OrganizationDriverSchemaPropertyRow = {
  id: string;
  organization_driver_schema_id: string;
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
  spec_lifecycle: SpecLifecycle | null;
};

export type OrganizationDriverSchemaPropertyInput = {
  id: string;
  parameterSpecId: string;
  propertyKey: string;
  sortOrder?: number;
};

export type OrganizationDriverSchemaRecord = {
  id: string;
  organizationId: string;
  compatible: string;
  displayName: string;
  notes: string;
  lifecycle: SpecLifecycle;
  version: number;
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
    specLifecycle: SpecLifecycle | null;
    sortOrder: number;
  }>;
};

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

function mapProperty(row: OrganizationDriverSchemaPropertyRow) {
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
  row: OrganizationDriverSchemaRow,
  properties: OrganizationDriverSchemaPropertyRow[],
): OrganizationDriverSchemaRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    compatible: row.compatible,
    displayName: row.display_name,
    notes: row.notes ?? "",
    lifecycle: row.lifecycle,
    version: row.version,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at ?? null,
    properties: properties
      .slice()
      .sort((left, right) => left.sort_order - right.sort_order || left.property_key.localeCompare(right.property_key))
      .map(mapProperty),
  };
}

async function loadProperties(
  db: Queryable,
  schemaIds: string[],
): Promise<Map<string, OrganizationDriverSchemaPropertyRow[]>> {
  const bySchema = new Map<string, OrganizationDriverSchemaPropertyRow[]>();
  if (schemaIds.length === 0) return bySchema;
  const result = await db.query<OrganizationDriverSchemaPropertyRow>(
    `
    select
      odp.id,
      odp.organization_driver_schema_id,
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
    from organization_driver_schema_properties odp
    left join lateral (
      select id, value_shape, lifecycle, example_value
      from parameter_spec_versions
      where parameter_spec_id = odp.parameter_spec_id
      order by version desc
      limit 1
    ) psv on true
    left join dts_property_specs dps on dps.parameter_spec_id = odp.parameter_spec_id
    where odp.organization_driver_schema_id = any($1::text[])
    order by odp.sort_order asc, odp.property_key asc
    `,
    [schemaIds],
  );
  for (const row of result.rows) {
    const list = bySchema.get(row.organization_driver_schema_id) ?? [];
    list.push(row);
    bySchema.set(row.organization_driver_schema_id, list);
  }
  return bySchema;
}

export async function listOrganizationDriverSchemas(
  db: Queryable,
  input: { organizationId: string; lifecycle?: SpecLifecycle | SpecLifecycle[] },
): Promise<OrganizationDriverSchemaRecord[]> {
  const lifecycles = input.lifecycle
    ? Array.isArray(input.lifecycle)
      ? input.lifecycle
      : [input.lifecycle]
    : null;
  const result = await db.query<OrganizationDriverSchemaRow>(
    `
    select id, organization_id, compatible, display_name, notes, lifecycle, version,
           created_by_user_id, updated_by_user_id, created_at::text, updated_at::text,
           activated_at::text
    from organization_driver_schemas
    where organization_id = $1
      and ($2::text[] is null or lifecycle = any($2::text[]))
    order by updated_at desc, id asc
    `,
    [input.organizationId, lifecycles],
  );
  const propertiesBySchema = await loadProperties(
    db,
    result.rows.map((row) => row.id),
  );
  return result.rows.map((row) => mapSchema(row, propertiesBySchema.get(row.id) ?? []));
}

export async function getOrganizationDriverSchema(
  db: Queryable,
  input: { organizationId: string; schemaId: string },
): Promise<OrganizationDriverSchemaRecord | null> {
  const result = await db.query<OrganizationDriverSchemaRow>(
    `
    select id, organization_id, compatible, display_name, notes, lifecycle, version,
           created_by_user_id, updated_by_user_id, created_at::text, updated_at::text,
           activated_at::text
    from organization_driver_schemas
    where organization_id = $1 and id = $2
    limit 1
    `,
    [input.organizationId, input.schemaId],
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
  const result = await db.query<OrganizationDriverSchemaRow>(
    `
    select id, organization_id, compatible, display_name, notes, lifecycle, version,
           created_by_user_id, updated_by_user_id, created_at::text, updated_at::text,
           activated_at::text
    from organization_driver_schemas
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
    lifecycle?: SpecLifecycle;
    version?: number;
    createdByUserId?: string | null;
    properties: OrganizationDriverSchemaPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord> {
  const lifecycle = input.lifecycle ?? "draft";
  const version = input.version ?? 1;
  await db.query(
    `
    insert into organization_driver_schemas (
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
      insert into organization_driver_schema_properties (
        id, organization_driver_schema_id, parameter_spec_id, property_key, sort_order
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
    throw new Error(`Failed to load organization driver schema ${input.id}`);
  }
  return created;
}

export async function replaceOrganizationDriverSchemaProperties(
  db: Queryable,
  input: {
    organizationId: string;
    schemaId: string;
    updatedByUserId?: string | null;
    properties: OrganizationDriverSchemaPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord | null> {
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
  if (!existing) return null;
  await db.query(
    `delete from organization_driver_schema_properties where organization_driver_schema_id = $1`,
    [input.schemaId],
  );
  for (const [index, property] of input.properties.entries()) {
    await db.query(
      `
      insert into organization_driver_schema_properties (
        id, organization_driver_schema_id, parameter_spec_id, property_key, sort_order
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
    update organization_driver_schemas
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
    update organization_driver_schemas
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
    lifecycle: SpecLifecycle;
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
    update organization_driver_schemas
    set lifecycle = $3,
        updated_by_user_id = $4,
        updated_at = now(),
        activated_at = case
          when $3 = 'active' then coalesce(activated_at, now())
          else activated_at
        end,
        version = case when $3 = 'active' and lifecycle <> 'active' then version + 1 else version end
    where organization_id = $1 and id = $2
    `,
    [input.organizationId, input.schemaId, input.lifecycle, input.updatedByUserId ?? null],
  );
  return getOrganizationDriverSchema(db, {
    organizationId: input.organizationId,
    schemaId: input.schemaId,
  });
}
