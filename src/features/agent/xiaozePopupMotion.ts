/* Kept in sync with the CSS fallbacks in styles.css (.xiaoze-popup-*).
   Open is capped at 400ms per the design-system motion rule (no UI
   transition above 400ms); easings come from --ease-out / --ease-in-out. */
export const XIAOZE_POPUP_OPEN_MS = 400;
export const XIAOZE_POPUP_CLOSE_MS = 360;

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
