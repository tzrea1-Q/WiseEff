import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { requestXiaozeSuggestions } from "@/infrastructure/http/xiaozeSuggestionsClient";
import { useXiaozeSuggestions } from "./useXiaozeSuggestions";
import { XiaozePageContext } from "./xiaozePageContext";

vi.mock("@/infrastructure/http/xiaozeSuggestionsClient", () => ({
  requestXiaozeSuggestions: vi.fn()
}));

function SuggestionsProbe({ enabled }: { enabled: boolean }) {
  const { insights, dismiss } = useXiaozeSuggestions({ enabled });
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
    });
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
});
