import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddUserDialog } from "./AddUserDialog";

describe("AddUserDialog", () => {
  it("renders nothing when open=false", () => {
    render(<AddUserDialog open={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText("姓名")).not.toBeInTheDocument();
  });

  it("renders form fields when open", () => {
    render(<AddUserDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("姓名")).toBeInTheDocument();
    expect(screen.getByLabelText("职位")).toBeInTheDocument();
    expect(screen.getByLabelText(/角色/)).toBeInTheDocument();
  });

  it("submits with form values", async () => {
    const onSubmit = vi.fn();
    render(<AddUserDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("姓名"), "Test User");
    await userEvent.type(screen.getByLabelText("职位"), "QA");
    await userEvent.selectOptions(screen.getByLabelText(/角色/), "Admin");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Test User",
      title: "QA",
      role: "Admin"
    });
  });

  it("prevents submit when name is empty", async () => {
    const onSubmit = vi.fn();
    render(<AddUserDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes on cancel button", async () => {
    const onOpenChange = vi.fn();
    render(<AddUserDialog open onOpenChange={onOpenChange} onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits default role=Editor when not changed", async () => {
    const onSubmit = vi.fn();
    render(<AddUserDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("姓名"), "Alice");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Alice",
      title: "",
      role: "Editor"
    });
  });
});
