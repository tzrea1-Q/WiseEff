import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeProvider } from "./XiaozeProvider";

const providerTestDoubles = vi.hoisted(() => ({
  agents: [] as unknown[],
  createXiaozeHttpAgent: vi.fn(() => ({ kind: "xiaoze-agent" }))
}));

vi.mock("./XiaozeCopilotPopup", () => ({
  XiaozeCopilotPopup: () => null
}));

vi.mock("./XiaozePopupOpenPolicy", () => ({
  XiaozePopupOpenPolicy: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: ({
    children,
    enableInspector,
    selfManagedAgents
  }: {
    children: React.ReactNode;
    enableInspector?: boolean;
    selfManagedAgents?: { default?: unknown };
  }) => (
    <div
      data-testid="copilot-kit"
      data-enable-inspector={String(enableInspector ?? false)}
      ref={() => {
        if (selfManagedAgents?.default) {
          providerTestDoubles.agents.push(selfManagedAgents.default);
        }
      }}
    >
      {children}
    </div>
  ),
  CopilotChatConfigurationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCopilotChatConfiguration: () => ({ setModalOpen: vi.fn() }),
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

vi.mock("./xiaozeHttpAgent", () => ({
  clearXiaozeAgentPendingTurn: vi.fn(),
  createXiaozeHttpAgent: providerTestDoubles.createXiaozeHttpAgent
}));

vi.mock("@ag-ui/client", () => ({
  HttpAgent: class MockHttpAgent {
    agentId = "xiaoze";
    constructor(_config: unknown) {}
  }
}));

describe("XiaozeProvider", () => {
  it("keeps one agent instance across provider rerenders", () => {
    providerTestDoubles.agents.length = 0;
    providerTestDoubles.createXiaozeHttpAgent.mockClear();
    const { rerender } = render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>child</div>
      </XiaozeProvider>
    );
    const initialAgent = providerTestDoubles.agents.at(-1);

    rerender(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>updated child</div>
      </XiaozeProvider>
    );

    expect(providerTestDoubles.createXiaozeHttpAgent).toHaveBeenCalledTimes(1);
    expect(providerTestDoubles.agents.at(-1)).toBe(initialAgent);
  });

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
