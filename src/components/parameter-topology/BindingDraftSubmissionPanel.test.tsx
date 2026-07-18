import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BindingDraftSubmissionPanel } from "./BindingDraftSubmissionPanel";

describe("BindingDraftSubmissionPanel delete action", () => {
  it("shows a delete intent and submits the empty tombstone with its action", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BindingDraftSubmissionPanel
        projectId="aurora"
        draft={{
          projectId: "aurora",
          draftId: "draft-delete",
          parameterId: "binding-gpio-int",
          candidateRevisionId: "candidate-delete",
          rawText: "",
          action: "delete",
          parameterSpecId: "spec-gpio-int",
          projectParameterBindingId: "binding-gpio-int",
          writeTarget: { role: "overlay", propertyKey: "gpio_int" },
          overlayFileId: "overlay-file",
          overlayFileName: "board-overlay.dts",
          reason: "Remove obsolete GPIO override"
        }}
        candidates={{
          hardwareCommitters: [{ id: "hardware", name: "Hardware" }],
          softwareCommitters: [{ id: "software", name: "Software" }],
          softwareUsers: [{ id: "user", name: "User" }]
        }}
        onSubmit={onSubmit}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText("删除属性")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        projectId: "aurora",
        items: [
          {
            draftId: "draft-delete",
            action: "delete",
            targetValue: "",
            reason: "Remove obsolete GPIO override",
            projectParameterBindingId: "binding-gpio-int",
            parameterSpecId: "spec-gpio-int"
          }
        ],
        assignees: {
          hardwareCommitterId: "hardware",
          softwareCommitterId: "software",
          softwareUserId: "user"
        }
      });
    });
  });
});
