import type { DeviceBridgePlatform } from "./types";
import type { DeviceBridgeRecord } from "./types";

export type MachineIdentity = {
  machineLabel: string;
  platform: DeviceBridgePlatform;
  arch: string;
};

export function normalizeMachineLabel(machineLabel: string) {
  return machineLabel.trim();
}

export function toMachineIdentity(input: MachineIdentity) {
  return {
    machineLabel: normalizeMachineLabel(input.machineLabel),
    platform: input.platform,
    arch: input.arch
  };
}

export function pickBridgeToReuse(bridges: DeviceBridgeRecord[]) {
  if (bridges.length === 0) {
    throw new Error("pickBridgeToReuse requires at least one bridge.");
  }

  return [...bridges].sort((left, right) => {
    const leftSeen = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0;
    const rightSeen = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0;
    if (rightSeen !== leftSeen) {
      return rightSeen - leftSeen;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  })[0];
}
