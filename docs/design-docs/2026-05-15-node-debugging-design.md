# Node Debugging Page Design

Date: 2026-05-15
Status: Approved for implementation planning

## Context

WiseEff currently has a parameter debugging page at `/debugging`. It is a React/Vite single page app with reducer-backed mock state and one Vite local API for writing the power management JSON config. The new node debugging page should keep the same operating style as the current parameter debugging page, but it must perform real device node reads and writes through `hdc`.

The browser cannot execute `hdc` directly, so real node debugging requires a local server-side bridge. The bridge will live in the Vite dev server, following the same local-only pattern already used by `/api/power-management-config`.

## Decisions

- Add a dedicated `/node-debugging` route under the debugging platform group.
- Reuse the existing debug parameter catalog instead of creating a separate node catalog.
- Add node metadata to each existing debug parameter:
  - `nodePath: string`
  - `accessMode: "RO" | "WO" | "RW"`
- Only `/debugging-admin` may show or edit `nodePath` and `accessMode`.
- The normal node debugging page must not show Linux node paths. Users operate on parameter/function names, not implementation paths.
- Entering `/node-debugging` automatically performs one HDC device detection.
- All writes require confirmation.
- `RW` writes automatically read back and succeed only when the returned value matches the target value.
- `WO` writes do not read back.
- `RO` items are read-only and never expose write actions.

## Goals

- Provide a real working node debugging page backed by `hdc`.
- Preserve the current parameter debugging page's layout, density, and interaction model.
- Keep Linux node implementation details out of the normal user workflow.
- Give Admin users a controlled place to maintain the node path and access mode metadata.
- Record enough operation evidence for failed reads, failed writes, and read-back mismatches.

## Non-Goals

- Do not add arbitrary node path input on the normal node debugging page.
- Do not support multiple target selection in the first version. Use the first target returned by `hdc list targets`.
- Do not replace the existing `/debugging` parameter debugging page.
- Do not build a production backend, database, authentication system, or real RBAC layer.

## Architecture

The feature has three layers:

1. **Configuration layer**
   - Extend `PowerManagementDebugParameter` and `src/config/power-management.json` with `nodePath` and `accessMode`.
   - Existing debug parameters remain the source of truth for node-debuggable functions.

2. **Local HDC bridge**
   - Add local Vite middleware under `/api/hdc/*`.
   - The middleware uses Node `child_process` to execute `hdc`.
   - The front end sends semantic requests such as detect target, read parameter node, and write parameter node. It never executes system commands directly.

3. **React UI**
   - Add `/node-debugging` as a sibling of `/debugging`.
   - Reuse the table, filters, connection state, details sheet pattern, and operation history style from the current parameter debugging page.
   - Add Admin editing fields to `/debugging-admin`.

## Data Model

Extend the debug parameter type:

```ts
export type PowerManagementDebugParameter = {
  id: string;
  name: string;
  key: string;
  description: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: PowerManagementRisk;
  status: "已同步" | "待下发" | "下发成功";
  nodePath: string;
  accessMode: "RO" | "WO" | "RW";
};
```

Initial `nodePath` values should be filled for every bundled debug parameter so the page has usable configuration immediately. If a row is missing `nodePath`, the normal page treats it as unavailable and disables read/write actions for that row.

## Routing And Navigation

Add a page config entry:

- path: `/node-debugging`
- label: `节点调试`
- group: `调试平台`
- title: `节点调试平台`
- subtitle: `通过 HDC 读写设备节点，完成调试参数验证`

The existing `/debugging` page remains `参数调试`. The two pages are siblings in the sidebar.

## Node Debugging Page

The page uses the current `/debugging` structure with node-specific behavior.

Visible table columns:

- selection
- parameter name and key
- access mode
- current value
- target value
- range and unit
- risk
- status
- actions

The page does not show `nodePath` in table rows, details sheets, confirmation dialogs, or operation history. Search supports parameter name and key. Admin-only path search is not part of the normal page.

Filters:

- risk
- status
- module
- access mode

Actions:

- `RO`: show read action only.
- `WO`: show write action only.
- `RW`: show read action and write-with-read-back action.
- Batch write includes only writable rows. `RO` rows are excluded and the action bar states how many selected rows are not writable.

On page entry:

1. Automatically call the HDC target detection API.
2. If a target is found, mark the page online and store the active target.
3. If no target is found or `hdc` fails, show the disconnected state and disable read/write actions.
4. Keep a manual `重新检测` action for device changes.

## HDC API Design

The Vite middleware should expose local JSON endpoints:

### `GET /api/hdc/targets`

