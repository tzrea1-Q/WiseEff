export const XIAOZE_POPUP_OPEN_SESSION_KEY = "wiseeff.xiaoze.popup.open.v1";

export function readXiaozePopupOpenSession(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeXiaozePopupOpenSession(open: boolean, storage: Pick<Storage, "setItem" | "removeItem"> = sessionStorage) {
  try {
    if (open) {
      storage.setItem(XIAOZE_POPUP_OPEN_SESSION_KEY, "1");
      return;
    }
    storage.removeItem(XIAOZE_POPUP_OPEN_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}
