import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageInsightBar } from "./PageInsightBar";

describe("PageInsightBar", () => {
  const defaultProps = {
    severity: "info" as const,
    headline: "检测到 1 份日志解析失败",
    actions: [{ label: "定位失败记录", onClick: vi.fn(), tone: "primary" as const }]
  };

  it("renders headline and actions", () => {
    render(<PageInsightBar {...defaultProps} />);

    expect(screen.getByText("检测到 1 份日志解析失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "定位失败记录" })).toBeInTheDocument();
  });

  it("renders with role=status for info severity", () => {
    render(<PageInsightBar {...defaultProps} severity="info" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders with role=alert for error severity", () => {
    render(<PageInsightBar {...defaultProps} severity="error" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("triggers onClick on action button", async () => {
    const onClick = vi.fn();

    render(<PageInsightBar {...defaultProps} actions={[{ label: "Go", onClick }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders dismiss button when onDismiss provided and triggers it", async () => {
    const onDismiss = vi.fn();

    render(<PageInsightBar {...defaultProps} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /关闭|dismiss/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not render dismiss button when onDismiss is undefined", () => {
    render(<PageInsightBar {...defaultProps} />);

    expect(screen.queryByRole("button", { name: /关闭|dismiss/i })).not.toBeInTheDocument();
  });

  it("renders description if provided", () => {
    render(<PageInsightBar {...defaultProps} description="建议立即查看" />);

    expect(screen.getByText("建议立即查看")).toBeInTheDocument();
  });

  it("applies different styling per severity", () => {
    const { container, rerender } = render(<PageInsightBar {...defaultProps} severity="info" />);
    const infoClass = (container.firstChild as HTMLElement).className;

    rerender(<PageInsightBar {...defaultProps} severity="error" />);

    expect((container.firstChild as HTMLElement).className).not.toEqual(infoClass);
  });
});
