import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { writePlatformAuditEvent } from "../audit/repository";
import type { AuthContext } from "../auth/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  findActivePlatformDriverSchemaOverlayByCompatible,
  getDriverSchemaOverlay,
  getDriverSchemaOverlayPromotion,
  insertDriverSchemaOverlayPromotion,
  insertPlatformDriverSchemaOverlay,
  listActiveOrganizationDriverSchemaOverlays,
  listPromotionsForPlatformSchema,
  materializePlatformParameterSpecs,
  retirePlatformParameterSpecsForOverlay,
  restoreSupersededContributors,
  setOrganizationDriverSchemaLifecycle,
  setPlatformDriverSchemaOverlayLifecycle,
  type DriverSchemaOverlayRecord,
  type OrganizationDriverSchemaRecord,
} from "./driverSchemaOverlayRepository";
import { invalidatePlatformSchemaRegistryCache } from "./schemaRegistryCache";
import type { PropertyValueShape } from "./types";

const schemasRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/dts");

function requireCanPromote(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("platform:schema-promote")) {
    throw new ApiError("FORBIDDEN", "Platform schema promotion permission is required.");
  }
}

type PropertyShapeSignature = {
  propertyKey: string;
  valueShapeKind: string;
  units: string | null;
};

type ContributorProjection = {
  organizationId: string;
  schemaId: string;
  propertyKeys: string[];
  properties: PropertyShapeSignature[];
  documentationByKey: Record<string, string>;
};

export type PromotionCandidateProjection = {
  compatible: string;
  contributorOrganizationIds: string[];
  contributorCount: number;
  propertyKeys: string[];
  contributors: ContributorProjection[];
  equivalent: boolean;
  divergence?: Array<{
    propertyKey: string;
    contributors: Array<{
      organizationId: string;
      valueShapeKind: string;
      units: string | null;
    }>;
  }>;
  hasActivePlatformOverlay: boolean;
  platformSchemaId?: string;
  promotionIds?: string[];
};

function shapeKind(value: PropertyValueShape | Record<string, unknown>): string {
  if (typeof value === "object" && value && "kind" in value) {
    return String((value as { kind: unknown }).kind);
  }
  return "unknown";
}

function contributorProjection(schema: OrganizationDriverSchemaRecord): ContributorProjection {
  const properties: PropertyShapeSignature[] = schema.properties.map((property) => ({
    propertyKey: property.propertyKey,
    valueShapeKind: shapeKind(property.valueShape),
    units: property.units ?? null,
  }));
  const documentationByKey: Record<string, string> = {};
  for (const property of schema.properties) {
    documentationByKey[property.propertyKey] = property.documentation ?? "";
  }
  return {
    organizationId: schema.organizationId!,
    schemaId: schema.id,
    propertyKeys: properties.map((property) => property.propertyKey).sort(),
    properties,
    documentationByKey,
  };
}

/** Exported for unit tests — promotion eligibility without I/O. */
export function areContributorsEquivalent(
  overlays: readonly OrganizationDriverSchemaRecord[],
): boolean {
  return equivalenceVerdict(overlays.map(contributorProjection)).equivalent;
}

/** Exported for unit tests — fixed projection shape without DB. */
export function projectPromotionCandidates(
  overlays: readonly OrganizationDriverSchemaRecord[],
): PromotionCandidateProjection[] {
  const grouped = new Map<string, OrganizationDriverSchemaRecord[]>();
  for (const overlay of overlays) {
    const key = overlay.compatible.toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(overlay);
    grouped.set(key, list);
  }
  const items: PromotionCandidateProjection[] = [];
  for (const group of grouped.values()) {
    const contributors = group.map(contributorProjection);
    const verdict = equivalenceVerdict(contributors);
    items.push({
      compatible: group[0].compatible,
      contributorOrganizationIds: contributors.map((entry) => entry.organizationId),
      contributorCount: contributors.length,
      propertyKeys: verdict.propertyKeys,
      contributors,
      equivalent: verdict.equivalent,
      ...(verdict.divergence ? { divergence: verdict.divergence } : {}),
      hasActivePlatformOverlay: false,
    });
  }
  items.sort((left, right) => left.compatible.localeCompare(right.compatible));
  return items;
}

