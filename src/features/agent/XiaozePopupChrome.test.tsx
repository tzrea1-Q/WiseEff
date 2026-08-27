import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozePopupChrome } from "./XiaozePopupChrome";
import { XIAOZE_POPUP_LAYOUT_STORAGE_KEY } from "./xiaozePopupLayout";

function renderChromeHarness() {
  const popup = document.createElement("div");
  popup.className = "copilotKitWindow";
  popup.dataset.copilotPopup = "";

  const handle = document.createElement("button");
  handle.dataset.xiaozeDragHandle = "";
  popup.appendChild(handle);

  const reset = document.createElement("button");
  reset.dataset.xiaozeLayoutReset = "";
  popup.appendChild(reset);

  const resize = document.createElement("button");
  resize.dataset.xiaozeResizeHandle = "";
  popup.appendChild(resize);
  document.body.appendChild(popup);

  const view = render(<XiaozePopupChrome />);
  return {
    ...view,
    popup,
    handle,
    reset,
    resize,
    cleanupHarness: () => popup.remove()
  };
}

function renderLauncherHarness() {
  const anchor = document.createElement("div");
  anchor.dataset.xiaozeLauncherAnchor = "";

  const handle = document.createElement("button");
  handle.dataset.xiaozeLauncherDragHandle = "";
  anchor.appendChild(handle);
  document.body.appendChild(anchor);

  const view = render(<XiaozePopupChrome />);
  return {
    ...view,
    anchor,
    handle,
    cleanupHarness: () => anchor.remove()
  };
}

describe("XiaozePopupChrome", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("moves from the dedicated handle and persists only after pointer up", async () => {
    const { popup, handle, reset, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px"));

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, isPrimary: true, clientX: 1000, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800, clientY: 400 });

    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("796px");
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("204px");
    expect(localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(reset.hidden).toBe(false);

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800, clientY: 400 });
    expect(localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toContain('"x":796');
    expect(document.body).not.toHaveClass("xiaoze-popup-drag-active");

    unmount();
    cleanupHarness();
  });

  it("supports keyboard movement, accelerated movement, and reset", async () => {
    const { popup, handle, reset, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px"));

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("988px");
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("156px");
    expect(reset.hidden).toBe(false);

    fireEvent.keyDown(handle, { key: "Home" });
    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px");
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("124px");
    expect(reset.hidden).toBe(true);

    unmount();
    cleanupHarness();
  });

  it("resizes from the lower-right handle while keeping the upper-left position", async () => {
    const { popup, resize, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("420px"));

    fireEvent.pointerDown(resize, { pointerId: 2, button: 0, isPrimary: true, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(resize, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(resize, { pointerId: 2, clientX: 100, clientY: 100 });

    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px");
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("124px");
    expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("428px");
    expect(popup.style.getPropertyValue("--copilot-popup-height")).toBe("760px");
    expect(localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toContain('"width":428');

    unmount();
    cleanupHarness();
  });

  it("supports keyboard resizing, accelerated resizing, and reset", async () => {
    const { popup, resize, reset, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("420px"));

    fireEvent.keyDown(resize, { key: "ArrowLeft" });
    expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("412px");
    fireEvent.keyDown(resize, { key: "ArrowUp", shiftKey: true });
    expect(popup.style.getPropertyValue("--copilot-popup-height")).toBe("648px");
    expect(reset.hidden).toBe(false);

    fireEvent.keyDown(resize, { key: "Home" });
    expect(popup.style.getPropertyValue("--copilot-popup-width")).toBe("420px");
    expect(popup.style.getPropertyValue("--copilot-popup-height")).toBe("680px");
    expect(reset.hidden).toBe(true);

    unmount();
    cleanupHarness();
  });

  it("rolls back a cancelled drag and clears global gesture state", async () => {
    const { popup, handle, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px"));

    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, isPrimary: true, clientX: 1000, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 850, clientY: 300 });
    fireEvent.pointerCancel(handle, { pointerId: 3 });

    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px");
    expect(localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(document.body).not.toHaveClass("xiaoze-popup-drag-active");

    unmount();
    cleanupHarness();
  });

  it("keeps the launcher's last dragged position when pointer capture is cancelled", async () => {
    const { anchor, handle, unmount, cleanupHarness } = renderLauncherHarness();
    await waitFor(() => expect(anchor.style.getPropertyValue("--xiaoze-launcher-left")).toBe("1360px"));

    fireEvent.pointerDown(handle, { pointerId: 5, button: 0, isPrimary: true, clientX: 1388, clientY: 848 });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 400, clientY: 300 });
    expect(anchor.style.getPropertyValue("--xiaoze-launcher-left")).toBe("372px");
    expect(anchor.style.getPropertyValue("--xiaoze-launcher-top")).toBe("272px");

    fireEvent.pointerCancel(handle, { pointerId: 5 });

    expect(anchor.style.getPropertyValue("--xiaoze-launcher-left")).toBe("372px");
    expect(anchor.style.getPropertyValue("--xiaoze-launcher-top")).toBe("272px");
    expect(document.body).not.toHaveClass("xiaoze-launcher-drag-active");

    unmount();
    cleanupHarness();
  });

  it("cleans up an active gesture when the popup is removed", async () => {
    const { popup, handle, unmount } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px"));

    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, isPrimary: true, clientX: 1000, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 850, clientY: 300 });
    expect(document.body).toHaveClass("xiaoze-popup-drag-active");

    popup.remove();

    await waitFor(() => expect(document.body).not.toHaveClass("xiaoze-popup-drag-active"));
    expect(document.body).not.toHaveClass("xiaoze-popup-resize-active");
    expect(localStorage.getItem(XIAOZE_POPUP_LAYOUT_STORAGE_KEY)).toBeNull();
    unmount();
  });

  it("does not bind drag or resize behavior on the mobile full-screen breakpoint", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const { popup, handle, unmount, cleanupHarness } = renderChromeHarness();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("");
    expect(handle).toHaveAttribute("disabled");

    unmount();
    cleanupHarness();
  });

  it("re-derives a default layout for a new desktop viewport without showing reset", async () => {
    const { popup, reset, unmount, cleanupHarness } = renderChromeHarness();
    await waitFor(() => expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("996px"));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1024 });
    fireEvent(window, new Event("resize"));

    expect(popup.style.getPropertyValue("--xiaoze-popup-left")).toBe("324px");
    expect(popup.style.getPropertyValue("--xiaoze-popup-top")).toBe("248px");
    expect(reset.hidden).toBe(true);

    unmount();
    cleanupHarness();
  });
});
