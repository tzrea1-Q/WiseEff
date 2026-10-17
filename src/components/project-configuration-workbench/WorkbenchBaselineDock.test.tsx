import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DtsReleaseBaseline } from "@/application/ports/DtsStructuredRepository";
import {
  WorkbenchBaselineDock,
  workbenchBaselineIdentity,
  workbenchBaselineIdentityLabel
} from "./WorkbenchBaselineDock";

const draft: DtsReleaseBaseline = {
  id: "bl-draft",
  organizationId: "org-1",
  configSetId: "cs-1",
  name: "draft-one",
  status: "draft",
  createdAt: "2026-08-07T00:00:00.000Z"
};

const released: DtsReleaseBaseline = {
  id: "bl-released",
  organizationId: "org-1",
  configSetId: "cs-1",
  name: "released-one",
  status: "released",
  createdAt: "2026-08-06T00:00:00.000Z"
};

const historical: DtsReleaseBaseline = {
  id: "bl-hist",
  organizationId: "org-1",
  configSetId: "cs-1",
  name: "hist-one",
  status: "historical",
  createdAt: "2026-08-05T00:00:00.000Z"
};

describe("workbenchBaselineIdentity", () => {
  it("labels draft, released tip, and historical identities", () => {
    expect(workbenchBaselineIdentity(draft, "bl-released")).toBe("draft");
    expect(workbenchBaselineIdentity(released, "bl-released")).toBe("released");
    expect(workbenchBaselineIdentity(historical, "bl-released")).toBe("historical");
    expect(workbenchBaselineIdentityLabel("historical")).toBe("历史版本");
  });
});

