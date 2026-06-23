import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateDebugParameterDialog } from "./CreateDebugParameterDialog";

describe("CreateDebugParameterDialog", () => {
  it("renders create dialog fields", () => {
    render(
      <CreateDebugParameterDialog
        open
        isApiMode
        canEdit
        loading={false}
        existingParameters={[]}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "创建调试参数" })).toBeInTheDocument();
    expect(screen.getByText("标识信息")).toBeInTheDocument();
    expect(screen.getByLabelText("调试目标值")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
  });

  it("calls onCreate with default HDC/ADB bindings", () => {
    const onCreate = vi.fn();
    render(
      <CreateDebugParameterDialog
        open
        isApiMode
        canEdit
        loading={false}
        existingParameters={[]}
        onCreate={onCreate}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const createdDraft = onCreate.mock.calls[0][0];
    expect(createdDraft.bindings).toHaveLength(2);
    expect(createdDraft.bindings[0].protocol).toBe("hdc");
    expect(createdDraft.bindings[1].protocol).toBe("adb");
  });
});
