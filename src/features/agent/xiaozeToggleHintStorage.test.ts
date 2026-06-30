import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissXiaozeToggleHint,
  markXiaozeToggleHintShown,
  readXiaozeToggleHintDismissed,
  readXiaozeToggleHintShown,
  XIAOZE_TOGGLE_HINT_SHOWN_SESSION_KEY,
  XIAOZE_TOGGLE_HINT_STORAGE_KEY
} from "./xiaozeToggleHintStorage";

describe("xiaozeToggleHintStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("reads dismissed state from localStorage", () => {
    expect(readXiaozeToggleHintDismissed()).toBe(false);
    dismissXiaozeToggleHint();
    expect(readXiaozeToggleHintDismissed()).toBe(true);
    expect(localStorage.getItem(XIAOZE_TOGGLE_HINT_STORAGE_KEY)).toBe("1");
  });

  it("tracks whether the hint was shown in the current session", () => {
    expect(readXiaozeToggleHintShown()).toBe(false);
    markXiaozeToggleHintShown();
    expect(readXiaozeToggleHintShown()).toBe(true);
    expect(sessionStorage.getItem(XIAOZE_TOGGLE_HINT_SHOWN_SESSION_KEY)).toBe("1");
  });
});
