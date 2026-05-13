import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SlidersHorizontal } from "lucide-react";
import { SubAppCard } from "./SubAppCard";

afterEach(cleanup);

const baseProps = {
  accent: "#2857FF",
  icon: SlidersHorizontal,
  kicker: "配置治理",
  title: "参数管理",
  description: "跨项目统一查询、对比充电/电池参数，提交并审阅变更。",
  chips: ["查询对比", "提交变更", "审阅合入"],
  primary: { label: "进入参数首页", href: "/parameter-home" },
  secondary: { label: "打开参数管理后台", href: "/parameter-admin" }
};

describe("SubAppCard", () => {
  it("renders the title, description, and 3 chips", () => {
    render(<SubAppCard {...baseProps} />);

    expect(screen.getByRole("heading", { name: "参数管理", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("跨项目统一查询、对比充电/电池参数，提交并审阅变更。")).toBeInTheDocument();
    expect(screen.getByText("配置治理")).toBeInTheDocument();
    const chips = screen.getAllByRole("listitem");
    expect(chips.map((item) => item.textContent)).toEqual(["查询对比", "提交变更", "审阅合入"]);
  });

  it("renders the primary CTA as a link to the target route", () => {
    render(<SubAppCard {...baseProps} />);

    const primary = screen.getByRole("link", { name: /进入参数首页/ });
    expect(primary).toHaveAttribute("href", "/parameter-home");
    expect(primary).toHaveClass("sub-app-card-primary");
  });

  it("renders the secondary CTA as a link to the admin route", () => {
    render(<SubAppCard {...baseProps} />);

    const secondary = screen.getByRole("link", { name: /打开参数管理后台/ });
    expect(secondary).toHaveAttribute("href", "/parameter-admin");
    expect(secondary).toHaveClass("sub-app-card-secondary");
  });

  it("does not render a status badge in the card header", () => {
    render(<SubAppCard {...baseProps} />);

    expect(screen.queryByLabelText(/当前状态/)).not.toBeInTheDocument();
    expect(screen.queryByText("条待审阅")).not.toBeInTheDocument();
  });

  it("groups the primary and secondary actions under the card operation area", () => {
    render(<SubAppCard {...baseProps} />);

    const actions = screen.getByLabelText("参数管理 操作");
    expect(actions).toHaveClass("sub-app-card-ctas");
    expect(actions).toContainElement(screen.getByRole("link", { name: /进入参数首页/ }));
    expect(actions).toContainElement(screen.getByRole("link", { name: /打开参数管理后台/ }));
  });

  it("exposes the accent color as a CSS custom property", () => {
    render(<SubAppCard {...baseProps} />);

    const article = screen.getByRole("article", { name: "参数管理" });
    expect(article.style.getPropertyValue("--sub-app-accent")).toBe("#2857FF");
  });
});
