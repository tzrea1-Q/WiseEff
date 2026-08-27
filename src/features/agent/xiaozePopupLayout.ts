export const XIAOZE_POPUP_SIZE_STORAGE_KEY = "wiseeff.xiaoze.popup.size.v1";
export const XIAOZE_POPUP_LAYOUT_STORAGE_KEY = "wiseeff.xiaoze.popup.layout.v2";
export const XIAOZE_POPUP_LAYOUT_VERSION = 2 as const;
export const XIAOZE_POPUP_DESKTOP_MIN_WIDTH = 768;
export const XIAOZE_POPUP_SAFE_INSET = 16;
export const XIAOZE_POPUP_DEFAULT_RIGHT = 24;
export const XIAOZE_POPUP_DEFAULT_BOTTOM = 96;
export const XIAOZE_LAUNCHER_SIZE = 56;
export const XIAOZE_LAUNCHER_GAP = 16;

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

export type XiaozePopupLayout = XiaozePopupSize & {
  version: typeof XIAOZE_POPUP_LAYOUT_VERSION;
  x: number;
  y: number;
};

export type XiaozePopupViewport = {
  width: number;
  height: number;
};

export type XiaozeLauncherPosition = {
  x: number;
  y: number;
};

function currentViewport(): XiaozePopupViewport {
  return typeof window === "undefined"
    ? { width: 1440, height: 900 }
    : { width: window.innerWidth, height: window.innerHeight };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLayout(value: unknown): value is XiaozePopupLayout {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<XiaozePopupLayout>;
  return (
    candidate.version === XIAOZE_POPUP_LAYOUT_VERSION &&
    isFiniteNumber(candidate.x) &&
    isFiniteNumber(candidate.y) &&
    isFiniteNumber(candidate.width) &&
    isFiniteNumber(candidate.height)
  );
}

function isSize(value: unknown): value is XiaozePopupSize {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<XiaozePopupSize>;
  return isFiniteNumber(candidate.width) && isFiniteNumber(candidate.height);
}

export function isXiaozePopupDesktop(viewport: XiaozePopupViewport = currentViewport()) {
  return viewport.width >= XIAOZE_POPUP_DESKTOP_MIN_WIDTH;
}

export function clampXiaozePopupLayout(
  layout: XiaozePopupLayout,
  viewport: XiaozePopupViewport = currentViewport()
): XiaozePopupLayout {
  const availableWidth = Math.max(0, viewport.width - XIAOZE_POPUP_SAFE_INSET * 2);
  const launcherFootprint = XIAOZE_LAUNCHER_GAP + XIAOZE_LAUNCHER_SIZE;
  const availableHeight = Math.max(0, viewport.height - XIAOZE_POPUP_SAFE_INSET * 2 - launcherFootprint);
  const width = Math.min(
    Math.max(layout.width, Math.min(XIAOZE_POPUP_MIN_SIZE.width, availableWidth)),
    availableWidth
  );
  const height = Math.min(
    Math.max(layout.height, Math.min(XIAOZE_POPUP_MIN_SIZE.height, availableHeight)),
    availableHeight
  );
  const maxX = Math.max(XIAOZE_POPUP_SAFE_INSET, viewport.width - XIAOZE_POPUP_SAFE_INSET - width);
  const maxY = Math.max(
    XIAOZE_POPUP_SAFE_INSET,
    viewport.height - XIAOZE_POPUP_SAFE_INSET - height - launcherFootprint
  );

  return {
    version: XIAOZE_POPUP_LAYOUT_VERSION,
    x: Math.min(Math.max(layout.x, XIAOZE_POPUP_SAFE_INSET), maxX),
    y: Math.min(Math.max(layout.y, XIAOZE_POPUP_SAFE_INSET), maxY),
    width,
    height
  };
}

export function getXiaozeLauncherPosition(layout: XiaozePopupLayout): XiaozeLauncherPosition {
  return {
    x: layout.x + layout.width - XIAOZE_LAUNCHER_SIZE,
    y: layout.y + layout.height + XIAOZE_LAUNCHER_GAP
  };
}

export function getDefaultXiaozePopupLayout(
  viewport: XiaozePopupViewport = currentViewport(),
  size: XiaozePopupSize = XIAOZE_POPUP_DEFAULT_SIZE
): XiaozePopupLayout {
  return clampXiaozePopupLayout(
    {
      version: XIAOZE_POPUP_LAYOUT_VERSION,
      x: viewport.width - XIAOZE_POPUP_DEFAULT_RIGHT - size.width,
      y: viewport.height - XIAOZE_POPUP_DEFAULT_BOTTOM - size.height,
      ...size
    },
    viewport
  );
}

export function readStoredXiaozePopupLayout(
  viewport: XiaozePopupViewport = currentViewport()
): XiaozePopupLayout {
  const fallback = getDefaultXiaozePopupLayout(viewport);
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      return isLayout(parsed) ? clampXiaozePopupLayout(parsed, viewport) : fallback;
    }

    const legacy = window.sessionStorage.getItem(XIAOZE_POPUP_SIZE_STORAGE_KEY);
    if (!legacy) {
      return fallback;
    }
    const parsedLegacy: unknown = JSON.parse(legacy);
    if (!isSize(parsedLegacy)) {
      return fallback;
    }

    const migrated = getDefaultXiaozePopupLayout(viewport, parsedLegacy);
    if (!isXiaozePopupDesktop(viewport)) {
      return migrated;
    }
    try {
      window.localStorage.setItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY, JSON.stringify(migrated));
      window.sessionStorage.removeItem(XIAOZE_POPUP_SIZE_STORAGE_KEY);
    } catch {
      // The valid legacy value still serves this render. Keep it for a later
      // migration attempt when local persistence becomes available.
    }
    return migrated;
  } catch {
    return fallback;
  }
}

