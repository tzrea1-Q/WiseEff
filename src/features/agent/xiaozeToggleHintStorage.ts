export const XIAOZE_TOGGLE_HINT_DELAY_MS = 1400;

const DISMISSED_LOCAL_KEY = "wiseeff.xiaoze.toggle-hint.dismissed.v1";
const LEGACY_SHOWN_SESSION_KEY = "wiseeff.xiaoze.toggle-hint.shown.v1";

const hintShownThisPageLoad = new Set<string>();
const hintDismissedThisPageLoad = new Set<string>();

function clearLegacyToggleHintStorage() {
  try {
    sessionStorage.removeItem(LEGACY_SHOWN_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

clearLegacyToggleHintStorage();

export function readXiaozeToggleHintDismissed(userId = ""): boolean {
  try {
    return hintDismissedThisPageLoad.has(userId) || localStorage.getItem(`${DISMISSED_LOCAL_KEY}:${userId}`) === "true";
  } catch {
    return hintDismissedThisPageLoad.has(userId);
  }
}

export function dismissXiaozeToggleHint(userId = "") {
  hintDismissedThisPageLoad.add(userId);
  try {
    localStorage.setItem(`${DISMISSED_LOCAL_KEY}:${userId}`, "true");
  } catch {
    return;
  }
}

export function readXiaozeToggleHintShown(userId = ""): boolean {
  return hintShownThisPageLoad.has(userId);
}

export function markXiaozeToggleHintShown(userId = "") {
  hintShownThisPageLoad.add(userId);
}

export function resetXiaozeToggleHintPageState() {
  hintShownThisPageLoad.clear();
  hintDismissedThisPageLoad.clear();
}
