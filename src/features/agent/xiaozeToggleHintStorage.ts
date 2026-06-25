export const XIAOZE_TOGGLE_HINT_STORAGE_KEY = "wiseeff.xiaoze.toggle-hint.dismissed.v1";

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
