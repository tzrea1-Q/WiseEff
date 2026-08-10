/**
 * The device-side contract a reload run must obey. Resolved server-side from stored organisation
 * defaults and optional per-device overrides — never from request input.
 */
export type ReloadConfigurationContract = {
  destinationDirectory: string;
  destinationFilename: string;
  triggerNodePath: string;
  triggerPayload: string;
  kernelLogCommand: string;
};

export type ReloadConfigurationScope = "organisation" | "device";

export type ReloadConfigurationSource = "seeded-default" | "organisation" | "device-override";

export type OrganisationReloadConfigurationDto = ReloadConfigurationContract & {
  scope: "organisation";
  source: "seeded-default" | "organisation";
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export type DeviceReloadConfigurationOverrideDto = ReloadConfigurationContract & {
  scope: "device";
  deviceId: string;
  deviceName: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type ReloadConfigurationAdminView = {
  organisation: OrganisationReloadConfigurationDto;
  deviceOverrides: DeviceReloadConfigurationOverrideDto[];
};

export type ResolvedReloadConfiguration = ReloadConfigurationContract & {
  organizationId: string;
  deviceId: string;
  source: ReloadConfigurationSource;
};

/** Seeded defaults applied when an organisation has never saved a configuration row. */
export const SEEDED_RELOAD_CONFIGURATION: ReloadConfigurationContract = {
  destinationDirectory: "/vendor/firmware/",
  destinationFilename: "power_dts_overlay.dtbo",
  triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
  triggerPayload: "1",
  kernelLogCommand: "dmesg"
};

/**
 * Re-export the shared closed allowlist so server save validation cannot drift from bridge
 * re-validation (`@wiseeff/device-command-core/kernelLogCommand`).
 */
export {
  KERNEL_LOG_COMMAND_ALLOWLIST,
  KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES,
  KERNEL_LOG_CAPTURE_MAX_BYTES,
  isAllowedKernelLogCommand
} from "@wiseeff/device-command-core/kernelLogCommand";
