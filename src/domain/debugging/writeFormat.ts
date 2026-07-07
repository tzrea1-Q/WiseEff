import type { DebugConnectionProtocol } from "./types";

type WriteFormatSource = {
  writeFormatExample?: string;
  writeFormatHint?: string;
  targetValue?: string;
  currentValue?: string;
};

export function protocolLabel(protocol: DebugConnectionProtocol): string {
  return protocol === "adb" ? "ADB" : "HDC";
}

export function resolveWriteFormatExample(source: WriteFormatSource): string {
  const configured = source.writeFormatExample?.trim();
  if (configured) {
    return configured;
  }

  const target = source.targetValue?.trim();
  if (target) {
    return target;
  }

  const current = source.currentValue?.trim();
  if (current) {
    return current;
  }

  return "value";
}

export function resolveWriteFormatHint(
  source: WriteFormatSource,
  example: string,
  protocol: DebugConnectionProtocol
): string {
  const configured = source.writeFormatHint?.trim();
  if (configured) {
    return configured;
  }

  return `例如输入 ${example}，系统会通过 ${protocolLabel(protocol)} 将该值写入当前节点。`;
}
