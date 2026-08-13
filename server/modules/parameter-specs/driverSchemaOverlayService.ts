import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { lookupParseCoverage } from "./parseCoverage";
import { assertNonStructuralPropertyKey } from "./structuralPropertyGuard";
import {
  findActiveOrganizationDriverSchemaByCompatible,
  findActivePlatformDriverSchemaOverlayByCompatible,
  getOrganizationDriverSchema,
  insertOrganizationDriverSchema,
  listOrganizationDriverSchemas,
  replaceOrganizationDriverSchemaProperties,
  setOrganizationDriverSchemaLifecycle,
  updateOrganizationDriverSchemaMeta,
  type DriverSchemaOverlayPropertyInput,
  type OrganizationDriverSchemaRecord,
} from "./driverSchemaOverlayRepository";
import { getCachedSchemaRegistry, invalidateOrganizationSchemaRegistryCache } from "./schemaRegistryCache";
import { findParameterSpecByIdentity } from "./repository";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import type { PropertyValueShape, SpecLifecycle } from "./types";
import { ensureAttributionSubjectForCompatible } from "../parameter-modules/resolveAttributionSubject";

const schemasRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/dts");

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

async function writeAudit(
  db: Queryable,
  auth: AuthContext,
  input: { action: string; subjectId: string; metadata: Record<string, unknown> },
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-management",
    kind: "organization_driver_schema",
    action: input.action,
    severity: "Low",
    targetType: "organization_driver_schema",
    targetId: input.subjectId,
    metadata: input.metadata,
    traceId: randomUUID(),
  });
}

export type OverlayPropertyInput =
  | {
      /** Link an existing ParameterSpec (definition library). */
      parameterSpecId: string;
      propertyKey?: string;
    }
  | {
      /** Create/update the org manual ParameterSpec for this property key. */
      propertyKey: string;
      valueShape: PropertyValueShape | Record<string, unknown>;
      units?: string | null;
      constraints?: Record<string, unknown>;
      exampleValue?: unknown;
      documentation?: string;
      /** Optional library row to copy shape from when creating the canonical manual spec. */
      copyFromParameterSpecId?: string;
    };

/**
 * Ensure the canonical org manual ParameterSpec (subject-scoped identity) exists and
 * carries the authored shape. Linking a library row copies its definition into
 * this identity so overlay matching and provisional upgrade share one row.
 */
