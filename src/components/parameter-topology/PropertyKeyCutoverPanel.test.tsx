import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PropertyKeyCutoverPreview, PropertyKeyCutoverRun } from "@/domain/parameter-topology/types";

import { PropertyKeyCutoverPanel } from "./PropertyKeyCutoverPanel";

function preview(): PropertyKeyCutoverPreview {
  return {
    parameterSpecId: "spec-1",
    fromKey: "typo_prop",
    toKey: "corrected_prop",
    referenceCount: 1,
    writesCatalog: false,
    writesSource: false,
    inlineRenameEligible: false,
    startBlockers: [],
    locations: [
      {
        projectId: "p1",
        bindingId: "b1",
        fileName: "board.dts",
        nodePath: "/charger@6e",
        status: "would-rewrite",
      },
    ],
  };
}

function run(overrides: Partial<PropertyKeyCutoverRun> = {}): PropertyKeyCutoverRun {
  return {
    id: "run-1",
    parameterSpecId: "spec-1",
    fromKey: "typo_prop",
    toKey: "corrected_prop",
    status: "ready",
    referenceCount: 1,
    writesCatalog: false,
    writesSource: false,
    stagedSource: true,
    startBlockers: [],
    items: [
      {
        id: "item-1",
        bindingId: "b1",
        projectId: "p1",
        status: "ready",
        locationStatus: "would-rewrite",
        incompatibilityCode: null,
        fileName: "board.dts",
        nodePath: "/charger@6e",
        stagedRewrite: { kind: "file-candidate", id: "cand-1", status: "ready" },
      },
    ],
    ...overrides,
  };
}

describe("PropertyKeyCutoverPanel", () => {
  it("walks preview → start → prepare without enabling inline rename", async () => {
    const actions = {
      preview: vi.fn().mockResolvedValue(preview()),
      start: vi.fn().mockResolvedValue(run({ status: "preparing", stagedSource: false, items: [] })),
      prepare: vi.fn().mockResolvedValue(run()),
      finalize: vi.fn().mockResolvedValue(run({ status: "finalized", writesCatalog: true })),
    };

    render(<PropertyKeyCutoverPanel currentKey="typo_prop" actions={actions} />);

    expect(screen.getByTestId("property-key-cutover")).toHaveTextContent("属性键切换");
    expect(screen.queryByRole("button", { name: "修正属性键" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新属性键"), { target: { value: "corrected_prop" } });
    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith({ propertyKey: "corrected_prop" }));
    expect(screen.getByText(/将改写源/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "纠正错键" } });
    fireEvent.click(screen.getByRole("button", { name: "启动作业" }));
    await waitFor(() =>
      expect(actions.start).toHaveBeenCalledWith({ propertyKey: "corrected_prop", reason: "纠正错键" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "暂存草稿" }));
    await waitFor(() => expect(actions.prepare).toHaveBeenCalled());
    expect(screen.getByText(/已暂存文件草稿/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成切换" })).toBeDisabled();
    expect(actions.finalize).not.toHaveBeenCalled();
  });

  it("enables finalize only after a re-preview shows the live source already uses the new key", async () => {
    const actions = {
      preview: vi
        .fn()
        .mockResolvedValueOnce(preview())
        .mockResolvedValueOnce({
          ...preview(),
          locations: [{ ...preview().locations[0]!, status: "already-new-key" as const }],
        }),
      start: vi.fn().mockResolvedValue(run({ status: "preparing", stagedSource: false, items: [] })),
      prepare: vi.fn().mockResolvedValue(run()),
      finalize: vi.fn().mockResolvedValue(run({ status: "finalized", writesCatalog: true })),
    };

    render(<PropertyKeyCutoverPanel currentKey="typo_prop" actions={actions} />);
    fireEvent.change(screen.getByLabelText("新属性键"), { target: { value: "corrected_prop" } });
    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "纠正错键" } });
    fireEvent.click(screen.getByRole("button", { name: "启动作业" }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "暂存草稿" }));
    await waitFor(() => expect(actions.prepare).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "完成切换" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "完成切换" })).toBeEnabled();
  });

  it("shows a collision blocker and keeps start disabled", async () => {
    const actions = {
      preview: vi.fn().mockResolvedValue({
        ...preview(),
        startBlockers: [{ code: "triple-collision", message: "occupied" }],
      }),
      start: vi.fn(),
      prepare: vi.fn(),
      finalize: vi.fn(),
    };

    render(<PropertyKeyCutoverPanel currentKey="typo_prop" actions={actions} />);
    fireEvent.change(screen.getByLabelText("新属性键"), { target: { value: "corrected_prop" } });
    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("目标属性键已被占用"));
    expect(screen.getByRole("button", { name: "启动作业" })).toBeDisabled();
    expect(actions.start).not.toHaveBeenCalled();
  });

  it("keeps finalize disabled when a re-preview still has no-occurrence locations", async () => {
    const actions = {
      preview: vi
        .fn()
        .mockResolvedValueOnce(preview())
        .mockResolvedValueOnce({
          ...preview(),
          locations: [{ ...preview().locations[0]!, status: "no-occurrence" as const, fileName: null }],
        }),
      start: vi.fn().mockResolvedValue(run({ status: "preparing", stagedSource: false, items: [] })),
      prepare: vi.fn().mockResolvedValue(run()),
      finalize: vi.fn(),
    };

    render(<PropertyKeyCutoverPanel currentKey="typo_prop" actions={actions} />);
    fireEvent.change(screen.getByLabelText("新属性键"), { target: { value: "corrected_prop" } });
    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "纠正错键" } });
    fireEvent.click(screen.getByRole("button", { name: "启动作业" }));
    await waitFor(() => expect(actions.start).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "暂存草稿" }));
    await waitFor(() => expect(actions.prepare).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "预检" }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/未命名文件/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成切换" })).toBeDisabled();
  });

  it("surfaces a resume failure instead of swallowing it", async () => {
    const actions = {
      preview: vi.fn(),
      start: vi.fn(),
      prepare: vi.fn(),
      finalize: vi.fn(),
      loadOpenRun: vi.fn().mockRejectedValue(new Error("network down")),
    };

    render(<PropertyKeyCutoverPanel currentKey="typo_prop" actions={actions} />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("无法读取进行中的属性键切换，请重试。"),
    );
  });
});
