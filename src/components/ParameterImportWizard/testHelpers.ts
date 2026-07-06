import { fireEvent, within, type HTMLElement } from "@testing-library/react";
import { screen } from "@testing-library/react";

export function fillPasteImportContent(scope: HTMLElement, value: string) {
  const entryButton = within(scope).queryByRole("button", { name: "粘贴 JSON / CSV / DTS 内容" });
  if (entryButton) {
    fireEvent.click(entryButton);
  } else {
    fireEvent.click(within(scope).getByRole("button", { name: "编辑" }));
  }

  const pasteDialog = screen.getByRole("dialog", { name: "粘贴导入内容" });
  fireEvent.change(within(pasteDialog).getByLabelText("导入内容"), { target: { value } });
  fireEvent.click(within(pasteDialog).getByRole("button", { name: "确认" }));
}
