import { buildParameterHistory } from "@/reviewMockData";
import {
  flattenDebugParameters,
  flattenProjectParameters,
  type PowerManagementConfig
} from "@/powerManagementConfig";

const parameterUpdatedAtBaselineMs = Date.parse("2026-05-10T17:00:00.000Z");

function createParameterUpdatedAtTs(updatedAt: string, index: number) {
  const parsedTimestamp = parseParameterUpdatedAtText(updatedAt);
  return new Date(parsedTimestamp + index).toISOString();
}

function parseParameterUpdatedAtText(updatedAt: string) {
  if (updatedAt === "刚刚") {
    return parameterUpdatedAtBaselineMs;
  }

  const todayMatch = updatedAt.match(/^今天 (\d{2}):(\d{2})$/);
  if (todayMatch) {
    return Date.UTC(2026, 4, 10, Number(todayMatch[1]), Number(todayMatch[2]));
  }

  const yesterdayMatch = updatedAt.match(/^昨天(?: (\d{2}):(\d{2}))?$/);
  if (yesterdayMatch) {
    return Date.UTC(2026, 4, 9, Number(yesterdayMatch[1] ?? 17), Number(yesterdayMatch[2] ?? 0));
  }

  const daysAgoMatch = updatedAt.match(/^(\d+) 天前$/);
  if (daysAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(daysAgoMatch[1]) * 24 * 60 * 60 * 1000;
  }

  const hoursAgoMatch = updatedAt.match(/^(\d+) 小时前$/);
  if (hoursAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(hoursAgoMatch[1]) * 60 * 60 * 1000;
  }

  const minutesAgoMatch = updatedAt.match(/^(\d+) 分钟前$/);
  if (minutesAgoMatch) {
    return parameterUpdatedAtBaselineMs - Number(minutesAgoMatch[1]) * 60 * 1000;
  }

  return Date.UTC(2026, 4, 1);
}

export function derivePowerManagementRuntimeState(configDraft: PowerManagementConfig) {
  return {
    parameters: flattenProjectParameters(configDraft).map((parameter, index) => ({
      ...parameter,
      updatedAtTs: createParameterUpdatedAtTs(parameter.updatedAt, index),
      history: buildParameterHistory(parameter.id)
    })),
    debugParameters: flattenDebugParameters(configDraft).map((parameter) => ({
      ...parameter
    }))
  };
}
