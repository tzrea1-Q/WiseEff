import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { compatibleSourceKey } from "../parameter-modules/ensureAttributionModuleForBinding";
import {
  activateOrganizationDriverSchemaForAuth,
  createOrganizationDriverSchemaForAuth,
  deprecateOrganizationDriverSchemaForAuth,
  previewOrganizationDriverSchemaDeprecationForAuth,
} from "./driverSchemaOverlayService";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";

function subjectIdForCompatible(organizationId: string, compatible: string): string {
  const digest = createHash("sha256")
    .update(`${organizationId}\u001f${compatibleSourceKey(compatible)}`)
    .digest("hex")
    .slice(0, 24);
  return `asub:driver-registration:compatible:${digest}`;
}

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Admin",
      email: "admin@example.com",
      isActive: true,
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  } as AuthContext;
}

type SchemaRow = {
  id: string;
  organizationId: string;
  compatible: string;
  displayName: string;
  notes: string;
  lifecycle: "draft" | "active" | "deprecated";
  version: number;
  properties: Array<{
    id: string;
    parameterSpecId: string;
    propertyKey: string;
    valueShape: Record<string, unknown>;
    units: string | null;
    constraints: Record<string, unknown>;
    documentation: string;
  }>;
};

function createServiceDb(seed?: { schemas?: SchemaRow[]; provisionalSpecIds?: string[] }) {
  const schemas = new Map((seed?.schemas ?? []).map((row) => [row.id, { ...row, properties: [...row.properties] }]));
  const provisional = new Set(seed?.provisionalSpecIds ?? []);
  const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  const upgradedVersions: string[] = [];
  const resolvedTasks: string[] = [];
  const ensuredSpecs = new Set<string>();

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (sql.includes("insert into parameter_specs")) {
      ensuredSpecs.add(String(values[0]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into parameter_spec_versions")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into dts_property_specs")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into driver_schema_overlays")) {
      const [id, organizationId, compatible, displayName, notes, lifecycle, version] = values as [
        string,
        string,
        string,
        string,
        string,
        "draft" | "active" | "deprecated",
        number,
      ];
      schemas.set(id, {
        id,
        organizationId,
        compatible,
        displayName,
        notes,
        lifecycle,
        version,
        properties: [],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into driver_schema_overlay_properties")) {
      const [id, schemaId, parameterSpecId, propertyKey] = values as [string, string, string, string];
      const schema = schemas.get(schemaId);
      if (!schema) throw new Error("missing schema");
      schema.properties.push({
        id,
        parameterSpecId,
        propertyKey,
        valueShape: { kind: "u32-array" },
        units: null,
        constraints: {},
        documentation: "",
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from driver_schema_overlays") && sql.includes("id = $2")) {
      const [organizationId, schemaId] = values as [string, string];
      const hit = schemas.get(schemaId);
      if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            id: hit.id,
            organization_id: hit.organizationId,
            compatible: hit.compatible,
            display_name: hit.displayName,
            notes: hit.notes,
            lifecycle: hit.lifecycle,
            version: hit.version,
            superseded_by_schema_id: null,
            created_by_user_id: "user-1",
            updated_by_user_id: "user-1",
            created_at: "2026-07-29T00:00:00.000Z",
            updated_at: "2026-07-29T00:00:00.000Z",
            activated_at: hit.lifecycle === "active" ? "2026-07-29T00:00:00.000Z" : null,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("from driver_schema_overlay_properties") && sql.includes("= any($1::text[])")) {
      const [ids] = values as [string[]];
      const rows = ids.flatMap((id) => {
        const schema = schemas.get(id);
        return (schema?.properties ?? []).map((property) => ({
          id: property.id,
          driver_schema_overlay_id: id,
          parameter_spec_id: property.parameterSpecId,
          parameter_spec_version_id: `${property.parameterSpecId}:v1`,
          property_key: property.propertyKey,
          value_shape: property.valueShape,
          units: property.units,
          constraints: property.constraints,
          example_value: null,
          documentation: property.documentation,
          spec_lifecycle: "active",
          sort_order: 0,
          created_at: "2026-07-29T00:00:00.000Z",
        }));
      });
      return { rows, rowCount: rows.length };
    }
    if (
      sql.includes("from driver_schema_overlays") &&
      sql.includes("organization_id is null") &&
      sql.includes("lower(compatible) = lower($1)")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.includes("from driver_schema_overlays") &&
      sql.includes("lower(compatible) = lower($2)") &&
      sql.includes("lifecycle = 'active'")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("update driver_schema_overlays") && sql.includes("set lifecycle = $3")) {
      const [organizationId, schemaId, lifecycle] = values as [string, string, "draft" | "active" | "deprecated"];
      const hit = schemas.get(schemaId);
      if (!hit || hit.organizationId !== organizationId) return { rows: [], rowCount: 0 };
      if (lifecycle === "active" && hit.lifecycle !== "active") hit.version += 1;
      hit.lifecycle = lifecycle;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("select id from parameter_specs where id = $1")) {
      const [specId] = values as [string];
      return provisional.has(specId) || ensuredSpecs.has(specId)
        ? { rows: [{ id: specId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("update parameter_spec_versions") && sql.includes("lifecycle = 'active'")) {
      upgradedVersions.push(String(values[0]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from parameter_spec_review_tasks") && sql.includes("status = 'open'")) {
      return { rows: [{ id: "task-1" }], rowCount: 1 };
    }
    if (sql.includes("update parameter_spec_review_tasks")) {
      resolvedTasks.push(String(values[0]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into audit_events")) {
      audits.push({ action: String(values[7]), metadata: {} });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from attribution_subjects") && sql.includes("source_key")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("from parameter_modules") && sql.includes("source_key")) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.includes("from parameter_specs ps") &&
      sql.includes("ps.attribution_subject_id = $2") &&
      sql.includes("coalesce(ps.property_key, '') = $3")
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("insert into attribution_subjects")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into driver_registrations")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from driver_schema_overlays") && sql.includes("organization_id = $1")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unhandled SQL: ${text}`);
  });

  const db = {
    query,
    transaction: vi.fn(async (fn: (tx: Queryable) => Promise<unknown>) => fn({ query } as Queryable)),
  } as unknown as Database;

  return { db, schemas, audits, upgradedVersions, resolvedTasks, ensuredSpecs };
}

describe("organizationDriverSchemaService", () => {
  it("rejects creating an overlay for a compatible already covered by a pinned schema", async () => {
    const { db } = createServiceDb();
    await expect(
      createOrganizationDriverSchemaForAuth(db, makeAuth(), {
        compatible: "sc8562",
        displayName: "SC8562 Overlay",
        properties: [{ propertyKey: "reg", valueShape: { kind: "u32-array" } }],
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("creates ParameterSpec rows then links them on draft create", async () => {
    const { db, ensuredSpecs, schemas } = createServiceDb();
    const created = await createOrganizationDriverSchemaForAuth(db, makeAuth(), {
      compatible: "vendor,only-overlay-chip",
      displayName: "Only Overlay",
      properties: [{ propertyKey: "vout_ovp_mv", valueShape: { kind: "u32-array" }, units: "mV" }],
    });
    const subjectId = subjectIdForCompatible("org-1", "vendor,only-overlay-chip");
    const expected = buildSubjectScopedManualSpecIds({
      organizationId: "org-1",
      attributionSubjectId: subjectId,
      propertyKey: "vout_ovp_mv",
    });
    expect(ensuredSpecs.has(expected.parameterSpecId)).toBe(true);
    expect(created.properties[0]?.parameterSpecId).toBe(expected.parameterSpecId);
    expect(schemas.get(created.id)?.properties[0]?.parameterSpecId).toBe(expected.parameterSpecId);
  });

  it("activates an overlay and marks linked ParameterSpecs active", async () => {
    const compatible = "vendor,only-overlay-chip";
    const propertyKey = "vout_ovp_mv";
    const subjectId = subjectIdForCompatible("org-1", compatible);
    const ids = buildSubjectScopedManualSpecIds({
      organizationId: "org-1",
      attributionSubjectId: subjectId,
      propertyKey,
    });
    const { db, upgradedVersions, resolvedTasks } = createServiceDb({
      schemas: [
        {
          id: "ods-1",
          organizationId: "org-1",
          compatible,
          displayName: "Only Overlay",
          notes: "",
          lifecycle: "draft",
          version: 1,
          properties: [
            {
              id: "odsp-1",
              parameterSpecId: ids.parameterSpecId,
              propertyKey,
              valueShape: { kind: "u32-array" },
              units: "mV",
              constraints: {},
              documentation: "ovp",
            },
          ],
        },
      ],
      provisionalSpecIds: [ids.parameterSpecId],
    });

    const result = await activateOrganizationDriverSchemaForAuth(db, makeAuth(), "ods-1");

    expect(result.schema.lifecycle).toBe("active");
    expect(result.upgradedSpecIds).toEqual([ids.parameterSpecId]);
    expect(upgradedVersions).toContain(ids.parameterSpecId);
    expect(result.resolvedReviewTaskIds).toEqual(["task-1"]);
    expect(resolvedTasks).toEqual(["task-1"]);
  });

  it("previews deprecation impact and requires explicit high-risk confirmation without successor", async () => {
    const { db } = createServiceDb({
      schemas: [
        {
          id: "ods-risk",
          organizationId: "org-1",
          compatible: "vendor,only-overlay-chip",
          displayName: "Only Overlay",
          notes: "",
          lifecycle: "active",
          version: 1,
          properties: [
            {
              id: "prop-1",
              parameterSpecId: "spec-1",
              propertyKey: "reg",
              valueShape: { kind: "u32-array" },
              units: null,
              constraints: {},
              documentation: "",
            },
            {
              id: "prop-2",
              parameterSpecId: "spec-2",
              propertyKey: "enable",
              valueShape: { kind: "bool" },
              units: null,
              constraints: {},
              documentation: "",
            },
          ],
        },
      ],
    });
    const baseQuery = vi.mocked(db.query).getMockImplementation()!;
    vi.mocked(db.query).mockImplementation(async (text: string, values?: unknown[]) => {
      if (text.replace(/\s+/g, " ").toLowerCase().includes("count(distinct b.project_id)")) {
        return { rows: [{ project_count: "3" }], rowCount: 1 };
      }
      return baseQuery(text, values);
    });

    const impact = await previewOrganizationDriverSchemaDeprecationForAuth(
      db,
      makeAuth(),
      "ods-risk",
    );

    expect(impact).toMatchObject({
      schemaId: "ods-risk",
      compatible: "vendor,only-overlay-chip",
      coverageLoss: true,
      definitionCount: 2,
      projectCount: 3,
      successorSource: null,
    });
    await expect(
      deprecateOrganizationDriverSchemaForAuth(db, makeAuth(), "ods-risk", {}),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({ confirmRequired: true }),
    });
  });
});
