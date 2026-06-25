import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeProvider } from "./XiaozeProvider";

vi.mock("./XiaozeCopilotPopup", () => ({
  XiaozeCopilotPopup: () => null
}));

vi.mock("./XiaozePopupOpenPolicy", () => ({
  XiaozePopupOpenPolicy: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: ({
    children,
    enableInspector
  }: {
    children: React.ReactNode;
    enableInspector?: boolean;
  }) => (
    <div data-testid="copilot-kit" data-enable-inspector={String(enableInspector ?? false)}>
      {children}
    </div>
  ),
  CopilotChatConfigurationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CopilotChat: () => null,
  CopilotPopup: () => null,
  UseAgentUpdate: {
    OnMessagesChanged: "OnMessagesChanged"
  },
  useAgent: () => ({
    agent: {
      messages: [],
      setMessages: vi.fn(),
      subscribe: () => ({ unsubscribe: vi.fn() })
    }
  }),
  useAgentContext: vi.fn(),
  useFrontendTool: vi.fn(),
  useInterrupt: vi.fn()
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

  it("keeps the CopilotKit inspector disabled by default", () => {
    render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>child</div>
      </XiaozeProvider>
    );
    expect(screen.getByTestId("copilot-kit")).toHaveAttribute("data-enable-inspector", "false");
  });

  it("enables the CopilotKit inspector when requested", () => {
    render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled enableInspector>
        <div>child</div>
      </XiaozeProvider>
    );
    expect(screen.getByTestId("copilot-kit")).toHaveAttribute("data-enable-inspector", "true");
  });
});
