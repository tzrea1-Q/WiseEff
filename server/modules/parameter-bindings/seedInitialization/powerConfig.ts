/** Reviewed ConfigurationSchema identity for the three seed JSON files. */
export const SEED_POWER_CONFIG_SCHEMA_ID = "wiseeff.power-config";

export const SEED_JSON_POINTERS = [
  { propertyKey: "charger.cv.limitMv", pointer: "/charger.cv.limitMv" },
  { propertyKey: "battery.thermal.targetTempC", pointer: "/battery.thermal.targetTempC" },
] as const;

export const SEED_SOURCE_FILE_NAMES = [
  "board.dts",
  "charging-thermal.dts",
  "power-config.json",
] as const;
