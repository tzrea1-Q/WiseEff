import { describe, expect, it } from "vitest";

import { catalogSubjectTypeLabel } from "./catalogPresentation";

describe("catalog presentation", () => {
  it("labels all canonical subject kinds, including ConfigurationSchema", () => {
    expect(catalogSubjectTypeLabel("driver")).toBe("驱动");
    expect(catalogSubjectTypeLabel("node-type")).toBe("节点类型");
    expect(catalogSubjectTypeLabel("configuration-schema")).toBe("配置模型");
  });
});
