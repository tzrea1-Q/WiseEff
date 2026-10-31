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
  it("summarizes a batch and submits one candidate with a shared optional reason", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");
    const second = { ...activeDefinition, id: "second", propertyKey: "second-key", usageSummary: { policyCount: 2, projectCount: 3, currentValueCount: 4 } };
    render(<DefinitionLifecycleDialog open intent="retire-definition" actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={domainState}
      catalog={ports.catalog} catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition}
      definitions={[activeDefinition, second]} onOpenChange={vi.fn()} />);
    expect(screen.getByText(/策略使用量暂不可用/)).toBeInTheDocument();
    expect(screen.getByText(/项目 5.*当前值 6/)).toBeInTheDocument();
    expect(screen.getByText(/second-key/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("原因"), "统一弃用");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]?.[0]?.changeSet).toEqual([
      expect.objectContaining({ op: "retire-definition", definitionId: activeDefinition.id, reason: "统一弃用" }),
      expect.objectContaining({ op: "retire-definition", definitionId: "second", reason: "统一弃用" })
    ]);
    const confirm = await screen.findByRole("dialog", { name: /确认弃用/ });
    expect(within(confirm).getByText(/项目 5.*当前值 6/)).toBeInTheDocument();
    expect(within(confirm).getByText(/second-key/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "确认弃用" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });

  it("allows a batch without a reason and blocks it in mock mode", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const view = render(<DefinitionLifecycleDialog open intent="restore-definition" actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={domainState} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition} definitions={[activeDefinition]}
      runtimeMode="mock" onOpenChange={vi.fn()} />);
    expect(screen.getByText("模拟模式不支持，请使用 API 模式。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预演影响" })).toBeDisabled();
    view.rerender(<DefinitionLifecycleDialog open intent="restore-definition" actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={domainState} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition} definitions={[activeDefinition]}
      runtimeMode="api" onOpenChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "预演影响" })).toBeEnabled();
  });
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

  it.each(["retire-definition", "restore-definition"] as const)(
    "preserves the current revision content when it previews %s",
    async (intent) => {
      const user = userEvent.setup();
      const schema = { type: "integer", minimum: 2, maximum: 9 };
      const definition = {
        ...activeDefinition,
        currentRevision: {
          ...activeDefinition.currentRevision,
          valueShape: { kind: "json-schema" as const, schema },
          unit: { kind: "symbol" as const, symbol: "mA" }
        }
      };
      const { ports } = renderDialog(intent, definition);
      const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");

      await user.type(screen.getByLabelText("原因"), `保留当前内容后${intent === "retire-definition" ? "弃用" : "恢复"}`);
      await user.click(screen.getByRole("button", { name: "预演影响" }));

      await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
      expect(preview.mock.calls[0]?.[0]?.changeSet?.[0]).toMatchObject({
        op: intent,
        reason: `保留当前内容后${intent === "retire-definition" ? "弃用" : "恢复"}`,
        content: {
          displayName: activeDefinition.currentRevision.displayName,
          documentation: activeDefinition.currentRevision.documentation,
          unit: "mA",
          valueSchema: schema
        }
      });
    }
  );

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
    expect(alert).toHaveTextContent("目录发布已变化");
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
