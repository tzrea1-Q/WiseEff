import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useXiaozeSuggestions } from "./useXiaozeSuggestions";
import { XiaozePageContext } from "./xiaozePageContext";

vi.mock("./xiaozeHttpAgent", () => ({
  resolveXiaozeAuthorizationHeader: vi.fn().mockResolvedValue("Bearer test")
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
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: [{ id: "s1", tone: "warning", headline: "3 pending review", meta: "Project p1" }] })
      })
    );
  });

  it("fetches suggestions when enabled", async () => {
    render(
      <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(screen.getByText("3 pending review")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalled();
  });

  it("fetches nothing when disabled", async () => {
    render(
      <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "p1" }}>
        <SuggestionsProbe enabled={false} />
      </XiaozePageContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