Runs:

```text
hdc list targets
```

Returns:

```ts
type HdcTargetsResponse = {
  ok: boolean;
  targets: string[];
  activeTarget?: string;
  error?: string;
  stderr?: string;
};
```

The first target is used as `activeTarget`.

### `POST /api/hdc/read-node`

Request:

```ts
type ReadNodeRequest = {
  target?: string;
  nodePath: string;
};
```

Runs:

```text
hdc -t <target> shell cat <nodePath>
```

Returns command, return code, stdout, stderr, duration, and a normalized `value` derived from trimmed stdout.

### `POST /api/hdc/write-node`

Request:

```ts
type WriteNodeRequest = {
  target?: string;
  nodePath: string;
  value: string;
  readBack: boolean;
};
```

Runs a write command equivalent to:

```text
echo "<value>" > <nodePath>
```

For `RW`, the front end sends `readBack: true` and the write API performs the read-back before returning. The final result includes write result, optional read result, and `verified: boolean` when read-back is requested.

Timeouts:

- target detection: 5 seconds
- read and write commands: 10 seconds

Windows execution should suppress extra console windows, matching the provided Python script's `CREATE_NO_WINDOW` behavior.

## Command Safety

- The main `hdc` process is invoked with argument arrays, not by shelling a full command string.
- The shell fragment after `hdc shell` must quote or escape `nodePath` and `value` safely.
- The UI never sends arbitrary user-provided node paths from the normal page. It only sends paths from the Admin-managed config.
- `nodePath` should be required to start with `/` before execution.
- Requests with missing or invalid `nodePath` return a structured 400 response.

## Admin Changes

`/debugging-admin` becomes the only place to maintain node metadata.

For each debug parameter, Admin can view and edit:

- existing debug parameter fields
- node path
- access mode: `RO`, `WO`, `RW`

Validation:

- `nodePath` is required for node debugging availability.
- `nodePath` must start with `/`.
- `accessMode` is required and must be one of `RO`, `WO`, or `RW`.

Saving should continue to use the existing config persistence flow so the fields survive refresh after `MARK_CONFIG_PERSISTED` and the JSON writer API.

## Operation States

Use node-specific row states in the UI while keeping compatibility with existing status styling where reasonable:

- `未检测`: page has not completed device detection.
- `可读取`: target is connected and the item is readable.
- `待读取`: a read is in flight.
- `读取成功`: read completed and current value was updated.
- `读取失败`: read failed; current value is not changed.
- `待写入`: target value differs from current value for writable rows.
- `写入中`: write is in flight.
- `写入成功`: `WO` write returned success. The current value remains the last known value or an unavailable marker because write-only nodes cannot be verified by read-back.
- `回读校验中`: `RW` write succeeded and read-back is in flight.
- `回读一致`: `RW` write succeeded and read-back matched the target value.
- `回读不一致`: write ran, but read-back did not match the target value.
- `写入失败`: write failed; current value is not changed.

## Error Handling

- `hdc` missing: show `本机未找到 hdc，请确认已安装并加入 PATH`.
- No targets: show disconnected state and disable read/write actions.
- Multiple targets: use the first target and display it in the header.
- Read failure: keep the old current value and show stderr or timeout summary.
- Write failure: keep the old current value and show stderr or timeout summary.
- `RW` mismatch: show the target value and read-back value as evidence, without exposing node path.
- Timeout: show a timeout-specific message and record the failed operation.

## Operation History

The normal page operation history records:

- parameter name
- key
- access mode
- action type: detect, read, write, write-readback
- result status
- return code
- stdout/stderr summary
- timestamp

It does not show `nodePath`. Admin-only audit views may include node path later, but that is outside this first implementation.

## Testing Strategy

Unit and interaction tests should cover:

- `PowerManagementDebugParameter` supports `nodePath` and `accessMode`.
- Bundled config rows include valid node metadata.
- Admin can edit and persist `nodePath` and `accessMode`.
- Normal node debugging page hides `nodePath`.
- Page entry automatically detects HDC targets.
- `RO` rows expose read only.
- `WO` rows expose write only and do not read back.
- `RW` rows write, then read back, then verify the result.
- All write flows require confirmation.
- Batch write excludes `RO` rows.
- Missing HDC, no target, read failure, write failure, timeout, and read-back mismatch all render useful feedback.
- HDC API helpers build command arguments safely and parse stdout/stderr predictably.

Final verification should run:

```bash
npm test
npm run build
```

Then use the running local app at `http://localhost:5174/` for a browser smoke test of `/node-debugging` and `/debugging-admin`.