describe("WorkbenchBaselineDock", () => {
  it.each([{ loading: true }, { error: "配置版本加载失败。" }])("hides stale versions and actions while the configuration list is unavailable: %j", (state) => {
    render(<WorkbenchBaselineDock baselines={[released]} selectedBaselineId={released.id} {...state}
      canAdmin canRelease canPreviewRestore onSelectBaseline={vi.fn()} onCompare={vi.fn()}
      onOpenRelease={vi.fn()} onOpenRestore={vi.fn()} />);
    expect(screen.queryByRole("button", { name: new RegExp(released.name) })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: released.name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比当前配置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复到此版本…" })).not.toBeInTheDocument();
  });

  it.each([released, historical])("explains protected recovery inline for $status without offering a direct restore", (selected) => {
    const onOpenRestore = vi.fn();
    render(<WorkbenchBaselineDock baselines={[released, historical]} selectedBaselineId={selected.id}
      releasedTipId={released.id} restoreReadOnly canAdmin canRelease={false} canPreviewRestore
      onSelectBaseline={vi.fn()} onCompare={vi.fn()} onOpenRelease={vi.fn()} onOpenRestore={onOpenRestore} />);
    expect(screen.getByRole("note")).toHaveTextContent("需要回退时，请在文件管理的版本历史中申请回滚审核。");
    expect(screen.queryByRole("button", { name: "查看恢复限制" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复到此版本…" })).not.toBeInTheDocument();
    expect(onOpenRestore).not.toHaveBeenCalled();
  });

  it("preserves the explicit restore permission for unprotected baselines", async () => {
    const user = userEvent.setup();
    const onOpenRestore = vi.fn();
    const props = { baselines: [released], selectedBaselineId: released.id, releasedTipId: released.id, canAdmin: true,
      canRelease: false, onSelectBaseline: vi.fn(), onCompare: vi.fn(), onOpenRelease: vi.fn(), onOpenRestore };
    const { rerender } = render(<WorkbenchBaselineDock {...props} canPreviewRestore={false} />);
    await user.click(screen.getByRole("button", { name: "恢复到此版本…" }));
    expect(onOpenRestore).not.toHaveBeenCalled();
    rerender(<WorkbenchBaselineDock {...props} canPreviewRestore />);
    await user.click(screen.getByRole("button", { name: "恢复到此版本…" }));
    expect(onOpenRestore).toHaveBeenCalledOnce();
    rerender(<WorkbenchBaselineDock {...props} canAdmin={false} canPreviewRestore />);
    expect(screen.queryByRole("button", { name: "恢复到此版本…" })).not.toBeInTheDocument();
  });

  it("keeps comparison controls locked while comparing without a duplicate exit action", () => {
    render(<WorkbenchBaselineDock baselines={[draft, released]} selectedBaselineId={draft.id} releasedTipId={released.id}
      canAdmin canRelease={false} canPreviewRestore={false} comparing
      onSelectBaseline={vi.fn()} onCompare={vi.fn()} onOpenRelease={vi.fn()} onOpenRestore={vi.fn()} />);
    expect(screen.getByRole("button", { name: "对比当前配置" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "对比已发布基线" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为正式版本" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "退出对比" })).not.toBeInTheDocument();
  });

  it("offers only working configuration comparison for every baseline identity", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();
    const props = {
      baselines: [draft, released, historical], releasedTipId: released.id, selectedBaselineId: released.id,
      canAdmin: true, canRelease: true, canPreviewRestore: true,
      onCompare, onSelectBaseline: vi.fn(), onOpenRelease: vi.fn(), onOpenRestore: vi.fn()
    };
    const { rerender } = render(<WorkbenchBaselineDock {...props} />);
    expect(screen.getByRole("heading", { name: released.name })).toBeInTheDocument();
    for (const selected of [released, draft, historical]) {
      rerender(<WorkbenchBaselineDock {...props} selectedBaselineId={selected.id} />);
      expect(screen.queryByRole("button", { name: "对比已发布基线" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "对比当前配置" }));
    }
    expect(onCompare.mock.calls).toEqual([["working"], ["working"], ["working"]]);
  });

  it("exposes create-context identities and compare/release/restore actions", async () => {
    const user = userEvent.setup();
    const onSelectBaseline = vi.fn();
    const onCompare = vi.fn();
    const onOpenRelease = vi.fn();
    const onOpenRestore = vi.fn();

    render(
      <WorkbenchBaselineDock
        baselines={[draft, released, historical]}
        releasedTipId="bl-released"
        selectedBaselineId="bl-draft"
        pinnedMembers={[{ fileId: "file-1", fileVersionId: "fv-1", versionNumber: 2 }]}
        fileNames={{ "file-1": "board.dts" }}
        canAdmin
        canRelease
        canPreviewRestore={false}
        onSelectBaseline={onSelectBaseline}
        onCompare={onCompare}
        onOpenRelease={onOpenRelease}
        onOpenRestore={onOpenRestore}
      />
    );

    expect(screen.getByLabelText("配置版本历史")).toBeInTheDocument();
    expect(screen.getByText("未定版")).toBeInTheDocument();
    expect(screen.getByText("正式版本")).toBeInTheDocument();
    expect(screen.getByText("历史版本")).toBeInTheDocument();
    expect(screen.getByLabelText("快照中的文件版本")).toHaveTextContent("board.dtsv2");

    await user.click(screen.getByRole("button", { name: /对比当前配置/ }));
    expect(onCompare).toHaveBeenCalledWith("working");

    await user.click(screen.getByRole("button", { name: "设为正式版本" }));
    expect(onOpenRelease).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /hist-one/ }));
    expect(onSelectBaseline).toHaveBeenCalledWith("bl-hist");
  });

  it("hides stale files during loading and exposes a scoped retry on failure", async () => {
    const retry = vi.fn();
    const props = { baselines: [released], selectedBaselineId: released.id, canAdmin: false, canRelease: false,
      canPreviewRestore: false, onSelectBaseline: vi.fn(), onCompare: vi.fn(), onOpenRelease: vi.fn(), onOpenRestore: vi.fn(),
      pinnedMembers: [{ fileId: "old-file", fileVersionId: "old-version", versionNumber: 1 }], onRetryMembers: retry };
    const view = render(<WorkbenchBaselineDock {...props} pinnedMembersLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取快照文件");
    expect(screen.queryByRole("table", { name: "快照中的文件版本" })).not.toBeInTheDocument();
    view.rerender(<WorkbenchBaselineDock {...props} pinnedMembersError="快照文件读取失败，请重试。" />);
    expect(screen.getByRole("alert")).toHaveTextContent("快照文件读取失败");
    expect(screen.queryByText("此快照未记录文件。")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试读取文件" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("projects the latest baseline command failure as an alert", () => {
    render(
      <WorkbenchBaselineDock
        baselines={[draft]}
        selectedBaselineId="bl-draft"
        canAdmin
        canRelease={false}
        canPreviewRestore={false}
        actionError="对比基线失败，请重试。"
        onSelectBaseline={vi.fn()}
        onCompare={vi.fn()}
        onOpenRelease={vi.fn()}
        onOpenRestore={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("对比基线失败，请重试。");
  });
});
