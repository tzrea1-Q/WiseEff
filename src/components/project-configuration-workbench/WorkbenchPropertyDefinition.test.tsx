import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import { WorkbenchPropertyDefinition } from "./WorkbenchPropertyDefinition";

afterEach(cleanup);

function binding(overrides: Partial<ProjectParameterBinding> = {}): ProjectParameterBinding {
  return {
    id: "binding", projectId: "project", parameterSpecId: "spec", parameterSpecVersionId: "spec-v1",
    sourceFileId: "file", sourceNodePath: "/board", propertyKey: "iin_max", definitionId: "definition",
    definitionRevisionId: "pinned-revision", driverModule: null, logicalNodeId: null, instanceName: null, locator: null,
    effectiveValue: { kind: "strings", values: ["2300"] }, rawValue: "2300", schemaState: "valid", policyState: "pass", moduleId: "power",
    ...overrides
  };
}

function definition(revisionId = "pinned-revision", displayName = "最大输入电流"): Awaited<ReturnType<ParameterCatalogRepository["getDefinitionRevision"]>> {
  return { item: {
    id: revisionId, definitionId: "definition", revisionNumber: 3, contentDigest: "sha256:revision",
    displayName, valueShape: { kind: "json-schema", schema: { type: "integer" } }, constraints: { kind: "none" },
    documentation: "限制电源的最大输入电流。", unit: { kind: "symbol", symbol: "mA" }, publishedInCatalogReleaseId: "release"
  } };
}

function props() {
  return {
    projectId: "project", revisionId: "config-revision", fileId: "file", nodePath: "/board", propertyName: "iin_max",
    topologyRepository: { listBindings: vi.fn().mockResolvedValue([binding()]) },
    catalogRepository: { getDefinitionRevision: vi.fn().mockResolvedValue(definition()) }
  };
}

const unavailable = "当前属性没有唯一关联的参数定义，单位与业务约束尚不可用。";

