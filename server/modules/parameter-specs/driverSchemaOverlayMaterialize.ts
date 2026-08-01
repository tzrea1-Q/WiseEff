import type { DriverSchemaOverlayRecord } from "./driverSchemaOverlayRepository";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import type {
  DriverSchema,
  OverlayLifecycle,
  PropertySpec,
  PropertyValueShape,
  SchemaRegistry,
  SpecLifecycle,
} from "./types";

function normalizeValueShape(value: unknown): PropertyValueShape {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return { kind: value as PropertyValueShape["kind"] };
    return { kind: "unknown" };
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind === "string") {
    return value as PropertyValueShape;
  }
  return { kind: "unknown" };
}

/**
 * Stable overlay ids carry the organization segment so a shared process cache
 * cannot collide tenants (ADR-0008).
 */
export function buildOrganizationOverlayDriverId(input: {
  organizationId: string;
  compatible: string;
  version: number;
}): string {
  return `driver:org/${input.organizationId}/${input.compatible}:v${input.version}`;
}

export function buildPlatformOverlayDriverId(input: {
  compatible: string;
  version: number;
}): string {
  return `driver:platform/${input.compatible}:v${input.version}`;
}

export function buildOrganizationOverlaySchemaNamespace(input: {
  organizationId: string;
  compatible: string;
}): string {
  return `org/${input.organizationId}/${input.compatible}`;
}

export function buildPlatformOverlaySchemaNamespace(compatible: string): string {
  return `platform/${compatible}`;
}

/**
 * Display-only compatible tail label. Never use as ParameterSpec write identity.
 * @deprecated Prefer subject displayName / module name for product UI.
 */
export function displayDriverLabelFromOverlayCompatible(compatible: string): string {
  const segment = compatible.split(",").pop()?.trim();
  return segment && segment.length > 0 ? segment : compatible;
}

/** @deprecated Use {@link displayDriverLabelFromOverlayCompatible}; not an identity signal. */
export const driverModuleFromOverlayCompatible = displayDriverLabelFromOverlayCompatible;

function overlayLifecycleToSpecLifecycle(lifecycle: OverlayLifecycle): SpecLifecycle {
  if (lifecycle === "superseded") return "deprecated";
  return lifecycle;
}

function materializeOverlayProperties(
  schema: DriverSchemaOverlayRecord,
  input: {
    scope: "platform" | "organization";
    organizationId: string | null;
    attributionSubjectId: string | null;
    driverId: string;
    schemaNamespace: string;
    lifecycle: OverlayLifecycle;
  },
): { properties: PropertySpec[]; propertyIds: string[] } {
  const lifecycle = overlayLifecycleToSpecLifecycle(input.lifecycle);
  const properties: PropertySpec[] = [];
  const propertyIds: string[] = [];

  for (const property of schema.properties) {
    let parameterSpecId = property.parameterSpecId;
    let parameterSpecVersionId = property.parameterSpecVersionId;
    if (!parameterSpecId || !parameterSpecVersionId) {
      if (!input.attributionSubjectId) {
        throw new Error(
          "Overlay property missing parameterSpecId and attributionSubjectId; cannot materialize subject-scoped identity.",
        );
      }
      const fallbackIds = buildSubjectScopedManualSpecIds({
        organizationId: input.organizationId,
        attributionSubjectId: input.attributionSubjectId,
        propertyKey: property.propertyKey,
      });
      parameterSpecId = parameterSpecId || fallbackIds.parameterSpecId;
      parameterSpecVersionId = parameterSpecVersionId || fallbackIds.parameterSpecVersionId;
    }
    const propertyLifecycle =
      property.specLifecycle === "active" ||
      property.specLifecycle === "deprecated" ||
      property.specLifecycle === "superseded"
        ? overlayLifecycleToSpecLifecycle(property.specLifecycle)
        : lifecycle;
    propertyIds.push(parameterSpecVersionId);
    properties.push({
      id: parameterSpecVersionId,
      parameterSpecId,
      driverSchemaId: input.driverId,
      propertyKey: property.propertyKey,
      schemaNamespace: input.schemaNamespace,
      source: "manual",
      scope: input.scope,
      lifecycle: propertyLifecycle,
      valueShape: normalizeValueShape(property.valueShape),
      units: property.units ?? undefined,
      constraints: property.constraints ?? {},
      exampleValue: property.exampleValue ?? undefined,
      documentation: property.documentation || undefined,
    });
  }

  return { properties, propertyIds };
}

