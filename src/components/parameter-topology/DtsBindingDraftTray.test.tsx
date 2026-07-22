import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowAssigneeCandidates } from "@/application/ports/ParameterRepository";

import {
  DtsBindingDraftTray,
  type PendingBindingDraft
} from "./DtsBindingDraftTray";

const candidates: WorkflowAssigneeCandidates = {
  hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
  softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
  softwareUsers: [{ id: "u-user", name: "Software Merger" }]
};

function draft(overrides: Partial<PendingBindingDraft> = {}): PendingBindingDraft {
  return {
    projectId: "aurora",
    currentRawValue: "<&gpio13 29 0>",
    reason: "Move interrupt line",
    draftId: "draft-typed-1",
    parameterId: "legacy-parameter-id-must-not-submit",
    candidateRevisionId: "candidate-1",
    rawText: "<&gpio13 30 0>",
    action: "set",
    parameterSpecId: "spec-sc8562-gpio-int",
    projectParameterBindingId: "binding-sc8562-gpio-int",
    writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
    overlayFileId: "file-overlay",
    overlayFileName: "overlay.dts",
    ...overrides
  };
}

describe("DtsBindingDraftTray", () => {
  it("shows semantic identities and submits the exact typed binding payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    const tray = screen.getByRole("region", { name: "绑定变更提交" });
    expect(within(tray).getByRole("heading", { name: "本轮已修改" })).toBeVisible();
    expect(within(tray).getByText("gpio_int")).toBeVisible();
    const diff = within(tray).getByLabelText("gpio_int 值变更");
    expect(diff.querySelector(".submission-preview-diff")).toBeInTheDocument();
    expect(within(diff).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(within(diff).getByText("<&gpio13 30 0>")).toBeVisible();
    expect(within(tray).getByText("Move interrupt line")).toBeVisible();
    fireEvent.click(within(tray).getByText("技术身份"));
    expect(within(tray).getByText("candidate-1")).toBeVisible();
    expect(within(tray).getByText("draft-typed-1")).toBeVisible();
    expect(within(tray).getByText("binding-sc8562-gpio-int")).toBeVisible();
    expect(within(tray).getByText("spec-sc8562-gpio-int")).toBeVisible();

    fireEvent.click(within(tray).getByRole("button", { name: "提交审核" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        projectId: "aurora",
        items: [
          {
            draftId: "draft-typed-1",
            projectParameterBindingId: "binding-sc8562-gpio-int",
            parameterSpecId: "spec-sc8562-gpio-int",
            action: "set",
            targetValue: "<&gpio13 30 0>",
            reason: "Move interrupt line"
          }
        ],
        assignees: {
          hardwareCommitterId: "u-hw",
          softwareCommitterId: "u-sw",
          softwareUserId: "u-user"
        }
      });
    });
    const submittedItem = onSubmit.mock.calls[0][0].items[0];
    expect(submittedItem).not.toHaveProperty("parameterId");
    expect(submittedItem).not.toHaveProperty("recommendedValue");
    expect(await within(tray).findByText(/已提交正式审核/)).toBeVisible();
  });

  it("removes only the local presentation item and renders delete as a tombstone intent", async () => {
    const onRemove = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[
          draft({
            draftId: "draft-delete",
            action: "delete",
            rawText: "",
            reason: "Remove obsolete override"
          })
        ]}
        candidates={candidates}
        onRemove={onRemove}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getAllByText("删除属性（tombstone）").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("gpio_int 值变更").querySelector(".submission-preview-diff")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移出本轮修改" }));
    expect(onRemove).toHaveBeenCalledWith("draft-delete");

    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        items: [expect.objectContaining({
          draftId: "draft-delete",
          action: "delete",
          targetValue: ""
        })]
      }));
    });
  });

  it("reports loading and load errors and keeps submission fail-closed", () => {
    const { rerender } = render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={null}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在加载项目角色候选人");
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();

    rerender(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={null}
        candidatesError="无法加载角色"
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("无法加载角色");
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });

  it.each([
    {
      name: "missing binding identity",
      drafts: [draft({ projectParameterBindingId: "" })],
      candidates,
      onSubmit: vi.fn()
    },
    {
      name: "missing role",
      drafts: [draft()],
      candidates: { ...candidates, softwareUsers: [] },
      onSubmit: vi.fn()
    },
    {
      name: "missing submit handler",
      drafts: [draft()],
      candidates,
      onSubmit: undefined
    },
    {
      name: "conflicting candidates",
      drafts: [draft(), draft({
        draftId: "draft-2",
        projectParameterBindingId: "binding-watchdog",
        parameterSpecId: "spec-watchdog",
        candidateRevisionId: "candidate-2",
        writeTarget: { role: "overlay", propertyKey: "watchdog_time" }
      })],
      candidates,
      onSubmit: vi.fn()
    }
  ])("blocks $name", ({ drafts, candidates: roleCandidates, onSubmit }) => {
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={drafts}
        candidates={roleCandidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
  });

  it("explains that different candidate revisions cannot be silently batched", () => {
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft(), draft({
          draftId: "draft-2",
          projectParameterBindingId: "binding-watchdog",
          parameterSpecId: "spec-watchdog",
          candidateRevisionId: "candidate-2",
          writeTarget: { role: "overlay", propertyKey: "watchdog_time" }
        })]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/不在同一工作版本上.*无法一起提交/);
  });

  it("shows a healthy working-version hint when all drafts share the same tip", () => {
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft(), draft({
          draftId: "draft-2",
          projectParameterBindingId: "binding-watchdog",
          parameterSpecId: "spec-watchdog",
          writeTarget: { role: "overlay", propertyKey: "watchdog_time" }
        })]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText(/本轮 2 项 · 同一工作版本/)).toBeVisible();
  });

  it.each([
    {
      name: "set with empty raw text",
      invalidDraft: draft({ action: "set", rawText: "  " }),
      message: /set.*非空 rawText/
    },
    {
      name: "delete with a non-empty raw value",
      invalidDraft: draft({ action: "delete", rawText: "<&gpio13 30 0>" }),
      message: /delete.*空 tombstone/
    }
  ])("blocks an action/value mismatch: $name", ({ invalidDraft, message }) => {
    const onSubmit = vi.fn();
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[invalidDraft]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    const submit = screen.getByRole("button", { name: "提交审核" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores an old resolve after the same draft id is replaced and submits only the new batch", async () => {
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    const oldRequest = new Promise<void>((resolve) => {
      resolveOld = resolve;
    });
    const newRequest = new Promise<void>((resolve) => {
      resolveNew = resolve;
    });
    const onSubmit = vi.fn()
      .mockImplementationOnce(() => oldRequest)
      .mockImplementationOnce(() => newRequest);
    const { rerender } = render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();

    rerender(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft({
          candidateRevisionId: "candidate-2",
          rawText: "<&gpio13 31 0>",
          reason: "Replacement reason"
        })]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "移出本轮修改" })).toBeDisabled();
    expect(screen.getByLabelText("硬件 MDE")).toBeDisabled();
    expect(screen.getByLabelText("软件 MDE")).toBeDisabled();
    expect(screen.getByLabelText("软件开发")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "移出本轮修改" }));
    fireEvent.click(screen.getByRole("button", { name: "提交中…" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOld();
      await oldRequest;
    });
    expect(screen.queryByText(/已提交正式审核/)).not.toBeInTheDocument();
    const newSubmit = await screen.findByRole("button", { name: "提交审核" });
    await waitFor(() => expect(newSubmit).toBeEnabled());
    fireEvent.click(newSubmit);
    expect(onSubmit).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveNew();
      await newRequest;
    });
    expect(await screen.findByText(/已提交正式审核/)).toBeVisible();
    const replacementItem = onSubmit.mock.calls[1][0].items[0];
    expect(replacementItem).toEqual(expect.objectContaining({
      draftId: "draft-typed-1",
      targetValue: "<&gpio13 31 0>",
      reason: "Replacement reason"
    }));
    expect(replacementItem).not.toHaveProperty("candidateRevisionId");
  });

  it("ignores an old rejection after the same draft id is replaced and allows the new batch to submit", async () => {
    let rejectOld!: (error: Error) => void;
    const oldRequest = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    const onSubmit = vi.fn()
      .mockImplementationOnce(() => oldRequest)
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    rerender(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft({
          candidateRevisionId: "candidate-2",
          rawText: "<&gpio13 31 0>",
          reason: "Replacement reason"
        })]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectOld(new Error("old request failed"));
      await oldRequest.catch(() => undefined);
    });
    expect(screen.queryByText("old request failed")).not.toBeInTheDocument();
    const newSubmit = await screen.findByRole("button", { name: "提交审核" });
    await waitFor(() => expect(newSubmit).toBeEnabled());
    expect(newSubmit).toBeEnabled();

    fireEvent.click(newSubmit);
    expect(await screen.findByText(/已提交正式审核/)).toBeVisible();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("freezes the sent assignees when candidates rerender during submission and keeps them after success", async () => {
    let resolveSubmit!: () => void;
    const pendingSubmit = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn(() => pendingSubmit);
    const { rerender } = render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    expect(onSubmit.mock.calls[0][0].assignees).toEqual({
      hardwareCommitterId: "u-hw",
      softwareCommitterId: "u-sw",
      softwareUserId: "u-user"
    });

    rerender(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={{
          hardwareCommitters: [{ id: "new-hw", name: "New Hardware" }],
          softwareCommitters: [{ id: "new-sw", name: "New Software" }],
          softwareUsers: [{ id: "new-user", name: "New User" }]
        }}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByLabelText("硬件 MDE")).toHaveValue("u-hw");
    expect(screen.getByLabelText("软件 MDE")).toHaveValue("u-sw");
    expect(screen.getByLabelText("软件开发")).toHaveValue("u-user");
    expect(screen.getByLabelText("硬件 MDE")).toBeDisabled();

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    expect(await screen.findByText(/已提交正式审核/)).toBeVisible();
    expect(screen.getByLabelText("硬件 MDE")).toHaveValue("u-hw");
    expect(screen.getByLabelText("软件 MDE")).toHaveValue("u-sw");
    expect(screen.getByLabelText("软件开发")).toHaveValue("u-user");
  });

  it("fails closed when an external project mutation blocks formal submission", () => {
    const onSubmit = vi.fn();
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[draft()]}
        candidates={candidates}
        externalBlocker="该项目正在创建 typed draft，正式提交已暂时锁定。"
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/正在创建 typed draft/);
    const submit = screen.getByRole("button", { name: "提交审核" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits only selected drafts when selectedBindingIds is non-empty", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DtsBindingDraftTray
        projectId="aurora"
        drafts={[
          draft({ draftId: "draft-a", projectParameterBindingId: "binding-a" }),
          draft({ draftId: "draft-b", projectParameterBindingId: "binding-b", writeTarget: { role: "overlay", propertyKey: "watchdog", targetRef: "sc8562" } })
        ]}
        selectedBindingIds={new Set(["binding-b"])}
        candidates={candidates}
        onRemove={vi.fn()}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        items: [
          expect.objectContaining({
            draftId: "draft-b",
            projectParameterBindingId: "binding-b"
          })
        ]
      }));
    });
    expect(onSubmit.mock.calls[0][0].items).toHaveLength(1);
  });
});