describe("WorkbenchPropertyDefinition", () => {
  it("uses the exact file, node and property binding and its effective immutable revision", async () => {
    const input = props();
    input.topologyRepository.listBindings.mockResolvedValue([
      binding({ id: "other-file", sourceFileId: "other", definitionRevisionId: "wrong-file" }),
      binding({ id: "other-node", sourceNodePath: "/other", definitionRevisionId: "wrong-node" }),
      binding({ id: "other-property", propertyKey: "voltage", definitionRevisionId: "wrong-property" }),
      binding({ effectiveRevisionId: "effective-revision" })
    ]);
    input.catalogRepository.getDefinitionRevision.mockResolvedValue(definition("effective-revision"));
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByText("最大输入电流")).toBeInTheDocument();
    expect(screen.getByText("mA")).toBeInTheDocument();
    expect(screen.getByText("限制电源的最大输入电流。")).toBeInTheDocument();
    expect(input.topologyRepository.listBindings).toHaveBeenCalledWith("project", "config-revision");
    expect(input.catalogRepository.getDefinitionRevision).toHaveBeenCalledExactlyOnceWith("definition", "effective-revision");
  });

  it.each(["missing", "ambiguous", "missing-definition", "missing-definition-revision"] as const)("reports unavailable metadata honestly for %s binding", async (kind) => {
    const input = props();
    input.topologyRepository.listBindings.mockResolvedValue(kind === "missing" ? [] : kind === "ambiguous" ? [binding(), binding({ id: "duplicate" })]
      : [binding(kind === "missing-definition" ? { definitionId: undefined } : { definitionRevisionId: undefined })]);
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    expect(input.catalogRepository.getDefinitionRevision).not.toHaveBeenCalled();
  });

  it("does not treat two exact bindings as unique when one has incomplete definition metadata", async () => {
    const input = props();
    input.topologyRepository.listBindings.mockResolvedValue([binding(), binding({ id: "duplicate", definitionId: undefined })]);
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    expect(input.catalogRepository.getDefinitionRevision).not.toHaveBeenCalled();
  });

  it("does not use another project's binding even when its source identity matches", async () => {
    const input = props();
    input.topologyRepository.listBindings.mockResolvedValue([binding({ projectId: "other-project" })]);
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    expect(input.catalogRepository.getDefinitionRevision).not.toHaveBeenCalled();
  });

  it("does not fetch definitions without a selected configuration revision", () => {
    const input = props();
    render(<WorkbenchPropertyDefinition {...input} revisionId={null} />);
    expect(screen.getByText(unavailable)).toBeInTheDocument();
    expect(input.topologyRepository.listBindings).not.toHaveBeenCalled();
  });

  it("rejects a server response for a different definition revision and supports retry", async () => {
    const input = props();
    input.catalogRepository.getDefinitionRevision.mockResolvedValueOnce(definition("other-revision")).mockResolvedValueOnce(definition());
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("最大输入电流")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试定义" }));
    expect(await screen.findByText("最大输入电流")).toBeInTheDocument();
    expect(input.catalogRepository.getDefinitionRevision).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("can retry a failed binding request", async () => {
    const input = props();
    input.topologyRepository.listBindings.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce([binding()]);
    render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(input.catalogRepository.getDefinitionRevision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试定义" }));
    expect(await screen.findByText("最大输入电流")).toBeInTheDocument();
    expect(input.topologyRepository.listBindings).toHaveBeenCalledTimes(2);
  });

  it("ignores a late definition response after the selected property changes", async () => {
    const input = props();
    let resolveOld!: (value: ReturnType<typeof definition>) => void;
    input.catalogRepository.getDefinitionRevision.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    input.topologyRepository.listBindings.mockResolvedValueOnce([binding()]).mockResolvedValueOnce([]);
    const { rerender } = render(<WorkbenchPropertyDefinition {...input} />);
    await waitFor(() => expect(input.catalogRepository.getDefinitionRevision).toHaveBeenCalledOnce());
    rerender(<WorkbenchPropertyDefinition {...input} nodePath="/new-node" />);
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    await act(async () => { resolveOld(definition("pinned-revision", "过期参数")); });
    expect(screen.queryByText("过期参数")).not.toBeInTheDocument();
    expect(screen.getByText(unavailable)).toBeInTheDocument();
  });

  it("ignores a late binding response after the selected configuration revision changes", async () => {
    const input = props();
    let resolveOld!: (items: ProjectParameterBinding[]) => void;
    input.topologyRepository.listBindings.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([]);
    const { rerender } = render(<WorkbenchPropertyDefinition {...input} />);
    rerender(<WorkbenchPropertyDefinition {...input} revisionId="new-revision" />);
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    await act(async () => { resolveOld([binding()]); });
    expect(input.catalogRepository.getDefinitionRevision).not.toHaveBeenCalled();
  });

  it("shares the configuration binding read across property selections and displays authored schema limits", async () => {
    const input = props();
    input.topologyRepository.listBindings.mockResolvedValue([binding(), binding({ id: "second", propertyKey: "values" })]);
    input.catalogRepository.getDefinitionRevision.mockResolvedValue({ item: { ...definition().item,
      valueShape: { kind: "json-schema", schema: { type: "array", minItems: 2, maxItems: 2, items: { type: "integer", maximum: 9 } } }
    } });
    const { rerender } = render(<WorkbenchPropertyDefinition {...input} />);
    expect(await screen.findByText("固定 2 项；每项：最大 9")).toBeInTheDocument();
    rerender(<WorkbenchPropertyDefinition {...input} propertyName="values" />);
    await waitFor(() => expect(input.catalogRepository.getDefinitionRevision).toHaveBeenCalledTimes(2));
    expect(input.topologyRepository.listBindings).toHaveBeenCalledOnce();
    expect(screen.getByText("固定 2 项；每项：最大 9")).toBeInTheDocument();
  });
});