export function materializeOrganizationDriverSchema(
  schema: DriverSchemaOverlayRecord & { organizationId: string },
  options?: { attributionSubjectId?: string | null },
): { driver: DriverSchema; properties: PropertySpec[] } {
  const schemaNamespace = buildOrganizationOverlaySchemaNamespace({
    organizationId: schema.organizationId,
    compatible: schema.compatible,
  });
  const driverId = buildOrganizationOverlayDriverId({
    organizationId: schema.organizationId,
    compatible: schema.compatible,
    version: schema.version,
  });
  const { properties, propertyIds } = materializeOverlayProperties(schema, {
    scope: "organization",
    organizationId: schema.organizationId,
    attributionSubjectId: options?.attributionSubjectId ?? null,
    driverId,
    schemaNamespace,
    lifecycle: schema.lifecycle,
  });

  const driver: DriverSchema = {
    id: driverId,
    compatible: schema.compatible,
    compatiblePatterns: [schema.compatible],
    nodenamePatterns: [],
    source: "manual",
    scope: "organization",
    schemaNamespace,
    version: schema.version,
    lifecycle: overlayLifecycleToSpecLifecycle(schema.lifecycle),
    propertyIds,
    commonRefs: [],
  };

  return { driver, properties };
}

export function materializePlatformDriverSchemaOverlay(
  schema: DriverSchemaOverlayRecord,
  options?: { attributionSubjectId?: string | null },
): { driver: DriverSchema; properties: PropertySpec[] } {
  const schemaNamespace = buildPlatformOverlaySchemaNamespace(schema.compatible);
  const driverId = buildPlatformOverlayDriverId({
    compatible: schema.compatible,
    version: schema.version,
  });
  const { properties, propertyIds } = materializeOverlayProperties(schema, {
    scope: "platform",
    organizationId: null,
    attributionSubjectId: options?.attributionSubjectId ?? null,
    driverId,
    schemaNamespace,
    lifecycle: schema.lifecycle,
  });

  const driver: DriverSchema = {
    id: driverId,
    compatible: schema.compatible,
    compatiblePatterns: [schema.compatible],
    nodenamePatterns: [],
    source: "manual",
    scope: "platform",
    schemaNamespace,
    version: schema.version,
    lifecycle: overlayLifecycleToSpecLifecycle(schema.lifecycle),
    propertyIds,
    commonRefs: [],
  };

  return { driver, properties };
}

export function overlayDigest(schemas: readonly DriverSchemaOverlayRecord[]): string {
  const parts = schemas
    .map(
      (schema) =>
        [
          schema.id,
          schema.organizationId ?? "platform",
          schema.compatible,
          schema.lifecycle,
          String(schema.version),
          schema.updatedAt,
          ...schema.properties.map(
            (property) =>
              `${property.parameterSpecId}:${property.propertyKey}:${JSON.stringify(property.valueShape)}:${property.units ?? ""}`,
          ),
        ].join("|"),
    )
    .sort();
  return parts.join("\n");
}

export function platformOverlayDigest(schemas: readonly DriverSchemaOverlayRecord[]): string {
  const platformOnly = schemas.filter((schema) => schema.organizationId == null);
  return overlayDigest(platformOnly);
}

export function mergePinnedRegistryWithOverlay(
  pinned: SchemaRegistry,
  overlaySchemas: readonly DriverSchemaOverlayRecord[],
  options?: { attributionSubjectIdByOverlayId?: ReadonlyMap<string, string> },
): SchemaRegistry {
  const drivers = [...pinned.drivers];
  const properties = [...pinned.properties];
  for (const schema of overlaySchemas) {
    const attributionSubjectId = options?.attributionSubjectIdByOverlayId?.get(schema.id) ?? null;
    const materialized =
      schema.organizationId == null
        ? materializePlatformDriverSchemaOverlay(schema, { attributionSubjectId })
        : materializeOrganizationDriverSchema(
            schema as DriverSchemaOverlayRecord & { organizationId: string },
            { attributionSubjectId },
          );
    drivers.push(materialized.driver);
    properties.push(...materialized.properties);
  }
  return {
    catalog: pinned.catalog,
    drivers,
    properties,
    driversById: new Map(drivers.map((driver) => [driver.id, driver])),
    propertiesById: new Map(properties.map((property) => [property.id, property])),
  };
}