function equivalenceVerdict(contributors: ContributorProjection[]): {
  equivalent: boolean;
  propertyKeys: string[];
  divergence?: PromotionCandidateProjection["divergence"];
} {
  if (contributors.length === 0) {
    return { equivalent: false, propertyKeys: [] };
  }
  const keySets = contributors.map((contributor) => contributor.propertyKeys);
  const unionKeys = [...new Set(keySets.flat())].sort();
  const sameKeySet = keySets.every(
    (keys) => keys.length === unionKeys.length && keys.every((key, index) => key === unionKeys[index]),
  );
  const divergence: NonNullable<PromotionCandidateProjection["divergence"]> = [];
  for (const propertyKey of unionKeys) {
    const shapes = contributors.map((contributor) => {
      const property = contributor.properties.find((entry) => entry.propertyKey === propertyKey);
      return {
        organizationId: contributor.organizationId,
        valueShapeKind: property?.valueShapeKind ?? "(missing)",
        units: property?.units ?? null,
      };
    });
    const first = shapes[0];
    const allMatch = shapes.every(
      (entry) =>
        entry.valueShapeKind === first.valueShapeKind && entry.units === first.units,
    );
    if (!allMatch) {
      divergence.push({ propertyKey, contributors: shapes });
    }
  }
  return {
    equivalent: sameKeySet && divergence.length === 0,
    propertyKeys: unionKeys,
    ...(divergence.length > 0 ? { divergence } : {}),
  };
}

export async function listPromotionCandidatesForAuth(
  db: Database,
  auth: AuthContext,
): Promise<{ items: PromotionCandidateProjection[] }> {
  requireCanPromote(auth);
  const overlays = await listActiveOrganizationDriverSchemaOverlays(db);
  const grouped = new Map<string, OrganizationDriverSchemaRecord[]>();
  for (const overlay of overlays) {
    const key = overlay.compatible.toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(overlay);
    grouped.set(key, list);
  }

  const items: PromotionCandidateProjection[] = [];
  for (const group of grouped.values()) {
    const compatible = group[0].compatible;
    const contributors = group.map(contributorProjection);
    const verdict = equivalenceVerdict(contributors);
    const platformOverlay = await findActivePlatformDriverSchemaOverlayByCompatible(db, compatible);
    const promotionIds = platformOverlay
      ? (await listPromotionsForPlatformSchema(db, platformOverlay.id)).map((row) => row.id)
      : [];
    items.push({
      compatible,
      contributorOrganizationIds: contributors.map((entry) => entry.organizationId),
      contributorCount: contributors.length,
      propertyKeys: verdict.propertyKeys,
      contributors,
      equivalent: verdict.equivalent,
      ...(verdict.divergence ? { divergence: verdict.divergence } : {}),
      hasActivePlatformOverlay: Boolean(platformOverlay),
      ...(platformOverlay
        ? { platformSchemaId: platformOverlay.id, promotionIds }
        : {}),
    });
  }

  items.sort((left, right) => left.compatible.localeCompare(right.compatible));
  return { items };
}

function pickDocumentationSource(
  contributors: ContributorProjection[],
  documentationSourceOrganizationId?: string,
): string | undefined {
  if (documentationSourceOrganizationId) {
    const match = contributors.find(
      (entry) => entry.organizationId === documentationSourceOrganizationId,
    );
    if (!match) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "documentationSourceOrganizationId is not among the contributors."
      );
    }
    return documentationSourceOrganizationId;
  }
  return contributors[0]?.organizationId;
}

