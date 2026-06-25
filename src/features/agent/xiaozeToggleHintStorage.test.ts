import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissXiaozeToggleHint,
  readXiaozeToggleHintDismissed,
  XIAOZE_TOGGLE_HINT_STORAGE_KEY
} from "./xiaozeToggleHintStorage";

describe("xiaozeToggleHintStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads dismissed state from localStorage", () => {
    expect(readXiaozeToggleHintDismissed()).toBe(false);
    dismissXiaozeToggleHint();
    expect(readXiaozeToggleHintDismissed()).toBe(true);
    expect(localStorage.getItem(XIAOZE_TOGGLE_HINT_STORAGE_KEY)).toBe("1");
  });
});
