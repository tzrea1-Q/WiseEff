import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  clampXiaozePopupSize,
  readStoredXiaozePopupSize,
  writeStoredXiaozePopupSize,
  XIAOZE_POPUP_DEFAULT_SIZE,
  XIAOZE_POPUP_MIN_SIZE,
  XIAOZE_POPUP_SIZE_STORAGE_KEY
} from "./xiaozePopupLayout";

describe("xiaozePopupLayout", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("clamps popup size to viewport bounds", () => {
    expect(clampXiaozePopupSize({ width: 100, height: 100 })).toEqual(XIAOZE_POPUP_MIN_SIZE);
    expect(clampXiaozePopupSize({ width: 4000, height: 3000 })).toEqual({
      width: 1392,
      height: 780
    });
  });

  it("reads and writes popup size from sessionStorage", () => {
    writeStoredXiaozePopupSize({ width: 520, height: 720 });
    expect(window.sessionStorage.getItem(XIAOZE_POPUP_SIZE_STORAGE_KEY)).toContain("520");
    expect(readStoredXiaozePopupSize()).toEqual({ width: 520, height: 720 });
  });

  it("falls back to defaults for invalid stored values", () => {
    window.sessionStorage.setItem(XIAOZE_POPUP_SIZE_STORAGE_KEY, '{"width":"bad"}');
    expect(readStoredXiaozePopupSize()).toEqual({ ...XIAOZE_POPUP_DEFAULT_SIZE });
  });
});
