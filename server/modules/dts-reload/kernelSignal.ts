import type { KernelSignalCaptureStatus, KernelSignalDto, ReloadRunTargetDto } from "./types";

/** Node-derived keywords shorter than this match too much log noise to be useful. */
const MIN_DERIVED_KEYWORD_LENGTH = 3;

/**
 * Keywords a driver plausibly prints for one reload target: the DTS property key,
 * the last node path segment (e.g. `wireless@0`), and that segment without its
 * unit address (`wireless`). Drivers rarely log the full property key, so the
 * node name is often the only identity that appears in dmesg/hilog output.
 */
export function kernelLogMatchKeywords(target: Pick<ReloadRunTargetDto, "propertyKey" | "nodePath">): string[] {
  const keywords: string[] = [];
  if (target.propertyKey) {
    keywords.push(target.propertyKey);
  }
  const lastSegment = target.nodePath?.split("/").filter(Boolean).at(-1) ?? "";
  if (lastSegment.length >= MIN_DERIVED_KEYWORD_LENGTH) {
    keywords.push(lastSegment);
  }
  const withoutUnitAddress = lastSegment.split("@")[0] ?? "";
  if (withoutUnitAddress !== lastSegment && withoutUnitAddress.length >= MIN_DERIVED_KEYWORD_LENGTH) {
    keywords.push(withoutUnitAddress);
  }
  return [...new Set(keywords.map((keyword) => keyword.toLowerCase()))];
}

/**
 * Server-side kernel log filtering for reload evidence (the platform-side
 * equivalent of `dmesg | grep -i <keyword>` — pipes are banned on the device).
 *
 * A line matches a target when it case-insensitively contains the property key
 * or a node-name keyword. These strings must never be interpolated into
 * device / bridge commands.
 */
export function matchKernelLogLinesByParameter(
  rawText: string,
  targets: ReloadRunTargetDto[]
): KernelSignalDto["matchedByParameter"] {
  const lines = rawText.split(/\r?\n/).filter((line) => line.length > 0);
  const lowered = lines.map((line) => line.toLowerCase());
  return targets.map((target) => {
    const keywords = kernelLogMatchKeywords(target);
    return {
      parameterName: target.propertyKey,
      bindingId: target.bindingId,
      lines:
        keywords.length > 0
          ? lines.filter((_, index) => keywords.some((keyword) => lowered[index]!.includes(keyword)))
          : []
    };
  });
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
