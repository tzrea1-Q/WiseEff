import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createParameterTopologyRuntime } from "@/application/parameters/parameterTopologyRuntime";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import {
  mapParameterSpecToLibraryRow,
  ParameterSpecLibrary
} from "@/components/parameter-topology/ParameterSpecLibrary";

describe("mock runtime semantic parameter model (seam)", () => {
  it("existing ParameterSpecLibrary renders specs loaded from the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();
    const dispatch = vi.fn();
    const runtime = createParameterTopologyRuntime({
      runtimeMode: "mock",
      dispatch,
      repository
    });

    const result = await runtime.listSpecs({});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const rows = result.value.map((item) =>
      mapParameterSpecToLibraryRow({
        id: item.id,
        organizationId: item.organizationId ?? null,
        propertyKey: item.propertyKey,
        specificationKey: item.specificationKey,
        driverModule: item.driverModule,
        lifecycle: item.lifecycle,
        currentVersion: item.currentVersion
      })
    );

    render(
      <ParameterSpecLibrary
        specs={rows}
        loading={false}
        selectedSpecId={null}
        detail={null}
        onSelectSpec={() => undefined}
      />
    );

    const library = screen.getByRole("region", { name: "参数库" });
    expect(library).toBeInTheDocument();
    expect(screen.getAllByText("gpio_int").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sc8562").length).toBeGreaterThan(0);
    // Spec identity is not rendered as a path-derived flat key
    expect(screen.queryByText(/amba\/i2c/)).not.toBeInTheDocument();
  });
});
