export const XIAOZE_POPUP_OPEN_MS = 440;
export const XIAOZE_POPUP_CLOSE_MS = 360;

export const XIAOZE_POPUP_EASE_OPEN = "cubic-bezier(0.16, 1, 0.3, 1)";
export const XIAOZE_POPUP_EASE_CLOSE = "cubic-bezier(0.4, 0, 0.72, 0.98)";

export type XiaozePopupMotionPhase = "entering" | "visible" | "leaving";

export function readXiaozePopupMotionDurations() {
  if (typeof window === "undefined") {
    return { openMs: XIAOZE_POPUP_OPEN_MS, closeMs: XIAOZE_POPUP_CLOSE_MS };
  }

  const reduced =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    return { openMs: 120, closeMs: 100 };
  }

  return { openMs: XIAOZE_POPUP_OPEN_MS, closeMs: XIAOZE_POPUP_CLOSE_MS };
}

export function dimensionToCss(value: number | string | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return `${fallback}px`;
}
