import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DtsSearchHit, DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { DtsSearchPanel } from "./DtsSearchPanel";

const PROJECT_ID = "project-atlas";

function hit(overrides: Partial<DtsSearchHit> = {}): DtsSearchHit {
  return {
    fileId: "file-1",
    fileName: "teaching-sample.dts",
    versionId: "ver-1",
    nodePath: "amba/i2c@XXXX0000/chip@6E",
    snippet: "amba/i2c@XXXX0000/chip@6E",
    ...overrides
  };
}

function createRepository(overrides: Partial<DtsStructuredRepository> = {}): DtsStructuredRepository {
  return {
    getStructure: vi.fn(),
    search: vi.fn().mockResolvedValue({ hits: [hit()] }),
    listConfigSets: vi.fn().mockResolvedValue([]),
    createConfigSet: vi.fn(),
    addConfigSetFile: vi.fn(),
    removeConfigSetFile: vi.fn(),
    listBaselines: vi.fn().mockResolvedValue([]),
    createBaseline: vi.fn(),
    compareBaseline: vi.fn(),
    rollbackBaseline: vi.fn(),
    releaseBaseline: vi.fn(),
    exportConfigSet: vi.fn(),
    submitStructuredEdits: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DtsSearchPanel", () => {
  it("searches via injected repository and lists hits", async () => {
    const repository = createRepository({
      search: vi.fn().mockResolvedValue({
        hits: [
          hit(),
          hit({
            nodePath: "demo_bool",
            propertyName: "weak_source_sleep_enabled",
            snippet: "weak_source_sleep_enabled=true"
          })
        ]
      })
    });

    render(<DtsSearchPanel projectId={PROJECT_ID} repository={repository} />);

    fireEvent.change(screen.getByLabelText("检索关键词"), { target: { value: "chip@6E" } });
    fireEvent.change(screen.getByLabelText("检索维度"), { target: { value: "path" } });
    fireEvent.click(screen.getByRole("button", { name: "检索" }));

    await waitFor(() => {
      expect(repository.search).toHaveBeenCalledWith(PROJECT_ID, { q: "chip@6E", by: "path" });
    });

    expect(await screen.findByText("amba/i2c@XXXX0000/chip@6E")).toBeInTheDocument();
    expect(screen.getByText("demo_bool")).toBeInTheDocument();
    expect(screen.getByText(/weak_source_sleep_enabled/)).toBeInTheDocument();
  });

  it("invokes onSelectHit when a hit is clicked", async () => {
    const onSelectHit = vi.fn();
    const selected = hit();
    const repository = createRepository({
      search: vi.fn().mockResolvedValue({ hits: [selected] })
    });

    render(<DtsSearchPanel projectId={PROJECT_ID} repository={repository} onSelectHit={onSelectHit} />);

    fireEvent.change(screen.getByLabelText("检索关键词"), { target: { value: "6E" } });
    fireEvent.click(screen.getByRole("button", { name: "检索" }));

    const hitButton = await screen.findByRole("button", { name: /跳转到节点 amba\/i2c@XXXX0000\/chip@6E/ });
    fireEvent.click(hitButton);

    expect(onSelectHit).toHaveBeenCalledWith(selected);
  });
});
