import { describe, expect, it, vi } from "vitest";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import { buildJsonWorkbenchCsv, downloadJsonWorkbenchCsv } from "./exportJsonWorkbenchRows";

const mockBinding: ProjectParameterBinding = {
  id: "binding-1",
  parameterSpecId: "spec-1",
  parameterSpecVersionId: "spec-v1",
  propertyKey: "charging-policy",
  driverModule: "charging",
  logicalNodeId: "node-1",
  instanceName: "charger0",
  locator: "/charger0",
  effectiveValue: { kind: "json", value: { maxVolt: 4200 } },
  rawValue: '{"maxVolt":4200}',
  schemaState: "valid",
  policyState: "pass",
  moduleId: "module-charging"
};

describe("exportJsonWorkbenchRows", () => {
  it("builds semantic CSV escaping special characters and formulas", () => {
    const csv = buildJsonWorkbenchCsv([
      mockBinding,
      {
        ...mockBinding,
        id: "binding-2",
        propertyKey: "=formula_prop",
        rawValue: '{"key":"value,with,comma"}'
      }
    ]);

    expect(csv).toContain("bindingId,propertyKey,moduleId,driverModule,instanceName,locator,rawValue,schemaState,policyState");
    expect(csv).toContain('binding-1,charging-policy,module-charging,charging,charger0,/charger0,"{""maxVolt"":4200}",valid,pass');
    expect(csv).toContain("'=formula_prop");
    expect(csv).toContain('"{""key"":""value,with,comma""}"');
  });

  it("triggers browser download with blob and anchor", () => {
    const clickMock = vi.fn();
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    vi.spyOn(document, "createElement").mockReturnValue({
      set href(val: string) {},
      set download(val: string) {},
      click: clickMock
    } as unknown as HTMLAnchorElement);

    downloadJsonWorkbenchCsv([mockBinding], "test-export.csv");
    expect(clickMock).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
