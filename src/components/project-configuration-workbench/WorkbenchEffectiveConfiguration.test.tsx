import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EffectiveTopologyNode } from "@/domain/parameter-topology/types";
import { WorkbenchEffectiveConfiguration } from "./WorkbenchEffectiveConfiguration";

describe("effective project configuration", () => {
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
