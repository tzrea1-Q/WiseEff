import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppFooterConfig } from "@/config/appFooterConfig";
import { AppFooter } from "./AppFooter";

const config: AppFooterConfig = {
  contact: null,
  copyrightOwner: "雷泽（WiseEff）",
  version: "v0.1.0"
};

describe("AppFooter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes an application page with ownership, version, and product feedback", () => {
    const onFeedback = vi.fn();

    render(<AppFooter config={config} onFeedback={onFeedback} />);

    const footer = screen.getByLabelText("页脚信息", { selector: "footer" });
    expect(footer).toHaveTextContent("© 2026 雷泽（WiseEff）");
    expect(footer).toHaveTextContent("版本 v0.1.0");

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));
    expect(onFeedback).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "联系我们" })).not.toBeInTheDocument();
  });

  it("opens an HTTPS contact safely outside the application", () => {
    render(
      <AppFooter
        config={{ ...config, contact: { href: "https://support.example.com", kind: "https" } }}
        onFeedback={vi.fn()}
      />
    );

    expect(screen.getByRole("link", { name: "联系我们" })).toHaveAttribute("href", "https://support.example.com");
    expect(screen.getByRole("link", { name: "联系我们" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "联系我们" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hands a mail contact to the system without forcing a browser tab", () => {
    render(
      <AppFooter
        config={{ ...config, contact: { href: "mailto:support@example.com", kind: "mailto" } }}
        onFeedback={vi.fn()}
      />
    );

    const contact = screen.getByRole("link", { name: "联系我们" });
    expect(contact).toHaveAttribute("href", "mailto:support@example.com");
    expect(contact).not.toHaveAttribute("target");
    expect(contact).not.toHaveAttribute("rel");
  });

  it("renders homepage metadata without nesting another footer landmark", () => {
    render(<AppFooter config={config} onFeedback={vi.fn()} variant="homepage" />);

    expect(screen.queryByLabelText("页脚信息", { selector: "footer" })).not.toBeInTheDocument();
    expect(screen.getByText("© 2026 雷泽（WiseEff）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "问题反馈" })).toBeInTheDocument();
  });
});
