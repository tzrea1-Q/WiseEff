# Debug a device

> Chinese: [Chinese](../zh-CN/user-guide/device-debugging.md)

## Who can do this

Hardware users and software users can open Node debugging (`/node-debugging`) and read nodes with `debugging:view` and `debugging:read`. Writing requires `debugging:write`; rolling back requires `debugging:rollback`. The default hardware/software committer, Organization Admin (`admin`), and Platform Admin (`platform-admin`) roles have these write permissions; ordinary hardware/software users do not. Guests cannot access this workflow.

Parameter debugging (`/dts-reload`) has a committer-level page gate. Starting, deploying, or restoring a DTS reload requires `debugging:dts-reload` in the selected project's scope, normally held by the same committer/Admin roles. Read-only history access is separately supported by the server with `debugging:view`, but that does not bypass the page gate or grant device-write access. Sensitive parameters can require additional capabilities and explicit confirmation. Roles never substitute for access to the selected Organization, project, session, or device.

Use the two entries under the Debugging platform navigation group:

- **Node debugging (`/node-debugging`)** reads and writes individual runtime node paths.
- **Parameter debugging (`/dts-reload`)** tests a batch of project parameter values through a generated device-tree overlay and kernel reload.

The old Parameter debugging (`/debugging`) workspace is offline; use `/dts-reload`, not the legacy route. Debugging administration (`/debugging-admin`, node catalog at `/debugging-admin/nodes`) is an Admin surface for maintaining nodes and protocol bindings, not a way around write permissions.

## Connect your computer and select a device

1. Open Node debugging (`/node-debugging`) or Parameter debugging (`/dts-reload`) and choose **HDC** or **ADB** for your device.
2. In the local Device Bridge panel, follow **Install Bridge** and download the installer recommended for your computer. Follow the panel's installation guidance; on Windows it asks you to run the installer as administrator so the browser can launch Bridge.
3. Choose **Connect this computer** and allow the browser to open the installed Bridge. The panel supplies a temporary pairing code. If pairing has expired or the connection is lost, reconnect using the current panel rather than an old code.
4. Connect the target device to the computer running Bridge and complete the device's debugging authorization. Detect devices in the page. If multiple targets are offered, select the intended one before any write or deployment.
5. Check both the Bridge connection and the selected HDC/ADB target. A connected Bridge is not proof that a device was detected. If detection fails, check the cable, device authorization, selected protocol, and the panel's tool status, then detect again.

If installation, pairing, or HDC/ADB tooling remains unavailable, ask your deployment operator to use the [local Device Bridge runbook](../runbooks/local-device-bridge.md). Do not start writes against an uncertain target. Real-device coverage is conditional on the available hardware and tooling; simulated results do not establish target-device readiness.

## Find and read a node

In Node debugging (`/node-debugging`), choose a module or subtree and search by name, Key, description, module, or path. Inspect the node's details, the path for the selected protocol, access mode, current value, and status before preparing a target value.

- **RO** nodes are read-only.
- **RW** nodes can be written only when the binding is available and the safety checks pass.
- **WO** nodes do not offer safe writes because a pre-write snapshot cannot be obtained.
- A missing or disabled HDC/ADB binding makes that node unavailable for the selected protocol. Ask an Admin to check its binding in Debugging administration (`/debugging-admin/nodes`); do not guess a replacement path.

The current value is an observation, not a live guarantee. Check stale-value warnings and read again when you need fresh evidence.

## Write a node and interpret the result

1. Open a writable node's editor and enter the target value. For a complex value, follow the displayed format and normalization guidance. Numeric bounds, when configured, are enforced by the server; complex values are checked against their value metadata.
2. Choose the write-and-readback action, or stage values and use the batch-send bar. Only pending writable nodes are sent; selecting rows limits the batch to those selected pending nodes. A batch containing high-risk nodes asks for confirmation before it sends anything.
3. Before a physical write, the server checks authorization and the device lease, reads the previous value, and records a pre-write snapshot. If the pre-write read fails, it does not issue the write. High-risk writes require explicit human confirmation.
4. Inspect **write outcome** separately from **readback outcome**. An executed write means the write command ran; it does not prove that the device returned the requested value. Node debugging displays the actual return value and makes **no equality judgment**, including when the device uses a different representation.

If a write executed but readback failed or is unknown, the displayed value may be stale. Use **Read again (without writing again)** to obtain a new observation. An unknown write outcome is not a safe reason to resend blindly; check the connection, Bridge guidance, and node value first.

