import { stableSemanticId } from "../parameter-topology/migration";

export function sanitizeSpecSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.@+-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function buildManualSpecIds(input: {
  organizationId: string;
  propertyKey: string;
  driverModule: string | null;
}): {
  schemaNamespace: string;
  specificationKey: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  dtsPropertySpecId: string;
} {
  const schemaNamespace = sanitizeSpecSegment(input.driverModule ?? "manual");
  const propertySegment = sanitizeSpecSegment(input.propertyKey);
  const specificationKey = `${schemaNamespace}/${propertySegment}`;
  const parameterSpecId = stableSemanticId("parameter_spec", [
    input.organizationId,
    "manual",
    schemaNamespace,
    propertySegment,
  ]);
  const parameterSpecVersionId = stableSemanticId("parameter_spec_version", [parameterSpecId, "1"]);
  const dtsPropertySpecId = stableSemanticId("dts_property_spec", [parameterSpecId, propertySegment]);
  return {
    schemaNamespace,
    specificationKey,
    parameterSpecId,
    parameterSpecVersionId,
    dtsPropertySpecId,
  };
}
