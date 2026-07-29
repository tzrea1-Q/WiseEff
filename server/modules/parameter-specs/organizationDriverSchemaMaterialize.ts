import type { OrganizationDriverSchemaRecord } from "./organizationDriverSchemaRepository";
import { buildManualSpecIds } from "./specIdentity";
import type {
  DriverSchema,
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

export function buildOrganizationOverlaySchemaNamespace(input: {
  organizationId: string;
  compatible: string;
}): string {
  return `org/${input.organizationId}/${input.compatible}`;
}

/**
 * driverModule for buildManualSpecIds must match ingest's provisional path:
 * matchable.compatible[0]?.split(",").pop()
 */
export function driverModuleFromOverlayCompatible(compatible: string): string {
  const segment = compatible.split(",").pop()?.trim();
  return segment && segment.length > 0 ? segment : compatible;
}

export function materializeOrganizationDriverSchema(
  schema: OrganizationDriverSchemaRecord,
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
  const lifecycle: SpecLifecycle = schema.lifecycle;
  const properties: PropertySpec[] = [];
  const propertyIds: string[] = [];

  const driverModule = driverModuleFromOverlayCompatible(schema.compatible);
  for (const property of schema.properties) {
    // Prefer the linked ParameterSpec identity. Creation always ensures the
    // buildManualSpecIds row so provisional upgrade stays in place.
    const fallbackIds = buildManualSpecIds({
      organizationId: schema.organizationId,
      propertyKey: property.propertyKey,
      driverModule,
    });
    const parameterSpecId = property.parameterSpecId || fallbackIds.parameterSpecId;
    const parameterSpecVersionId =
      property.parameterSpecVersionId || fallbackIds.parameterSpecVersionId;
    const propertyLifecycle =
      property.specLifecycle === "active" || property.specLifecycle === "deprecated"
        ? property.specLifecycle
        : lifecycle;
    propertyIds.push(parameterSpecVersionId);
    properties.push({
      id: parameterSpecVersionId,
      parameterSpecId,
      driverSchemaId: driverId,
      propertyKey: property.propertyKey,
      schemaNamespace,
      source: "manual",
      lifecycle: propertyLifecycle,
      valueShape: normalizeValueShape(property.valueShape),
      units: property.units ?? undefined,
      constraints: property.constraints ?? {},
      exampleValue: property.exampleValue ?? undefined,
      documentation: property.documentation || undefined,
    });
  }

  const driver: DriverSchema = {
    id: driverId,
    compatible: schema.compatible,
    compatiblePatterns: [schema.compatible],
    nodenamePatterns: [],
    source: "manual",
    schemaNamespace,
    version: schema.version,
    lifecycle,
    propertyIds,
    commonRefs: [],
  };

  return { driver, properties };
}

export function overlayDigest(schemas: readonly OrganizationDriverSchemaRecord[]): string {
  const parts = schemas
    .map(
      (schema) =>
        [
          schema.id,
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

export function mergePinnedRegistryWithOverlay(
  pinned: SchemaRegistry,
  overlaySchemas: readonly OrganizationDriverSchemaRecord[],
): SchemaRegistry {
  const drivers = [...pinned.drivers];
  const properties = [...pinned.properties];
  for (const schema of overlaySchemas) {
    const materialized = materializeOrganizationDriverSchema(schema);
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
