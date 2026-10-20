import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DecodedFields, decodedValueText } from "./DecodedFields";

afterEach(cleanup);
it("shows nested register fields and meanings under the cited value", () => {
  render(<DecodedFields events={[{ v: 1, source: "declarative", extractor: "charger", file: "charger.log", line: 1,
    fields: { val: { raw: "0x20", value: 32, fields: {
      CHRG_FAULT: { raw: "2", value: 2, meaning: "thermal_shutdown" }, WATCHDOG_FAULT: { raw: "0", value: 0 },
      temperature: { raw: "255", value: -1.5, unit: "°C" }
    } } } }]} />);
  expect(screen.getByText("val = 32")).toHaveAttribute("title", expect.stringContaining("raw=0x20"));
  expect(screen.getByText("CHRG_FAULT = 2 (thermal_shutdown)")).toBeVisible();
  expect(screen.getByText("WATCHDOG_FAULT = 0")).toBeVisible();
  expect(screen.getByText("temperature = -1.5 °C")).toBeVisible();
  expect(screen.getByRole("list", { name: "charger.log:1 · charger · val" })).toBeVisible();
});
it("keeps scalar and bytes rendering and treats meanings as text", () => {
  expect(decodedValueText({ raw: "00ff", value: { hex: "00ff", length: 2 } })).toBe("00ff");
  render(<DecodedFields events={[{ v: 1, source: "declarative", extractor: "x", file: "a.log", line: 1,
    fields: { flag: { raw: "1", value: 1, meaning: "<img src=x>" }, text: "ok" } }]} />);
  expect(screen.getByText("flag = 1 (<img src=x>)")).toBeVisible();
  expect(screen.getByText("text = ok")).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
});
