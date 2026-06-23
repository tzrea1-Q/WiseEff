export type HdcDeviceTarget = {
  targetRef: string;
  online: boolean;
};

export function parseHdcTargets(stdout: string): HdcDeviceTarget[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      targetRef: line,
      online: true
    }));
}
