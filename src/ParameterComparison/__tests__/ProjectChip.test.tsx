import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { projects } from "../../mockData";
import { ProjectChip } from "../components/ProjectChip";

describe("ProjectChip", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the selected project code and name", () => {
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        projects={projects}
        selectedProjectId={projects[0].id}
        disabledProjectId={projects[1].id}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: /基准项目/ })).toHaveTextContent(projects[0].code);
    expect(screen.getByRole("button", { name: /基准项目/ })).toHaveTextContent(projects[0].name);
  });

  it("opens a searchable list of projects", () => {
    render(
      <ProjectChip
        label="对比项目"
        tone="target"
        projects={projects}
        selectedProjectId={projects[1].id}
        disabledProjectId={projects[0].id}
        onSelect={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /对比项目/ }));
    fireEvent.change(screen.getByPlaceholderText("搜索项目"), { target: { value: projects[2].code } });

    const listbox = screen.getByRole("listbox", { name: "对比项目列表" });
    expect(within(listbox).getByRole("option", { name: new RegExp(projects[2].code) })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: new RegExp(projects[1].code) })).not.toBeInTheDocument();
  });

  it("does not select the disabled project", () => {
    const onSelect = vi.fn();
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        projects={projects}
        selectedProjectId={projects[0].id}
        disabledProjectId={projects[1].id}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(projects[1].code) }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects an available project and closes the popover", () => {
    const onSelect = vi.fn();
    render(
      <ProjectChip
        label="基准项目"
        tone="base"
        projects={projects}
        selectedProjectId={projects[0].id}
        disabledProjectId={projects[1].id}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /基准项目/ }));
    fireEvent.click(screen.getByRole("option", { name: new RegExp(projects[2].code) }));

    expect(onSelect).toHaveBeenCalledWith(projects[2].id);
    expect(screen.queryByRole("listbox", { name: "基准项目列表" })).not.toBeInTheDocument();
  });
});
