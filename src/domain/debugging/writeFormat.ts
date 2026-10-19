type WriteFormatSource = {
  writeFormatExample?: string;
  writeFormatHint?: string;
  targetValue?: string;
  currentValue?: string;
};

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
  example: string
): string {
  const configured = source.writeFormatHint?.trim();
  if (configured) {
    return configured;
  }

  return `例如输入 ${example}，系统会将该值写入当前设备节点。`;
}
