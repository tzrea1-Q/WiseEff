import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirtyIndicator } from "./DirtyIndicator";

describe("DirtyIndicator", () => {
  it("does not render when count is zero", () => {
    const { container } = render(<DirtyIndicator count={0} onInspect={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders the dirty count as an inspect button", () => {
    render(<DirtyIndicator count={3} onInspect={vi.fn()} />);

    expect(screen.getByRole("button", { name: /3 处未导出/ })).toBeInTheDocument();
  });

  it("calls onInspect when clicked", () => {
    const onInspect = vi.fn();
    render(<DirtyIndicator count={2} onInspect={onInspect} />);

    fireEvent.click(screen.getByRole("button", { name: /2 处未导出/ }));

    expect(onInspect).toHaveBeenCalledTimes(1);
  });
});
