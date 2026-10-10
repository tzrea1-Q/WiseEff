import type { SpecAttributionModule } from "@/domain/parameter-topology/types";

export type ParameterSpecLibraryRow = {
  id: string;
  identityKind?: "canonical-definition" | "legacy-spec";
  /** Null means platform-global catalog; Admins may still update via PATCH. */
  organizationId: string | null;
  propertyKey: string;
  /** Declared attribution subject (ADR-0013/0017); distinct from observed modules. */
  attributionSubjectId: string | null;
  /** Distinct attribution units from project bindings; empty = not yet observed. */
  attributionModules: SpecAttributionModule[];
  /** Server-declared taxonomy placement; authoritative even before observation. */
  declaredPlacement?: {
    moduleId: string;
    moduleName: string;
    categoryId: string | null;
    categoryName: string | null;
    path?: string[];
  } | null;
  driverModule: string | null;
  compatible: string | null;
  valueType: string;
  /** Full inferred/API value shape; activate must not collapse to kind-only. */
  valueShape: Record<string, unknown> | null;
  schemaSource: string;
  schemaVersion: string | number | null;
  exampleValue: unknown;
  reviewState: string;
  usageCount: number;
};

/** Maps topology API / mock payloads into library rows. Never uses path as identity. */
export function mapParameterSpecToLibraryRow(input: {
  id: string;
  identityKind?: ParameterSpecLibraryRow["identityKind"];
  organizationId?: string | null;
  propertyKey?: string | null;
  specificationKey?: string | null;
  driverModule?: string | null;
  lifecycle?: string | null;
  currentVersion?: number | null;
  compatiblePatterns?: string[] | null;
  valueShape?: unknown;
  exampleValue?: unknown;
  schemaNamespace?: string | null;
  schemaSource?: string | null;
  usageCount?: number | null;
  reviewState?: string | null;
  attributionModules?: SpecAttributionModule[] | null;
  attributionSubjectId?: string | null;
  declaredPlacement?: ParameterSpecLibraryRow["declaredPlacement"];
}): ParameterSpecLibraryRow {
  const propertyKey =
    input.propertyKey?.trim() ||
    input.specificationKey?.split("/").filter(Boolean).at(-1) ||
    input.id;
  const valueShape = input.valueShape;
  let valueType = "unknown";
  let preservedShape: Record<string, unknown> | null = null;
  if (typeof valueShape === "string") {
    valueType = valueShape;
  } else if (valueShape && typeof valueShape === "object" && !Array.isArray(valueShape) && "kind" in valueShape) {
    preservedShape = { ...(valueShape as Record<string, unknown>) };
    valueType = String((valueShape as { kind: unknown }).kind);
  }

  const schemaSource =
    input.schemaSource?.trim() ||
    (input.schemaNamespace?.includes("vendor")
      ? "vendor"
      : input.schemaNamespace?.includes("linux")
        ? "linux"
        : "manual");

  return {
    id: input.id,
    identityKind: input.identityKind ?? "legacy-spec",
    organizationId: input.organizationId ?? null,
    propertyKey,
    attributionSubjectId: input.attributionSubjectId ?? null,
    attributionModules: input.attributionModules ?? [],
    declaredPlacement: input.declaredPlacement ?? null,
    driverModule: input.driverModule ?? null,
    compatible: input.compatiblePatterns?.[0] ?? null,
    valueType,
    valueShape: preservedShape,
    schemaSource,
    schemaVersion: input.currentVersion ?? null,
    exampleValue: input.exampleValue ?? null,
    reviewState: input.reviewState ?? input.lifecycle ?? "draft",
    usageCount: input.usageCount ?? 0
  };
}
