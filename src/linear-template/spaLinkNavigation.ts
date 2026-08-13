import type { MouseEvent } from "react";

/**
 * Landing-page anchors keep their `href` (middle-click / cmd-click still open a
 * new tab), but plain left-clicks on in-app routes go through the SPA router
 * instead of a full page reload (ui-design-system §Layout: navigation preserves
 * SPA behavior).
 */
export function handleSpaLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  onNavigate?: (path: string) => void
) {
  if (!onNavigate || !href.startsWith("/")) {
    return;
  }
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  onNavigate(href);
}
