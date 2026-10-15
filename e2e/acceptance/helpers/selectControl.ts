import type { Locator } from "playwright/test";

/** Choose through the visible shared menu, preserving original business values. */
export async function selectControlOption(trigger: Locator, value: string | { label: string }) {
  await trigger.click();
  const listbox = trigger.page().getByRole("listbox");
  await listbox.waitFor({ state: "visible" });
  if (typeof value !== "string") {
    await listbox.getByRole("option", { name: value.label, exact: true }).click();
    return;
  }
  const options = listbox.getByRole("option");
  const index = await options.evaluateAll((elements, requested) =>
    elements.findIndex((element) => element.getAttribute("data-value") === requested), value);
  if (index < 0) throw new Error(`Select option not found: ${value}`);
  await options.nth(index).click();
}

/** Inspect the visible menu without changing the current selection. */
export async function readSelectControlOptions(trigger: Locator) {
  await trigger.click();
  const listbox = trigger.page().getByRole("listbox");
  await listbox.waitFor({ state: "visible" });
  try {
    return await listbox.getByRole("option").evaluateAll((elements) => elements.map((element) => ({
      value: element.getAttribute("data-value") ?? "",
      label: element.textContent?.trim() ?? "",
      disabled: element.getAttribute("aria-disabled") === "true"
    })));
  } finally {
    await listbox.press("Escape");
    await listbox.waitFor({ state: "hidden" });
  }
}
