import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TabPanel } from "./tab-panel";

describe("TabPanel keyboard entry", () => {
  it("lets keyboard users reach a text-only panel", async () => {
    const user = userEvent.setup();
    render(<><button>Before</button><TabPanel aria-label="Details">No requests</TabPanel></>);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: "Details" })).toHaveFocus();
  });

  it("enters controls directly and restores panel focus when they disappear", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TabPanel aria-label="Details"><button>Refresh</button></TabPanel>);
    expect(screen.getByRole("tabpanel")).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveFocus();
    rerender(<TabPanel aria-label="Details">No requests</TabPanel>);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });

  it.each([
    <button disabled>Refresh</button>,
    <button tabIndex={-1}>Refresh</button>,
    <div hidden><button>Refresh</button></div>,
    <div style={{ display: "none" }}><button>Refresh</button></div>
  ])("keeps a panel reachable when its controls cannot be tabbed to (%#)", (content) => {
    render(<TabPanel aria-label="Details">{content}</TabPanel>);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });

  it("restores focusability when a descendant independently removes its control", async () => {
    const user = userEvent.setup();
    function Refresh() {
      const [refreshed, setRefreshed] = useState(false);
      return refreshed ? <p>No requests</p> : <button onClick={() => setRefreshed(true)}>Refresh</button>;
    }
    render(<TabPanel aria-label="Details"><Refresh /></TabPanel>);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0"));
  });

  it("keeps hidden panels and non-panel containers out of the tab order", () => {
    const { container } = render(<><TabPanel hidden>Inactive</TabPanel><TabPanel role={undefined}>Accounts without tabs</TabPanel></>);
    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});
