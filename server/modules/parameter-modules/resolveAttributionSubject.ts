import { createHash } from "node:crypto";

import { ApiError } from "../../shared/http/errors";
import type { Queryable } from "../../shared/database/client";
import { compatibleSourceKey } from "./ensureAttributionModuleForBinding";
import { getParameterModuleBySourceKey } from "../parameters/parameterModuleRepository";
import { defaultDriverRegistrationAttributes } from "./attributionSubjects";

/**
 * Look up a catalog AttributionSubject by owner scope + source_key (ADR-0013).
 */
export async function findAttributionSubjectBySourceKey(
  db: Queryable,
  input: { organizationId: string | null; sourceKey: string },
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `
    select id
    from attribution_subjects
    where organization_id is not distinct from $1
      and source_key = $2
    limit 1
    `,
    [input.organizationId, input.sourceKey],
  );
  return result.rows[0]?.id ?? null;
}

export async function getModuleAttributionSubjectId(
  db: Queryable,
  moduleId: string,
): Promise<string | null> {
  const result = await db.query<{ attribution_subject_id: string | null }>(
    `
    select attribution_subject_id
    from parameter_modules
    where id = $1
    limit 1
    `,
    [moduleId],
  );
  return result.rows[0]?.attribution_subject_id ?? null;
}

/**
 * Resolve the durable AttributionSubject for a compatible string.
 * Prefers exact `compatible:{token}` source_key, then module placement via the same key.
 * Does not invent subjects — callers that need creation should use ensure*.
 */
export async function resolveAttributionSubjectIdForCompatible(
  db: Queryable,
  input: { organizationId: string | null; compatible: string },
): Promise<string | null> {
  const compatible = input.compatible.trim();
  if (!compatible) return null;
  const sourceKey = compatibleSourceKey(compatible);
  const bySource = await findAttributionSubjectBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey,
  });
  if (bySource) return bySource;

  if (input.organizationId) {
    const module = await getParameterModuleBySourceKey(db, {
      organizationId: input.organizationId,
      sourceKey,
    });
    if (module?.attributionSubjectId) return module.attributionSubjectId;
  }

  return null;
}

function subjectIdForCompatibleSourceKey(input: {
  organizationId: string | null;
  sourceKey: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.organizationId ?? "platform"}\u001f${input.sourceKey}`)
    .digest("hex")
    .slice(0, 24);
  return `asub:driver-registration:compatible:${digest}`;
}

/**
 * Resolve or create the AttributionSubject for a compatible (overlay / provisional writes).
 * Does not place taxonomy modules — ingest/module ensure remains responsible for tree placement.
 */
export async function ensureAttributionSubjectForCompatible(
  db: Queryable,
  input: {
    organizationId: string | null;
    compatible: string;
    displayName?: string;
  },
): Promise<string> {
  const compatible = input.compatible.trim();
  if (!compatible) {
    throw new ApiError("VALIDATION_FAILED", "compatible is required to resolve attribution subject.");
  }
  const existing = await resolveAttributionSubjectIdForCompatible(db, {
    organizationId: input.organizationId,
    compatible,
  });
  if (existing) return existing;

  const sourceKey = compatibleSourceKey(compatible);
  const subjectId = subjectIdForCompatibleSourceKey({
    organizationId: input.organizationId,
    sourceKey,
  });
  const displayName =
    input.displayName?.trim() ||
    compatible.split(",").pop()?.trim() ||
    compatible;
  const defaults = defaultDriverRegistrationAttributes();

  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values ($1, $2, 'driver-registration', $3, 'auto', $4)
    on conflict (organization_id, source_key) do nothing
    `,
    [subjectId, input.organizationId, displayName, sourceKey],
  );
  // Prefer an existing row that raced in on the unique (org, source_key) path.
  const resolved = await findAttributionSubjectBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey,
  });
  const finalId = resolved ?? subjectId;
  await db.query(
    `
    insert into driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality, notes
    ) values ($1, $2, $3, $4)
    on conflict (attribution_subject_id) do nothing
    `,
    [finalId, defaults.driverNature, defaults.instanceCardinality, ""],
  );
  return finalId;
}

