import { useEffect } from "react";
import {
  applyXiaozeLauncherLayout,
  applyXiaozePopupLayout,
  clampXiaozePopupLayout,
  getDefaultXiaozePopupLayout,
  isXiaozePopupDesktop,
  readStoredXiaozePopupLayout,
  resetStoredXiaozePopupLayout,
  writeStoredXiaozePopupLayout,
  XIAOZE_POPUP_MIN_SIZE,
  XIAOZE_POPUP_SAFE_INSET,
  type XiaozePopupLayout
} from "./xiaozePopupLayout";

const POPUP_SELECTOR = "[data-copilot-popup].copilotKitWindow";
const LAUNCHER_ANCHOR_SELECTOR = "[data-xiaoze-launcher-anchor]";
const LAUNCHER_HANDLE_SELECTOR = "[data-xiaoze-launcher-drag-handle]";
const DRAG_HANDLE_SELECTOR = "[data-xiaoze-drag-handle]";
const RESET_SELECTOR = "[data-xiaoze-layout-reset]";
const RESIZE_HANDLE_SELECTOR = "[data-xiaoze-resize-handle]";
const DRAG_THRESHOLD = 6;

type GestureKind = "drag" | "resize";

function sameLayout(left: XiaozePopupLayout, right: XiaozePopupLayout) {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function resizeKeepingOrigin(layout: XiaozePopupLayout, width: number, height: number): XiaozePopupLayout {
  const maxWidth = Math.max(0, window.innerWidth - XIAOZE_POPUP_SAFE_INSET - layout.x);
  const maxHeight = Math.max(0, window.innerHeight - XIAOZE_POPUP_SAFE_INSET - layout.y);
  return {
    ...layout,
    width: Math.min(Math.max(width, Math.min(XIAOZE_POPUP_MIN_SIZE.width, maxWidth)), maxWidth),
    height: Math.min(Math.max(height, Math.min(XIAOZE_POPUP_MIN_SIZE.height, maxHeight)), maxHeight)
  };
}

function bindXiaozePopupLayout(popup: HTMLElement) {
  const dragHandle = popup.querySelector<HTMLButtonElement>(DRAG_HANDLE_SELECTOR);
  const resetButton = popup.querySelector<HTMLButtonElement>(RESET_SELECTOR);
  const resizeHandle = popup.querySelector<HTMLButtonElement>(RESIZE_HANDLE_SELECTOR);
  if (!dragHandle || !resetButton || !resizeHandle) {
    return;
  }

  if (!isXiaozePopupDesktop()) {
    dragHandle.disabled = true;
    resizeHandle.disabled = true;
    resetButton.hidden = true;
    return () => {
      dragHandle.disabled = false;
      resizeHandle.disabled = false;
    };
  }

  dragHandle.disabled = false;
  resizeHandle.disabled = false;
  let layout = readStoredXiaozePopupLayout();
  let defaultLayout = getDefaultXiaozePopupLayout();
  let frame = 0;
  let gestureCleanup: (() => void) | undefined;

  const renderLayout = (next: XiaozePopupLayout) => {
    layout = next;
    applyXiaozePopupLayout(popup, next);
    const launcherAnchor = document.querySelector<HTMLElement>(LAUNCHER_ANCHOR_SELECTOR);
    if (launcherAnchor) {
      applyXiaozeLauncherLayout(launcherAnchor, next);
    }
    resetButton.hidden = sameLayout(next, defaultLayout);
  };

  const commitLayout = (next: XiaozePopupLayout) => {
    renderLayout(next);
    writeStoredXiaozePopupLayout(next);
  };

  const startGesture = (kind: GestureKind, event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || gestureCleanup) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = layout;
    let changed = false;
    let nextLayout = startLayout;
    target.setPointerCapture(pointerId);

    const clearGesture = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      popup.classList.remove("xiaoze-popup-is-dragging", "xiaoze-popup-is-resizing");
      document.body.classList.remove("xiaoze-popup-drag-active", "xiaoze-popup-resize-active");
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerCancel);
      target.removeEventListener("lostpointercapture", onPointerCancel);
      gestureCleanup = undefined;
    };

    const scheduleRender = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        renderLayout(nextLayout);
      });
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!changed && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
        return;
      }
      changed = true;
      if (kind === "drag") {
        popup.classList.add("xiaoze-popup-is-dragging");
        document.body.classList.add("xiaoze-popup-drag-active");
        nextLayout = clampXiaozePopupLayout({
          ...startLayout,
          x: startLayout.x + deltaX,
          y: startLayout.y + deltaY
        });
      } else {
        popup.classList.add("xiaoze-popup-is-resizing");
        document.body.classList.add("xiaoze-popup-resize-active");
        nextLayout = resizeKeepingOrigin(
          startLayout,
          startLayout.width + deltaX,
          startLayout.height + deltaY
        );
      }
      scheduleRender();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      clearGesture();
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      if (changed) {
        commitLayout(nextLayout);
      }
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      clearGesture();
      renderLayout(startLayout);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerCancel);
    target.addEventListener("lostpointercapture", onPointerCancel);
    gestureCleanup = () => {
      clearGesture();
      renderLayout(startLayout);
    };
  };

  const onDragPointerDown = (event: PointerEvent) => startGesture("drag", event);
  const onResizePointerDown = (event: PointerEvent) => startGesture("resize", event);
  const onDragKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      commitLayout(resetStoredXiaozePopupLayout());
      return;
    }
    const step = event.shiftKey ? 32 : 8;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const offset = offsets[event.key];
    if (!offset) {
      return;
    }
    event.preventDefault();
    commitLayout(clampXiaozePopupLayout({ ...layout, x: layout.x + offset[0], y: layout.y + offset[1] }));
  };
  const onResizeKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      commitLayout(resetStoredXiaozePopupLayout());
      return;
    }
    const step = event.shiftKey ? 32 : 8;
    const sizeOffsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const offset = sizeOffsets[event.key];
    if (!offset) {
      return;
    }
    event.preventDefault();
    commitLayout(resizeKeepingOrigin(layout, layout.width + offset[0], layout.height + offset[1]));
  };
  const onReset = () => {
    defaultLayout = getDefaultXiaozePopupLayout();
    commitLayout(resetStoredXiaozePopupLayout());
  };
  const onWindowResize = () => {
    if (!isXiaozePopupDesktop()) {
      return;
    }
    const wasDefault = sameLayout(layout, defaultLayout);
    defaultLayout = getDefaultXiaozePopupLayout();
    commitLayout(wasDefault ? defaultLayout : clampXiaozePopupLayout(layout));
  };

  dragHandle.addEventListener("pointerdown", onDragPointerDown);
  dragHandle.addEventListener("keydown", onDragKeyDown);
  resizeHandle.addEventListener("pointerdown", onResizePointerDown);
  resizeHandle.addEventListener("keydown", onResizeKeyDown);
  resetButton.addEventListener("click", onReset);
  window.addEventListener("resize", onWindowResize);
  renderLayout(layout);

  return () => {
    gestureCleanup?.();
    dragHandle.removeEventListener("pointerdown", onDragPointerDown);
    dragHandle.removeEventListener("keydown", onDragKeyDown);
    resizeHandle.removeEventListener("pointerdown", onResizePointerDown);
    resizeHandle.removeEventListener("keydown", onResizeKeyDown);
    resetButton.removeEventListener("click", onReset);
    window.removeEventListener("resize", onWindowResize);
  };
}

