import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecomputeBindingsResultDialog } from "./RecomputeBindingsResultDialog";

afterEach(() => cleanup());

describe("RecomputeBindingsResultDialog", () => {
  it("reports updated count and empty-state guidance when nothing changed", () => {
    const onClose = vi.fn();
    render(
      <RecomputeBindingsResultDialog
        result={{ updated: 0, conflicts: [] }}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "全量重算结果" });
    expect(dialog).toHaveTextContent("更新的项目参数");
    expect(dialog).toHaveTextContent("0");
    expect(dialog).toHaveTextContent("没有项目参数需要改写模块归属");

    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists conflicts when present", () => {
    render(
      <RecomputeBindingsResultDialog
        result={{
          updated: 2,
          conflicts: ["binding-1: unique key collision"],
          preview: {
            affectedBindings: 2,
            byProject: [{ projectId: "proj-aurora", count: 2 }],
            fromModules: [],
            toModuleId: null,
            emptiedModules: [],
            conflicts: []
          }
        }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "全量重算结果" })).toHaveTextContent("2");
    expect(screen.getByText("proj-aurora")).toBeInTheDocument();
    expect(screen.getByText("binding-1: unique key collision")).toBeInTheDocument();
  });
});
