import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBeforeUnload } from "./useBeforeUnload";

describe("useBeforeUnload", () => {
  it("prevents the beforeunload event when enabled", () => {
    const { unmount } = renderHook(() => useBeforeUnload(true, "有未导出变更"));
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("does not prevent the beforeunload event when disabled", () => {
    renderHook(() => useBeforeUnload(false, "x"));
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, "returnValue", { writable: true, value: "" });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("removes the listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useBeforeUnload(true, "x"));

    unmount();

    expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    remove.mockRestore();
  });
});
