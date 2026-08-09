import { ApiError } from "../../shared/http/errors";
import {
  KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES,
  type ReloadConfigurationContract
} from "./configurationTypes";

const SHELL_METACHARACTERS = /[;&|`$<>(){}[\]\\]/;

/**
 * Absolute Unix path with no `..` segments. Trailing slash is allowed for directories.
 */
export function isAbsoluteUnixPath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.includes("\0")) return false;
  const segments = value.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  return true;
}

/**
 * Destination filename must be a single path segment (basename), no separators or traversal.
 */
export function isValidDestinationFilename(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return false;
  if (value === "." || value === ".." || value.includes("..")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * A saved kernel log command must start with a recognised log-source prefix and must not contain
 * shell metacharacters. Optional trailing arguments are allowed for the allowlisted tools.
 */
export function isAllowedKernelLogCommand(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return false;
  return KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES.some(
    (prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `)
  );
}

export function parseReloadConfigurationContract(input: unknown): ReloadConfigurationContract {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("VALIDATION_FAILED", "Reload configuration must be an object.", 400);
  }
  const record = input as Record<string, unknown>;
  const destinationDirectory = typeof record.destinationDirectory === "string" ? record.destinationDirectory.trim() : "";
  const destinationFilename = typeof record.destinationFilename === "string" ? record.destinationFilename.trim() : "";
  const triggerNodePath = typeof record.triggerNodePath === "string" ? record.triggerNodePath.trim() : "";
  const triggerPayload = typeof record.triggerPayload === "string" ? record.triggerPayload.trim() : "";
  const kernelLogCommand = typeof record.kernelLogCommand === "string" ? record.kernelLogCommand.trim() : "";

  const contract: ReloadConfigurationContract = {
    destinationDirectory,
    destinationFilename,
    triggerNodePath,
    triggerPayload,
    kernelLogCommand
  };
  assertReloadConfigurationContract(contract);
  return contract;
}

export function assertReloadConfigurationContract(contract: ReloadConfigurationContract): void {
  if (!isAbsoluteUnixPath(contract.destinationDirectory.trim())) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Destination directory must be an absolute Unix path without '..' segments.",
      400,
      { field: "destinationDirectory" }
    );
  }
  if (!isValidDestinationFilename(contract.destinationFilename.trim())) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Destination filename must be a basename only (no path separators).",
      400,
      { field: "destinationFilename" }
    );
  }
  if (!isAbsoluteUnixPath(contract.triggerNodePath.trim())) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Trigger node path must be an absolute Unix path without '..' segments.",
      400,
      { field: "triggerNodePath" }
    );
  }
  if (!contract.triggerPayload.trim()) {
    throw new ApiError("VALIDATION_FAILED", "Trigger payload must be a non-empty string.", 400, {
      field: "triggerPayload"
    });
  }
  if (contract.triggerPayload.trim().length > 256) {
    throw new ApiError("VALIDATION_FAILED", "Trigger payload exceeds the 256 character limit.", 400, {
      field: "triggerPayload"
    });
  }
  if (!isAllowedKernelLogCommand(contract.kernelLogCommand)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Kernel log command must start with a recognised log source (${KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES.join(", ")}).`,
      400,
      {
        field: "kernelLogCommand",
        allowlist: [...KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES]
      }
    );
  }
}
