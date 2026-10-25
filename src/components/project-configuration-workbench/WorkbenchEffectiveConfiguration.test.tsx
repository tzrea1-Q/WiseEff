import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EffectiveTopologyNode } from "@/domain/parameter-topology/types";
import { WorkbenchEffectiveConfiguration } from "./WorkbenchEffectiveConfiguration";

describe("effective project configuration", () => {
  it("prepares formal node actions without a parameter Binding and distinguishes explicit deletion from removing an override", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const node: EffectiveTopologyNode = { id: "n", logicalNodeId: "logical", locator: "/device", name: "device", parentLogicalNodeId: null,
      effects: [{ id: "p", propertyName: "limit", effectKind: "set", nodeOccurrenceId: "o", propertyOccurrenceId: "p1", sourceOrder: 0,
        rawText: "<25>", source: { fileId: "local", fileVersionId: "v1", sourceName: "board.dts" } }] };
    render(<WorkbenchEffectiveConfiguration node={node} projectId="project" configSetId="config" revisionId="revision" search="" onPrepareOverride={prepare} />);
    await userEvent.click(screen.getByRole("combobox", { name: "节点操作" }));
    await userEvent.click(screen.getByRole("option", { name: "在本项目禁用" }));
    await userEvent.click(screen.getByRole("button", { name: "查看节点差异" }));
    expect(prepare).toHaveBeenLastCalledWith({ expectedConfigRevisionId: "revision", logicalNodeId: "logical", propertyName: "status", action: "disable-node" });
    await userEvent.click(screen.getByRole("button", { name: "删除此属性" }));
    expect(prepare).toHaveBeenLastCalledWith({ expectedConfigRevisionId: "revision", logicalNodeId: "logical", propertyName: "limit", propertyOccurrenceId: "p1", action: "delete-property" });
    await userEvent.click(screen.getByRole("button", { name: "撤销本项目覆盖" }));
    expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ action: "remove-override" }));
  });
  it("prepares a local source draft with exact property identity, retaining failed input", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error("配置已变化")).mockResolvedValueOnce(undefined);
    const node: EffectiveTopologyNode = { id:"n",logicalNodeId:"logical",locator:"/device",name:"device",parentLogicalNodeId:null,compatible:"acme,power", effects:[
      {id:"e",propertyName:"limit",effectKind:"override",nodeOccurrenceId:"n1",propertyOccurrenceId:"p1",sourceOrder:1,rawText:"<25>",source:{fileId:"local",fileVersionId:"v",sourceName:"board.dts"}}
    ] };
    render(<WorkbenchEffectiveConfiguration node={node} projectId="project" configSetId="config" revisionId="revision" search=""
      overrideTargets={[{fileId:"local",fileName:"board.dts"}]} onPrepareOverride={prepare} />);
    await userEvent.click(screen.getByRole("button",{name:"在本项目覆盖"}));
    await userEvent.clear(screen.getByLabelText("limit 本项目值"));
    await userEvent.type(screen.getByLabelText("limit 本项目值"),"<31>");
    await userEvent.click(screen.getByRole("button",{name:"查看源码差异"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("配置已变化");
    expect(screen.getByLabelText("limit 本项目值")).toHaveValue("<31>");
    await userEvent.click(screen.getByRole("button",{name:"查看源码差异"}));
    expect(prepare).toHaveBeenLastCalledWith({expectedConfigRevisionId:"revision",logicalNodeId:"logical",propertyName:"limit",propertyOccurrenceId:"p1",action:"set",rawText:"<31>",targetFileId:"local"});
    await userEvent.click(screen.getByRole("button",{name:"取消"}));
    await userEvent.click(screen.getByRole("button",{name:"撤销本项目覆盖"}));
    expect(prepare).toHaveBeenLastCalledWith({expectedConfigRevisionId:"revision",logicalNodeId:"logical",propertyName:"limit",propertyOccurrenceId:"p1",action:"remove-override"});
  });
  it("shows the final value and ancestor reachability, with the ordered exact source chain on demand", async () => {
    const source = { fileId: "shared-file", fileVersionId: "snapshot-v1", sourceName: "lib/common.dtsi",
      startLine: 7, startColumn: 2, endLine: 7, endColumn: 18,
      sharedReference: { referenceId: "ref", resourceId: "resource", versionId: "published-v1", version: 1,
        memberId: "member", digest: "digest", readOnly: true as const } };
    const node: EffectiveTopologyNode = { id: "n", logicalNodeId: "logical", locator: "/bus/device@1", name: "device", unitAddress: "1",
      compatible: "test,device", parentLogicalNodeId: "bus", enablement: { selfEnabled: true, reachable: false,
        rawStatus: '"okay"', rawToken: "okay", override: "force-enabled", blockingAncestorId: "bus", blockingAncestorLabel: "/bus" }, effects: [
        { id: "first", propertyName: "limit", effectKind: "set", nodeOccurrenceId: "o1", propertyOccurrenceId: "p1", sourceOrder: 0, rawText: "<42>", source },
        { id: "last", propertyName: "limit", effectKind: "override", nodeOccurrenceId: "o2", propertyOccurrenceId: "p2", sourceOrder: 1, rawText: "<36>",
          source: { ...source, fileId: "private-file", fileVersionId: "private-v2", sourceName: "board.dts", startLine: 12, sharedReference: undefined } }
      ] };
    render(<WorkbenchEffectiveConfiguration node={node} projectId="project" configSetId="config" revisionId="revision-v2"
      search="?organization=org&tab=effective" />);
    expect(screen.getByLabelText("limit 最终值")).toHaveTextContent("<36>");
    expect(screen.getByText("节点已启用 · 祖先 /bus 阻断")).toBeVisible();
    expect(screen.getByText("<42>")).not.toBeVisible();
    const final = screen.getAllByRole("link", { name: "board.dts:12" })[0]!;
    const params = new URL(final.getAttribute("href")!, "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ organization: "org", tab: "source", configSet: "config", revision: "revision-v2",
      file: "private-file", version: "private-v2", sourceMode: "history", line: "12", node: "/bus/device@1", property: "limit" });
    await userEvent.click(screen.getByText("继承与覆盖（2）"));
    const chain = screen.getByRole("list", { name: "limit 来源链" });
    expect(within(chain).getAllByRole("listitem").map(item => item.textContent)).toEqual([
      expect.stringContaining("<42>"), expect.stringContaining("<36>")
    ]);
    const sharedParams = new URL(within(chain).getByRole("link", { name: "共享资源 v1" }).getAttribute("href")!, "http://localhost").searchParams;
    expect(Object.fromEntries(sharedParams)).toMatchObject({ resource: "resource", version: "published-v1", member: "member", line: "7" });
    expect(sharedParams.get("projectContext")).toContain("revision=revision-v2");
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
});
