import { fireEvent, screen, within } from "@testing-library/react";

function getModuleTree() {
  return screen.getByRole("tree");
}

export function expandModuleTreeNode(moduleName: string) {
  const tree = getModuleTree();
  const checkbox = within(tree).queryByRole("checkbox", { name: moduleName });
  // ColumnFilter hides a sole structural root; its children are already visible
  // at the tree's top level and do not need the hidden root expanded first.
  if (!checkbox) return;
  const option = checkbox.closest<HTMLElement>('[role="treeitem"]');
  const expandButton = option ? within(option).queryByRole("button", { name: "展开" }) : null;

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
