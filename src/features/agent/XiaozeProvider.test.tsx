import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeProvider } from "./XiaozeProvider";

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: ({ children }: { children: React.ReactNode }) => <div data-testid="copilot-kit">{children}</div>,
  CopilotPopup: () => null,
  useAgentContext: vi.fn()
}));

vi.mock("@ag-ui/client", () => ({
  HttpAgent: class MockHttpAgent {
    agentId = "xiaoze";
    constructor(_config: unknown) {}
  }
}));

describe("XiaozeProvider", () => {
  it("renders children inside the provider", () => {
    render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>child</div>
      </XiaozeProvider>
    );
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-kit")).toBeInTheDocument();
  });

  it("passes through children when disabled", () => {
    render(
      <XiaozeProvider enabled={false}>
        <div>plain-child</div>
      </XiaozeProvider>
    );
    expect(screen.getByText("plain-child")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-kit")).not.toBeInTheDocument();
  });
});
