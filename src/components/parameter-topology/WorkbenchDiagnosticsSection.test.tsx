import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkbenchDiagnosticsSection } from "./WorkbenchDiagnosticsSection";

describe("WorkbenchDiagnosticsSection", () => {
  it("collapses dangling-reference warnings into one expandable summary", () => {
    render(
      <WorkbenchDiagnosticsSection
        diagnostics={[
          {
            code: "dangling-reference",
            severity: "warning",
            message:
              'Overlay target "&amba" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
          },
          {
            code: "dangling-reference",
            severity: "warning",
            message:
              'Overlay target "&charging_core" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
          },
          {
            code: "TOPOLOGY_NOT_READY",
            message: "拓扑尚未就绪，无法提交编辑。"
          }
        ]}
      />
    );

    const section = screen.getByRole("region", { name: "编译诊断" });
    expect(
      within(section).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    ).toBeVisible();
    expect(screen.queryByText(/Overlay target "&amba"/)).not.toBeInTheDocument();
    expect(screen.getByText("拓扑尚未就绪，无法提交编辑。")).toBeVisible();

    fireEvent.click(
      within(section).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    );
    expect(within(section).getByText("&amba")).toBeVisible();
    expect(within(section).getByText("&charging_core")).toBeVisible();
  });

  it("renders nothing when diagnostics are empty", () => {
    const { container } = render(<WorkbenchDiagnosticsSection diagnostics={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
