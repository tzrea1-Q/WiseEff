import { test } from "playwright/test";

test.describe("DTS reload workbench hand-off", () => {
  test("DTS-RELOAD-HANDOFF-001: carry selected bindings from /parameters into /dts-reload", async ({
    page
  }) => {
    // @acceptance-planned DTS-RELOAD-HANDOFF-001
    // @operation-planned DTS-RELOAD-HANDOFF-001
    test.skip(
      true,
      "Pending: playwright coverage for workbench 带到参数调试 deep link (?project=&bindingIds=) and the /dts-reload hand-off banner. Unit coverage is in handoff.test.ts / DtsParameterWorkbench.test.tsx / DtsReloadPage.test.tsx."
    );
    void page;
  });
});
