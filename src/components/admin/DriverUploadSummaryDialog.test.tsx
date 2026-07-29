import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DriverUploadSummaryDialog } from "./DriverUploadSummaryDialog";

describe("DriverUploadSummaryDialog", () => {
  it("shows matched and unregistered counts from the upload summary", async () => {
    const onClose = vi.fn();
    const onOpenUnregisteredQueue = vi.fn();
    const user = userEvent.setup();

    render(
      <DriverUploadSummaryDialog
        fileName="board.dts"
        summary={{
          matchedRegistered: ["sc8562"],
          newUnregistered: ["huawei,orphan"],
          matchedRegisteredCount: 1,
          newUnregisteredCount: 1,
        }}
        onClose={onClose}
        onOpenUnregisteredQueue={onOpenUnregisteredQueue}
      />,
    );

    expect(screen.getByRole("dialog", { name: "上传驱动对照摘要" })).toBeInTheDocument();
    expect(screen.getByText("sc8562")).toBeInTheDocument();
    expect(screen.getByText("huawei,orphan")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去处理未登记驱动" }));
    expect(onOpenUnregisteredQueue).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
