import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useHorizontalDragScroll } from "./useHorizontalDragScroll";

function DragSurface() {
  const ref = useRef<HTMLDivElement>(null);
  useHorizontalDragScroll(ref);

  return (
    <div ref={ref} className="data-table-scroll" data-testid="scrollport">
      <button type="button">筛选角色</button>
      <span data-testid="cell">Xu Yun</span>
    </div>
  );
}

function mockOverflow(element: HTMLElement, scrollWidth = 800, clientWidth = 200) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
  element.scrollLeft = 0;
}

describe("useHorizontalDragScroll", () => {
  it("drags an overflowed surface horizontally and suppresses the trailing click", () => {
    const onCellClick = vi.fn();
    const { getByTestId } = render(<DragSurface />);
    const scrollport = getByTestId("scrollport");
    const cell = getByTestId("cell");
    cell.addEventListener("click", onCellClick);
    mockOverflow(scrollport);

    fireEvent.pointerDown(cell, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 120 });
    fireEvent.pointerMove(scrollport, { pointerId: 1, pointerType: "mouse", clientX: 40 });
    expect(scrollport.scrollLeft).toBe(80);
    expect(scrollport.dataset.dragging).toBe("true");

    fireEvent.pointerUp(scrollport, { pointerId: 1, pointerType: "mouse", clientX: 40 });
    fireEvent.click(cell);

    expect(onCellClick).not.toHaveBeenCalled();
    expect(scrollport.dataset.dragging).toBeUndefined();
  });

  it("does not start a drag from interactive controls", () => {
    const { getByRole, getByTestId } = render(<DragSurface />);
    const scrollport = getByTestId("scrollport");
    mockOverflow(scrollport);

    fireEvent.pointerDown(getByRole("button", { name: "筛选角色" }), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 120
    });
    fireEvent.pointerMove(scrollport, { pointerId: 1, pointerType: "mouse", clientX: 20 });

    expect(scrollport.scrollLeft).toBe(0);
    expect(scrollport.dataset.dragging).toBeUndefined();
  });

  it("leaves touch pans to native scrolling", () => {
    const { getByTestId } = render(<DragSurface />);
    const scrollport = getByTestId("scrollport");
    const cell = getByTestId("cell");
    mockOverflow(scrollport);

    fireEvent.pointerDown(cell, { pointerId: 1, pointerType: "touch", button: 0, clientX: 120 });
    fireEvent.pointerMove(scrollport, { pointerId: 1, pointerType: "touch", clientX: 20 });

    expect(scrollport.scrollLeft).toBe(0);
  });
});
