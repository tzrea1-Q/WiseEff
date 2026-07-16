import { useEffect, useState } from "react";
import type { TopologyLayoutMode } from "./ProjectTopologyWorkspace";

/**
 * Desktop ≥1100: three panes.
 * Tablet 768–1099: detail collapses into a drawer.
 * Mobile &lt;768: tree → properties → detail with breadcrumb.
 */
export function useTopologyLayoutMode(): TopologyLayoutMode {
  const [mode, setMode] = useState<TopologyLayoutMode>(() => readLayoutMode());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mobile = window.matchMedia("(max-width: 767px)");
    const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1099px)");

    const sync = () => {
      if (mobile.matches) {
        setMode("mobile");
      } else if (tablet.matches) {
        setMode("tablet");
      } else {
        setMode("desktop");
      }
    };

    sync();
    mobile.addEventListener("change", sync);
    tablet.addEventListener("change", sync);
    return () => {
      mobile.removeEventListener("change", sync);
      tablet.removeEventListener("change", sync);
    };
  }, []);

  return mode;
}

function readLayoutMode(): TopologyLayoutMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }
  if (window.matchMedia("(max-width: 767px)").matches) {
    return "mobile";
  }
  if (window.matchMedia("(min-width: 768px) and (max-width: 1099px)").matches) {
    return "tablet";
  }
  return "desktop";
}
