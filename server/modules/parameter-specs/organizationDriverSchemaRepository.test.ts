import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import {
  findActiveOrganizationDriverSchemaByCompatible,
  getOrganizationDriverSchema,
  insertOrganizationDriverSchema,
  listOrganizationDriverSchemas,
  setOrganizationDriverSchemaLifecycle,
  type OrganizationDriverSchemaPropertyRow,
  type OrganizationDriverSchemaRow,
} from "./organizationDriverSchemaRepository";

type SchemaState = OrganizationDriverSchemaRow & {
  properties: OrganizationDriverSchemaPropertyRow[];
};

function createFakeDb() {
  const schemas = new Map<string, SchemaState>();
  const specs = new Map<
    string,
    {
      value_shape: unknown;
      units: string | null;
      constraints: unknown;
      example_value: unknown;
      documentation: string | null;
      lifecycle: "draft" | "active" | "deprecated";
      version_id: string;
    }
  >();

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (sql.includes("insert into organization_driver_schemas")) {
      const [
        id,
        organizationId,
        compatible,
        displayName,
        notes,
        lifecycle,
        version,
        createdByUserId,
        activatedAt,
      ] = values as [
        string,
        string,
        string,
        string,
        string,
        "draft" | "active" | "deprecated",
        number,
        string | null,
        string | null,
      ];
      if (
        lifecycle === "active" &&
        [...schemas.values()].some(
          (row) =>
            row.organization_id === organizationId &&
            row.lifecycle === "active" &&
            row.compatible.toLowerCase() === compatible.toLowerCase(),
        )
      ) {
        const error = new Error(
          'duplicate key value violates unique constraint "organization_driver_schemas_org_compatible_active_uidx"',
        ) as Error & { code?: string };
        error.code = "23505";
        throw error;
      }
      const now = new Date().toISOString();
      schemas.set(id, {
        id,
        organization_id: organizationId,
        compatible,
        display_name: displayName,
        notes,
        lifecycle,
        version,
        created_by_user_id: createdByUserId,
        updated_by_user_id: createdByUserId,
        created_at: now,
        updated_at: now,
        activated_at: activatedAt,
        properties: [],
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("insert into organization_driver_schema_properties")) {
      const [id, schemaId, parameterSpecId, propertyKey, sortOrder] = values as [
        string,
        string,
        string,
        string,
        number,
      ];
      const schema = schemas.get(schemaId);
      if (!schema) throw new Error(`missing schema ${schemaId}`);
      const spec = specs.get(parameterSpecId) ?? {
        value_shape: { kind: "unknown" },
        units: null,
        constraints: {},
        example_value: null,
        documentation: "",
        lifecycle: "active" as const,
        version_id: `${parameterSpecId}:v1`,
      };
      specs.set(parameterSpecId, spec);
      schema.properties.push({
        id,
        organization_driver_schema_id: schemaId,
        parameter_spec_id: parameterSpecId,
        parameter_spec_version_id: spec.version_id,
        property_key: propertyKey,
        value_shape: spec.value_shape as OrganizationDriverSchemaPropertyRow["value_shape"],
        units: spec.units,
        constraints: spec.constraints as Record<string, unknown>,
        example_value: spec.example_value,
        documentation: spec.documentation,
        spec_lifecycle: spec.lifecycle,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("from organization_driver_schemas") &&
      sql.includes("organization_id = $1 and id = $2")
    ) {
      const [organizationId, schemaId] = values as [string, string];
      const hit = schemas.get(schemaId);
      if (!hit || hit.organization_id !== organizationId) return { rows: [], rowCount: 0 };
      const { properties: _properties, ...row } = hit;
      return { rows: [row], rowCount: 1 };
    }

    if (
      sql.includes("from organization_driver_schemas") &&
      sql.includes("lower(compatible) = lower($2)") &&
      sql.includes("lifecycle = 'active'")
    ) {
      const [organizationId, compatible] = values as [string, string];
      const hit = [...schemas.values()].find(
        (row) =>
          row.organization_id === organizationId &&
          row.lifecycle === "active" &&
          row.compatible.toLowerCase() === compatible.toLowerCase(),
      );
      if (!hit) return { rows: [], rowCount: 0 };
      const { properties: _properties, ...row } = hit;
      return { rows: [row], rowCount: 1 };
    }

    if (
      sql.includes("from organization_driver_schemas") &&
      sql.includes("organization_id = $1") &&
      sql.includes("($2::text[] is null or lifecycle = any($2::text[]))")
    ) {
      const [organizationId, lifecycles] = values as [string, string[] | null];
      const rows = [...schemas.values()]
        .filter((row) => row.organization_id === organizationId)
        .filter((row) => !lifecycles || lifecycles.includes(row.lifecycle))
        .map(({ properties: _properties, ...row }) => row);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("from organization_driver_schema_properties") && sql.includes("= any($1::text[])")) {
      const [schemaIds] = values as [string[]];
      const rows = schemaIds.flatMap((id) => schemas.get(id)?.properties ?? []);
      return { rows, rowCount: rows.length };
    }

    if (sql.includes("update organization_driver_schemas") && sql.includes("set lifecycle = $3")) {
      const [organizationId, schemaId, lifecycle, updatedByUserId] = values as [
        string,
        string,
        "draft" | "active" | "deprecated",
        string | null,
      ];
      const hit = schemas.get(schemaId);
      if (!hit || hit.organization_id !== organizationId) return { rows: [], rowCount: 0 };
      if (
        lifecycle === "active" &&
        [...schemas.values()].some(
          (row) =>
            row.id !== schemaId &&
            row.organization_id === organizationId &&
            row.lifecycle === "active" &&
            row.compatible.toLowerCase() === hit.compatible.toLowerCase(),
        )
      ) {
        const error = new Error(
          'duplicate key value violates unique constraint "organization_driver_schemas_org_compatible_active_uidx"',
        ) as Error & { code?: string };
        error.code = "23505";
        throw error;
      }
      if (lifecycle === "active" && hit.lifecycle !== "active") {
        hit.version += 1;
        hit.activated_at = hit.activated_at ?? new Date().toISOString();
      }
      hit.lifecycle = lifecycle;
      hit.updated_by_user_id = updatedByUserId;
      hit.updated_at = new Date().toISOString();
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in fake db: ${text}`);
  });

  return {
    db: { query } as Queryable,
    schemas,
    seedSpec(
      parameterSpecId: string,
      definition: {
        value_shape: unknown;
        units?: string | null;
        documentation?: string;
      },
    ) {
      specs.set(parameterSpecId, {
        value_shape: definition.value_shape,
        units: definition.units ?? null,
        constraints: {},
        example_value: null,
        documentation: definition.documentation ?? "",
        lifecycle: "active",
        version_id: `${parameterSpecId}:v1`,
      });
    },
  };
}

describe("organizationDriverSchemaRepository", () => {
  it("inserts a draft schema linking ParameterSpec rows", async () => {
    const { db, seedSpec } = createFakeDb();
    seedSpec("pspec-reg", {
      value_shape: { kind: "u32-array" },
      documentation: "bus address",
    });
    const created = await insertOrganizationDriverSchema(db, {
      id: "ods-1",
      organizationId: "org-1",
      compatible: "vendor,overlay-chip",
      displayName: "Overlay Chip",
      notes: "gap fill",
      createdByUserId: "user-1",
      properties: [
        {
          id: "odsp-1",
          parameterSpecId: "pspec-reg",
          propertyKey: "reg",
        },
      ],
    });

    expect(created.lifecycle).toBe("draft");
    expect(created.organizationId).toBe("org-1");
    expect(created.compatible).toBe("vendor,overlay-chip");
    expect(created.properties).toEqual([
      expect.objectContaining({
        parameterSpecId: "pspec-reg",
        propertyKey: "reg",
        valueShape: { kind: "u32-array" },
        documentation: "bus address",
      }),
    ]);

    const listed = await listOrganizationDriverSchemas(db, { organizationId: "org-1" });
    expect(listed).toHaveLength(1);
    expect(await getOrganizationDriverSchema(db, { organizationId: "org-2", schemaId: "ods-1" })).toBeNull();
  });

  it("allows two drafts for the same compatible but rejects a second active", async () => {
    const { db } = createFakeDb();
    await insertOrganizationDriverSchema(db, {
      id: "ods-draft-a",
      organizationId: "org-1",
      compatible: "vendor,same",
      displayName: "A",
      properties: [],
    });
    await insertOrganizationDriverSchema(db, {
      id: "ods-draft-b",
      organizationId: "org-1",
      compatible: "vendor,same",
      displayName: "B",
      properties: [],
    });

    await setOrganizationDriverSchemaLifecycle(db, {
      organizationId: "org-1",
      schemaId: "ods-draft-a",
      lifecycle: "active",
      updatedByUserId: "user-1",
    });

    await expect(
      setOrganizationDriverSchemaLifecycle(db, {
        organizationId: "org-1",
        schemaId: "ods-draft-b",
        lifecycle: "active",
        updatedByUserId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "23505" });

    const active = await findActiveOrganizationDriverSchemaByCompatible(db, {
      organizationId: "org-1",
      compatible: "vendor,same",
    });
    expect(active?.id).toBe("ods-draft-a");
    expect(active?.version).toBe(2);
  });
});
