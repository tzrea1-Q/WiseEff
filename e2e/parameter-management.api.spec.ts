import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { expect, test } from "playwright/test";
import { apiRoute, smokeHeaders } from "./acceptance/helpers/runtime";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const parameterName = "fast_charge_current_limit_ma";
const parameterValueId = `${projectId}-fast-charge-current`;
const actorUserId = "u-xu-yun";
const targetValue = String(3300 + (Date.now() % 100));
const changeReason = `M1 E2E acceptance ${Date.now()}`;

function runNpmScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}

async function seedWorkflowUsers(client: Client) {
  const users = [
    ["u-wang-jie", "Wang Jie", "wang@chargelab.cn", "Hardware Reviewer", "hardware-committer"],
    ["u-sun-mei", "Sun Mei", "sun@chargelab.cn", "Software Reviewer", "software-committer"],
    ["u-liu-min", "Liu Min", "liu@chargelab.cn", "Software Engineer", "software-user"]
  ] as const;

  for (const [userId, name, email, title, roleId] of users) {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, 'org-chargelab', $2, $3, $4, true)
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [userId, name, email, title]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, 'org-chargelab', $3, $4)
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [`e2e-${userId}-${roleId}-${projectId}`, userId, projectId, roleId]
    );
  }
}

async function cleanupOpenE2ERequests(client: Client) {
  const requests = await client.query<{ id: string; submission_round_id: string | null }>(
    `
    select cr.id, cr.submission_round_id
    from parameter_change_requests cr
    join parameter_submission_items psi on psi.change_request_id = cr.id
    where psi.reason like 'M1 E2E acceptance%'
      and cr.status not in ('merged', 'rejected')
    `
  );
  const requestIds = requests.rows.map((row) => row.id);
  const roundIds = Array.from(
    new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
  );

  if (requestIds.length > 0) {
    await client.query("delete from parameter_review_decisions where request_id = any($1::text[])", [requestIds]);
    await client.query("delete from parameter_submission_items where change_request_id = any($1::text[])", [requestIds]);
    await client.query("delete from parameter_change_requests where id = any($1::text[])", [requestIds]);
  }
  if (roundIds.length > 0) {
    await client.query(
      `
      delete from parameter_submission_rounds
      where id = any($1::text[])
        and not exists (
          select 1 from parameter_change_requests
          where parameter_change_requests.submission_round_id = parameter_submission_rounds.id
        )
      `,
      [roundIds]
    );
  }

  await client.query(
    `
    delete from parameter_drafts
    where project_id = $1
      and user_id = $2
      and project_parameter_value_id = $3
    `,
    [projectId, actorUserId, parameterValueId]
  );
}

test.beforeAll(async () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the M1 parameter management API E2E smoke.");
  }

  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await cleanupOpenE2ERequests(client);
    await seedWorkflowUsers(client);
  } finally {
    await client.end();
  }
});

test("M1 parameter management loop persists a merged parameter change and audit evidence", async ({ page }) => {
  await page.goto(`/parameters?project=${projectId}`);

  const searchTable = page.getByRole("region", { name: "检索参数表" });
  await expect(searchTable).toContainText(parameterName);
  await searchTable.getByRole("button", { name: "筛选重要性" }).click();
  await page.getByRole("checkbox", { name: /高/ }).check();
  await expect(searchTable).toContainText(parameterName);

  await searchTable.getByRole("button", { name: `查看 ${parameterName}` }).click();
  const detailDialog = page.getByRole("dialog", { name: parameterName });
  await expect(detailDialog.getByText("近期历史")).toBeVisible();
  await detailDialog.getByRole("button", { name: "加入修改草稿" }).click();

  const draftDialog = page.getByRole("dialog", { name: "修改草稿" });
  await draftDialog.getByLabel("目标值").fill(targetValue);
  await draftDialog.getByLabel("修改原因").fill(changeReason);
  await draftDialog.getByRole("button", { name: "提交参数" }).click();

  const modifiedSection = page.getByRole("region", { name: "本轮已修改参数区" });
  await expect(modifiedSection).toContainText(targetValue);
  await modifiedSection.getByRole("button", { name: "提交本轮 (1 项)" }).click();

  const submitDialog = page.getByRole("dialog", { name: "提交本轮参数" });
  await submitDialog.getByLabel("硬件 MDE").selectOption({ label: "Wang Jie" });
  await submitDialog.getByLabel("软件 MDE").selectOption({ label: "Sun Mei" });
  await submitDialog.getByLabel("软件开发").selectOption({ label: "Liu Min" });
  await submitDialog.getByRole("button", { name: "确认提交" }).click();
  await expect(submitDialog).not.toBeVisible();

  await page.goto("/parameter-review");
  const requestRow = page.getByRole("row").filter({ hasText: targetValue }).first();
  await expect(requestRow).toBeVisible();
  const requestId = ((await requestRow.locator("td").first().textContent()) ?? "").trim();
  expect(requestId).not.toEqual("");
  await requestRow.click();

  const reviewDetail = page.getByRole("complementary", { name: "审阅详情" });
  const currentStep = reviewDetail.locator(".vertical-timeline-item--current");
  await expect(currentStep).toContainText("硬件MDE检视");
  await reviewDetail.getByRole("button", { name: "推进流程" }).click();
  await expect(currentStep).toContainText("软件MDE检视");
  await reviewDetail.getByRole("button", { name: "推进流程" }).click();
  await expect(currentStep).toContainText("软件开发人员合入");
  await reviewDetail.getByRole("button", { name: "推进流程" }).click();

  await page.getByRole("tab", { name: "历史提交" }).click();
  await expect(page.getByRole("row").filter({ hasText: targetValue }).first()).toContainText("已合入");

  await page.goto(`/parameters?project=${projectId}`);
  await page.reload();
  await page.getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" }).fill(parameterName);
  const mergedRow = searchTable.getByRole("row").filter({ hasText: parameterName }).first();
  await expect(mergedRow.locator(".parameter-value-diff > span").first()).toHaveText(targetValue);

  await page.goto("/parameter-admin?audit=open");
  await expect(page).toHaveURL(/\/audit/);
  await expect(page.getByLabelText("搜索审计记录")).toBeVisible();
  const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
  expect(auditResponse.ok()).toBe(true);
  const auditBody = (await auditResponse.json()) as {
    items: Array<{ kind: string; action: string; projectId: string | null; targetId: string | null }>;
  };
  expect(auditBody.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "merge",
        kind: "parameter-merge",
        projectId,
        targetId: requestId
      })
    ])
  );
});
