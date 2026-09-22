import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import {
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";

import { DefinitionLifecycleDialog } from "./DefinitionLifecycleDialog";

// The publication gate needs a ready domain state, matching the existing
// PublicationDialog harness.
const domainState = deriveCatalogDomainState({ document: readyCatalogDocument });

function renderDialog(
  intent: "retire-definition" | "restore-definition",
  definition = activeDefinition
) {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  const onCompleted = vi.fn();
  const view = render(
    <DefinitionLifecycleDialog
      open
      intent={intent}
      actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]}
      domainState={domainState}
      catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID}
      definition={{
        ...definition,
        lifecycle: intent === "restore-definition" ? "retired" : "active"
      }}
      createIdempotencyKey={() => "idem-847-lifecycle"}
      onOpenChange={vi.fn()}
      onCompleted={onCompleted}
    />
  );
  return { ...view, ports, onCompleted };
}

/**
 * Issue #847 decision 10: one dialog performs the whole lifecycle operation —
 * capture the shared impact, confirm once, publish through the governed
 * pipeline, and report the actual activation outcome.
 */
describe("DefinitionLifecycleDialog", () => {
  it("requires a reason before it will capture the impact", async () => {
    const user = userEvent.setup();
    const { ports } = renderDialog("retire-definition");
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");

    expect(screen.getByRole("button", { name: "预演影响" })).toBeDisabled();
    await user.type(screen.getByLabelText("原因"), "重复定义，需要退役");
    expect(screen.getByRole("button", { name: "预演影响" })).toBeEnabled();
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps a known zero distinct from unavailable policy usage through final confirmation", async () => {
    const user = userEvent.setup();
    renderDialog("restore-definition", {
      ...activeDefinition,
      usageSummary: { ...activeDefinition.usageSummary, policyCount: 0 }
    });

    expect(screen.getByText(/策略 0/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("原因"), "恢复为活跃定义");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    const confirm = await screen.findByRole("dialog", { name: /确认恢复/ });
    expect(within(confirm).getByText(/策略 0/)).toBeInTheDocument();
    expect(within(confirm).queryByText(/策略使用量暂不可用/)).not.toBeInTheDocument();
  });

  it("captures the retire candidate, confirms the shared impact, and reports the effective result", async () => {
    const user = userEvent.setup();
    const { ports, onCompleted } = renderDialog("retire-definition");
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");

    await user.type(screen.getByLabelText("原因"), "重复定义，需要退役");
    await user.click(screen.getByRole("button", { name: "预演影响" }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]?.[0]?.changeSet?.[0]).toMatchObject({
      op: "retire-definition",
      definitionId: activeDefinition.id
    });

    const confirm = await screen.findByRole("dialog", { name: /确认弃用/ });
    expect(within(confirm).getByText(/策略使用量暂不可用/)).toBeInTheDocument();
    expect(within(confirm).getByText(/共享目录影响/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "确认弃用" }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it("keeps the input and does not silently resubmit when the request fails", async () => {
    const user = userEvent.setup();
    const { ports } = renderDialog("retire-definition");
    vi.spyOn(ports.catalog, "createPublicationCandidate").mockRejectedValue(
      catalogApiFailure("release-drift")
    );

    await user.type(screen.getByLabelText("原因"), "保留输入");
    await user.click(screen.getByRole("button", { name: "预演影响" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-preserve-input", "true");
    expect(screen.getByLabelText("原因")).toHaveValue("保留输入");
  });

  it("restores a retired definition through the same single dialog", async () => {
    const user = userEvent.setup();
    const { ports } = renderDialog("restore-definition");
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");

    await user.type(screen.getByLabelText("原因"), "恢复为活跃定义");
    await user.click(screen.getByRole("button", { name: "预演影响" }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]?.[0]?.changeSet?.[0]).toMatchObject({
      op: "restore-definition",
      definitionId: activeDefinition.id
    });
    const confirm = await screen.findByRole("dialog", { name: /确认恢复/ });
    expect(within(confirm).getByText(/策略使用量暂不可用/)).toBeInTheDocument();
  });
});
