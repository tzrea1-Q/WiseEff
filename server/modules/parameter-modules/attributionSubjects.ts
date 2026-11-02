export type DriverNature = "physical-device" | "logical-service";
export type InstanceCardinality = "multiple" | "singleton-per-project";
export type AttributionSubjectKind = "driver-registration" | "node-type-definition";

export function defaultDriverRegistrationAttributes(): {
  driverNature: DriverNature;
  instanceCardinality: InstanceCardinality;
} {
  return {
    driverNature: "physical-device",
    instanceCardinality: "multiple",
  };
}

export function attributionSubjectIdForModule(moduleId: string, subjectKind: AttributionSubjectKind): string {
  return `asub:${subjectKind}:${moduleId}`;
}
