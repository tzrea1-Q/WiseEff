export type HdcDeviceTarget = {
  targetRef: string;
  online: boolean;
};

/** HDC prints `[Empty]` when the tool is available but no USB device is attached. */
export function isHdcPlaceholderTarget(targetRef: string): boolean {
  const normalized = targetRef.trim();
  if (!normalized) {
    return true;
  }
  return /^\[empty\]$/i.test(normalized);
}

export function parseHdcTargets(stdout: string): HdcDeviceTarget[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isHdcPlaceholderTarget(line))
    .map((line) => ({
      targetRef: line,
      online: true
    }));
}
