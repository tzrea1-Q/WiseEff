export const XIAOZE_TOGGLE_HINT_STORAGE_KEY = "wiseeff.xiaoze.toggle-hint.dismissed.v1";
export const XIAOZE_TOGGLE_HINT_SHOWN_SESSION_KEY = "wiseeff.xiaoze.toggle-hint.shown.v1";

export const XIAOZE_TOGGLE_HINT_DELAY_MS = 1400;

export function readXiaozeToggleHintDismissed(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(XIAOZE_TOGGLE_HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissXiaozeToggleHint(storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(XIAOZE_TOGGLE_HINT_STORAGE_KEY, "1");
  } catch {
    // Ignore storage failures; hint may reappear next visit.
  }
}

export function readXiaozeToggleHintShown(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(XIAOZE_TOGGLE_HINT_SHOWN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markXiaozeToggleHintShown(storage: Pick<Storage, "setItem"> = sessionStorage) {
  try {
    storage.setItem(XIAOZE_TOGGLE_HINT_SHOWN_SESSION_KEY, "1");
  } catch {
    // Ignore storage failures; hint may reappear on the next page visit.
  }
}
