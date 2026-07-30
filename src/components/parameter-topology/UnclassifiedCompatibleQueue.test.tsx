import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnclassifiedCompatibleQueue } from "./UnclassifiedCompatibleQueue";

afterEach(() => cleanup());

describe("UnclassifiedCompatibleQueue", () => {
  it("filters by compatible and supports bulk selection", () => {
    const onSelectionChange = vi.fn();
    const onClassify = vi.fn();
    const onDismiss = vi.fn();

    render(
      <UnclassifiedCompatibleQueue
        canAdmin
        selectedCompatibles={[]}
        onSelectionChange={onSelectionChange}
        onClassify={onClassify}
        onDismiss={onDismiss}
        hints={[
          {
            compatible: "vendor,alpha",
            bindingCount: 3,
            projectCount: 1,
            suggestedGroupName: "alpha"
          },
          {
            compatible: "vendor,beta",
            bindingCount: 5,
            projectCount: 2,
            suggestedGroupName: "beta"
          }
        ]}
      />
    );

    const region = screen.getByRole("region", { name: "未登记驱动" });
    expect(within(region).getByText("vendor,alpha")).toBeInTheDocument();
    expect(within(region).getByText("vendor,beta")).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("checkbox", { name: "选择 vendor,alpha" }));
    expect(onSelectionChange).toHaveBeenCalledWith(["vendor,alpha"]);

    fireEvent.click(within(region).getAllByRole("button", { name: "归类" })[0]!);
    expect(onClassify).toHaveBeenCalledWith([
      expect.objectContaining({ compatible: "vendor,alpha" })
    ]);

    fireEvent.click(within(region).getAllByRole("button", { name: "忽略" })[0]!);
    expect(onDismiss).toHaveBeenCalledWith("vendor,alpha");
  });
});
