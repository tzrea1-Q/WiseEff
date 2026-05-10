import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ParameterKeyTooltip } from "../components/ParameterKeyTooltip";

describe("ParameterKeyTooltip", () => {
  it("shows parameter metadata on hover and hides it on mouse leave", () => {
    render(
      <ParameterKeyTooltip
        parameterKey="fast_charge_current_limit_ma"
        module="Charging Policy"
        description="限制快充阶段的最大充电电流。"
        risk="High"
      />
    );

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "fast_charge_current_limit_ma" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("限制快充阶段的最大充电电流。");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Charging Policy");
    expect(screen.getByRole("tooltip")).toHaveTextContent("High");

    fireEvent.mouseLeave(screen.getByRole("button", { name: "fast_charge_current_limit_ma" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the tooltip when the key receives focus", () => {
    render(
      <ParameterKeyTooltip
        parameterKey="battery_temp_target_c"
        module="Battery Safety"
        description="电池目标温度。"
        risk="Medium"
      />
    );

    fireEvent.focus(screen.getByRole("button", { name: "battery_temp_target_c" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("电池目标温度。");
  });
});
