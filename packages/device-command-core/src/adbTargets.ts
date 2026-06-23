export type AdbDeviceTarget = {
  targetRef: string;
  online: boolean;
};

export function parseAdbDevices(stdout: string): AdbDeviceTarget[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => line.split(/\s+/))
    .filter(([serial, state]) => Boolean(serial) && state === "device")
    .map(([serial]) => ({
      targetRef: serial,
      online: true
    }));
}