export async function promoteDriverSchemaOverlayForAuth(
  db: Database,
  auth: AuthContext,
  input: {
    compatible: string;
    displayName?: string;
    notes?: string;
    documentationSourceOrganizationId?: string;
  },
): Promise<{
  promotionIds: string[];
  platformSchemaId: string;
  supersededSchemaIds: string[];
  affectedOrganizationIds: string[];
}> {
  requireCanPromote(auth);
  const compatible = input.compatible.trim();
  if (!compatible) {
    throw new ApiError("VALIDATION_FAILED", "compatible is required.");
  }

  return db.transaction(async (tx) => {
    await tx.query(
      `select pg_advisory_xact_lock(
         hashtext('driver-schema-overlay-promotion'),
         hashtext(lower($1))
       )`,
      [compatible],
    );
    const existingPlatform = await findActivePlatformDriverSchemaOverlayByCompatible(tx, compatible);
    if (existingPlatform) {
      throw new ApiError(
        "CONFLICT",
        "An active platform overlay already exists for this compatible.",
        { platformSchemaId: existingPlatform.id },
      );
    }

    const overlays = (await listActiveOrganizationDriverSchemaOverlays(tx)).filter(
      (overlay) => overlay.compatible.toLowerCase() === compatible.toLowerCase(),
    );
    if (overlays.length === 0) {
      throw new ApiError("NOT_FOUND", "No active organization overlays found for compatible.");
    }

    const contributors = overlays.map(contributorProjection);
    const verdict = equivalenceVerdict(contributors);
    if (!verdict.equivalent) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Contributors are not equivalent for promotion.",
        { divergence: verdict.divergence },
      );
    }

    const documentationSourceOrgId = pickDocumentationSource(
      contributors,
      input.documentationSourceOrganizationId,
    );
    const documentationSource = contributors.find(
      (entry) => entry.organizationId === documentationSourceOrgId,
    );
    const referenceOverlay = overlays.find(
      (overlay) => overlay.organizationId === documentationSourceOrgId,
    ) ?? overlays[0];

    const parameterSpecIdsBySource = await materializePlatformParameterSpecs(tx, {
      compatible: referenceOverlay.compatible,
      sourceOrganizationId: referenceOverlay.organizationId,
      properties: referenceOverlay.properties,
    });
    const parameterSpecIds = referenceOverlay.properties.map((property) => {
      const platformParameterSpecId = parameterSpecIdsBySource.get(property.parameterSpecId);
      if (!platformParameterSpecId) {
        throw new Error(
          `Platform promotion did not materialize ${property.parameterSpecId}.`,
        );
      }
      return platformParameterSpecId;
    });

    const platformSchemaId = randomUUID();
    const platformOverlay = await insertPlatformDriverSchemaOverlay(tx, {
      id: platformSchemaId,
      compatible: referenceOverlay.compatible,
      displayName: input.displayName?.trim() || referenceOverlay.displayName,
      notes: input.notes ?? referenceOverlay.notes,
      createdByUserId: auth.user.id,
      properties: referenceOverlay.properties.map((property, index) => ({
        id: randomUUID(),
        parameterSpecId: parameterSpecIds[index]!,
        propertyKey: property.propertyKey,
        sortOrder: index,
      })),
    });

    const promotionIds: string[] = [];
    const supersededSchemaIds: string[] = [];
    const affectedOrganizationIds: string[] = [];

    for (const overlay of overlays) {
      const superseded = await setOrganizationDriverSchemaLifecycle(tx, {
        organizationId: overlay.organizationId,
        schemaId: overlay.id,
        lifecycle: "superseded",
        updatedByUserId: auth.user.id,
        supersededBySchemaId: platformSchemaId,
      });
      if (!superseded) continue;
      supersededSchemaIds.push(superseded.id);
      affectedOrganizationIds.push(superseded.organizationId);

      const promotion = await insertDriverSchemaOverlayPromotion(tx, {
        id: randomUUID(),
        platformSchemaId,
        sourceSchemaId: overlay.id,
        sourceOrganizationId: overlay.organizationId,
        promotedByUserId: auth.user.id,
        documentationSource:
          overlay.organizationId === documentationSourceOrgId
            ? documentationSourceOrgId
            : null,
      });
      promotionIds.push(promotion.id);
    }

    await invalidatePlatformSchemaRegistryCache(tx, schemasRoot);

    await writePlatformAuditEvent(tx, {
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameter-management",
      kind: "driver_schema_overlay_promotion",
      action: "promoted",
      severity: "High",
      targetType: "driver_schema_overlay",
      targetId: platformSchemaId,
      projectId: null,
      traceId: randomUUID(),
      metadata: {
        compatible,
        platformSchemaId,
        supersededSchemaIds,
        promotionIds,
        parameterSpecIds,
        sourceParameterSpecIds: referenceOverlay.properties.map(
          (property) => property.parameterSpecId,
        ),
        contributorCount: overlays.length,
      },
      affectedOrganizationIds,
    });

    return {
      promotionIds,
      platformSchemaId: platformOverlay.id,
      supersededSchemaIds,
      affectedOrganizationIds,
    };
  });
}

