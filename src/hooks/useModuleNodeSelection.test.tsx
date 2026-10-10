import { fireEvent, render, screen } from "@testing-library/react";
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

afterEach(() => window.history.replaceState(null, "", "/"));

describe("module node URL selection", () => {
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
      const first = render(<Navigator />);
      fireEvent.click(screen.getByRole("treeitem", { name: /电池/ }));
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
    }
  );
});
