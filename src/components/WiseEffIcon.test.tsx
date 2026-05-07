import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WiseEffIcon } from "./WiseEffIcon";

describe("WiseEffIcon", () => {
  it("renders the full elastic-path W mark with accessible title", () => {
    render(<WiseEffIcon title="WiseEff brand icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff brand icon" });

    expect(icon).toHaveClass("wiseeff-icon");
    expect(icon).toHaveAttribute("viewBox", "0 0 260 260");
    expect(icon.querySelector(".wiseeff-icon-spark")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-node-primary")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-node-secondary")).toBeInTheDocument();
  });

  it("renders a compact favicon variant without the spark", () => {
    render(<WiseEffIcon variant="favicon" title="WiseEff favicon icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff favicon icon" });

    expect(icon).toHaveAttribute("viewBox", "0 0 40 40");
    expect(icon.querySelector(".wiseeff-icon-spark")).not.toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-node-secondary")).not.toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-node-primary")).toBeInTheDocument();
  });

  it("hides decorative icons from assistive technology", () => {
    const { container } = render(<WiseEffIcon decorative />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg?.querySelector("title")).not.toBeInTheDocument();
  });

  it("renders a single-color mark for monochrome contexts", () => {
    render(<WiseEffIcon variant="mono" title="WiseEff monochrome icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff monochrome icon" });

    expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("fill", "none");
    expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("stroke", "currentColor");
    expect(icon.querySelector(".wiseeff-icon-path")).toHaveAttribute("stroke", "currentColor");
    expect(icon.querySelector(".wiseeff-icon-spark")).not.toBeInTheDocument();
  });
});
