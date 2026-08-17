import { randomUUID } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export type CoverageClaimInput = {
  kind: "overlay-property";
  overlayId?: string;
  overlayPropertyId?: string;
  upsertOverlay?: {
    compatible: string;
    displayName?: string;
    createPropertyLink: true;
  };
};

/**
 * Ensure the definition is linked from an org overlay property row.
 * Never mints a second ParameterSpec identity — links the existing row only.
 */
export async function ensureExplicitOverlayCoverageClaim(
  db: Queryable,
  input: {
    organizationId: string;
    parameterSpecId: string;
    propertyKey: string;
    claim: CoverageClaimInput;
    createdByUserId: string;
  },
): Promise<{ overlayId: string; overlayPropertyId: string }> {
  if (input.claim.kind !== "overlay-property") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Only overlay-property coverage claims are supported in this release.",
      { kind: input.claim.kind },
    );
  }

  const propertyKey = input.propertyKey.trim();
  if (!propertyKey) {
    throw new ApiError("VALIDATION_FAILED", "propertyKey is required for coverage claim.");
  }

  if (input.claim.overlayPropertyId) {
    const existing = await db.query<{
      id: string;
      driver_schema_overlay_id: string;
      parameter_spec_id: string;
      property_key: string;
    }>(
      `
      select op.id, op.driver_schema_overlay_id, op.parameter_spec_id, op.property_key
      from driver_schema_overlay_properties op
      inner join driver_schema_overlays o on o.id = op.driver_schema_overlay_id
      where op.id = $1
        and o.organization_id = $2
        and o.lifecycle in ('draft', 'active')
      limit 1
      `,
      [input.claim.overlayPropertyId, input.organizationId],
    );
    const hit = existing.rows[0];
    if (!hit) {
      throw new ApiError("NOT_FOUND", "Coverage claim overlay property was not found.", {
        overlayPropertyId: input.claim.overlayPropertyId,
      });
    }
    if (hit.parameter_spec_id !== input.parameterSpecId || hit.property_key !== propertyKey) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Coverage claim does not match this parameter definition.",
        {
          overlayPropertyId: hit.id,
          expectedParameterSpecId: input.parameterSpecId,
          actualParameterSpecId: hit.parameter_spec_id,
        },
      );
    }
    return { overlayId: hit.driver_schema_overlay_id, overlayPropertyId: hit.id };
  }

  if (input.claim.overlayId) {
    const linked = await linkPropertyOntoOverlay(db, {
      organizationId: input.organizationId,
      overlayId: input.claim.overlayId,
      parameterSpecId: input.parameterSpecId,
      propertyKey,
    });
    return linked;
  }

  if (input.claim.upsertOverlay?.createPropertyLink) {
    const compatible = input.claim.upsertOverlay.compatible.trim();
    if (!compatible) {
      throw new ApiError("VALIDATION_FAILED", "upsertOverlay.compatible is required.");
    }
    const displayName =
      input.claim.upsertOverlay.displayName?.trim() || `${compatible} coverage overlay`;

    const existingOverlay = await db.query<{ id: string }>(
      `
      select id
      from driver_schema_overlays
      where organization_id = $1
        and compatible = $2
        and lifecycle in ('draft', 'active')
      order by
        case lifecycle when 'draft' then 0 else 1 end,
        updated_at desc
      limit 1
      `,
      [input.organizationId, compatible],
    );

    let overlayId = existingOverlay.rows[0]?.id;
    if (!overlayId) {
      overlayId = randomUUID();
      await db.query(
        `
        insert into driver_schema_overlays (
          id, organization_id, compatible, display_name, notes, lifecycle, version,
          created_by_user_id, updated_by_user_id
        ) values ($1, $2, $3, $4, '', 'draft', 1, $5, $5)
        `,
        [overlayId, input.organizationId, compatible, displayName, input.createdByUserId],
      );
    }

    return linkPropertyOntoOverlay(db, {
      organizationId: input.organizationId,
      overlayId,
      parameterSpecId: input.parameterSpecId,
      propertyKey,
    });
  }

  throw new ApiError(
    "VALIDATION_FAILED",
    "Activation requires an explicit coverage claim (existing overlay property or upsertOverlay).",
    { parameterSpecId: input.parameterSpecId },
  );
}

