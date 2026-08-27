import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyXiaozePopupLayout,
  clampXiaozePopupLayout,
  getDefaultXiaozePopupLayout,
  readStoredXiaozePopupLayout,
  writeStoredXiaozePopupLayout,
  XIAOZE_POPUP_LAYOUT_STORAGE_KEY,
  XIAOZE_POPUP_MIN_SIZE,
  XIAOZE_POPUP_SAFE_INSET,
  XIAOZE_POPUP_SIZE_STORAGE_KEY
} from "./xiaozePopupLayout";

describe("xiaozePopupLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("derives the established lower-right default as an absolute layout", () => {
    expect(getDefaultXiaozePopupLayout()).toEqual({
      version: 2,
      x: 996,
      y: 124,
      width: 420,
      height: 680
    });
  });

  it("clamps size before keeping the whole popup inside every viewport edge", () => {
    expect(
      clampXiaozePopupLayout({ version: 2, x: -400, y: -300, width: 4000, height: 3000 })
    ).toEqual({
      version: 2,
      x: XIAOZE_POPUP_SAFE_INSET,
      y: XIAOZE_POPUP_SAFE_INSET,
      width: 1408,
      height: 868
    });

    expect(
      clampXiaozePopupLayout({ version: 2, x: 5000, y: 5000, width: 100, height: 100 })
    ).toEqual({
      version: 2,
      x: 1440 - XIAOZE_POPUP_SAFE_INSET - XIAOZE_POPUP_MIN_SIZE.width,
      y: 900 - XIAOZE_POPUP_SAFE_INSET - XIAOZE_POPUP_MIN_SIZE.height,
      ...XIAOZE_POPUP_MIN_SIZE
    });
  });

  it("persists one versioned local layout and restores a clamped value", () => {
    writeStoredXiaozePopupLayout({ version: 2, x: 120, y: 80, width: 520, height: 720 });

    expect(window.localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toContain('"version":2');
    expect(readStoredXiaozePopupLayout()).toEqual({ version: 2, x: 120, y: 80, width: 520, height: 720 });
  });

  it("migrates the valid size-only session record once without losing its dimensions", () => {
    window.sessionStorage.setItem(XIAOZE_POPUP_SIZE_STORAGE_KEY, JSON.stringify({ width: 520, height: 720 }));

    expect(readStoredXiaozePopupLayout()).toEqual({ version: 2, x: 896, y: 84, width: 520, height: 720 });
    expect(window.localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toContain('"width":520');
    expect(window.sessionStorage.getItem(XIAOZE_POPUP_SIZE_STORAGE_KEY)).toBeNull();
  });

  it("uses a valid legacy size for this render when local persistence is unavailable", () => {
    window.sessionStorage.setItem(XIAOZE_POPUP_SIZE_STORAGE_KEY, JSON.stringify({ width: 520, height: 720 }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key === XIAOZE_POPUP_LAYOUT_STORAGE_KEY) {
        throw new DOMException("blocked", "QuotaExceededError");
      }
    });

    expect(readStoredXiaozePopupLayout()).toEqual({ version: 2, x: 896, y: 84, width: 520, height: 720 });
    expect(window.sessionStorage.getItem(XIAOZE_POPUP_SIZE_STORAGE_KEY)).not.toBeNull();
  });

  it("falls back safely for invalid or non-finite stored values", () => {
    window.localStorage.setItem(
      XIAOZE_POPUP_LAYOUT_STORAGE_KEY,
      '{"version":2,"x":0,"y":0,"width":null,"height":680}'
    );

    expect(readStoredXiaozePopupLayout()).toEqual(getDefaultXiaozePopupLayout());
  });

  it("does not overwrite desktop layout while the mobile full-screen presentation is active", () => {
    const desktop = { version: 2 as const, x: 120, y: 80, width: 520, height: 720 };
    writeStoredXiaozePopupLayout(desktop);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    writeStoredXiaozePopupLayout({ version: 2, x: 0, y: 0, width: 390, height: 844 });

    expect(JSON.parse(window.localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY) ?? "null")).toEqual(desktop);
  });

  it("applies layout variables without using the motion transform", () => {
    const popup = document.createElement("div");
    applyXiaozePopupLayout(popup, { version: 2, x: 120, y: 80, width: 520, height: 720 });

    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("120px");
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("80px");
    expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("520px");
    expect(popup.style.getPropertyValue("--copilot-popup-height")).toBe("720px");
    expect(popup.style.transform).toBe("");
  });
});
