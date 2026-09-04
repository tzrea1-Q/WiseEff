import { useEffect, useState } from "react";

export const catalogLayoutModes = ["desktop", "tablet", "mobile"] as const;
export type CatalogLayoutMode = (typeof catalogLayoutModes)[number];

/** Desktop ≥1100 keeps list, detail, and timeline side by side. */
export const CATALOG_DESKTOP_MIN_WIDTH_PX = 1100;
/** Tablet 768–1099 collapses detail/timeline into one sheet. */
export const CATALOG_TABLET_MIN_WIDTH_PX = 768;

export function readCatalogLayoutMode(
  media: Pick<Window, "matchMedia"> | null | undefined = typeof window === "undefined" ? undefined : window
): CatalogLayoutMode {
  if (!media || typeof media.matchMedia !== "function") {
    return "desktop";
  }
  if (media.matchMedia(`(max-width: ${CATALOG_TABLET_MIN_WIDTH_PX - 1}px)`).matches) {
    return "mobile";
  }
  if (media.matchMedia(`(min-width: ${CATALOG_TABLET_MIN_WIDTH_PX}px) and (max-width: ${CATALOG_DESKTOP_MIN_WIDTH_PX - 1}px)`).matches) {
    return "tablet";
  }
  return "desktop";
}

export function useCatalogLayoutMode(override?: CatalogLayoutMode): CatalogLayoutMode {
  const [mode, setMode] = useState<CatalogLayoutMode>(() => override ?? readCatalogLayoutMode());

  useEffect(() => {
    if (override) {
      setMode(override);
      return undefined;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mobile = window.matchMedia(`(max-width: ${CATALOG_TABLET_MIN_WIDTH_PX - 1}px)`);
    const tablet = window.matchMedia(
      `(min-width: ${CATALOG_TABLET_MIN_WIDTH_PX}px) and (max-width: ${CATALOG_DESKTOP_MIN_WIDTH_PX - 1}px)`
    );
    const sync = () => setMode(readCatalogLayoutMode(window));
    sync();
    mobile.addEventListener("change", sync);
    tablet.addEventListener("change", sync);
    return () => {
      mobile.removeEventListener("change", sync);
      tablet.removeEventListener("change", sync);
    };
  }, [override]);

  return override ?? mode;
}
