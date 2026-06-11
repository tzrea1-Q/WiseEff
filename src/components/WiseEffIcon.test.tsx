import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WiseEffIcon } from "./WiseEffIcon";

afterEach(() => {
  cleanup();
});

describe("WiseEffIcon", () => {
  it("renders the full thunder marsh mark with accessible title", () => {
    render(<WiseEffIcon title="WiseEff brand icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff brand icon" });

    expect(icon).toHaveClass("wiseeff-icon");
    expect(icon).toHaveAttribute("viewBox", "0 0 260 260");
    expect(icon.querySelector(".wiseeff-icon-bolt")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-primary")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-secondary")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-tertiary")).toBeInTheDocument();
  });

  it("uses unique gradient references for each full icon instance", () => {
    render(
      <>
        <WiseEffIcon title="First WiseEff icon" />
        <WiseEffIcon title="Second WiseEff icon" />
      </>
    );

    const firstIcon = screen.getByRole("img", { name: "First WiseEff icon" });
    const secondIcon = screen.getByRole("img", { name: "Second WiseEff icon" });
    const firstBgId = firstIcon.querySelector("linearGradient")?.getAttribute("id");
    const firstBoltId = firstIcon.querySelectorAll("linearGradient")[1]?.getAttribute("id");
    const secondBgId = secondIcon.querySelector("linearGradient")?.getAttribute("id");
    const secondBoltId = secondIcon.querySelectorAll("linearGradient")[1]?.getAttribute("id");

    expect(firstBgId).toBeTruthy();
    expect(firstBoltId).toBeTruthy();
    expect(secondBgId).toBeTruthy();
    expect(secondBoltId).toBeTruthy();
    expect(firstBgId).not.toBe(secondBgId);
    expect(firstBoltId).not.toBe(secondBoltId);
    expect(firstIcon.querySelector(".wiseeff-icon-container")).toHaveAttribute("fill", `url(#${firstBgId})`);
    expect(firstIcon.querySelector(".wiseeff-icon-bolt")).toHaveAttribute("fill", `url(#${firstBoltId})`);
    expect(secondIcon.querySelector(".wiseeff-icon-container")).toHaveAttribute("fill", `url(#${secondBgId})`);
    expect(secondIcon.querySelector(".wiseeff-icon-bolt")).toHaveAttribute("fill", `url(#${secondBoltId})`);
  });

  it("renders a compact favicon variant with a simplified marsh wave", () => {
    render(<WiseEffIcon variant="favicon" title="WiseEff favicon icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff favicon icon" });

    expect(icon).toHaveAttribute("viewBox", "0 0 40 40");
    expect(icon.querySelector(".wiseeff-icon-bolt")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-primary")).toBeInTheDocument();
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-secondary")).not.toBeInTheDocument();
  });

  it("hides decorative icons from assistive technology", () => {
    const { container } = render(<WiseEffIcon decorative />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg?.querySelector("title")).not.toBeInTheDocument();
  });

  it("keeps decorative icons hidden even when consumer aria props conflict", () => {
    const { container } = render(<WiseEffIcon decorative aria-hidden={false} aria-label="visible" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a single-color mark for monochrome contexts", () => {
    render(<WiseEffIcon variant="mono" title="WiseEff monochrome icon" />);

    const icon = screen.getByRole("img", { name: "WiseEff monochrome icon" });

    expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("fill", "none");
    expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("stroke", "currentColor");
    expect(icon.querySelector(".wiseeff-icon-bolt")).toHaveAttribute("fill", "currentColor");
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-primary")).toHaveAttribute("stroke", "currentColor");
    expect(icon.querySelector(".wiseeff-icon-marsh-wave-tertiary")).not.toBeInTheDocument();
  });
});
