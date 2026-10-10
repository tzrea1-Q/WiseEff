import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissXiaozeToggleHint,
  markXiaozeToggleHintShown,
  readXiaozeToggleHintDismissed,
  readXiaozeToggleHintShown,
  resetXiaozeToggleHintPageState
} from "./xiaozeToggleHintStorage";

describe("xiaozeToggleHintStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    resetXiaozeToggleHintPageState();
  });

  it("tracks dismissal", () => {
    expect(readXiaozeToggleHintDismissed()).toBe(false);
    dismissXiaozeToggleHint();
    expect(readXiaozeToggleHintDismissed()).toBe(true);
  });

  it("tracks whether the hint was shown during the current page load", () => {
    expect(readXiaozeToggleHintShown()).toBe(false);
    markXiaozeToggleHintShown();
    expect(readXiaozeToggleHintShown()).toBe(true);
  });

  it("resets shown state but preserves dismissal on a fresh page load", () => {
    dismissXiaozeToggleHint();
    markXiaozeToggleHintShown();
    resetXiaozeToggleHintPageState();
    expect(readXiaozeToggleHintDismissed()).toBe(true);
    expect(readXiaozeToggleHintShown()).toBe(false);
  });
});
