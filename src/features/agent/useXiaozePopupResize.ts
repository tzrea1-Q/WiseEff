import { useEffect } from "react";
import {
  applyXiaozePopupSize,
  clampXiaozePopupSize,
  readStoredXiaozePopupSize,
  writeStoredXiaozePopupSize,
  type XiaozePopupSize
} from "./xiaozePopupLayout";

const POPUP_SELECTOR = "[data-copilot-popup].copilotKitWindow";
const RESIZE_HANDLE_CLASS = "xiaoze-popup-resize-handle";
const RESIZING_CLASS = "xiaoze-popup-is-resizing";

type ResizeAxis = "width" | "height" | "both";

function findPopup() {
  return document.querySelector<HTMLElement>(POPUP_SELECTOR);
}

function ensureResizeHandle(popup: HTMLElement) {
  let handle = popup.querySelector<HTMLElement>(`.${RESIZE_HANDLE_CLASS}`);
  if (handle) {
    return handle;
  }

  handle = document.createElement("button");
  handle.type = "button";
  handle.className = RESIZE_HANDLE_CLASS;
  handle.setAttribute("aria-label", "拖拽调整小泽窗口大小");
  handle.dataset.resizeAxis = "both";
  popup.appendChild(handle);
  return handle;
}

function startResize(popup: HTMLElement, axis: ResizeAxis, event: PointerEvent) {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = popup.getBoundingClientRect().width;
  const startHeight = popup.getBoundingClientRect().height;
  const pointerId = event.pointerId;
  const target = event.currentTarget as HTMLElement;

  target.setPointerCapture(pointerId);
  popup.classList.add(RESIZING_CLASS);
  document.body.classList.add("xiaoze-popup-resize-active");

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) {
      return;
    }

    const deltaX = startX - moveEvent.clientX;
    const deltaY = startY - moveEvent.clientY;
    const next: XiaozePopupSize = {
      width: axis === "height" ? startWidth : startWidth + deltaX,
      height: axis === "width" ? startHeight : startHeight + deltaY
    };

    applyXiaozePopupSize(popup, next);
  };

  const onPointerUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) {
      return;
    }

    target.releasePointerCapture(pointerId);
    popup.classList.remove(RESIZING_CLASS);
    document.body.classList.remove("xiaoze-popup-resize-active");
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);

    writeStoredXiaozePopupSize({
      width: popup.getBoundingClientRect().width,
      height: popup.getBoundingClientRect().height
    });
  };

  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
}

function bindPopup(popup: HTMLElement) {
  applyXiaozePopupSize(popup, readStoredXiaozePopupSize());

  const handle = ensureResizeHandle(popup);
  const onPointerDown = (event: PointerEvent) => {
    const axis = (event.currentTarget as HTMLElement).dataset.resizeAxis;
    startResize(popup, axis === "width" ? "width" : axis === "height" ? "height" : "both", event);
  };

  handle.addEventListener("pointerdown", onPointerDown);

  const onWindowResize = () => {
    applyXiaozePopupSize(popup, clampXiaozePopupSize(readStoredXiaozePopupSize()));
  };
  window.addEventListener("resize", onWindowResize);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("resize", onWindowResize);
    handle.remove();
  };
}

export function useXiaozePopupResize(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }

    let cleanup: (() => void) | undefined;
    const observer = new MutationObserver(() => {
      const popup = findPopup();
      if (!popup || popup.dataset.xiaozeResizeBound === "true") {
        return;
      }
      popup.dataset.xiaozeResizeBound = "true";
      cleanup?.();
      cleanup = bindPopup(popup);
    });

    const existing = findPopup();
    if (existing) {
      existing.dataset.xiaozeResizeBound = "true";
      cleanup = bindPopup(existing);
    }

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanup?.();
      const popup = findPopup();
      if (popup) {
        delete popup.dataset.xiaozeResizeBound;
      }
    };
  }, [enabled]);
}
