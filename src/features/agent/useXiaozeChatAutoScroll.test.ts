import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useXiaozeChatAutoScroll } from "./useXiaozeChatAutoScroll";

function createScrollFixture(initialScrollHeight = 200) {
  const scrollEl = document.createElement("div");
  const contentEl = document.createElement("div");
  const chatRoot = document.createElement("div");
  chatRoot.setAttribute("data-copilot-running", "false");
  chatRoot.appendChild(scrollEl);
  scrollEl.appendChild(contentEl);
  document.body.appendChild(chatRoot);

  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 200 });
  Object.defineProperty(scrollEl, "scrollTop", { configurable: true, writable: true, value: 0 });

  let scrollHeight = initialScrollHeight;
  Object.defineProperty(scrollEl, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
    set: (value: number) => {
      scrollHeight = value;
    }
  });

  return {
    chatRoot,
    scrollEl,
    contentEl,
    growContent(delta = 80) {
      scrollHeight += delta;
      contentEl.textContent = `${contentEl.textContent ?? ""}more text`;
    },
    pinToBottom() {
      scrollEl.scrollTop = scrollHeight - scrollEl.clientHeight;
    }
  };
}

describe("useXiaozeChatAutoScroll", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("tracks content growth by applying the same scrollHeight delta when pinned", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const fixture = createScrollFixture();
    fixture.pinToBottom();
    const scrollRef = { current: fixture.scrollEl };
    const contentRef = { current: fixture.contentEl };

    renderHook(() => useXiaozeChatAutoScroll(scrollRef, contentRef));

    act(() => {
      fixture.growContent(80);
    });

    await waitFor(() => {
      expect(fixture.scrollEl.scrollTop).toBe(80);
    });
  });

  it("snaps to bottom when the chat enters running state while lagging behind", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });

    const fixture = createScrollFixture(480);
    fixture.scrollEl.scrollTop = 0;
    const scrollRef = { current: fixture.scrollEl };
    const contentRef = { current: fixture.contentEl };

    renderHook(() => useXiaozeChatAutoScroll(scrollRef, contentRef));

    act(() => {
      fixture.chatRoot.setAttribute("data-copilot-running", "true");
    });

    await waitFor(() => {
      expect(fixture.scrollEl.scrollTop).toBe(280);
    });
  });
});
