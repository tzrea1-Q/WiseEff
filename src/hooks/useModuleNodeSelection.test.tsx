import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DtsTopologyNavigator } from "@/components/parameter-topology/DtsTopologyNavigator";
import { useModuleNodeSelection } from "./useModuleNodeSelection";

function Navigator({ available = true }: { available?: boolean }) {
  const [selectedNodeId, setSelectedNodeId] = useModuleNodeSelection(() => available);
  return <DtsTopologyNavigator
    view="effective" labelKind="text" selectedNodeId={selectedNodeId}
    onSelectNode={(nodeId) => setSelectedNodeId((current) => current === nodeId ? null : nodeId)}
    nodes={available ? [{
      id: "power/电池", parentId: null, label: "电池", name: "电池",
      unitAddress: null, compatible: null, bindingIds: [], bindingCount: 2,
      attentionCount: 0, children: []
    }] : []}
  />;
}

function NavigationSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const syncSearch = () => setSearch(window.location.search);
    window.addEventListener("popstate", syncSearch);
    return () => window.removeEventListener("popstate", syncSearch);
  }, []);
  return <output aria-label="导航查询">{search}</output>;
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("module node URL selection", () => {
  it("synchronizes app navigation search state on selection and reselect-to-clear", () => {
    window.history.replaceState(null, "", "/parameters?project=aurora#details");
    render(<StrictMode><NavigationSearch /><Navigator /></StrictMode>);
    const node = screen.getByRole("treeitem", { name: /电池/ });
    fireEvent.click(node);
    expect(screen.getByLabelText("导航查询")).toHaveTextContent("?project=aurora&moduleNode=power%2F%E7%94%B5%E6%B1%A0");
    fireEvent.click(node);
    expect(screen.getByLabelText("导航查询")).toHaveTextContent(/^\?project=aurora$/);
  });

  it("applies successive selection updates within one interaction", () => {
    function SelectionActions() {
      const [selectedNodeId, setSelectedNodeId] = useModuleNodeSelection();
      return <>
        <output aria-label="模块选择">{selectedNodeId ?? "未选择"}</output>
        <button onClick={() => {
          setSelectedNodeId("power/电池");
          setSelectedNodeId((current) => current === "power/电池" ? "power/充电" : current);
        }}>切换模块</button>
      </>;
    }
    render(<SelectionActions />);
    fireEvent.click(screen.getByRole("button", { name: "切换模块" }));
    expect(screen.getByLabelText("模块选择")).toHaveTextContent("power/充电");
    expect(new URL(window.location.href).searchParams.get("moduleNode")).toBe("power/充电");
  });

  it("waits for a restored node, but clears a resolved selection if that node later disappears", () => {
    window.history.replaceState(null, "", "/parameters?moduleNode=power%2F%E7%94%B5%E6%B1%A0");
    const view = render(<Navigator available={false} />);
    expect(new URL(window.location.href).searchParams.get("moduleNode")).toBe("power/电池");
    view.rerender(<Navigator />);
    expect(screen.getByRole("treeitem", { name: /电池/ })).toHaveAttribute("aria-selected", "true");
    view.rerender(<Navigator available={false} />);
    expect(new URL(window.location.href).searchParams.has("moduleNode")).toBe(false);
    view.rerender(<Navigator />);
    expect(screen.getByRole("treeitem", { name: /电池/ })).toHaveAttribute("aria-selected", "false");
  });

  it("restores the URL selection on browser history navigation", () => {
    render(<Navigator />);
    window.history.replaceState(null, "", "/parameters?moduleNode=power%2F%E7%94%B5%E6%B1%A0");
    fireEvent.popState(window);
    expect(screen.getByRole("treeitem", { name: /电池/ })).toHaveAttribute("aria-selected", "true");
    window.history.replaceState(null, "", "/parameters");
    fireEvent.popState(window);
    expect(screen.getByRole("treeitem", { name: /电池/ })).toHaveAttribute("aria-selected", "false");
  });

  it.each(["/parameters", "/node-debugging", "/dts-reload"])(
    "restores selection after reload and clears it on reselect on %s", (route) => {
      window.history.replaceState({ retained: true }, "", `${route}?project=aurora#details`);
      const historyLength = window.history.length;
      const first = render(<Navigator />);
      fireEvent.click(screen.getByRole("treeitem", { name: /电池/ }));
      expect(window.history.length).toBe(historyLength);
      expect(new URL(window.location.href).searchParams.get("moduleNode")).toBe("power/电池");
      expect(window.location.search).toContain("project=aurora");
      expect(window.location.hash).toBe("#details");
      expect(window.history.state).toEqual({ retained: true });
      first.unmount();
      render(<Navigator />);
      const selected = screen.getByRole("treeitem", { name: /电池/ });
      expect(selected).toHaveAttribute("aria-selected", "true");
      fireEvent.click(selected);
      expect(selected).toHaveAttribute("aria-selected", "false");
      expect(new URL(window.location.href).searchParams.has("moduleNode")).toBe(false);
      expect(window.location.search).toBe("?project=aurora");
      expect(window.history.length).toBe(historyLength);
    }
  );
});
