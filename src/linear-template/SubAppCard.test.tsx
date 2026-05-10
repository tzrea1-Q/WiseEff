import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SlidersHorizontal } from "lucide-react";
import { SubAppCard } from "./SubAppCard";

afterEach(cleanup);

const baseProps = {
  accent: "#2857FF",
  icon: SlidersHorizontal,
  title: "参数管理",
  description: "跨项目统一查询、对比充电/电池参数，提交并审阅变更。",
  chips: ["查询对比", "提交变更", "审阅合入"],
  primary: { label: "进入参数首页", href: "/parameter-home" },
  secondary: { label: "打开参数管理后台", href: "/parameter-admin" },
  badge: { count: 1, label: "1 条待审阅" }
};

describe("SubAppCard", () => {
  it("renders the title, description, and 3 chips", () => {
    render(<SubAppCard {...baseProps} />);

    expect(screen.getByRole("heading", { name: "参数管理", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("跨项目统一查询、对比充电/电池参数，提交并审阅变更。")).toBeInTheDocument();
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

  it("renders the active badge with aria-label", () => {
    render(<SubAppCard {...baseProps} />);

    const badge = screen.getByLabelText("1 条待审阅");
    expect(badge).toHaveClass("sub-app-card-badge");
    expect(badge).not.toHaveClass("sub-app-card-badge-empty");
  });

  it("applies the empty modifier when badge count is 0", () => {
    render(<SubAppCard {...baseProps} badge={{ count: 0, label: "暂无待办" }} />);

    const badge = screen.getByLabelText("暂无待办");
    expect(badge).toHaveClass("sub-app-card-badge-empty");
  });

  it("exposes the accent color as a CSS custom property", () => {
    render(<SubAppCard {...baseProps} />);

    const article = screen.getByRole("article", { name: "参数管理" });
    expect(article.style.getPropertyValue("--sub-app-accent")).toBe("#2857FF");
  });
});