async function ensureCanonicalOverlayParameterSpec(
  db: Queryable,
  input: {
    organizationId: string;
    compatible: string;
    propertyKey: string;
    valueShape: PropertyValueShape | Record<string, unknown>;
    units?: string | null;
    constraints?: Record<string, unknown>;
    exampleValue?: unknown;
    documentation?: string;
  },
): Promise<{ parameterSpecId: string; propertyKey: string }> {
  const propertyKey = input.propertyKey.trim();
  if (!propertyKey) {
    throw new ApiError("VALIDATION_FAILED", "propertyKey is required.", 400);
  }
  assertNonStructuralPropertyKey(propertyKey);
  const attributionSubjectId = await ensureAttributionSubjectForCompatible(db, {
    organizationId: input.organizationId,
    compatible: input.compatible,
  });
  const valueShape = JSON.stringify(input.valueShape);
  const constraints = JSON.stringify(input.constraints ?? {});
  const exampleValue =
    input.exampleValue == null ? null : JSON.stringify(input.exampleValue);
  const documentation = input.documentation ?? "";
  const displayName = propertyKey;
  const description = documentation || `Organization overlay property ${propertyKey}`;

  const existing = await findParameterSpecByIdentity(db, {
    organizationId: input.organizationId,
    attributionSubjectId,
    propertyKey,
  });
  if (existing?.parameterSpecVersionId) {
    await db.query(
      `
      update parameter_specs
      set attribution_subject_id = coalesce(attribution_subject_id, $2),
          property_key = coalesce(property_key, $3)
      where id = $1
      `,
      [existing.parameterSpecId, attributionSubjectId, propertyKey],
    );
    await db.query(
      `
      update parameter_spec_versions
      set display_name = $2,
          description = $3,
          value_shape = $4::jsonb,
          example_value = $5::jsonb,
          lifecycle = 'active'
      where id = $1
      `,
      [
        existing.parameterSpecVersionId,
        displayName,
        description,
        valueShape,
        exampleValue,
      ],
    );
    await db.query(
      `
      update dts_property_specs
      set units = $2,
          constraints = $3::jsonb,
          documentation = $4,
          property_key = $5
      where parameter_spec_id = $1
      `,
      [existing.parameterSpecId, input.units ?? null, constraints, documentation || null, propertyKey],
    );
    return { parameterSpecId: existing.parameterSpecId, propertyKey };
  }

  const ids = buildSubjectScopedManualSpecIds({
    organizationId: input.organizationId,
    attributionSubjectId,
    propertyKey,
  });

  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key, attribution_subject_id, property_key
    )
    values ($1, $2, 'manual', $3, $4, $5)
    on conflict (id) do update set
      attribution_subject_id = coalesce(parameter_specs.attribution_subject_id, excluded.attribution_subject_id),
      property_key = coalesce(parameter_specs.property_key, excluded.property_key)
    `,
    [ids.parameterSpecId, input.organizationId, ids.specificationKey, attributionSubjectId, propertyKey],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, $3, $4, $5::jsonb, null, $6::jsonb, 'active')
    on conflict (id) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      value_shape = excluded.value_shape,
      example_value = excluded.example_value,
      lifecycle = 'active'
    `,
    [
      ids.parameterSpecVersionId,
      ids.parameterSpecId,
      displayName,
      description,
      valueShape,
      exampleValue,
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, driver_schema_id, property_key, schema_namespace,
      units, constraints, documentation
    ) values ($1, $2, null, $3, $4, $5, $6::jsonb, $7)
    on conflict (id) do update set
      units = excluded.units,
      constraints = excluded.constraints,
      documentation = excluded.documentation,
      schema_namespace = excluded.schema_namespace
    `,
    [
      ids.dtsPropertySpecId,
      ids.parameterSpecId,
      propertyKey,
      ids.schemaNamespace,
      input.units ?? null,
      constraints,
      documentation || null,
    ],
  );
  return { parameterSpecId: ids.parameterSpecId, propertyKey };
}

async function resolveOverlayPropertyLinks(
  db: Queryable,
  input: {
    organizationId: string;
    compatible: string;
    properties: OverlayPropertyInput[];
  },
): Promise<DriverSchemaOverlayPropertyInput[]> {
  const links: DriverSchemaOverlayPropertyInput[] = [];
  for (const [index, property] of input.properties.entries()) {
    if ("parameterSpecId" in property && property.parameterSpecId) {
      const specId = property.parameterSpecId;
      const row = await db.query<{
        id: string;
        property_key: string | null;
        value_shape: unknown;
        units: string | null;
        constraints: unknown;
        example_value: unknown;
        documentation: string | null;
      }>(
        `
        select
          ps.id,
          dps.property_key,
          psv.value_shape,
          dps.units,
          dps.constraints,
          psv.example_value,
          dps.documentation
        from parameter_specs ps
        left join lateral (
          select value_shape, example_value
          from parameter_spec_versions
          where parameter_spec_id = ps.id
          order by version desc
          limit 1
        ) psv on true
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        where ps.id = $1
          and (ps.organization_id = $2 or ps.organization_id is null)
        limit 1
        `,
        [specId, input.organizationId],
      );
      const hit = row.rows[0];
      if (!hit) {
        throw new ApiError("NOT_FOUND", `Parameter spec ${specId} was not found.`, 404);
      }
      const propertyKey = (property.propertyKey ?? hit.property_key ?? "").trim();
      if (!propertyKey) {
        throw new ApiError(
          "VALIDATION_FAILED",
          `Parameter spec ${specId} has no property key to link.`,
          400,
        );
      }
      const ensured = await ensureCanonicalOverlayParameterSpec(db, {
        organizationId: input.organizationId,
        compatible: input.compatible,
        propertyKey,
        valueShape: (hit.value_shape as PropertyValueShape) ?? { kind: "unknown" },
        units: hit.units,
        constraints:
          hit.constraints && typeof hit.constraints === "object"
            ? (hit.constraints as Record<string, unknown>)
            : {},
        exampleValue: hit.example_value,
        documentation: hit.documentation ?? "",
      });
      links.push({
        id: randomUUID(),
        parameterSpecId: ensured.parameterSpecId,
        propertyKey: ensured.propertyKey,
        sortOrder: index,
      });
      continue;
    }

    if (!("propertyKey" in property) || !("valueShape" in property)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Each property must include parameterSpecId or propertyKey+valueShape.",
        400,
      );
    }

    let valueShape = property.valueShape;
    let units = property.units;
    let constraints = property.constraints;
    let exampleValue = property.exampleValue;
    let documentation = property.documentation;
    if (property.copyFromParameterSpecId) {
      const source = await db.query<{
        value_shape: unknown;
        units: string | null;
        constraints: unknown;
        example_value: unknown;
        documentation: string | null;
      }>(
        `
        select psv.value_shape, dps.units, dps.constraints, psv.example_value, dps.documentation
        from parameter_specs ps
        left join lateral (
          select value_shape, example_value
          from parameter_spec_versions
          where parameter_spec_id = ps.id
          order by version desc
          limit 1
        ) psv on true
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        where ps.id = $1
          and (ps.organization_id = $2 or ps.organization_id is null)
        limit 1
        `,
        [property.copyFromParameterSpecId, input.organizationId],
      );
      const hit = source.rows[0];
      if (hit) {
        valueShape = (hit.value_shape as PropertyValueShape) ?? valueShape;
        units = units ?? hit.units;
        constraints =
          constraints ??
          (hit.constraints && typeof hit.constraints === "object"
            ? (hit.constraints as Record<string, unknown>)
            : {});
        exampleValue = exampleValue ?? hit.example_value;
        documentation = documentation ?? hit.documentation ?? undefined;
      }
    }

    const ensured = await ensureCanonicalOverlayParameterSpec(db, {
      organizationId: input.organizationId,
      compatible: input.compatible,
      propertyKey: property.propertyKey,
      valueShape,
      units,
      constraints,
      exampleValue,
      documentation,
    });
    links.push({
      id: randomUUID(),
      parameterSpecId: ensured.parameterSpecId,
      propertyKey: ensured.propertyKey,
      sortOrder: index,
    });
  }
  return links;
}

function assertExactCompatible(compatible: string) {
  const trimmed = compatible.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_FAILED", "compatible is required.", 400);
  }
  if (trimmed.includes("*")) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Overlay schemas support exact compatible values only.",
      400,
    );
  }
  return trimmed;
}

function assertPinnedDoesNotCover(compatible: string) {
  const pinned = getCachedSchemaRegistry(schemasRoot);
  const coverage = lookupParseCoverage(compatible, pinned);
  if (coverage.covered) {
    throw new ApiError(
      "CONFLICT",
      `Compatible is already covered by a pinned ${coverage.source} schema (${coverage.pattern}); an organization overlay is not needed.`,
      409,
      { pattern: coverage.pattern, driverId: coverage.driverId, source: coverage.source },
    );
  }
}

async function assertNoActivePlatformOverlayCovers(db: Queryable, compatible: string) {
  const platformOverlay = await findActivePlatformDriverSchemaOverlayByCompatible(db, compatible);
  if (platformOverlay) {
    throw new ApiError(
      "CONFLICT",
      "An active platform overlay already covers this compatible; organization authoring is not allowed.",
      409,
      {
        platformSchemaId: platformOverlay.id,
        compatible: platformOverlay.compatible,
        displayName: platformOverlay.displayName,
      },
    );
  }
}

/**
 * Historical binding revision schemaState stays immutable (round-5). Activation
 * upgrades the provisional/manual ParameterSpec in place so the current view
 * reads typed definitions; UI may distinguish "spec defined, revision predates it".
 */
export async function upgradeProvisionalSpecsForOverlay(
  db: Queryable,
  input: {
    organizationId: string;
    schema: OrganizationDriverSchemaRecord;
    reviewerUserId: string;
  },
): Promise<{ upgradedSpecIds: string[]; resolvedReviewTaskIds: string[] }> {
  const upgradedSpecIds: string[] = [];
  const resolvedReviewTaskIds: string[] = [];

  for (const property of input.schema.properties) {
    const parameterSpecId = property.parameterSpecId;
    const existing = await db.query<{ id: string }>(
      `select id from parameter_specs where id = $1 and organization_id = $2 limit 1`,
      [parameterSpecId, input.organizationId],
    );
    if (existing.rows[0]) {
      await db.query(
        `
        update parameter_spec_versions
        set lifecycle = 'active'
        where parameter_spec_id = $1
        `,
        [parameterSpecId],
      );
      upgradedSpecIds.push(parameterSpecId);
    }

    const openTasks = await db.query<{ id: string }>(
      `
      select id
      from parameter_spec_review_tasks
      where organization_id = $1
        and status = 'open'
        and (
          parameter_spec_id = $2
          or coalesce(source_evidence->>'propertyKey', '') = $3
        )
      `,
      [input.organizationId, parameterSpecId, property.propertyKey],
    );
    for (const task of openTasks.rows) {
      await db.query(
        `
        update parameter_spec_review_tasks
        set status = 'resolved',
            reviewer_user_id = $2,
            reason = $3,
            resolved_at = now()
        where id = $1
        `,
        [
          task.id,
          input.reviewerUserId,
          `Resolved by activating organization driver schema ${input.schema.id} (${input.schema.compatible})`,
        ],
      );
      resolvedReviewTaskIds.push(task.id);
    }
  }

  return { upgradedSpecIds, resolvedReviewTaskIds };
}

export async function listOrganizationDriverSchemasForAuth(
  db: Database,
  auth: AuthContext,
  input?: { lifecycle?: SpecLifecycle | SpecLifecycle[] },
): Promise<{ items: OrganizationDriverSchemaRecord[]; total: number }> {
  requireCanView(auth);
  const items = await listOrganizationDriverSchemas(db, {
    organizationId: auth.organization.id,
    lifecycle: input?.lifecycle,
  });
  return { items, total: items.length };
}

export async function getOrganizationDriverSchemaForAuth(
  db: Database,
  auth: AuthContext,
  schemaId: string,
): Promise<OrganizationDriverSchemaRecord> {
  requireCanView(auth);
  const item = await getOrganizationDriverSchema(db, {
    organizationId: auth.organization.id,
    schemaId,
  });
  if (!item) {
    throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
  }
  return item;
}

export async function createOrganizationDriverSchemaForAuth(
  db: Database,
  auth: AuthContext,
  input: {
    compatible: string;
    displayName: string;
    notes?: string;
    properties: OverlayPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord> {
  requireCanAdmin(auth);
  const compatible = assertExactCompatible(input.compatible);
  assertPinnedDoesNotCover(compatible);
  await assertNoActivePlatformOverlayCovers(db, compatible);
  if (!input.displayName.trim()) {
    throw new ApiError("VALIDATION_FAILED", "displayName is required.", 400);
  }
  if (!input.properties.length) {
    throw new ApiError("VALIDATION_FAILED", "At least one property definition is required.", 400);
  }

  const propertyLinks = await resolveOverlayPropertyLinks(db, {
    organizationId: auth.organization.id,
    compatible,
    properties: input.properties,
  });
  const created = await insertOrganizationDriverSchema(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    compatible,
    displayName: input.displayName,
    notes: input.notes,
    lifecycle: "draft",
    createdByUserId: auth.user.id,
    properties: propertyLinks,
  });
  await writeAudit(db, auth, {
    action: "created",
    subjectId: created.id,
    metadata: { compatible, propertyCount: created.properties.length },
  });
  invalidateOrganizationSchemaRegistryCache(auth.organization.id);
  return created;
}

export async function updateOrganizationDriverSchemaForAuth(
  db: Database,
  auth: AuthContext,
  schemaId: string,
  input: {
    displayName?: string;
    notes?: string;
    properties?: OverlayPropertyInput[];
  },
): Promise<OrganizationDriverSchemaRecord> {
  requireCanAdmin(auth);
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: auth.organization.id,
    schemaId,
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
  }
  if (existing.lifecycle === "active" && input.properties) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Active overlay property sets are immutable; create a new draft to revise definitions.",
      400,
    );
  }

  let updated =
    (await updateOrganizationDriverSchemaMeta(db, {
      organizationId: auth.organization.id,
      schemaId,
      displayName: input.displayName,
      notes: input.notes,
      updatedByUserId: auth.user.id,
    })) ?? existing;

  if (input.properties) {
    if (!input.properties.length) {
      throw new ApiError("VALIDATION_FAILED", "At least one property definition is required.", 400);
    }
    updated =
      (await replaceOrganizationDriverSchemaProperties(db, {
        organizationId: auth.organization.id,
        schemaId,
        updatedByUserId: auth.user.id,
        properties: await resolveOverlayPropertyLinks(db, {
          organizationId: auth.organization.id,
          compatible: existing.compatible,
          properties: input.properties,
        }),
      })) ?? updated;
  }

  await writeAudit(db, auth, {
    action: "updated",
    subjectId: schemaId,
    metadata: {
      displayName: input.displayName,
      propertyCount: input.properties?.length,
    },
  });
  invalidateOrganizationSchemaRegistryCache(auth.organization.id);
  return updated;
}

export async function activateOrganizationDriverSchemaForAuth(
  db: Database,
  auth: AuthContext,
  schemaId: string,
): Promise<{
  schema: OrganizationDriverSchemaRecord;
  upgradedSpecIds: string[];
  resolvedReviewTaskIds: string[];
}> {
  requireCanAdmin(auth);
  return db.transaction(async (tx) => {
    const existing = await getOrganizationDriverSchema(tx, {
      organizationId: auth.organization.id,
      schemaId,
    });
    if (!existing) {
      throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
    }
    if (existing.lifecycle === "active") {
      return { schema: existing, upgradedSpecIds: [], resolvedReviewTaskIds: [] };
    }
    if (existing.lifecycle === "deprecated") {
      throw new ApiError("VALIDATION_FAILED", "Deprecated overlay schemas cannot be activated.", 400);
    }
    if (existing.properties.length === 0) {
      throw new ApiError("VALIDATION_FAILED", "Cannot activate an overlay with no properties.", 400);
    }

    assertPinnedDoesNotCover(existing.compatible);
    await assertNoActivePlatformOverlayCovers(tx, existing.compatible);

    const otherActive = await findActiveOrganizationDriverSchemaByCompatible(tx, {
      organizationId: auth.organization.id,
      compatible: existing.compatible,
    });
    if (otherActive && otherActive.id !== schemaId) {
      throw new ApiError(
        "CONFLICT",
        "Another active overlay already claims this compatible.",
        409,
        { activeSchemaId: otherActive.id },
      );
    }

    const schema = await setOrganizationDriverSchemaLifecycle(tx, {
      organizationId: auth.organization.id,
      schemaId,
      lifecycle: "active",
      updatedByUserId: auth.user.id,
    });
    if (!schema) {
      throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
    }

    const retro = await upgradeProvisionalSpecsForOverlay(tx, {
      organizationId: auth.organization.id,
      schema,
      reviewerUserId: auth.user.id,
    });

    await writeAudit(tx, auth, {
      action: "activated",
      subjectId: schemaId,
      metadata: {
        compatible: schema.compatible,
        version: schema.version,
        upgradedSpecIds: retro.upgradedSpecIds,
        resolvedReviewTaskIds: retro.resolvedReviewTaskIds,
      },
    });
    invalidateOrganizationSchemaRegistryCache(auth.organization.id);
    return {
      schema,
      upgradedSpecIds: retro.upgradedSpecIds,
      resolvedReviewTaskIds: retro.resolvedReviewTaskIds,
    };
  });
}

export type OrganizationDriverSchemaDeprecationImpact = {
  schemaId: string;
  compatible: string;
  coverageLoss: boolean;
  definitionCount: number;
  projectCount: number;
  successorSource:
    | {
        scope: "platform";
        schemaId: string;
        displayName: string;
      }
    | {
        scope: "pinned";
        driverId: string;
        pattern: string;
        source: string;
      }
    | null;
};

export async function previewOrganizationDriverSchemaDeprecationForAuth(
  db: Database,
  auth: AuthContext,
  schemaId: string,
): Promise<OrganizationDriverSchemaDeprecationImpact> {
  requireCanAdmin(auth);
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: auth.organization.id,
    schemaId,
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
  }

  const pinnedCoverage = lookupParseCoverage(
    existing.compatible,
    getCachedSchemaRegistry(schemasRoot),
  );
  const platformOverlay = pinnedCoverage.covered
    ? null
    : await findActivePlatformDriverSchemaOverlayByCompatible(db, existing.compatible);
  const successorSource: OrganizationDriverSchemaDeprecationImpact["successorSource"] =
    pinnedCoverage.covered
      ? {
          scope: "pinned",
          driverId: pinnedCoverage.driverId,
          pattern: pinnedCoverage.pattern,
          source: pinnedCoverage.source,
        }
      : platformOverlay
        ? {
            scope: "platform",
            schemaId: platformOverlay.id,
            displayName: platformOverlay.displayName,
          }
        : null;
  const projectImpact = await db.query<{ project_count: string }>(
    `
    select count(distinct b.project_id)::text as project_count
    from project_parameter_bindings b
    left join lateral (
      select compatible
      from dts_logical_node_revisions
      where logical_node_id = b.logical_node_id
      order by config_revision_id desc
      limit 1
    ) lnr on true
    where b.organization_id = $1
      and lower(trim(both '"' from trim(both '''' from trim(both from lnr.compatible))))
        = lower($2)
    `,
    [auth.organization.id, existing.compatible.trim()],
  );

  return {
    schemaId: existing.id,
    compatible: existing.compatible,
    coverageLoss: existing.lifecycle === "active" && successorSource === null,
    definitionCount: existing.properties.length,
    projectCount: Number(projectImpact.rows[0]?.project_count ?? 0),
    successorSource,
  };
}

export async function deprecateOrganizationDriverSchemaForAuth(
  db: Database,
  auth: AuthContext,
  schemaId: string,
  input: { confirmCoverageLoss?: boolean } = {},
): Promise<OrganizationDriverSchemaRecord> {
  requireCanAdmin(auth);
  const impact = await previewOrganizationDriverSchemaDeprecationForAuth(db, auth, schemaId);
  if (impact.coverageLoss && !input.confirmCoverageLoss) {
    throw new ApiError(
      "CONFLICT",
      "Deprecating this overlay removes parse coverage and requires explicit confirmation.",
      409,
      { confirmRequired: true, impact },
    );
  }
  const existing = await getOrganizationDriverSchema(db, {
    organizationId: auth.organization.id,
    schemaId,
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
  }
  if (existing.lifecycle === "superseded") {
    throw new ApiError(
      "CONFLICT",
      "Superseded organization overlays are read-only.",
      409,
      { successorSchemaId: existing.supersededBySchemaId },
    );
  }
  const updated = await setOrganizationDriverSchemaLifecycle(db, {
    organizationId: auth.organization.id,
    schemaId,
    lifecycle: "deprecated",
    updatedByUserId: auth.user.id,
  });
  if (!updated) {
    throw new ApiError("NOT_FOUND", "Organization driver schema not found.", 404);
  }
  await writeAudit(db, auth, {
    action: "deprecated",
    subjectId: schemaId,
    metadata: { compatible: updated.compatible, impact, confirmCoverageLoss: Boolean(input.confirmCoverageLoss) },
  });
  invalidateOrganizationSchemaRegistryCache(auth.organization.id);
  return updated;
}
