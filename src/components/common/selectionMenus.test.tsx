import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColumnFilter } from "@/components/ColumnFilter";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { ModalDialog } from "./ModalDialog";
import { ModuleTreeSelect } from "./ModuleTreeSelect";

describe("selection menus inside a dialog", () => {
  for (const kind of ["tree", "multi", "column"] as const) {
    it(`${kind} consumes Escape before the parent dialog and restores focus`, async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(<ModalDialog open title="编辑模块" onDismiss={onDismiss}>
        {kind === "tree" ? <ModuleTreeSelect label="选择模块" mode="single" nodes={[{ id: "power", name: "电源", parentId: null, path: "power", depth: 0 }]} value="" onChange={vi.fn()} />
          : kind === "multi" ? <MultiSelectDropdown label="选择模块" value={[]} options={[{ value: "power", label: "电源" }]} onChange={vi.fn()} />
            : <ColumnFilter label="选择模块" groupLabel="模块" values={["电源"]} selectedValues={[]} onToggle={vi.fn()} onClear={vi.fn()} />}
      </ModalDialog>);
      const trigger = screen.getByRole("button", { name: /选择模块/ });
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{Escape}");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveFocus();
      expect(onDismiss).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  }
});
