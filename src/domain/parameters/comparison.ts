import type { ParameterRecord, RiskLevel } from "./types";

export type ComparisonRowStatus = "drift" | "synced";

export type ComparisonRow = {
  key: string;
  module: string;
  description: string;
  baseValue: string;
  targetValue: string;
  baseNumeric: number | null;
  targetNumeric: number | null;
  unit: string;
  status: ComparisonRowStatus;
  risk: RiskLevel;
  structuredDiff?: { before: Record<string, unknown>; after: Record<string, unknown> };
};

export type RiskFilter = "All" | RiskLevel;

export type ComparisonFilters = {
  driftOnly: boolean;
  risk: RiskLevel[];
  modules: string[];
  query: string;
};

const riskRank: Record<RiskLevel, number> = {
  High: 0,
  Medium: 1,
  Low: 2
};

function isMissing(value: string | null | undefined) {
  return value === null || value === undefined || value.trim() === "";
}

export function parseNumeric(value: string | null): number | null {
  if (value === null || isMissing(value)) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDeltaMagnitude(row: ComparisonRow) {
  if (row.baseNumeric === null || row.targetNumeric === null) {
    return -1;
  }
  if (row.baseNumeric === 0) {
    return Math.abs(row.targetNumeric - row.baseNumeric);
  }

  return Math.abs(((row.targetNumeric - row.baseNumeric) / Math.abs(row.baseNumeric)) * 100);
}

export function sortComparisonRows(rows: ComparisonRow[]) {
  return [...rows].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "drift" ? -1 : 1;
    }

    const riskDelta = riskRank[left.risk] - riskRank[right.risk];
    if (riskDelta !== 0) {
      return riskDelta;
    }

    const magnitudeDelta = getDeltaMagnitude(right) - getDeltaMagnitude(left);
    if (magnitudeDelta !== 0) {
      return magnitudeDelta;
    }

    return left.key.localeCompare(right.key);
  });
}

const STRUCTURED_DIFFS: Record<string, ComparisonRow["structuredDiff"]> = {
  fast_charge_current_limit_ma: {
    before: { fast_charge_current_limit_ma: 3850, charge_mode: "adaptive", thermal_throttle_threshold_c: 42, max_input_power_w: 67, taper_current_ma: 800 },
    after: { fast_charge_current_limit_ma: 4200, charge_mode: "aggressive", thermal_throttle_threshold_c: 44, max_input_power_w: 72, taper_current_ma: 650 }
  },
  battery_temp_target_c: {
    before: { battery_temp_target_c: 38, thermal_zone: "battery_pack", throttle_step_pct: 15, hysteresis_c: 2 },
    after: { battery_temp_target_c: 40, thermal_zone: "battery_pack", throttle_step_pct: 20, hysteresis_c: 3 }
  },
  standby_drain_limit_ma: {
    before: { standby_drain_limit_ma: 18, wakeup_source: "rtc_alarm", deep_sleep_enabled: true, peripheral_shutdown_delay_ms: 500 },
    after: { standby_drain_limit_ma: 28, wakeup_source: "rtc_alarm", deep_sleep_enabled: false, peripheral_shutdown_delay_ms: 200 }
  },
  usb_pd_profile_limit_w: {
    before: { usb_pd_profile_limit_w: 33, pdo_profiles: "5V/3A, 9V/3A, 12V/2.75A", pps_enabled: true, cable_rating: "5A" },
    after: { usb_pd_profile_limit_w: 30, pdo_profiles: "5V/3A, 9V/3A", pps_enabled: true, cable_rating: "3A" }
  }
};

export type ComparisonMetrics = {
  total: number;
  drift: number;
  synced: number;
  highRisk: number;
};

export type BuildComparisonDataInput = {
  parameters: ParameterRecord[];
  baseProjectId: string;
  targetProjectId: string;
  filters: ComparisonFilters;
};

function formatValue(value: string | null, unit: string) {
  if (value === null || value.trim() === "") {
    return "未配置";
  }
  return `${value} ${unit}`.trim();
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesQuery(row: ComparisonRow, query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return true;
  }
  return [row.key, row.module, row.description, row.baseValue, row.targetValue].some((value) =>
    normalize(value).includes(normalizedQuery)
  );
}

export function buildComparisonData({ parameters, baseProjectId, targetProjectId, filters }: BuildComparisonDataInput) {
  const baseParameters = parameters.filter((parameter) => parameter.projectId === baseProjectId);
  const targetParameters = parameters.filter((parameter) => parameter.projectId === targetProjectId);
  const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));

  const rows = sortComparisonRows(
    baseParameters.map((baseParameter) => {
      const targetParameter = targetByName.get(baseParameter.name);
      const targetValue = targetParameter?.currentValue ?? null;
      const status = targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift";

      return {
        key: baseParameter.name,
        module: baseParameter.module,
        description: baseParameter.description,
        baseValue: formatValue(baseParameter.currentValue, baseParameter.unit),
        targetValue: formatValue(targetValue, targetParameter?.unit ?? baseParameter.unit),
        baseNumeric: parseNumeric(baseParameter.currentValue),
        targetNumeric: parseNumeric(targetValue),
        unit: baseParameter.unit,
        status,
        risk: baseParameter.risk,
        structuredDiff: STRUCTURED_DIFFS[baseParameter.name]
      };
    })
  );

  const filteredRows = rows.filter(
    (row) =>
      (!filters.driftOnly || row.status === "drift") &&
      (filters.risk.length === 0 || filters.risk.includes(row.risk)) &&
      (filters.modules.length === 0 || filters.modules.includes(row.module)) &&
      matchesQuery(row, filters.query)
  );

  return {
    rows,
    filteredRows,
    moduleOptions: Array.from(new Set(rows.map((row) => row.module))).sort((left, right) => left.localeCompare(right)),
    metrics: {
      total: rows.length,
      drift: rows.filter((row) => row.status === "drift").length,
      synced: rows.filter((row) => row.status === "synced").length,
      highRisk: rows.filter((row) => row.status === "drift" && row.risk === "High").length
    } satisfies ComparisonMetrics
  };
}
