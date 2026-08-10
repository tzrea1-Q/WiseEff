import type { KernelSignalCaptureStatus, KernelSignalDto, ReloadRunTargetDto } from "./types";

/**
 * Server-side kernel log filtering for reload evidence.
 *
 * Matching identity: each target's `propertyKey` (DTS property / parameter name).
 * A line matches when it contains the propertyKey as a substring (case-sensitive).
 * These strings must never be interpolated into device / bridge commands.
 */
export function matchKernelLogLinesByParameter(
  rawText: string,
  targets: ReloadRunTargetDto[]
): KernelSignalDto["matchedByParameter"] {
  const lines = rawText.split(/\r?\n/).filter((line) => line.length > 0);
  return targets.map((target) => ({
    parameterName: target.propertyKey,
    bindingId: target.bindingId,
    lines: target.propertyKey
      ? lines.filter((line) => line.includes(target.propertyKey))
      : []
  }));
}

export function buildNotObtainedKernelSignal(input: {
  command: string;
  captureError: string;
}): KernelSignalDto {
  return {
    command: input.command,
    captureStatus: "not-obtained",
    captureError: input.captureError,
    rawText: null,
    truncated: false,
    matchedByParameter: [],
    excerpt: null
  };
}

export function buildObtainedKernelSignal(input: {
  command: string;
  rawText: string;
  truncated: boolean;
  targets: ReloadRunTargetDto[];
}): KernelSignalDto {
  return {
    command: input.command,
    captureStatus: "obtained",
    captureError: null,
    rawText: input.rawText,
    truncated: input.truncated,
    matchedByParameter: matchKernelLogLinesByParameter(input.rawText, input.targets),
    excerpt: null
  };
}

function inferCaptureStatus(record: Record<string, unknown>, legacyExcerpt: string | null): KernelSignalCaptureStatus {
  if (record.captureStatus === "obtained" || record.captureStatus === "not-obtained") {
    return record.captureStatus;
  }
  if (typeof record.rawText === "string" && record.rawText.length > 0) {
    return "obtained";
  }
  if (legacyExcerpt && legacyExcerpt.length > 0) {
    return "obtained";
  }
  return "not-obtained";
}

/**
 * Parse stored JSON into KernelSignalDto, including pre-#286 `{ command, excerpt }` stubs.
 */
export function parseKernelSignal(value: unknown): KernelSignalDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command : "";
  if (!command) return null;

  const legacyExcerpt = typeof record.excerpt === "string" ? record.excerpt : null;
  const captureStatus = inferCaptureStatus(record, legacyExcerpt);
  const rawText =
    typeof record.rawText === "string"
      ? record.rawText
      : captureStatus === "obtained" && legacyExcerpt
        ? legacyExcerpt
        : null;

  const matchedRaw = Array.isArray(record.matchedByParameter) ? record.matchedByParameter : [];
  const matchedByParameter = matchedRaw
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      parameterName: typeof entry.parameterName === "string" ? entry.parameterName : "",
      bindingId: typeof entry.bindingId === "string" ? entry.bindingId : "",
      lines: Array.isArray(entry.lines)
        ? entry.lines.filter((line): line is string => typeof line === "string")
        : []
    }));

  return {
    command,
    captureStatus,
    captureError: typeof record.captureError === "string" ? record.captureError : null,
    rawText: captureStatus === "obtained" ? rawText : null,
    truncated: record.truncated === true,
    matchedByParameter,
    excerpt: legacyExcerpt
  };
}
