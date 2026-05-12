import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { projects } from "../../mockData";
import { ComparisonHeader } from "../components/ComparisonHeader";

describe("ComparisonHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders breadcrumb, dynamic title, and project chips", () => {
    render(
      <ComparisonHeader
        projects={projects}
        baseProject={projects[0]}
        targetProject={projects[1]}
        onNavigate={() => undefined}
        onBaseProjectChange={() => undefined}
        onTargetProjectChange={() => undefined}
        onSwap={() => undefined}
        onExport={() => undefined}
      />
    );

    expect(screen.getByRole("navigation", { name: "参数对比路径" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`基准项目 ${projects[0].code}`) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`对比项目 ${projects[1].code}`) })).toBeInTheDocument();
  });

  it("fires navigation, swap, and export actions", () => {
    const onNavigate = vi.fn();
    const onSwap = vi.fn();
    const onExport = vi.fn();
    render(
      <ComparisonHeader
        projects={projects}
        baseProject={projects[0]}
        targetProject={projects[1]}
        onNavigate={onNavigate}
        onBaseProjectChange={() => undefined}
        onTargetProjectChange={() => undefined}
        onSwap={onSwap}
        onExport={onExport}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "参数" }));
    fireEvent.click(screen.getByRole("button", { name: "交换基准和对比项目" }));
    fireEvent.click(screen.getByRole("button", { name: "导出对比结果" }));

    expect(onNavigate).toHaveBeenCalledWith("/parameters");
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
