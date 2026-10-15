import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

/** Choose a shared SelectControl option through its visible menu, using the original business value. */
export async function selectControlOption(trigger: HTMLElement, value: string) {
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {});
  await user.click(trigger);
  const options = within(await screen.findByRole("listbox")).getAllByRole("option");
  const option = options.find((candidate) => candidate.getAttribute("data-value") === value);
  if (!option) throw new Error(`Select option not found: ${value}`);
  await user.click(option);
}