export async function revertDriverSchemaOverlayPromotionForAuth(
  db: Database,
  auth: AuthContext,
  promotionId: string,
): Promise<{
  platformSchemaId: string;
  restoredSchemaIds: string[];
  affectedOrganizationIds: string[];
}> {
  requireCanPromote(auth);

  return db.transaction(async (tx) => {
    const promotion = await getDriverSchemaOverlayPromotion(tx, promotionId);
    if (!promotion) {
      throw new ApiError("NOT_FOUND", "Promotion record not found.");
    }
    await tx.query(
      `select pg_advisory_xact_lock(
         hashtext('driver-schema-overlay-revert'),
         hashtext($1)
       )`,
      [promotion.platform_schema_id],
    );

    const platformSchema = await getDriverSchemaOverlay(tx, promotion.platform_schema_id);
    if (!platformSchema || platformSchema.organizationId != null) {
      throw new ApiError("NOT_FOUND", "Platform overlay not found.");
    }
    if (platformSchema.lifecycle !== "active") {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Only active platform overlays can be reverted via promotion."
      );
    }

    const deprecated = await setPlatformDriverSchemaOverlayLifecycle(tx, {
      schemaId: platformSchema.id,
      lifecycle: "deprecated",
      updatedByUserId: auth.user.id,
    });
    if (!deprecated) {
      throw new ApiError("NOT_FOUND", "Platform overlay not found.");
    }

    const retiredParameterSpecIds =
      await retirePlatformParameterSpecsForOverlay(tx, platformSchema.id);

    const restored = await restoreSupersededContributors(tx, platformSchema.id);
    const restoredSchemaIds = restored.map((schema) => schema.id);
    const affectedOrganizationIds = restored.map((schema) => schema.organizationId);

    await invalidatePlatformSchemaRegistryCache(tx, schemasRoot);

    await writePlatformAuditEvent(tx, {
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameter-management",
      kind: "driver_schema_overlay_promotion",
      action: "reverted",
      severity: "High",
      targetType: "driver_schema_overlay_promotion",
      targetId: promotionId,
      projectId: null,
      traceId: randomUUID(),
      metadata: {
        platformSchemaId: platformSchema.id,
        compatible: platformSchema.compatible,
        restoredSchemaIds,
        promotionId,
        retiredParameterSpecIds,
      },
      affectedOrganizationIds,
    });

    return {
      platformSchemaId: platformSchema.id,
      restoredSchemaIds,
      affectedOrganizationIds,
    };
  });
}

export async function getPromotionBlastRadius(
  db: Queryable,
  compatible: string,
): Promise<{ contributorCount: number; affectedOrganizationIds: string[] }> {
  const overlays = (await listActiveOrganizationDriverSchemaOverlays(db)).filter(
    (overlay) => overlay.compatible.toLowerCase() === compatible.toLowerCase(),
  );
  return {
    contributorCount: overlays.length,
    affectedOrganizationIds: overlays.map((overlay) => overlay.organizationId),
  };
}
