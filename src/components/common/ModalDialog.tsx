import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

/**
 * Open dialogs, bottom-most first. Escape is handled by the last entry only, so a
 * dialog stacked on another dialog does not dismiss the one underneath it.
 */
const dialogStack: string[] = [];
// Escape keydown already consumed by an outer dialog's dismiss during this
// same dispatch — inner dialogs mounted by that dismiss must ignore it.
let lastDismissKeydownEvent: KeyboardEvent | null = null;

let backgroundInertCount = 0;

/**
 * `inert` blocks focus and pointer input for the whole background subtree, which is
 * what makes `aria-modal` on the dialog card true rather than aspirational.
 *
 * `aria-hidden` is deliberately not applied: it would remove background content from
 * the accessibility tree, and accessible-name queries in the existing component tests
 * legitimately read background content while a dialog is open.
 */
function acquireBackgroundInert(): () => void {
  const root = document.getElementById("root");
  if (!root) {
    return () => {};
  }
  if (backgroundInertCount === 0) {
    root.setAttribute("inert", "");
  }
  backgroundInertCount += 1;
  return () => {
    backgroundInertCount = Math.max(0, backgroundInertCount - 1);
    if (backgroundInertCount === 0) {
      root.removeAttribute("inert");
    }
  };
}

/**
 * Layout-free visibility test. `offsetParent` and `getClientRects` are unusable here
 * because jsdom performs no layout, so every candidate would look hidden under test.
 */
function isVisible(node: HTMLElement): boolean {
  if (node.hasAttribute("hidden") || node.closest("[hidden],[inert]")) {
    return false;
  }
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusableWithin(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

export type ModalDialogRenderProps = {
  /** Put this on the element that names the dialog. */
  titleId: string;
  /** Put this on the element that describes it, and pass `describedBy`. */
  descriptionId: string;
};

export type ModalDialogProps = {
  open: boolean;
  /**
   * Escape and backdrop dismissal. Omit it to make the dialog non-dismissible, which
   * is how a pending operation should block its own dialog from closing under it.
   */
  onDismiss?: () => void;
  /** Classes for the dialog card. */
  className: string;
  /** Extra classes for the backdrop, for surface-specific treatments. */
  backdropClassName?: string;
  /** Set when the card renders an element carrying `descriptionId`. */
  describedBy?: boolean;
  children: ReactNode | ((ids: ModalDialogRenderProps) => ReactNode);
};

/**
 * The modal contract shared by every dialog: the card (not the backdrop) is the
 * `dialog`, focus enters on open and returns to the trigger on close, Tab cannot leave,
 * Escape reaches only the top-most dialog, and backdrop dismissal needs the press and
 * the release to both land on the backdrop so a drag out of the card cannot close it.
 */
export function ModalDialog({
  open,
  onDismiss,
  className,
  backdropClassName,
  describedBy = false,
  children
}: ModalDialogProps) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pressedBackdrop = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const dismissible = typeof onDismiss === "function";

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    dialogStack.push(generatedId);
    return () => {
      const index = dialogStack.lastIndexOf(generatedId);
      if (index >= 0) {
        dialogStack.splice(index, 1);
      }
    };
  }, [generatedId, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    return acquireBackgroundInert();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissible) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // When an outer dialog consumes an Escape and synchronously opens this
      // dialog (e.g. a dirty-state confirmation), environments that do not
      // snapshot listener lists (jsdom) deliver the SAME keydown to the
      // freshly-mounted listener and instantly dismiss the dialog it opened.
      // Track the consumed event by identity — timestamps are unreliable here
      // because jsdom stamps epoch time while performance.now() is page-relative.
      if (event.defaultPrevented || event === lastDismissKeydownEvent) {
        return;
      }
      if (dialogStack[dialogStack.length - 1] !== generatedId) {
        return;
      }
      const dismiss = onDismissRef.current;
      if (!dismiss) {
        return;
      }
      event.stopPropagation();
      lastDismissKeydownEvent = event;
      dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // Read onDismiss through a ref so Escape uses the latest callback even if it
    // arrives after this commit but before this effect re-subscribes. Callers such
    // as a dirty-state wizard pass a new onDismiss every render; findByRole can
    // resolve on the MutationObserver from that commit while the window listener
    // still closes over the previous unguarded dismiss.
  }, [generatedId, dismissible, open]);

  const trapTab = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const focusables = focusableWithin(card);
    if (focusables.length === 0) {
      event.preventDefault();
      card.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || active === card) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) {
    return null;
  }

  const body = (
    <div
      className={backdropClassName ? `modal-backdrop ${backdropClassName}` : "modal-backdrop"}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        const releasedOnBackdrop = event.target === event.currentTarget;
        const shouldDismiss = pressedBackdrop.current && releasedOnBackdrop;
        pressedBackdrop.current = false;
        if (shouldDismiss) {
          onDismiss?.();
        }
      }}
    >
      <div
        ref={cardRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        {typeof children === "function" ? children({ titleId, descriptionId }) : children}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
