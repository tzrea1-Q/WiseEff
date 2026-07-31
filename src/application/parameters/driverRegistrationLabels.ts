import type {
  DriverNature,
  InstanceCardinality,
} from "@/application/ports/ParameterModuleRegistryRepository";

export function formatDriverNatureLabel(value: DriverNature | null | undefined): string {
  switch (value) {
    case "physical-device":
      return "物理设备";
    case "logical-service":
      return "逻辑服务";
    default:
      return "—";
  }
}

export function formatInstanceCardinalityLabel(
  value: InstanceCardinality | null | undefined,
): string {
  switch (value) {
    case "multiple":
      return "多实例";
    case "singleton-per-project":
      return "单例/项目";
    default:
      return "—";
  }
}
