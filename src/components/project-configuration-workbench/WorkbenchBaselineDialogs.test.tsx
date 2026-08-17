import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchBaselineDialogs } from "./WorkbenchBaselineDialogs";

afterEach(() => cleanup());

function renderDialogs(overrides: Partial<Parameters<typeof WorkbenchBaselineDialogs>[0]> = {}) {
  return render(
    <WorkbenchBaselineDialogs
      createOpen={false}
      releaseOpen={false}
      restoreOpen={false}
      leaveOpen={false}
      sessionDraftsDirty={false}
      baselineActionError=""
      newBaselineName=""
      onNewBaselineNameChange={vi.fn()}
      pendingAction={null}
      releaseReadiness={null}
      acknowledgedWarningIds={new Set()}
      restorePreview={null}
      selectedBaselineId="bl-1"
      baselines={[]}
      onCancelCreate={vi.fn()}
      onConfirmCreate={vi.fn()}
      onCancelRelease={vi.fn()}
      onConfirmRelease={vi.fn()}
      onCancelRestore={vi.fn()}
      onConfirmRestore={vi.fn()}
      onCancelLeave={vi.fn()}
      onConfirmLeave={vi.fn()}
      confirmation={null}
      onCancelConfirmation={vi.fn()}
      onConfirmConfirmation={vi.fn()}
      {...overrides}
    />
  );
}

describe("WorkbenchBaselineDialogs", () => {
  it("renders the action error inside the open restore confirmation dialog", () => {
    renderDialogs({
      restoreOpen: true,
      baselineActionError: "恢复基线失败：请求超时"
    });

    const dialog = screen.getByRole("dialog", { name: "恢复基线确认" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("恢复基线失败：请求超时");
  });

  it("renders the action error inside the open release confirmation dialog", () => {
    renderDialogs({
      releaseOpen: true,
      baselineActionError: "就绪状态已变化，请重新查看就绪问题后再操作。"
    });

    const dialog = screen.getByRole("dialog", { name: "发布基线确认" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("就绪状态已变化");
  });

  it("blocks release confirm until the revision-gate acknowledgement is ticked", () => {
    renderDialogs({
      releaseOpen: true,
      releaseRequiresConfirmation: true
    });

    const dialog = screen.getByRole("dialog", { name: "发布基线确认" });
    const confirm = within(dialog).getByRole("button", { name: "确认发布" });
    const acknowledgement = within(dialog).getByRole("checkbox", {
      name: "我已了解修订校验未硬性通过的风险，确认继续发布。"
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(acknowledgement);
    expect(confirm).toBeEnabled();
  });
});
