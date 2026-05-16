import type { PowerManagementConfig, PowerManagementDebugParameter } from "../../powerManagementConfig";

export type DebugParameterDiffKind = "added" | "deleted" | "modified";

export type DebugParameterDiffField = {
  name: keyof PowerManagementDebugParameter;
  label: string;
  before?: string;
  after?: string;
};

export type DebugParameterDiff = {
  id: string;
  kind: DebugParameterDiffKind;
  key: string;
  displayName: string;
  changedFields: DebugParameterDiffField[];
};

const FIELD_LABELS: Record<Exclude<keyof PowerManagementDebugParameter, "id" | "status">, string> = {
  name: "展示名称",
  key: "参数 key",
  description: "描述",
  module: "模块",
  currentValue: "默认值",
  targetValue: "推荐值",
  range: "有效区间",
  unit: "单位",
  risk: "风险等级",
  nodePath: "节点路径",
  accessMode: "访问模式"
};

const FIELDS_TO_COMPARE: Array<Exclude<keyof PowerManagementDebugParameter, "id" | "status">> = [
  "name",
  "key",
  "currentValue",
  "targetValue",
  "unit",
  "range",
  "risk",
  "nodePath",
  "accessMode"
];

export function computeDirtyDiff(
  configDraft: PowerManagementConfig,
  persistedSnapshot: PowerManagementConfig
): DebugParameterDiff[] {
  const snapshotById = new Map(
    persistedSnapshot.debugParameters.map((parameter) => [parameter.id, parameter])
  );

  const diffs: DebugParameterDiff[] = [];

  for (const current of configDraft.debugParameters) {
    const previous = snapshotById.get(current.id);

    if (!previous) {
      diffs.push({
        id: current.id,
        kind: "added",
        key: current.key,
        displayName: current.name,
        changedFields: FIELDS_TO_COMPARE.map((name) => ({
          name,
          label: FIELD_LABELS[name],
          after: String(current[name])
        }))
      });
      continue;
    }

    const changedFields: DebugParameterDiffField[] = [];
    for (const name of FIELDS_TO_COMPARE) {
      if (current[name] !== previous[name]) {
        changedFields.push({
          name,
          label: FIELD_LABELS[name],
          before: String(previous[name]),
          after: String(current[name])
        });
      }
    }

    if (changedFields.length > 0) {
      diffs.push({
        id: current.id,
        kind: "modified",
        key: current.key,
        displayName: current.name,
        changedFields
      });
    }
  }

  const currentIds = new Set(configDraft.debugParameters.map((parameter) => parameter.id));
  for (const previous of persistedSnapshot.debugParameters) {
    if (!currentIds.has(previous.id)) {
      diffs.push({
        id: previous.id,
        kind: "deleted",
        key: previous.key,
        displayName: previous.name,
        changedFields: []
      });
    }
  }

  return diffs;
}
