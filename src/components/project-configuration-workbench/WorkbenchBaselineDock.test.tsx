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
    expect(workbenchBaselineIdentityLabel("historical")).toBe("历史");
  });
});

describe("WorkbenchBaselineDock", () => {
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
        canAdmin
        canRelease
        canRestore={false}
        onSelectBaseline={onSelectBaseline}
        onCompare={onCompare}
        onOpenRelease={onOpenRelease}
        onOpenRestore={onOpenRestore}
        onExitCompare={vi.fn()}
      />
    );

    expect(screen.getByLabelText("基线历史")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(screen.getByText("历史")).toBeInTheDocument();
    expect(screen.getByLabelText("钉住的成员版本")).toHaveTextContent("file-1 · v2");

    await user.click(screen.getByRole("button", { name: /对比 Working/ }));
    expect(onCompare).toHaveBeenCalledWith("working");

    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(onOpenRelease).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /hist-one/ }));
    expect(onSelectBaseline).toHaveBeenCalledWith("bl-hist");
  });
});
