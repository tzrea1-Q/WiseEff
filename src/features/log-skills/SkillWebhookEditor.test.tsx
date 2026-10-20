import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillWebhookEditor } from "./SkillWebhookEditor";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
afterEach(cleanup);
function createLogActions(overrides: Partial<LogAnalysisRepository>) {
  return { listLogDomainWebhookDeliveries: vi.fn().mockResolvedValue([]), setLogDomainWebhook: vi.fn().mockResolvedValue(webhookDomain), sendLogDomainWebhookTest: vi.fn(), ...overrides } as Required<Pick<LogAnalysisRepository, "listLogDomainWebhookDeliveries" | "setLogDomainWebhook" | "sendLogDomainWebhookTest">>;
}
const webhookDomain = {
    id: "domain-charging",
    name: "charging-power",
    description: "充电/电源子系统内核日志",
    status: "active" as const,
    formatProfile: undefined,
    modelOverride: "gpt-4o",
    webhook: {
      enabled: true,
      url: "https://hooks.example.com/wiseeff",
      secretConfigured: true,
      secretLastFour: "cdef"
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  };
describe("workspace result webhook", () => {
  it("rotates the write-only secret and respects read-only access", async () => {
    const logActions = createLogActions({});
    const { rerender } = render(<SkillWebhookEditor domain={webhookDomain} logActions={logActions} onSaved={async () => undefined} />);
    const secret = screen.getByLabelText(/签名密钥/);
    expect(secret).toHaveValue("");
    fireEvent.change(secret, { target: { value: "rotated-signing-secret" } });
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => expect(logActions.setLogDomainWebhook).toHaveBeenCalledWith(expect.objectContaining({ secret: "rotated-signing-secret" })));
    expect(secret).toHaveValue("");
    expect(screen.queryByText("rotated-signing-secret")).not.toBeInTheDocument();
    rerender(<SkillWebhookEditor domain={webhookDomain} logActions={logActions} onSaved={async () => undefined} disabled />);
    expect(secret).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送测试投递" })).toBeDisabled();
  });

  it("opens the webhook editor, saves config without echoing the secret, and lists recent deliveries", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([webhookDomain]),
      setLogDomainWebhook: vi.fn().mockResolvedValue(webhookDomain),
      listLogDomainWebhookDeliveries: vi.fn().mockResolvedValue([
        {
          id: "delivery-1",
          logDomainId: "domain-charging",
          logRecordId: "log-1",
          runId: "run-1",
          kind: "result" as const,
          attempt: 1,
          status: "delivered" as const,
          httpStatus: 200,
          createdAt: "2026-08-13T02:00:00.000Z"
        },
        {
          id: "delivery-2",
          logDomainId: "domain-charging",
          kind: "test" as const,
          attempt: 1,
          status: "failed" as const,
          error: "Receiver responded with HTTP 500.",
          createdAt: "2026-08-13T01:00:00.000Z"
        }
      ])
    });
    render(<SkillWebhookEditor domain={webhookDomain} logActions={logActions} onSaved={async () => undefined} />);

    const editor = await screen.findByTestId("domain-webhook-editor");
    const enabled = within(editor).getByRole("checkbox", { name: "启用结果回调" });
    expect(enabled.closest("label")).toHaveClass("skill-webhook-toggle");
    await userEvent.click(within(editor).getByText("启用结果回调", { selector: "label" }));
    expect(enabled).not.toBeChecked();
    await userEvent.click(within(editor).getByText("启用结果回调", { selector: "label" }));
    expect(enabled).toBeChecked();
    await waitFor(() => expect(logActions.listLogDomainWebhookDeliveries).toHaveBeenCalledWith("domain-charging", 10));
    // The secret never renders; only configured-state + last four characters do.
    expect(editor).toHaveTextContent("已配置 · 末四位 cdef");
    const deliveries = within(editor).getByTestId("domain-webhook-deliveries");
    expect(deliveries).toHaveTextContent("已送达");
    expect(deliveries).toHaveTextContent("HTTP 200");
    expect(deliveries).toHaveTextContent("投递失败");

    const urlInput = within(editor).getByLabelText("回调地址");
    expect(urlInput).toHaveAccessibleDescription("仅支持 HTTPS；禁止私网、环回、链路本地和元数据地址。");
    expect(deliveries).not.toHaveTextContent("Receiver responded");
    expect(deliveries).toHaveTextContent("回调服务暂不可用");
    expect(deliveries.textContent).toMatch(/2026\/08\/1[23] \d{2}:00/);
    await userEvent.clear(urlInput);
    await userEvent.click(urlInput);
    await userEvent.paste("https://hooks.example.com/updated");
    await userEvent.click(within(editor).getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(logActions.setLogDomainWebhook).toHaveBeenCalledWith({
        domainId: "domain-charging",
        url: "https://hooks.example.com/updated",
        enabled: true
      })
    );
    expect(await within(editor).findByRole("status")).toHaveTextContent("配置已保存");
  });

  it("sends a test delivery and reports the outcome inline", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([webhookDomain]),
      sendLogDomainWebhookTest: vi.fn().mockResolvedValue({ status: "delivered", attempts: 1, httpStatus: 200 })
    });
    render(<SkillWebhookEditor domain={webhookDomain} logActions={logActions} onSaved={async () => undefined} />);
    const editor = await screen.findByTestId("domain-webhook-editor");
    await userEvent.click(within(editor).getByRole("button", { name: "发送测试投递" }));

    await waitFor(() => expect(logActions.sendLogDomainWebhookTest).toHaveBeenCalledWith("domain-charging"));
    expect(await within(editor).findByRole("status")).toHaveTextContent("测试投递成功（HTTP 200）");
    // The list refreshes after a test delivery (initial load + refresh).
    expect(logActions.listLogDomainWebhookDeliveries).toHaveBeenCalledTimes(2);
  });

  it.each(["skipped", "failed"] as const)("explains %s test deliveries without exposing provider errors", async (status) => {
    const logActions = createLogActions({ sendLogDomainWebhookTest: vi.fn().mockResolvedValue({ status, error: "RAW_PROVIDER_FAILURE" }) });
    render(<SkillWebhookEditor domain={webhookDomain} logActions={logActions} onSaved={async () => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "发送测试投递" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(status === "skipped" ? "测试投递未执行，请检查回调配置。" : "测试投递失败，请检查回调服务后重试。");
    expect(screen.queryByText("RAW_PROVIDER_FAILURE")).not.toBeInTheDocument();
  });
});

