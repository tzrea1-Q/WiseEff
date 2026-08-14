import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

describe("ConfirmDialog", () => {
  it("keeps footer actions outside the scroll region when description content is very tall (TD-084)", () => {
    const tallDescription = (
      <div data-testid="tall-content">
        {Array.from({ length: 120 }, (_, index) => (
          <p key={index}>补偿性恢复参数行 {index + 1}</p>
        ))}
      </div>
    );

    render(
      <ConfirmDialog
        open
        title="确认部署"
        description={tallDescription}
        confirmLabel="确认部署"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "确认部署" });
    const scrollRegion = dialog.querySelector(".confirm-dialog__scroll");
    const footer = dialog.querySelector(".dialog-actions");

    expect(scrollRegion).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(scrollRegion).toContainElement(screen.getByTestId("tall-content"));
    expect(footer).toContainElement(screen.getByRole("button", { name: "确认部署" }));
    expect(footer).toContainElement(screen.getByRole("button", { name: "取消" }));
    expect(scrollRegion?.contains(footer ?? null)).toBe(false);
  });

  it("still confirms and cancels through the footer actions", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="删除草稿"
        description="此操作不可撤销。"
        confirmLabel="确认删除"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
