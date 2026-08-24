import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  }) => {
    if (selfManagedAgents?.default) {
      providerTestDoubles.agents.push(selfManagedAgents.default);
    }
    return (
      <div data-testid="copilot-kit" data-enable-inspector={String(enableInspector ?? false)}>
        {children}
      </div>
    );
  },
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
  beforeEach(() => {
    providerTestDoubles.agents.length = 0;
    providerTestDoubles.createXiaozeHttpAgent.mockClear();
  });

  it("keeps one agent instance across provider rerenders", () => {
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

  it("creates a new agent when agentUrl changes", () => {
    const { rerender } = render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>child</div>
      </XiaozeProvider>
    );
    const initialAgent = providerTestDoubles.agents.at(-1);

    rerender(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze?variant=next" enabled>
        <div>child</div>
      </XiaozeProvider>
    );

    expect(providerTestDoubles.createXiaozeHttpAgent).toHaveBeenCalledTimes(2);
    expect(providerTestDoubles.agents.at(-1)).not.toBe(initialAgent);
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

  it("does not create an agent while disabled", () => {
    render(
      <XiaozeProvider enabled={false}>
        <div>plain-child</div>
      </XiaozeProvider>
    );

    expect(providerTestDoubles.createXiaozeHttpAgent).not.toHaveBeenCalled();
  });

  it("supports disabled to enabled to disabled without a Hook order error", () => {
    const { rerender } = render(
      <XiaozeProvider enabled={false}>
        <div>plain-child</div>
      </XiaozeProvider>
    );

    expect(() => {
      rerender(
        <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
          <div>enabled-child</div>
        </XiaozeProvider>
      );
    }).not.toThrow();

    expect(() => {
      rerender(
        <XiaozeProvider enabled={false}>
          <div>plain-child-again</div>
        </XiaozeProvider>
      );
    }).not.toThrow();

    expect(screen.getByText("plain-child-again")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-kit")).not.toBeInTheDocument();
  });

  it("supports enabled to disabled without a Hook order error", () => {
    const { rerender } = render(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>enabled-child</div>
      </XiaozeProvider>
    );

    expect(() => {
      rerender(
        <XiaozeProvider enabled={false}>
          <div>plain-child</div>
        </XiaozeProvider>
      );
    }).not.toThrow();

    expect(screen.getByText("plain-child")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-kit")).not.toBeInTheDocument();
  });

  it("works and creates a fresh agent when re-enabled", () => {
    const { rerender } = render(
      <XiaozeProvider enabled={false}>
        <div>plain-child</div>
      </XiaozeProvider>
    );

    rerender(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>enabled-child</div>
      </XiaozeProvider>
    );
    const firstEnabledAgent = providerTestDoubles.agents.at(-1);

    rerender(
      <XiaozeProvider enabled={false}>
        <div>plain-child-again</div>
      </XiaozeProvider>
    );
    rerender(
      <XiaozeProvider agentUrl="/api/v1/agent/xiaoze" enabled>
        <div>enabled-child-again</div>
      </XiaozeProvider>
    );

    expect(providerTestDoubles.createXiaozeHttpAgent).toHaveBeenCalledTimes(2);
    expect(providerTestDoubles.agents.at(-1)).not.toBe(firstEnabledAgent);
    expect(screen.getByTestId("copilot-kit")).toBeInTheDocument();
    expect(screen.getByText("enabled-child-again")).toBeInTheDocument();
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
