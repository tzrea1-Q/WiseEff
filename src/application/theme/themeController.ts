/**
 * Dark-theme wiring (aesthetics uplift P3 — wiring only, shipping deferred).
 *
 * Owns the `dark` class on <html> that activates the `.dark` token block in
 * src/styles.css, the persisted preference under `wiseeff.theme`, and the
 * `prefers-color-scheme` subscription for the `system` preference. There is
 * deliberately no user-visible switch yet: until the shipping decision, the
 * default preference is `light` (not `system`), so nothing changes for users
 * regardless of their OS setting.
 */

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "wiseeff.theme";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Storage can throw (privacy modes, disabled storage); treat it as absent. */
function readStoredPreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

function persistPreference(storage: Pick<Storage, "setItem">, preference: ThemePreference): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Non-persistable environments still get the in-session theme.
  }
}

function applyResolvedTheme(root: HTMLElement, isDark: boolean): void {
  root.classList.toggle("dark", isDark);
  // The token blocks already declare `color-scheme`; mirroring it on the
  // element keeps native chrome (scrollbars, form controls) in sync even
  // before the stylesheet loads, and makes the wiring observable in tests.
  root.style.colorScheme = isDark ? "dark" : "light";
}

export type ThemeControllerHandle = {
  getPreference: () => ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Removes the system listener and the dev probe (test isolation). */
  dispose: () => void;
};

/**
 * Reads the stored preference, applies it to <html>, and keeps the resolved
 * theme in sync with the OS while the preference is `system`.
 */
export function initThemeController({
  storage = window.localStorage,
  matchMedia = window.matchMedia.bind(window),
  root = document.documentElement
}: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  matchMedia?: (query: string) => MediaQueryList;
  root?: HTMLElement;
} = {}): ThemeControllerHandle {
  const systemDark = matchMedia(DARK_SCHEME_QUERY);
  let preference = readStoredPreference(storage);

  const resolveAndApply = () => {
    applyResolvedTheme(root, preference === "dark" || (preference === "system" && systemDark.matches));
  };

  const onSystemSchemeChange = () => {
    if (preference === "system") {
      resolveAndApply();
    }
  };

  systemDark.addEventListener("change", onSystemSchemeChange);
  resolveAndApply();

  const setPreference = (next: ThemePreference) => {
    if (!isThemePreference(next)) {
      return;
    }
    preference = next;
    persistPreference(storage, next);
    resolveAndApply();
  };

  // Dev probe for the deferred switch UI: lets QA/devtools flip the theme
  // (`window.__wiseeffSetTheme("dark" | "light" | "system")`) without any
  // user-visible control existing yet. The future settings UI should call
  // setPreference through this module instead.
  window.__wiseeffSetTheme = setPreference;

  return {
    getPreference: () => preference,
    setPreference,
    dispose: () => {
      systemDark.removeEventListener("change", onSystemSchemeChange);
      if (window.__wiseeffSetTheme === setPreference) {
        delete window.__wiseeffSetTheme;
      }
    }
  };
}

declare global {
  interface Window {
    /** Dev probe installed by initThemeController; no user-visible switch yet. */
    __wiseeffSetTheme?: (preference: ThemePreference) => void;
  }
}
