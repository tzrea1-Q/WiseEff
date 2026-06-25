import { beforeEach, describe, expect, it } from "vitest";
import {
  readXiaozePopupOpenSession,
  writeXiaozePopupOpenSession,
  XIAOZE_POPUP_OPEN_SESSION_KEY
} from "./xiaozePopupOpenState";

describe("xiaozePopupOpenState", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("defaults to closed and remembers an explicit open preference for the session", () => {
    expect(readXiaozePopupOpenSession()).toBe(false);

    writeXiaozePopupOpenSession(true);
    expect(readXiaozePopupOpenSession()).toBe(true);
    expect(sessionStorage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY)).toBe("1");

    writeXiaozePopupOpenSession(false);
    expect(readXiaozePopupOpenSession()).toBe(false);
    expect(sessionStorage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY)).toBeNull();
  });
});
