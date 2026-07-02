export const XIAOZE_TOGGLE_HINT_DELAY_MS = 1400;

const LEGACY_DISMISSED_LOCAL_KEY = "wiseeff.xiaoze.toggle-hint.dismissed.v1";
const LEGACY_SHOWN_SESSION_KEY = "wiseeff.xiaoze.toggle-hint.shown.v1";

let hintShownThisPageLoad = false;
let hintDismissedThisPageLoad = false;

function clearLegacyToggleHintStorage() {
  try {
    localStorage.removeItem(LEGACY_DISMISSED_LOCAL_KEY);
    sessionStorage.removeItem(LEGACY_SHOWN_SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

clearLegacyToggleHintStorage();

export function readXiaozeToggleHintDismissed(): boolean {
  return hintDismissedThisPageLoad;
}

export function dismissXiaozeToggleHint() {
  hintDismissedThisPageLoad = true;
}

export function readXiaozeToggleHintShown(): boolean {
  return hintShownThisPageLoad;
}

export function markXiaozeToggleHintShown() {
  hintShownThisPageLoad = true;
}

export function resetXiaozeToggleHintPageState() {
  hintShownThisPageLoad = false;
  hintDismissedThisPageLoad = false;
}