function bindXiaozeLauncherLayout(anchor: HTMLElement) {
  const handle = anchor.querySelector<HTMLButtonElement>(LAUNCHER_HANDLE_SELECTOR);
  if (!handle || !isXiaozePopupDesktop()) {
    return;
  }

  let layout = readStoredXiaozePopupLayout();
  let frame = 0;
  let gestureCleanup: (() => void) | undefined;
  let suppressClick = false;
  let suppressClickTimer = 0;

  const renderLayout = (next: XiaozePopupLayout) => {
    layout = next;
    applyXiaozeLauncherLayout(anchor, next);
    const popup = document.querySelector<HTMLElement>(POPUP_SELECTOR);
    if (popup) {
      applyXiaozePopupLayout(popup, next);
      const resetButton = popup.querySelector<HTMLButtonElement>(RESET_SELECTOR);
      if (resetButton) {
        resetButton.hidden = sameLayout(next, getDefaultXiaozePopupLayout());
      }
    }
  };

  const commitLayout = (next: XiaozePopupLayout) => {
    renderLayout(next);
    writeStoredXiaozePopupLayout(next);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || gestureCleanup) {
      return;
    }
    // A fresh press is an intentional new interaction. Only the synthetic
    // click from the preceding drag should be consumed, never this click.
    suppressClick = false;
    window.clearTimeout(suppressClickTimer);

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = readStoredXiaozePopupLayout();
    let changed = false;
    let nextLayout = startLayout;
    handle.setPointerCapture(pointerId);

    const clearGesture = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      anchor.classList.remove("xiaoze-launcher-is-dragging");
      document.body.classList.remove("xiaoze-launcher-drag-active");
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      handle.removeEventListener("lostpointercapture", onPointerCancel);
      gestureCleanup = undefined;
    };

    const scheduleRender = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        renderLayout(nextLayout);
      });
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!changed && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
        return;
      }
      changed = true;
      moveEvent.preventDefault();
      anchor.classList.add("xiaoze-launcher-is-dragging");
      document.body.classList.add("xiaoze-launcher-drag-active");
      nextLayout = clampXiaozePopupLayout({
        ...startLayout,
        x: startLayout.x + deltaX,
        y: startLayout.y + deltaY
      });
      scheduleRender();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      clearGesture();
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      if (changed) {
        suppressClick = true;
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = window.setTimeout(() => {
          suppressClick = false;
        }, 500);
        commitLayout(nextLayout);
      }
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      clearGesture();
      renderLayout(startLayout);
    };

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
    handle.addEventListener("lostpointercapture", onPointerCancel);
    gestureCleanup = () => {
      clearGesture();
      renderLayout(startLayout);
    };
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick) {
      return;
    }
    suppressClick = false;
    window.clearTimeout(suppressClickTimer);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      commitLayout(resetStoredXiaozePopupLayout());
      return;
    }
    const step = event.shiftKey ? 32 : 8;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const offset = offsets[event.key];
    if (!offset) {
      return;
    }
    event.preventDefault();
    const currentLayout = readStoredXiaozePopupLayout();
    commitLayout(
      clampXiaozePopupLayout({
        ...currentLayout,
        x: currentLayout.x + offset[0],
        y: currentLayout.y + offset[1]
      })
    );
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("click", onClickCapture, true);
  handle.addEventListener("keydown", onKeyDown);
  renderLayout(layout);

  return () => {
    gestureCleanup?.();
    window.clearTimeout(suppressClickTimer);
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("click", onClickCapture, true);
    handle.removeEventListener("keydown", onKeyDown);
  };
}

