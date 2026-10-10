import { expect, test } from "playwright/test";
import { collectConsistencyMeasurements, installConsistencyReadGuard } from "./consistency";
import { requirePrimaryActionColors } from "./primary-color";
import { requireOrganizationViewSwitchStyles } from "./view-switch";
import { settleQualityRoute } from "./helpers";

test("resolves all three root switch signatures and catches scoped geometry or semantic drift", async ({ page }) => {
  await page.setContent(`
    <style>
      :root {
        --space-10: 40px; --space-8: 32px; --space-6: 24px; --space-1: 4px;
        --radius-full: 999px; --radius-md: 8px; --radius-sm: 6px;
        --text-md: 14px; --text-base: 13px; --text-sm: 12px;
        --leading-md: 22px; --leading-base: 20px; --leading-sm: 18px;
        --view-switch-font-weight: 600;
        --surface: rgb(255, 255, 255); --surface-sunken: rgb(247, 249, 252);
        --nav-selected: rgb(0, 61, 155); --accent-soft: rgb(218, 226, 255);
      }
      button { display: inline-block; box-sizing: border-box; font-weight: var(--view-switch-font-weight); background: var(--surface); }
      nav button { height: var(--space-10); border-radius: var(--radius-full); font-size: var(--text-md); line-height: var(--leading-md); }
      [role="tab"] { height: var(--space-8); border-radius: var(--radius-md); font-size: var(--text-base); line-height: var(--leading-base); }
      [role="radio"] { height: calc(var(--space-6) + var(--space-1)); border-radius: var(--radius-sm); font-size: var(--text-sm); line-height: var(--leading-sm); background: var(--surface-sunken); }
      [aria-current="page"] { background: var(--nav-selected); }
      [aria-selected="true"] { background: var(--accent-soft); }
      [aria-checked="true"] { background: var(--surface); }
      .scoped { --space-10: 43px; }
    </style>
    <main>
      <nav aria-label="组织范围"><button class="view-switch__item" aria-current="page">组织管理</button><button class="view-switch__item">人员管理</button></nav>
      <div role="tablist"><button class="view-switch__item" role="tab" aria-selected="true">账号库</button><button class="view-switch__item" role="tab" aria-selected="false">注册申请</button></div>
      <div role="radiogroup"><button class="view-switch__item" role="radio" aria-checked="true">全部</button><button class="view-switch__item" role="radio" aria-checked="false">我的</button></div>
      <div hidden><button class="view-switch__item" role="tab">隐藏</button></div>
    </main>
  `);
  const measurements = await page.evaluate(collectConsistencyMeasurements);
  expect(measurements.viewSwitches).toHaveLength(6);
  expect(measurements.viewSwitchSignatures.map((style) => [style.variant, style.height])).toEqual([["section", 40], ["tabs", 32], ["toggle", 28]]);
  expect(() => requireOrganizationViewSwitchStyles(measurements, "/organization/members")).not.toThrow();
  await page.locator("nav").evaluate((element) => element.classList.add("scoped"));
  const overridden = await page.evaluate(collectConsistencyMeasurements);
  expect(overridden.viewSwitchSignatures[0].height).toBe(40);
  expect(() => requireOrganizationViewSwitchStyles(overridden, "/organization/members")).toThrow("matched 0");
  await page.locator("nav").evaluate((element) => element.classList.remove("scoped"));
  await page.getByRole("tablist").evaluate((element) => {
    element.removeAttribute("role");
    element.querySelectorAll("button").forEach((button) => button.removeAttribute("role"));
  });
  const missingRoles = await page.evaluate(collectConsistencyMeasurements);
  expect(missingRoles.viewSwitches).toHaveLength(6);
  expect(() => requireOrganizationViewSwitchStyles(missingRoles, "/organization/members")).toThrow("matched 0");
});