async function ensureNodeTypeDefinitionSubject(
  db: Queryable,
  input: { organizationId: string | null; nodename: string; displayName?: string },
): Promise<string> {
  const sourceKey = `nodetype:${input.nodename.toLowerCase()}`;
  const existing = await db.query<{ id: string; subject_kind: string }>(
    `
    select id, subject_kind
    from attribution_subjects
    where organization_id is not distinct from $1
      and source_key = $2
    limit 1
    `,
    [input.organizationId, sourceKey],
  );
  const subjectId =
    existing.rows[0]?.id ??
    `asub:node-type-definition:nodename:${createHash("sha256")
      .update(`${input.organizationId ?? "platform"}\u001f${sourceKey}`)
      .digest("hex")
      .slice(0, 24)}`;

  // Older expand migrations incorrectly classified nodename-backed schemas as
  // driver registrations. Correct that durable discriminant before a new
  // schema/property write can reuse the subject.
  if (existing.rows[0]?.subject_kind === "driver-registration") {
    // Placements are intentionally not foreign-keyed to driver_registrations,
    // so deleting the child row alone would leave a stale driver placement
    // that could be mistaken for a node-type declaration by catalog queries.
    await db.query(`delete from driver_registration_placements where attribution_subject_id = $1`, [subjectId]);
    await db.query(`delete from driver_registrations where attribution_subject_id = $1`, [subjectId]);
    await db.query(
      `update parameter_modules
       set kind = 'node-type', updated_at = now()
       where attribution_subject_id = $1 and source_key = $2 and kind = 'driver-group'`,
      [subjectId, sourceKey],
    );
    await db.query(
      `update attribution_subjects set subject_kind = 'node-type-definition', updated_at = now() where id = $1`,
      [subjectId],
    );
  } else {
    await db.query(
      `
      insert into attribution_subjects (
        id, organization_id, subject_kind, display_name, origin, source_key
      ) values ($1, $2, 'node-type-definition', $3, 'auto', $4)
      on conflict (organization_id, source_key) do nothing
      `,
      [subjectId, input.organizationId, input.displayName?.trim() || input.nodename, sourceKey],
    );
  }

  const resolved = await findAttributionSubjectBySourceKey(db, {
    organizationId: input.organizationId,
    sourceKey,
  });
  const finalId = resolved ?? subjectId;
  await db.query(
    `
    insert into node_type_definitions (attribution_subject_id, bare_node_name)
    values ($1, $2)
    on conflict (attribution_subject_id) do nothing
    `,
    [finalId, input.nodename],
  );
  return finalId;
}

/**
 * Resolve a schema's stable attribution identity. Compatible evidence maps to
 * DriverRegistration; nodename-only schemas are NodeTypeDefinition entities,
 * not drivers that may bypass the organization placement invariant.
 */
export async function ensureAttributionSubjectForDriverSchema(
  db: Queryable,
  input: {
    organizationId: string | null;
    compatible?: string | null;
    nodename?: string | null;
    displayName?: string;
  },
): Promise<string> {
  const compatible = input.compatible?.trim();
  if (compatible) {
    return ensureAttributionSubjectForCompatible(db, {
      organizationId: input.organizationId,
      compatible,
      displayName: input.displayName,
    });
  }

  const nodename = input.nodename?.trim();
  if (!nodename) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "A driver schema requires compatible or nodename evidence to resolve its attribution subject.",
    );
  }

  return ensureNodeTypeDefinitionSubject(db, {
    organizationId: input.organizationId,
    nodename,
    displayName: input.displayName,
  });
}

/**
 * Fail-closed resolve for product write paths. No silent driverModule fallback.
 */
export async function requireAttributionSubjectIdForCompatible(
  db: Queryable,
  input: { organizationId: string | null; compatible: string },
): Promise<string> {
  const subjectId = await resolveAttributionSubjectIdForCompatible(db, input);
  if (subjectId) return subjectId;
  throw new ApiError(
    "CONFLICT",
    "Cannot resolve attribution subject for compatible; register or place the driver before writing specs.",
    {
      organizationId: input.organizationId,
      compatible: input.compatible,
      sourceKey: compatibleSourceKey(input.compatible),
    },
  );
}
