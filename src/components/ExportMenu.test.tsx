import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "./ExportMenu";

afterEach(() => {
  cleanup();
});

describe("ExportMenu", () => {
  it("expands three export actions", () => {
    render(<ExportMenu onDownload={vi.fn()} onCopy={vi.fn()} onViewDiff={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /导出 JSON/ }));

    expect(screen.getByRole("menuitem", { name: /下载/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /复制到剪贴板/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /查看导出/ })).toBeInTheDocument();
  });

  it("calls the matching callback from a menu action", () => {
    const onDownload = vi.fn();
    const onCopy = vi.fn();
    const onViewDiff = vi.fn();
    render(<ExportMenu onDownload={onDownload} onCopy={onCopy} onViewDiff={onViewDiff} />);

    fireEvent.click(screen.getByRole("button", { name: /导出 JSON/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /下载/ }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
    expect(onViewDiff).not.toHaveBeenCalled();
  });
});
