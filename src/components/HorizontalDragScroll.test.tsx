import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HorizontalDragScroll } from "./HorizontalDragScroll";

function mockSize(element: HTMLElement, values: { clientWidth: number; scrollWidth?: number }) {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: values.clientWidth });
  if (values.scrollWidth !== undefined) {
    Object.defineProperty(element, "scrollWidth", { configurable: true, value: values.scrollWidth });
  }
}

describe("HorizontalDragScroll", () => {
  it("keeps the default consumer DOM unchanged when the visible rail is not requested", () => {
    const { container, getByTestId } = render(
      <HorizontalDragScroll className="data-table-scroll" data-testid="scrollport">
        <table />
      </HorizontalDragScroll>
    );

    expect(getByTestId("scrollport").parentElement).toBe(container);
    expect(container.querySelector(".horizontal-drag-scroll-rail")).not.toBeInTheDocument();
  });

  it("owns a visible rail that mirrors and controls the opted-in scrollport", () => {
    const { container, getByTestId } = render(
      <HorizontalDragScroll className="data-table-scroll" data-testid="scrollport" visibleRail>
        <table />
      </HorizontalDragScroll>
    );
    const scrollport = getByTestId("scrollport");
    const rail = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail")!;
    const thumb = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail__thumb")!;
    mockSize(scrollport, { clientWidth: 200, scrollWidth: 800 });
    mockSize(rail, { clientWidth: 200 });
    thumb.style.minWidth = "64px";
    Object.defineProperty(rail, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 200, bottom: 16, width: 200, height: 16, x: 0, y: 0, toJSON() {} })
    });

    fireEvent.scroll(scrollport);

    expect(rail.hidden).toBe(false);
    expect(thumb.style.width).toBe("64px");
    fireEvent.pointerDown(rail, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 150 });
    expect(scrollport.scrollLeft).toBeCloseTo(520.59, 2);
  });

  it("exposes an overflowed opt-in rail as the scrollport's horizontal scrollbar", () => {
    const { container, getByTestId } = render(
      <HorizontalDragScroll className="data-table-scroll" data-testid="scrollport" visibleRail>
        <table />
      </HorizontalDragScroll>
    );
    const scrollport = getByTestId("scrollport");
    const rail = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail")!;
    const thumb = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail__thumb")!;
    mockSize(scrollport, { clientWidth: 200, scrollWidth: 800 });
    mockSize(rail, { clientWidth: 200 });

    fireEvent.scroll(scrollport);

    expect(rail).toHaveAttribute("role", "scrollbar");
    expect(rail).toHaveAttribute("aria-orientation", "horizontal");
    expect(scrollport.id).not.toBe("");
    expect(rail).toHaveAttribute("aria-controls", scrollport.id);
    expect(rail).toHaveAttribute("aria-valuemin", "0");
    expect(rail).toHaveAttribute("aria-valuemax", "600");
    expect(rail).toHaveAttribute("aria-valuenow", "0");
    expect(rail).toHaveAttribute("tabindex", "0");
    expect(rail.hidden).toBe(false);
    expect(thumb).toHaveAttribute("aria-hidden", "true");
  });

  it("scrolls the controlled viewport from the rail keyboard contract", () => {
    const { container, getByTestId } = render(
      <HorizontalDragScroll className="data-table-scroll" data-testid="scrollport" visibleRail>
        <table />
      </HorizontalDragScroll>
    );
    const scrollport = getByTestId("scrollport");
    const rail = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail")!;
    mockSize(scrollport, { clientWidth: 200, scrollWidth: 800 });
    mockSize(rail, { clientWidth: 200 });
    scrollport.scrollLeft = 300;
    fireEvent.scroll(scrollport);

    expect(rail).toHaveAttribute("aria-valuenow", "300");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(scrollport.scrollLeft).toBe(340);
    expect(rail).toHaveAttribute("aria-valuenow", "340");
    fireEvent.keyDown(rail, { key: "ArrowLeft" });
    expect(scrollport.scrollLeft).toBe(300);
    fireEvent.keyDown(rail, { key: "PageDown" });
    expect(scrollport.scrollLeft).toBe(500);
    fireEvent.keyDown(rail, { key: "PageUp" });
    expect(scrollport.scrollLeft).toBe(300);
    fireEvent.keyDown(rail, { key: "End" });
    expect(scrollport.scrollLeft).toBe(600);
    expect(rail).toHaveAttribute("aria-valuenow", "600");
    fireEvent.keyDown(rail, { key: "Home" });
    expect(scrollport.scrollLeft).toBe(0);
    expect(rail).toHaveAttribute("aria-valuenow", "0");
  });

  it("hides and removes the rail from the tab order when the scrollport fits", () => {
    const { container, getByTestId } = render(
      <HorizontalDragScroll className="data-table-scroll" data-testid="scrollport" visibleRail>
        <table />
      </HorizontalDragScroll>
    );
    const scrollport = getByTestId("scrollport");
    const rail = container.querySelector<HTMLElement>(".horizontal-drag-scroll-rail")!;
    mockSize(scrollport, { clientWidth: 200, scrollWidth: 200 });
    mockSize(rail, { clientWidth: 200 });

    fireEvent.scroll(scrollport);

    expect(rail.hidden).toBe(true);
    expect(rail).toHaveAttribute("tabindex", "-1");
    expect(rail).toHaveAttribute("aria-valuemax", "0");
    expect(rail).toHaveAttribute("aria-valuenow", "0");
  });
});
