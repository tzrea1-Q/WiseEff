import { useEffect, type RefObject } from "react";

const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, label, [role='button'], [role='checkbox'], [role='combobox'], [role='menuitem'], [role='option']";

const DRAG_THRESHOLD_PX = 6;

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function canScrollHorizontally(element: HTMLElement) {
  return element.scrollWidth > element.clientWidth + 1;
}

function syncOverflowState(element: HTMLElement) {
  element.dataset.overflowX = canScrollHorizontally(element) ? "true" : "false";
}

/** Pointer-drag pan for overflowed table scrollports. Touch/trackpad keep native scrolling. */
export function useHorizontalDragScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    let pointerId: number | null = null;
    let startX = 0;
    let startScrollLeft = 0;
    let dragging = false;
    let suppressClick = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) {
        return;
      }
      if (!canScrollHorizontally(element) || isInteractiveTarget(event.target)) {
        return;
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = element.scrollLeft;
      dragging = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - startX;
      if (!dragging) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        element.dataset.dragging = "true";
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // jsdom and some browsers reject capture on detached nodes.
        }
      }
      element.scrollLeft = startScrollLeft - deltaX;
      event.preventDefault();
    };

    const endDrag = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) {
        return;
      }
      if (dragging) {
        suppressClick = true;
        try {
          element.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore missing capture.
        }
      }
      delete element.dataset.dragging;
      pointerId = null;
      dragging = false;
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) {
        return;
      }
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            syncOverflowState(element);
          })
        : null;
    resizeObserver?.observe(element);
    if (element.firstElementChild) {
      resizeObserver?.observe(element.firstElementChild);
    }
    syncOverflowState(element);

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    element.addEventListener("click", onClickCapture, true);

    return () => {
      resizeObserver?.disconnect();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endDrag);
      element.removeEventListener("pointercancel", endDrag);
      element.removeEventListener("click", onClickCapture, true);
    };
  }, [ref]);
}
