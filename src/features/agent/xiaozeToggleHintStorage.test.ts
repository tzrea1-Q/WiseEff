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
    resetXiaozeToggleHintPageState();
  });

  it("tracks dismiss for the current page load only", () => {
    expect(readXiaozeToggleHintDismissed()).toBe(false);
    dismissXiaozeToggleHint();
    expect(readXiaozeToggleHintDismissed()).toBe(true);
  });

  it("tracks whether the hint was shown during the current page load", () => {
    expect(readXiaozeToggleHintShown()).toBe(false);
    markXiaozeToggleHintShown();
    expect(readXiaozeToggleHintShown()).toBe(true);
  });

  it("resets shown and dismissed state on a fresh page load", () => {
    dismissXiaozeToggleHint();
    markXiaozeToggleHintShown();
    resetXiaozeToggleHintPageState();
    expect(readXiaozeToggleHintDismissed()).toBe(false);
    expect(readXiaozeToggleHintShown()).toBe(false);
  });
});
