import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import * as defaultApiClient from "@/infrastructure/http/defaultApiClient";
import { requestXiaozeSuggestions } from "@/infrastructure/http/xiaozeSuggestionsClient";
import { useXiaozeSuggestions } from "./useXiaozeSuggestions";
import { XiaozePageContext } from "./xiaozePageContext";

vi.mock("@/infrastructure/http/xiaozeSuggestionsClient", () => ({
  requestXiaozeSuggestions: vi.fn()
}));

function SuggestionsProbe({ enabled, organizationId }: { enabled: boolean; organizationId?: string }) {
  const { insights, dismiss } = useXiaozeSuggestions({ enabled, organizationId });
  return (
    <div>
      <span data-testid="count">{insights.length}</span>
      {insights.map((item) => (
        <div key={item.id}>
          <span>{item.headline}</span>
          <button type="button" onClick={() => dismiss(item.id)}>
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

describe("useXiaozeSuggestions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(defaultApiClient, "createDefaultApiClient");
    vi.mocked(requestXiaozeSuggestions).mockResolvedValue([
      {
        id: "s1",
        tone: "warning",
        headline: "有 3 条参数变更待审阅",
        meta: "项目：Demo 项目",
        citations: []
      }
    ]);
  });

  it("fetches suggestions when enabled", async () => {
    render(
      <XiaozePageContext.Provider
        value={{ path: "/parameters", pageKey: "parameters", projectId: "p1", projectName: "Demo 项目" }}
      >
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(screen.getByText("有 3 条参数变更待审阅")).toBeInTheDocument());
    expect(requestXiaozeSuggestions).toHaveBeenCalledWith({
      path: "/parameters",
      pageKey: "parameters",
      projectId: "p1",
      projectName: "Demo 项目"
    }, vi.mocked(defaultApiClient.createDefaultApiClient).mock.results[0]?.value, expect.any(AbortSignal));
    expect(defaultApiClient.createDefaultApiClient).toHaveBeenCalledWith({ organizationId: undefined });
  });

  it("binds suggestions to the explicit organization client", async () => {
    render(<XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
      <SuggestionsProbe enabled organizationId="target-organization" />
    </XiaozePageContext.Provider>);
    await waitFor(() => expect(screen.getByText("有 3 条参数变更待审阅")).toBeInTheDocument());
    expect(defaultApiClient.createDefaultApiClient).toHaveBeenCalledWith({ organizationId: "target-organization" });
    expect(vi.mocked(requestXiaozeSuggestions).mock.calls[0]?.[1]).toBe(vi.mocked(defaultApiClient.createDefaultApiClient).mock.results[0]?.value);
  });

  it("fetches nothing when disabled", async () => {
    render(
      <XiaozePageContext.Provider
        value={{ path: "/parameters", pageKey: "parameters", projectId: "p1", projectName: "Demo 项目" }}
      >
        <SuggestionsProbe enabled={false} />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(requestXiaozeSuggestions).not.toHaveBeenCalled();
  });

  it("fetches nothing when the page does not support proactive insights", async () => {
    render(
      <XiaozePageContext.Provider value={{ path: "/parameter-home", pageKey: "parameter-home", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(requestXiaozeSuggestions).not.toHaveBeenCalled();
  });

  it("fails closed and reports typed client errors", async () => {
    const error = new WiseEffApiError(
      "INTERNAL_ERROR",
      "XiaozeSuggestResponse contract validation failed.",
      { reason: "contract-drift", schemaName: "XiaozeSuggestResponse" },
      ""
    );
    vi.mocked(requestXiaozeSuggestions).mockRejectedValueOnce(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(report).toHaveBeenCalledWith("Failed to load Xiaoze suggestions.", error);
  });

  it("does not log an aborted request as an error", async () => {
    vi.mocked(requestXiaozeSuggestions).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      render(<XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>);
    });
    expect(requestXiaozeSuggestions).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("aborts on unmount and ignores a late fetch rejection", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<Awaited<ReturnType<typeof requestXiaozeSuggestions>>>((_resolve, rejectPending) => { reject = rejectPending; });
    vi.mocked(requestXiaozeSuggestions).mockReturnValueOnce(pending);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { unmount } = render(
      <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );
    await waitFor(() => expect(requestXiaozeSuggestions).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(requestXiaozeSuggestions).mock.calls[0]![2]!;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => reject(new TypeError("Failed to fetch")));

    expect(report).not.toHaveBeenCalled();
  });

  it("aborts on pagehide so a fetch broken by page unload is not logged", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<Awaited<ReturnType<typeof requestXiaozeSuggestions>>>((_resolve, rejectPending) => { reject = rejectPending; });
    vi.mocked(requestXiaozeSuggestions).mockReturnValueOnce(pending);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );
    await waitFor(() => expect(requestXiaozeSuggestions).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(requestXiaozeSuggestions).mock.calls[0]![2]!;

    window.dispatchEvent(new Event("pagehide"));
    expect(signal.aborted).toBe(true);
    await act(async () => reject(new TypeError("Failed to fetch")));

    expect(report).not.toHaveBeenCalled();
  });
});
