import type { DtsValueType } from "@/application/ports/DtsStructuredRepository";

/** User-facing Chinese labels for DTS property value types. */
export const DTS_VALUE_TYPE_LABELS: Record<DtsValueType, string> = {
  "u32-array": "整数数组",
  bytes: "字节数组",
  "string-list": "字符串列表",
  "phandle-list": "句柄引用",
  mixed: "混合类型",
  bool: "布尔值",
  empty: "空属性"
};

export function dtsValueTypeLabel(valueType: DtsValueType | string): string {
  return DTS_VALUE_TYPE_LABELS[valueType as DtsValueType] ?? valueType;
}
