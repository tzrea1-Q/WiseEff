export const XIAOZE_POPUP_SIZE_STORAGE_KEY = "wiseeff.xiaoze.popup.size.v1";

export const XIAOZE_POPUP_DEFAULT_SIZE = {
  width: 420,
  height: 680
} as const;

export const XIAOZE_POPUP_MIN_SIZE = {
  width: 320,
  height: 420
} as const;

export type XiaozePopupSize = {
  width: number;
  height: number;
};

export function clampXiaozePopupSize(size: XiaozePopupSize): XiaozePopupSize {
  if (typeof window === "undefined") {
    return size;
  }

  const maxWidth = Math.max(XIAOZE_POPUP_MIN_SIZE.width, window.innerWidth - 48);
  const maxHeight = Math.max(XIAOZE_POPUP_MIN_SIZE.height, window.innerHeight - 120);

  return {
    width: Math.min(Math.max(size.width, XIAOZE_POPUP_MIN_SIZE.width), maxWidth),
    height: Math.min(Math.max(size.height, XIAOZE_POPUP_MIN_SIZE.height), maxHeight)
  };
}

export function readStoredXiaozePopupSize(): XiaozePopupSize {
  if (typeof window === "undefined") {
    return { ...XIAOZE_POPUP_DEFAULT_SIZE };
  }

  try {
    const raw = window.sessionStorage.getItem(XIAOZE_POPUP_SIZE_STORAGE_KEY);
    if (!raw) {
      return { ...XIAOZE_POPUP_DEFAULT_SIZE };
    }
    const parsed = JSON.parse(raw) as Partial<XiaozePopupSize>;
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
      return { ...XIAOZE_POPUP_DEFAULT_SIZE };
    }
    return clampXiaozePopupSize({ width: parsed.width, height: parsed.height });
  } catch {
    return { ...XIAOZE_POPUP_DEFAULT_SIZE };
  }
}

export function writeStoredXiaozePopupSize(size: XiaozePopupSize) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(XIAOZE_POPUP_SIZE_STORAGE_KEY, JSON.stringify(clampXiaozePopupSize(size)));
}

export function applyXiaozePopupSize(popup: HTMLElement, size: XiaozePopupSize) {
  const clamped = clampXiaozePopupSize(size);
  popup.style.setProperty("--copilot-popup-width", `${clamped.width}px`);
  popup.style.setProperty("--copilot-popup-height", `${clamped.height}px`);
  popup.dataset.xiaozeResizable = "true";
}