export async function findExistingCoverageClaim(
  db: Queryable,
  input: { organizationId: string; parameterSpecId: string; propertyKey: string },
): Promise<{ overlayId: string; overlayPropertyId: string } | null> {
  const result = await db.query<{ id: string; driver_schema_overlay_id: string }>(
    `
    select op.id, op.driver_schema_overlay_id
    from driver_schema_overlay_properties op
    inner join driver_schema_overlays o on o.id = op.driver_schema_overlay_id
    where op.parameter_spec_id = $1
      and op.property_key = $2
      and (
        o.organization_id = $3
        or o.organization_id is null
      )
      and o.lifecycle in ('draft', 'active')
    order by
      case when o.organization_id = $3 then 0 else 1 end,
      case o.lifecycle when 'active' then 0 else 1 end
    limit 1
    `,
    [input.parameterSpecId, input.propertyKey, input.organizationId],
  );
  const hit = result.rows[0];
  if (!hit) return null;
  return { overlayId: hit.driver_schema_overlay_id, overlayPropertyId: hit.id };
}

async function linkPropertyOntoOverlay(
  db: Queryable,
  input: {
    organizationId: string;
    overlayId: string;
    parameterSpecId: string;
    propertyKey: string;
  },
): Promise<{ overlayId: string; overlayPropertyId: string }> {
  const overlay = await db.query<{ id: string; lifecycle: string }>(
    `
    select id, lifecycle
    from driver_schema_overlays
    where id = $1
      and organization_id = $2
      and lifecycle in ('draft', 'active')
    limit 1
    `,
    [input.overlayId, input.organizationId],
  );
  if (!overlay.rows[0]) {
    throw new ApiError("NOT_FOUND", "Organization driver schema overlay was not found.", {
      overlayId: input.overlayId,
    });
  }
  if (overlay.rows[0].lifecycle === "active") {
    // Active overlay property sets are immutable — only allow if link already exists.
    const existing = await db.query<{ id: string }>(
      `
      select id
      from driver_schema_overlay_properties
      where driver_schema_overlay_id = $1
        and parameter_spec_id = $2
        and property_key = $3
      limit 1
      `,
      [input.overlayId, input.parameterSpecId, input.propertyKey],
    );
    if (existing.rows[0]) {
      return { overlayId: input.overlayId, overlayPropertyId: existing.rows[0].id };
    }
    throw new ApiError(
      "VALIDATION_FAILED",
      "Active overlay property sets are immutable; create a draft overlay to add coverage.",
      { overlayId: input.overlayId },
    );
  }

  const existing = await db.query<{ id: string }>(
    `
    select id
    from driver_schema_overlay_properties
    where driver_schema_overlay_id = $1
      and parameter_spec_id = $2
      and property_key = $3
    limit 1
    `,
    [input.overlayId, input.parameterSpecId, input.propertyKey],
  );
  if (existing.rows[0]) {
    return { overlayId: input.overlayId, overlayPropertyId: existing.rows[0].id };
  }

  const overlayPropertyId = randomUUID();
  const sortOrder = await db.query<{ next: string }>(
    `
    select coalesce(max(sort_order), -1) + 1 as next
    from driver_schema_overlay_properties
    where driver_schema_overlay_id = $1
    `,
    [input.overlayId],
  );
  await db.query(
    `
    insert into driver_schema_overlay_properties (
      id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order
    ) values ($1, $2, $3, $4, $5)
    `,
    [
      overlayPropertyId,
      input.overlayId,
      input.parameterSpecId,
      input.propertyKey,
      Number(sortOrder.rows[0]?.next ?? 0),
    ],
  );
  return { overlayId: input.overlayId, overlayPropertyId };
}
