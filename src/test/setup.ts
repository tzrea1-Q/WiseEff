import "@testing-library/jest-dom/vitest";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? function scrollIntoView() {};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverMock as typeof ResizeObserver);
