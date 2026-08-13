import { afterEach, describe, expect, it } from "vitest";
import {
  initThemeController,
  THEME_STORAGE_KEY,
  type ThemeControllerHandle
} from "./themeController";

type FakeMediaQueryList = MediaQueryList & {
  setMatches: (matches: boolean) => void;
};

function createFakeSystemScheme(initialMatches: boolean): FakeMediaQueryList {
  let matches = initialMatches;
  const listeners = new Set<EventListener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener);
    },
    setMatches: (next: boolean) => {
      matches = next;
      for (const listener of listeners) {
        listener(new Event("change"));
      }
    }
  };
  return mql as unknown as FakeMediaQueryList;
}

function createMemoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map)
  };
}

describe("themeController", () => {
  const activeHandles: ThemeControllerHandle[] = [];

  function init(options: {
    storedTheme?: string;
    systemPrefersDark?: boolean;
  } = {}) {
    const storage = createMemoryStorage(
      options.storedTheme === undefined ? {} : { [THEME_STORAGE_KEY]: options.storedTheme }
    );
    const systemScheme = createFakeSystemScheme(options.systemPrefersDark ?? false);
    const handle = initThemeController({
      storage,
      matchMedia: () => systemScheme
    });
    activeHandles.push(handle);
    return { handle, storage, systemScheme };
  }

  afterEach(() => {
    while (activeHandles.length > 0) {
      activeHandles.pop()?.dispose();
    }
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to light with no stored preference, even when the OS prefers dark", () => {
    const { handle } = init({ systemPrefersDark: true });

    expect(handle.getPreference()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("applies a stored dark preference on init", () => {
    init({ storedTheme: "dark" });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("falls back to light for an invalid stored value", () => {
    const { handle } = init({ storedTheme: "solarized" });

    expect(handle.getPreference()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles the dark class and persists the preference on setPreference", () => {
    const { handle, storage } = init();

    handle.setPreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(storage.dump()[THEME_STORAGE_KEY]).toBe("dark");

    handle.setPreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(storage.dump()[THEME_STORAGE_KEY]).toBe("light");
  });

  it("follows the OS scheme while the preference is system", () => {
    const { handle, systemScheme, storage } = init({ systemPrefersDark: true });

    handle.setPreference("system");
    expect(storage.dump()[THEME_STORAGE_KEY]).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    systemScheme.setMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    systemScheme.setMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores OS scheme changes while an explicit preference is set", () => {
    const { handle, systemScheme } = init();

    handle.setPreference("light");
    systemScheme.setMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    handle.setPreference("dark");
    systemScheme.setMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("restores a stored system preference and resolves it against the OS on init", () => {
    init({ storedTheme: "system", systemPrefersDark: true });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("exposes the window.__wiseeffSetTheme dev probe and removes it on dispose", () => {
    const { handle } = init();

    expect(typeof window.__wiseeffSetTheme).toBe("function");
    window.__wiseeffSetTheme?.("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(handle.getPreference()).toBe("dark");

    handle.dispose();
    expect(window.__wiseeffSetTheme).toBeUndefined();
  });

  it("stops following the OS after dispose", () => {
    const { handle, systemScheme } = init();
    handle.setPreference("system");
    handle.dispose();

    systemScheme.setMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