for (const [theme, primaryColor] of [["light", "rgb(0, 82, 204)"], ["dark", "rgb(76, 141, 255)"]]) {
  test(`resolves the root primary color without hiding scoped overrides (${theme})`, async ({ page }) => {
    await page.setContent(`
      <style>
        :root { --primary: ${primaryColor}; }
        button, a { display: inline-block; height: 32px; }
        .primary, .is-primary, [data-variant="default"] { background: var(--primary); }
        :disabled, [aria-disabled="true"] { background: rgb(233, 238, 251); }
        .scoped { --primary: rgb(0, 61, 155); }
      </style>
      <main>
        <button class="button primary" disabled>提交</button>
        <button class="button primary" aria-disabled="true">不可用</button>
        <a class="button primary local-device-bridge-panel__install-cta" href="#">安装</a>
        <button data-slot="button" data-variant="default">检索</button>
        <button class="button is-primary">应用</button>
        <nav><button aria-current="page">选中导航</button></nav>
        <div hidden><button class="button primary">隐藏</button></div>
      </main>
    `);
    const measurements = await page.evaluate(collectConsistencyMeasurements);
    expect(measurements.primaryActions).toHaveLength(5);
    expect(measurements.primaryActions.map((action) => action.primaryColor)).toEqual(Array(5).fill(primaryColor));
    expect(measurements.primaryActions.map((action) => action.disabled)).toEqual([true, true, false, false, false]);
    expect(() => requirePrimaryActionColors(measurements, "/fixture")).not.toThrow();
    await page.locator("main").evaluate((element) => element.classList.add("scoped"));
    const overridden = await page.evaluate(collectConsistencyMeasurements);
    expect(() => requirePrimaryActionColors(overridden, "/fixture")).toThrow("must equal primary");
  });
}

test("collects visible view-switch signatures without enforcing a design", async ({ page }) => {
  await page.setContent(`
    <style>
      button, a { display: inline-block; height: 32px; box-sizing: border-box; border-radius: 8px; font-size: 13px; }
      [aria-selected="true"], [aria-checked="true"], [aria-current="page"] { background: rgb(0, 61, 155); }
    </style>
    <main>
      <nav aria-label="模块"><a href="#" aria-current="page">目录</a></nav>
      <div role="tablist"><button role="tab" aria-selected="true">待审核</button><button role="tab" aria-selected="false">历史</button></div>
      <div role="radiogroup"><button role="radio" aria-checked="true">概览</button></div>
      <div class="protocol-switch"><button class="protocol-switch-button active">协议</button></div>
      <ol class="local-device-bridge-wizard__steps"><li data-active="true">安装</li></ol>
      <div hidden><button role="tab">隐藏</button></div>
    </main>
  `);

  const measurements = await page.evaluate(collectConsistencyMeasurements);
  expect(measurements.viewSwitches).toHaveLength(6);
  expect(measurements.viewSwitches).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: "link", groupRole: "navigation", selected: true, height: 32, radius: "8px 8px 8px 8px", fontSize: "13px", background: "rgb(0, 61, 155)" }),
    expect.objectContaining({ role: "tab", groupRole: "tablist", selected: false }),
    expect.objectContaining({ role: "radio", groupRole: "radiogroup", selected: true }),
    expect.objectContaining({ role: "button", selected: true }),
    expect.objectContaining({ role: "listitem", selected: true })
  ]));
});

test("settles read-only Bridge routes without waiting for a POST-created pairing code", async ({ page }) => {
  await page.setContent("<main><p>已识别当前环境</p><p>Fast charge current</p><p>运行历史</p></main>");
  await settleQualityRoute(page, "/node-debugging", { readOnly: true });
  await settleQualityRoute(page, "/dts-reload", { readOnly: true });
});

test("settles project review roles on its loaded governance content, not a DTS file", async ({ page }) => {
  await page.setContent("<main><h1>aurora 项目审核角色配置</h1><h2>组织成员职责授权</h2></main>");
  await settleQualityRoute(page, "/parameter-admin/projects/aurora/review-roles", { readOnly: true });
});

test("stubs Bridge pairing setup without sending a POST to the server", async ({ context, page }) => {
  const forwarded: string[] = [];
  await context.route("https://consistency.example/**", async (route) => {
    forwarded.push(route.request().method());
    await route.fulfill({ contentType: "text/html", body: "<main>只读</main>" });
  });
  const blocked = await installConsistencyReadGuard(context);
  await page.goto("https://consistency.example/");
  const response = await page.evaluate(async () => {
    const response = await fetch("/api/v1/device-bridges/pairing-codes", { method: "POST" });
    return { status: response.status, body: await response.json() };
  });
  expect(response.status).toBe(201);
  expect(response.body.code).toMatch(/^\d{6}$/);
  expect(Date.parse(response.body.expiresAt)).toBeGreaterThan(Date.now());
  expect(forwarded).toEqual(["GET"]);
  expect(blocked).toEqual([]);
});

test("includes topbar primary actions and table-header filters", async ({ page }) => {
  await page.setContent(`
    <header><button class="button primary">上传</button></header>
    <main><div role="table"><div role="rowgroup"><div role="row"><span role="columnheader"><button class="parameters-column-filter__trigger">筛选模块</button></span></div></div></div></main>
  `);
  const measurements = await page.evaluate(collectConsistencyMeasurements);
  expect(measurements.primaryActions).toHaveLength(1);
  expect(measurements.filterControls).toHaveLength(1);
});