export function useXiaozePopupLayout(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }

    let boundPopup: HTMLElement | null = null;
    let boundLauncher: HTMLElement | null = null;
    let cleanup: (() => void) | undefined;
    let launcherCleanup: (() => void) | undefined;
    let desktop = isXiaozePopupDesktop();
    const bindCurrentPopup = () => {
      const launcher = document.querySelector<HTMLElement>(LAUNCHER_ANCHOR_SELECTOR);
      if (launcher !== boundLauncher) {
        launcherCleanup?.();
        boundLauncher = launcher;
        launcherCleanup = launcher ? bindXiaozeLauncherLayout(launcher) : undefined;
      }
      const popup = document.querySelector<HTMLElement>(POPUP_SELECTOR);
      if (!popup) {
        cleanup?.();
        cleanup = undefined;
        boundPopup = null;
        return;
      }
      if (popup === boundPopup && cleanup) {
        return;
      }
      if (popup !== boundPopup) {
        cleanup?.();
      }
      boundPopup = popup;
      cleanup = bindXiaozePopupLayout(popup);
    };

    bindCurrentPopup();
    const observer = new MutationObserver(bindCurrentPopup);
    observer.observe(document.body, { childList: true, subtree: true });
    const handleBreakpointChange = () => {
      const nextDesktop = isXiaozePopupDesktop();
      if (nextDesktop === desktop) {
        return;
      }
      desktop = nextDesktop;
      cleanup?.();
      launcherCleanup?.();
      cleanup = undefined;
      launcherCleanup = undefined;
      boundPopup = null;
      boundLauncher = null;
      bindCurrentPopup();
    };
    window.addEventListener("resize", handleBreakpointChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleBreakpointChange);
      cleanup?.();
      launcherCleanup?.();
    };
  }, [enabled]);
}
