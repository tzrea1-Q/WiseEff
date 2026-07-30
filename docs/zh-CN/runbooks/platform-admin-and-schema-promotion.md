# 平台超级管理员与驱动 schema 晋升

> English: [English](../../runbooks/platform-admin-and-schema-promotion.md)

跨组织角色 `platform-admin`，以及将组织驱动 schema 覆盖晋升为平台层的运维步骤（ADR-0009）。

## 生产环境引导首位平台超级管理员

没有自助路径。自助注册与普通组织 Admin 的用户治理都不能授予 `platform-admin`。

1. 确认已应用至 `0078_platform_admin_role.sql`（若要做覆盖晋升，还需 `0079`）。
2. 选定已有活跃用户，或先用 `users:manage` 创建普通组织 Admin。
3. 带外写入角色绑定（SQL 示例，替换 id）：

```sql
insert into user_role_bindings (id, user_id, organization_id, project_id, role_id, created_at)
values (
  'urb-platform-admin-bootstrap',
  '<user_id>',
  '<home_organization_id>',
  null,
  'platform-admin',
  now()
);
```

4. 确认 `/api/v1/me` 返回 `platform-admin`，且权限含 `platform:access` 与 `platform:schema-promote`。
5. 确认可见 `/platform-console`，且只有该用户在 `/user-permissions` 看到平台超级管理员授予控件。

开发种子（`npm run db:seed:m0`，`NODE_ENV=development`）已为 ChargeLab 演示管理员绑定 `platform-admin`。

## 将覆盖晋升到平台层

影响面：从未编写该 compatible 覆盖的组织，会在下次 ingest 开始解析它。贡献方组织的覆盖会被标记为已取代（不删除）。

1. 以 `platform-admin` 打开 `/platform-console`。
2. 查看候选列表。仅对 `equivalent: true` 的行晋升。若有分歧，先线下对齐——接口不会合并不同的值形状。
3. 确认对话框写明跨租户影响面与文档来源组织。
4. 执行晋升后应看到：一条平台覆盖（`organization_id IS NULL`）、贡献方覆盖为 `superseded`、链接的 ParameterSpec 提升为平台作用域且 id 不变、平台与各租户审计事件。
5. 在从未编写该覆盖的租户归属树上抽检：芯片应为平台已覆盖。

## 撤销晋升

1. 在控制台撤销晋升。
2. 平台行应变为 deprecated，贡献方覆盖恢复为 `active`。
3. 组织侧芯片应回到组织覆盖（如适用）。

## 护栏

- 只有已持有 `platform-admin` 的调用方才能授予或撤销该角色。
- 平台超级管理员不会扩大对其他组织参数、日志、用户或项目的访问。
- 优先走产品控制台。直接改库仅作应急，并需使 schema 注册表进程缓存失效（不确定时可重启 API 进程）。

## 手工验收：`DRV-PROMOTE-001`～`004`（逐步）

本地 API 模式。演示账号：`xu.yun` / `WiseEff-Dev!`（ChargeLab Admin，且应已有 `platform-admin`）。

### 芯片文案对照（先认字）

| 你在 UI 上看到的 | 含义 |
| --- | --- |
| 组织级解析覆盖 | 本组织配置的解析覆盖正在生效 |
| 官方解析覆盖 | 官方（仓库内置）解析覆盖，或本组织贡献已晋升至平台后的展示态 |
| 被更高优先级覆盖 | 存在更高优先级的解析覆盖，本组织级覆盖当前不参与匹配 |
| 平台级解析覆盖 | 平台级解析覆盖正在生效（非本组织贡献晋升场景） |
| 解析未覆盖 | 尚无可用解析覆盖；可执行「配置组织级解析」 |

入口固定为：

1. 登录 `xu.yun`
2. 打开 **参数后台** → **组织配置** → **驱动归属**（路由 `/parameter-admin/modules`）
3. 需要晋升时再打开 **平台控制台**（`/platform-console`）

### 共用准备：登记未覆盖驱动 + 激活组织 overlay

若控制台里已有候选（例如 `vendor,fold_registry_test`）且贡献组织是 ChargeLab，可跳过准备，直接从各 ID 的「晋升」步开始。

1. 在归属树点 **登记驱动**（或「未登记驱动」队列里的认领）。
2. 填写：
   - 显示名称：任意，如 `Accept Promote Demo`
   - 业务分类：选一个已有业务分类（如 Power）
   - compatible：一行一条，用**确定未被 pinned 覆盖**的值，例如 `vendor,accept-promote-demo`
3. 确认后树里出现驱动组；点该行 **修改**。
4. 在「compatible 匹配规则」里该条应显示 **解析未覆盖**，点 **配置组织级解析**。
5. 在对话框里 **添加参数定义** → 选用已有定义或新建（至少一个属性）→ **保存并激活**。
6. 期望：页面提示已激活；再打开该驱动组，规则旁为 **组织级解析覆盖**；树芯片同文案。

