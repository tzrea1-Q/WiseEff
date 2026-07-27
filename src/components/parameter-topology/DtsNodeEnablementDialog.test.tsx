import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TopologyNodeEnablement } from "@/domain/parameter-topology/types";

import { DtsNodeEnablementDialog } from "./DtsNodeEnablementDialog";

function enablement(overrides: Partial<TopologyNodeEnablement> = {}): TopologyNodeEnablement {
  return {
    selfEnabled: true,
    override: "force-enabled",
    rawStatus: '"okay"',
    rawToken: "okay",
    reachable: true,
    blockingAncestorId: null,
    blockingAncestorLabel: null,
    ...overrides
  };
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof DtsNodeEnablementDialog>> = {}
) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <DtsNodeEnablementDialog
      open
      nodeLabel="sc8562@6E"
      enablement={enablement()}
      measuredSpelling="okay"
      onClose={vi.fn()}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm };
}

describe("DtsNodeEnablementDialog", () => {
  it("blocks disable until reason and confirmation are provided", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole("radio", { name: "禁用" }));
    const confirm = screen.getByRole("button", { name: "校验并加入本轮" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "修改原因" }), "Bring-up isolation");
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "我确认要禁用此节点" }));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        target: "force-disabled",
        reason: "Bring-up isolation",
        acknowledgeNonstandard: undefined,
        spellingOverride: undefined
      });
    });
  });

  it("shows nonstandard guard until user acknowledges overwrite", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      enablement: enablement({
        selfEnabled: false,
        override: "nonstandard",
        rawStatus: '"reserved"',
        rawToken: "reserved"
      })
    });

    expect(screen.getByRole("region", { name: "非标准 status" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "启用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校验并加入本轮" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "仍要修改" }));
    await user.click(screen.getByRole("radio", { name: "启用" }));
    expect(screen.getByRole("radio", { name: "启用" })).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "校验并加入本轮" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "修改原因" }), "Override reserved token");
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "我了解将覆盖非标准 status 原文" }));
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        acknowledgeNonstandard: true,
        reason: "Override reserved token"
      }));
    });
  });

  it("submits unstated restore with reason via low-emphasis action", async () => {
    const { onConfirm } = renderDialog();

    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Revert explicit status" }
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复未声明" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        target: "unstated",
        reason: "Revert explicit status",
        acknowledgeNonstandard: undefined,
        spellingOverride: undefined
      });
    });
  });
});
