/**
 * macOS-aware keyboard convention for the app shell and review workbench.
 *
 * Product helpers must not bind ⌘/Ctrl+letter — those stay with the browser
 * and OS (find, copy, refresh). Page helpers use Alt+letter or unchorded keys
 * when the user is not typing. `LogsPage` still uses Ctrl/⌘+F; that steal is
 * not the pattern for new surfaces.
 */

export function isApplePlatform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

export function isPrimaryModifier(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  userAgent?: string
): boolean {
  return isApplePlatform(userAgent) ? event.metaKey : event.ctrlKey;
}

export function formatPrimaryShortcut(key: string, userAgent?: string): string {
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  return isApplePlatform(userAgent) ? `⌘${normalized}` : `Ctrl+${normalized}`;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(target.isContentEditable);
}

/** True when a new app/page shortcut should stand down (typing or ⌘/Ctrl). */
export function shouldIgnoreAppShortcut(event: KeyboardEvent): boolean {
  return isTypingTarget(event.target) || event.metaKey || event.ctrlKey;
}