To restore a node, use **Rollback snapshot** in Node debugging (`/node-debugging`) and review the confirmation. This writes the stored pre-write value back under rollback authorization and reads back the result. Availability depends on a valid snapshot and its session/device context. Inspect the outcome; do not assume a rollback succeeded just because you confirmed it. Node snapshots are distinct from DTS reload evidence snapshots.

## Pre-flight and deploy a DTS reload

In Parameter debugging (`/dts-reload`):

1. Select the project and candidates, compare each library baseline with its debug value, and edit the values you intend to test. The platform generates the overlay; you do not author it manually. Debug values are run-scoped and do not update the parameter library, drafts, or release baseline.
2. Start pre-flight. The platform compiles the base and overlay, performs a dry-run merge, and checks the resulting properties and values. Review each step and diagnostic. A validated pre-flight is **not a device deployment**; blocked or failed checks need resolution before proceeding. Toolchain or project-source problems require help from the operator or project Admin.
3. Complete Bridge connection and device detection, then choose deployment and review the target, parameter changes, and generated overlay in the confirmation. Sensitive-value confirmation and deployment confirmation are separate gates. Pre-flight can be prepared before a device is connected, but deployment cannot.
4. After confirmation, the platform mounts and transfers the compiled artifact, checks its on-device digest, triggers reload, and gathers available kernel-log and debug-node evidence. Read the run's terminal state and snapshot rather than treating a successful transfer as proof of driver behavior.

| Run outcome | What it means |
| --- | --- |
| Validated | Pre-flight passed; device deployment is still a separate action. |
| Failed / blocked | Inspect the failed step or refusal. A failure after a device-side write may still leave debug residue. |
| Unverifiable | Deployment commands and integrity checks succeeded, but driver behavior could not be confirmed: no readable bound parameters, or incomplete reads without a contradiction. |
| Behaviourally verified | All selected parameters with readable debug-node bindings matched their debug values under the declared value shapes. Unbound parameters remain evidence gaps. |
| Contradicted | At least one bound parameter read disagreed with its debug value; this is not a verified run. |

Unlike ordinary node debugging, DTS reload compares bound observations with the debug values. Kernel-log text is retained as **unjudged evidence**; it does not by itself establish reload success or failure.

## Restore the baseline after a reload

Parameter debugging (`/dts-reload`) can show **debug residue** for the selected device. This is platform bookkeeping from prior runs, not a live device-state probe. Rebooting, reflashing, or changing the device outside WiseEff can invalidate that indication.

Choose **Restore baseline (compensating reload)** and inspect the confirmation. The platform starts a **new** run for the residue-producing run's parameter set using its recorded library baseline values, with the same pre-flight, sensitive-parameter checks, and separate deployment confirmation. Missing baselines or changed configuration can block restoration.

This is not undo and does not unload the applied overlay: it deploys another overlay with baseline values. Residue bookkeeping is cleared when the compensating deployment reaches verified, unverifiable, or contradicted; failed restoration does not clear it. Clearing the indicator is therefore not proof that the driver observed the baseline. Inspect that run's evidence and any remaining warnings. A reload snapshot records evidence, not an undoable copy of the device tree. See the maintained [reload snapshot decision](../adr/0021-reload-snapshot-satisfies-device-write-snapshot-non-negotiable.md) for that boundary.

## Find history and share evidence

- In **Node debugging (`/node-debugging`)**, expand **Node operation records** for the current session's detection, read, write/readback, and rollback events. Check the status, return code, output/error summary, and timestamp alongside the node detail's write and readback outcomes.
- In **Parameter debugging (`/dts-reload`)**, expand **Run history**. It lists runs by project, including blocked/failed runs and separately marked baseline-restoration runs; optionally filter to the current device. Open a run for its pre-flight steps, baseline-to-debug values, terminal state, and reload snapshot. The snapshot includes recorded baselines, artifact digest/integrity results, available kernel-log evidence, and per-parameter verification outcomes. Download the compiled artifact while it is available; expired artifacts are marked unavailable.
- Keep the run ID and project/device context with your report. A reload run can be reopened through Parameter debugging (`/dts-reload?runId=<run-id>`). Report missing bindings, failed reads, truncation, and unverifiable states rather than presenting them as successful verification.
- Admins can cross-check retained actions in **Audit center (`/audit`)**. The [operation coverage matrix](../developer/user-operation-coverage-matrix.md) distinguishes automated/simulated checks from conditional real HDC/ADB evidence; a history record does not replace target-hardware acceptance.
