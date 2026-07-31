export type DriverNature = "physical-device" | "logical-service";
export type InstanceCardinality = "multiple" | "singleton-per-project";
export type AttributionSubjectKind = "driver-registration" | "node-type-definition";

export type ModuleKindForParent =
  | "business"
  | "driver-group"
  | "node-type"
  | "unclassified";

export function defaultDriverRegistrationAttributes(): {
  driverNature: DriverNature;
  instanceCardinality: InstanceCardinality;
} {
  return {
    driverNature: "physical-device",
    instanceCardinality: "multiple",
  };
}

/**
 * Parent/child kind rules for the taxonomy tree after ADR-0010 + ADR-0013.
 * Instances never appear as modules; nesting expresses schema composition only.
 */
export function isValidAttributionParentKind(
  kind: Exclude<ModuleKindForParent, "unclassified">,
  parentKind: ModuleKindForParent | null | undefined,
): boolean {
  if (kind === "business") {
    return parentKind == null || parentKind === "business";
  }
  if (kind === "driver-group") {
    return parentKind === "business";
  }
  if (kind === "node-type") {
    return parentKind === "business" || parentKind === "driver-group" || parentKind === "node-type";
  }
  return false;
}

export function attributionSubjectIdForModule(moduleId: string, subjectKind: AttributionSubjectKind): string {
  return `asub:${subjectKind}:${moduleId}`;
}