export function writeStoredXiaozePopupLayout(
  layout: XiaozePopupLayout,
  viewport: XiaozePopupViewport = currentViewport()
) {
  if (typeof window === "undefined" || !isXiaozePopupDesktop(viewport)) {
    return;
  }
  try {
    window.localStorage.setItem(
      XIAOZE_POPUP_LAYOUT_STORAGE_KEY,
      JSON.stringify(clampXiaozePopupLayout(layout, viewport))
    );
  } catch {
    // Layout persistence is progressive enhancement; rendering must remain usable.
  }
}

export function resetStoredXiaozePopupLayout(viewport: XiaozePopupViewport = currentViewport()) {
  const layout = getDefaultXiaozePopupLayout(viewport);
  writeStoredXiaozePopupLayout(layout, viewport);
  return layout;
}

export function applyXiaozePopupLayout(popup: HTMLElement, layout: XiaozePopupLayout) {
  const clamped = clampXiaozePopupLayout(layout);
  popup.style.setProperty("--xiaoze-popup-left", `${clamped.x}px`);
  popup.style.setProperty("--xiaoze-popup-top", `${clamped.y}px`);
  popup.style.setProperty("--copilot-popup-width", `${clamped.width}px`);
  popup.style.setProperty("--copilot-popup-height", `${clamped.height}px`);
  popup.dataset.xiaozeResizable = "true";
  popup.dataset.xiaozeMovable = "true";
}

export function applyXiaozeLauncherLayout(anchor: HTMLElement, layout: XiaozePopupLayout) {
  const clamped = clampXiaozePopupLayout(layout);
  const position = getXiaozeLauncherPosition(clamped);
  anchor.style.setProperty("--xiaoze-launcher-left", `${position.x}px`);
  anchor.style.setProperty("--xiaoze-launcher-top", `${position.y}px`);
  anchor.dataset.xiaozeMovable = "true";
}

export function clampXiaozePopupSize(size: XiaozePopupSize): XiaozePopupSize {
  const layout = clampXiaozePopupLayout({
    ...getDefaultXiaozePopupLayout(),
    ...size
  });
  return { width: layout.width, height: layout.height };
}

export function readStoredXiaozePopupSize(): XiaozePopupSize {
  const { width, height } = readStoredXiaozePopupLayout();
  return { width, height };
}

export function writeStoredXiaozePopupSize(size: XiaozePopupSize) {
  const current = readStoredXiaozePopupLayout();
  writeStoredXiaozePopupLayout(clampXiaozePopupLayout({ ...current, ...size }));
}

export function applyXiaozePopupSize(popup: HTMLElement, size: XiaozePopupSize) {
  const current = readStoredXiaozePopupLayout();
  applyXiaozePopupLayout(popup, { ...current, ...size });
}