test("blocks every non-GET request before it reaches the server", async ({ context, page }) => {
  const forwarded: string[] = [];
  await context.route("https://consistency.example/**", async (route) => {
    forwarded.push(route.request().method());
    await route.fulfill({ contentType: "text/html", body: "<main>只读</main>" });
  });
  const blocked = await installConsistencyReadGuard(context);
  await page.goto("https://consistency.example/");
  const results = await page.evaluate(async () => {
    const results: boolean[] = [];
    for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
      results.push(await fetch(`/probe?token=private`, { method }).then(() => true, () => false));
    }
    return results;
  });
  expect(results).toEqual([true, false, false, false, false, false, false]);
  expect(forwarded).toEqual(["GET", "GET"]);
  expect(blocked).toEqual(["HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ method, pathname: "/probe" })));
  expect(JSON.stringify(blocked)).not.toContain("private");
});

test("collects primary colors, row geometry, overlays, tree anchors and control heights", async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin: 0; }
      .clip { position: absolute; left: 20px; top: 10px; width: 300px; height: 80px; overflow: hidden; }
      .data-table-scroll { position: absolute; top: 20px; width: 300px; height: 100px; overflow: auto; }
      [role="table"] { width: 400px; height: 240px; }
      [role="row"] { position: relative; width: 360px; height: 40px; }
      [role="cell"] { position: absolute; left: 330px; width: 80px; height: 40px; }
      .xiaoze-chat-toggle, .xiaoze-toggle-hint { position: fixed; right: 10px; bottom: 10px; width: 40px; height: 40px; }
      .xiaoze-toggle-hint { bottom: 60px; width: 180px; }
      .controls { position: absolute; top: 200px; }
      select, button { box-sizing: border-box; height: 32px; }
      .library-sort { height: 28px; }
      .parameter-catalog__pagination button { height: 30px; }
      .button.primary { background: rgb(10, 20, 30); }
      .tree { position: absolute; top: 300px; }
      .dts-topology-navigator__label { display: block; margin-left: 32px; }
      [aria-level="2"] .dts-topology-navigator__label { margin-left: 48px; }
    </style>
    <main>
      <div class="clip"><div class="data-table-scroll"><div role="table"><div role="row"><div role="cell" class="dts-parameter-workbench-table__actions"><button>编辑</button></div></div></div></div></div>
      <div class="controls">
        <button class="button primary">提交</button>
        <select aria-label="项目筛选"><option>项目</option></select>
        <select class="library-sort" aria-label="排序"><option>名称</option></select>
        <nav class="parameter-catalog__pagination"><button aria-label="下一页">下一页</button></nav>
        <select hidden><option>隐藏</option></select>
      </div>
      <div class="tree" role="tree"><div role="treeitem" aria-level="1"><span class="dts-topology-navigator__label">模块</span></div><div role="treeitem" aria-level="2"><span class="dts-topology-navigator__label">参数</span></div></div>
      <ul class="parameter-catalog__tree"><li class="parameter-catalog__tree-node"><span class="parameter-catalog__tree-label">旧模块</span><ul><li class="parameter-catalog__tree-node"><span class="parameter-catalog__tree-label">旧参数</span></li></ul></li></ul>
    </main>
    <button class="xiaoze-chat-toggle">小泽</button><div class="xiaoze-toggle-hint">提示</div>
  `);

  const measurements = await page.evaluate(collectConsistencyMeasurements);
  expect(measurements.primaryActions).toEqual([expect.objectContaining({ background: "rgb(10, 20, 30)" })]);
  expect(measurements.rowActions).toEqual([expect.objectContaining({
    cell: expect.objectContaining({ left: 350, right: 430, height: 40 }),
    row: expect.objectContaining({ left: 20, right: 380, height: 40 })
  })]);
  expect(measurements.tableScrollports).toEqual([expect.objectContaining({ rect: { left: 20, top: 30, right: 320, bottom: 90, width: 300, height: 60 } })]);
  expect(measurements.xiaozeLaunchers).toEqual([expect.objectContaining({ rect: expect.objectContaining({ right: 1430, bottom: 890 }) })]);
  expect(measurements.xiaozeHints).toHaveLength(1);
  expect(measurements.moduleTreeLabels).toEqual(expect.arrayContaining([
    expect.objectContaining({ depth: 1, left: 32 }), expect.objectContaining({ depth: 2, left: 48 })
  ]));
  expect(measurements.moduleTreeLabels.map((label) => label.depth)).toEqual([1, 2, 1, 2]);
  expect(measurements.filterControls.map((control) => control.height)).toEqual([32]);
  expect(measurements.sortControls.map((control) => control.height)).toEqual([28]);
  expect(measurements.paginationControls.map((control) => control.height)).toEqual([30]);
});
