import { classifyStatusRaw, parseStatusToken } from "./nodeEnablement";

export type EnablementEditTarget = "force-enabled" | "force-disabled" | "unstated";
export type StatusSpelling = "ok" | "okay";

export type EnablementWritePlan = {
  action: "set" | "delete";
  rawText: string | null;
};

/**
 * Measure the project's status spelling convention from raw DTS status values.
 * Ties and empty samples fall back to `ok`.
 */
export function measureStatusSpelling(rawStatuses: Array<string | null | undefined>): StatusSpelling {
  let ok = 0;
  let okay = 0;
  for (const raw of rawStatuses) {
    const token = parseStatusToken(raw)?.toLowerCase();
    if (token === "ok") ok += 1;
    if (token === "okay") okay += 1;
  }
  if (okay > ok) return "okay";
  return "ok";
}

export function resolveEnablementWrite(input: {
  target: EnablementEditTarget;
  currentRaw: string | null | undefined;
  projectSpelling: StatusSpelling;
  acknowledgeNonstandard?: boolean;
}): EnablementWritePlan {
  const current = classifyStatusRaw(input.currentRaw);
  if (current.override === "nonstandard" && !input.acknowledgeNonstandard) {
    throw new Error(
      `Nonstandard status value ${current.rawToken ?? "?"} requires explicit acknowledgement before overwrite.`
    );
  }

  if (input.target === "unstated") {
    return { action: "delete", rawText: null };
  }

  if (input.target === "force-disabled") {
    return { action: "set", rawText: '"disabled"' };
  }

  // force-enabled: preserve existing ok/okay spelling when present.
  const existing = parseStatusToken(input.currentRaw)?.toLowerCase();
  if (existing === "ok" || existing === "okay") {
    return { action: "set", rawText: `"${existing}"` };
  }
  return { action: "set", rawText: `"${input.projectSpelling}"` };
}
