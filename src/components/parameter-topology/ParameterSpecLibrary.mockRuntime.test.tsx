import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";
import {
  mapParameterSpecToLibraryRow,
  ParameterSpecLibrary,
  formatSpecPrimaryLabel,
} from "@/components/parameter-topology/ParameterSpecLibrary";

describe("mock runtime semantic parameter model (seam)", () => {
  it("existing ParameterSpecLibrary renders specs loaded from the mock topology adapter", async () => {
    const repository = createMockParameterTopologyRepository();

    const specs = await repository.listSpecs({});

    const rows = specs.map((item) =>
      mapParameterSpecToLibraryRow({
        id: item.id,
        organizationId: item.organizationId ?? null,
        propertyKey: item.propertyKey,
        specificationKey: item.specificationKey,
        driverModule: item.driverModule,
        lifecycle: item.lifecycle,
        currentVersion: item.currentVersion,
        attributionModules: item.attributionModules,
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

    const library = screen.getByRole("region", { name: "参数定义库" });
    expect(library).toBeInTheDocument();
    expect(screen.getAllByText(/gpio_int/).length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "参数定义" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "驱动模块" })).toBeInTheDocument();
    if (rows[0]) {
      expect(screen.getAllByText(formatSpecPrimaryLabel(rows[0])).length).toBeGreaterThan(0);
    }
    // Spec identity is not rendered as a path-derived flat key
    expect(screen.queryByText(/amba\/i2c/)).not.toBeInTheDocument();
  });
});
