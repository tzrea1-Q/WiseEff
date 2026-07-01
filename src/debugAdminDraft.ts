import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugParameter as DomainDebugParameter,
  DebugParameterBindingStatus,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";
import {
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR
} from "@/debugValueKind";

export function emptyDebugAdminDraft(index: number): DebugAdminParameterDraft {
  return {
    projectId: null,
    name: `new_debug_parameter_${index}`,
    key: `debug.new_parameter_${index}`,
    description: "",
    module: "Diagnostics",
    currentValue: "",
    targetValue: "",
    unit: "",
    range: "",
    minValue: null,
    maxValue: null,
    risk: "Low",
    nodePath: "",
    accessMode: "RO",
    sortOrder: index,
    enabled: true,
    bindings: [],
    valueKind: DEBUG_VALUE_KIND_SCALAR,
    valueFormat: DEBUG_VALUE_FORMAT_RAW,
    normalizationMode: DEBUG_NORMALIZATION_MODE_TRIM,
    maxValueBytes: null
  };
}

export function draftFromDebugParameter(parameter: DomainDebugParameter): DebugAdminParameterDraft {
  return {
    id: parameter.id,
    projectId: parameter.projectId ?? null,
    name: parameter.name,
    key: parameter.key,
    description: parameter.description,
    module: parameter.module,
    currentValue: parameter.currentValue,
    targetValue: parameter.targetValue,
    unit: parameter.unit,
    range: parameter.range,
    minValue: parameter.minValue ?? null,
    maxValue: parameter.maxValue ?? null,
    risk: parameter.risk,
    nodePath: parameter.nodePath,
    accessMode: parameter.accessMode,
    sortOrder: parameter.sortOrder ?? 0,
    enabled: parameter.enabled ?? true,
    bindings: parameter.bindings ?? [],
    valueKind: parameter.valueKind ?? DEBUG_VALUE_KIND_SCALAR,
    valueFormat: parameter.valueFormat ?? DEBUG_VALUE_FORMAT_RAW,
    normalizationMode: parameter.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM,
    maxValueBytes: parameter.maxValueBytes ?? null
  };
}

export function bindingForProtocol(
  bindings: DebugParameterNodeBinding[] | DebugNodeProtocolBinding[] | undefined,
  protocol: DebugConnectionProtocol
): DebugParameterNodeBinding {
  return (
    bindings?.find((binding) => binding.protocol === protocol) ?? {
      protocol,
      nodePath: "",
      accessMode: "RO",
      enabled: false,
      notes: ""
    }
  );
}

export function nodeBindingStatus(
  bindings: DebugNodeProtocolBinding[] | undefined,
  protocol: DebugConnectionProtocol
): DebugParameterBindingStatus {
  const binding = bindings?.find((item) => item.protocol === protocol);
  if (!binding || !binding.nodePath.trim()) {
    return "missing";
  }
  if (!binding.enabled) {
    return "disabled";
  }
  return "configured";
}

export function nodeBindingStatusLabel(status: DebugParameterBindingStatus) {
  switch (status) {
    case "configured":
      return "已配置";
    case "disabled":
      return "已禁用";
    case "missing":
      return "缺失";
  }
}

export function isArchivedDebugParameter(parameter: DomainDebugParameter) {
  return Boolean(parameter.archivedAt);
}

export function coverageLabel(parameter: DomainDebugParameter) {
  if (isArchivedDebugParameter(parameter)) return "已归档";
  if (parameter.enabled === false) return "已停用";
  const hdc = bindingForProtocol(parameter.bindings, "hdc").enabled;
  const adb = bindingForProtocol(parameter.bindings, "adb").enabled;
  if (hdc && adb) return "双协议";
  if (hdc) return "HDC 已配置";
  if (adb) return "ADB 已配置";
  return "缺 HDC / ADB";
}
