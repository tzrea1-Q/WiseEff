import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverMock as typeof ResizeObserver);

HTMLElement.prototype.hasPointerCapture = HTMLElement.prototype.hasPointerCapture ?? (() => false);
HTMLElement.prototype.setPointerCapture = HTMLElement.prototype.setPointerCapture ?? (() => {});
HTMLElement.prototype.releasePointerCapture = HTMLElement.prototype.releasePointerCapture ?? (() => {});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined)
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard
  });
});

afterEach(() => {
  cleanup();
});
