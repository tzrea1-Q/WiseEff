import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeTurnReasoningPanel } from "./XiaozeTurnReasoningPanel";

vi.mock("@/infrastructure/http/runtimeMode", () => ({
  xiaozeReasoningDevExpanded: false
}));

vi.mock("./XiaozeRunTimingContext", () => ({
  useXiaozeRunTiming: () => ({ durationMs: 3200 })
}));

describe("XiaozeTurnReasoningPanel", () => {
  it("expands to show reasoning content after the turn completes", () => {
    render(
      <XiaozeTurnReasoningPanel
        content="The user is asking about charge parameters."
        isStreaming={false}
        reasoningMessageId="r1"
      />
    );

    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/The user is asking/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /已思考/ }));

    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/The user is asking/)).toBeInTheDocument();
  });

  it("keeps the panel open while streaming", () => {
    render(
      <XiaozeTurnReasoningPanel content="Still thinking..." isStreaming reasoningMessageId="r1" />
    );

    expect(screen.getByRole("button", { name: "思考中…" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Still thinking...")).toBeInTheDocument();
  });
});