### `DRV-PROMOTE-002`：晋升至平台后贡献方看到「官方解析覆盖」

1. 用同一账号打开 `/platform-console`。
2. 找到刚准备的 compatible（或已有等价候选），点 **查看贡献详情** 确认 `属性等价`，再点 **晋升至平台**，读完跨租户影响面后确认。
3. 回到 `/parameter-admin/modules`，刷新。
4. 找到**当初配置组织级解析的那个驱动组** → **修改**。
5. 期望：该 compatible 旁为 **官方解析覆盖**（不是空白、也不是「解析未覆盖」或「组织级解析覆盖」）；树芯片同文案。  
   说明数据仍在，生命周期变为被平台级覆盖取代，界面按官方覆盖展示。

### `DRV-PROMOTE-003`：平台级已覆盖后再配置 → 被拒绝

说明：规则已由平台级覆盖时，模块编辑里 **不会再显示**「配置组织级解析」按钮（入口被收起）。验收以「无法再走配置成功路径 + API 拒绝文案」为准。

1. 接上一步，确认该 compatible 已是官方解析覆盖 / 平台级解析覆盖。
2. 在模块编辑里确认：**没有**「配置组织级解析」按钮。
3. 再用 API 证实拒绝原因（把 `$TOKEN` 换成当前登录 token）：

```bash
curl -sS -X POST "http://127.0.0.1:8787/api/v2/organization-driver-schemas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "compatible": "vendor,accept-promote-demo",
    "displayName": "should-fail",
    "properties": [{ "propertyKey": "demo_prop", "valueShape": { "kind": "string" } }]
  }'
```

4. 期望：HTTP 409，正文含 `An active platform overlay already covers this compatible`。  
   若 UI 某条保存路径碰到同一错误，前端会显示：**该驱动已存在平台级解析覆盖，无法再配置组织级解析。**

### `DRV-PROMOTE-004`：从未配置该组织级解析的组织也看到平台级解析覆盖

Development 下自助注册会进 ChargeLab，需要另建一个组织管理员（一次性 SQL，密码哈希复用 `xu.yun`）：

```sql
insert into organizations (id, name) values ('org-accept-b', 'Accept Org B')
  on conflict (id) do nothing;

insert into users (id, organization_id, name, title, is_active, last_active_at)
values ('u-accept-b-admin', 'org-accept-b', 'Accept B Admin', 'Admin', true, now())
  on conflict (id) do nothing;

insert into user_role_bindings (id, user_id, organization_id, project_id, role_id, created_at)
values ('urb-accept-b-admin', 'u-accept-b-admin', 'org-accept-b', null, 'admin', now())
  on conflict (id) do nothing;

insert into user_password_credentials (user_id, username, password_hash)
select 'u-accept-b-admin', 'accept.b', password_hash
from user_password_credentials where username = 'xu.yun'
on conflict (user_id) do nothing;
```

1. 确认 `DRV-PROMOTE-002` 已对同一 compatible 完成晋升。
2. 退出，用 `accept.b` / `WiseEff-Dev!` 登录。
3. 打开 `/parameter-admin/modules`，**登记驱动**，compatible 填**同一个**值（如 `vendor,accept-promote-demo`），**不要**再写 overlay。
4. 打开该驱动组 → **修改**。
5. 期望：规则旁为 **平台级解析覆盖** / **官方解析覆盖**，树芯片同文案——表示平台层对该组织也生效，而不是「解析未覆盖」。

### `DRV-PROMOTE-001`：被更高优先级覆盖（与晋升后的「官方解析覆盖」不同）

「被更高优先级覆盖」≠ 晋升后的「官方解析覆盖」。

- **官方解析覆盖（晋升后）**：本组织 overlay 已 `superseded`（走控制台晋升至平台就会进入此态）→ 用 `002` 验收。
- **被更高优先级覆盖**：组织 overlay **仍为 active**，但匹配输给更高层（pinned vendor/linux，或未 supersede 的平台行）。

产品晋升至平台路径会把贡献方标成 `superseded`，因此**正常点「晋升至平台」测到的是 002，不是 001**。本地要看到未生效芯片，需模拟「高层已盖住、组织行仍 active」：

1. 另选一个未占用的 compatible，如 `vendor,accept-shadow-demo`，按「共用准备」配置并激活组织级解析，确认 **组织级解析覆盖**。
2. 应急 SQL：插入一条同 compatible 的 **platform** active 行（`organization_id IS NULL`），**不要**把组织行改成 `superseded`（可参考库里已有平台行的列，复制结构后改 id/compatible）。然后重启 API（清 schema 缓存）。
3. 刷新归属树与模块编辑。
4. 期望：规则旁 **被更高优先级覆盖**；树芯片同文案。
5. 测完删掉该模拟平台行并重启 API，避免污染后续用例。

若时间紧：至少用 `002` 证明「不是数据丢了」；`001` 记为「需模拟双层同时 active」并保留上述步骤证据。
