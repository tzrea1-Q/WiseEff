import { fireEvent, screen, within } from "@testing-library/react";

function getModuleTree() {
  return screen.getByRole("tree");
}

export function expandModuleTreeNode(moduleName: string) {
  const tree = getModuleTree();
  const checkbox = within(tree).getByRole("checkbox", { name: moduleName });
  const option = checkbox.closest(".module-tree-option");
  const expandButton = option?.querySelector("button.module-tree-expand");

  if (expandButton) {
    fireEvent.click(expandButton);
  }
}

export function openModuleTreeFilter(triggerName: RegExp | string = /^模块/) {
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
}

export function selectModuleTreeFilter(moduleName: string, expandNames: string[] = []) {
  openModuleTreeFilter();

  for (const expandName of expandNames) {
    expandModuleTreeNode(expandName);
  }

  fireEvent.click(within(getModuleTree()).getByRole("checkbox", { name: moduleName }));
}
