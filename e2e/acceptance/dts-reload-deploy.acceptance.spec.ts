/**
 * @acceptance DTS-RELOAD-DEPLOY-001
 * @operation DTS-RELOAD-DEPLOY-001
 * @acceptance DTS-RELOAD-KERNEL-001
 * @operation DTS-RELOAD-KERNEL-001
 * @acceptance DTS-RELOAD-VERIFY-001
 * @operation DTS-RELOAD-VERIFY-001
 * @acceptance DTS-RELOAD-RESIDUE-001
 * @operation DTS-RELOAD-RESIDUE-001
 *
 * Wiring proof for #285/#286/#287/#288: one fake bridge WebSocket client with
 * mountTarget/pushFile/writeNode/readKernelLog handlers proves the real RPC envelope,
 * connection-pool serialisation, and per-method timeouts are connected. Branch coverage
 * (including behavioural verify via debug.readNode and residue set/clear) lives in
 * server/modules/dts-reload/deploy.test.ts and residue.test.ts / restoreBaseline.test.ts.
 */
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "playwright/test";
import WebSocket from "ws";

import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";

import { acceptanceUserIdForRole, authHeadersForRole } from "./helpers/bearerAuth";

const databaseUrl = process.env.DATABASE_URL?.trim() || "";
const apiBase = process.env.VITE_WISEEFF_API_BASE_URL ?? process.env.WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
const userId = acceptanceUserIdForRole("admin");

function apiRoute(path: string) {
  return new URL(path, apiBase).toString();
}

/** Bearer + x-wiseeff-user so the spec works under both AUTH_MODE=production (hmac) and development. */
function authHeaders() {
  return authHeadersForRole("admin");
}

function bridgeWebSocketUrl() {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/device-bridges/ws";
  url.search = "";
  return url.toString();
}

async function postJson<T>(page: Page, path: string, data: Record<string, unknown>) {
  const response = await page.request.post(apiRoute(path), {
    data,
    headers: authHeaders()
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  expect(response.ok(), `${path} failed: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

async function pairBridge(page: Page) {
  const pairing = await postJson<{ code: string }>(page, "/api/v1/device-bridges/pairing-codes", {});
  const paired = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), {
    data: {
      code: pairing.code,
      machineLabel: "E2E-Reload-Fake-Bridge",
      platform: "windows",
      arch: "amd64",
      clientVersion: "0.1.0-test"
    },
    headers: authHeaders()
  });
  expect(paired.ok()).toBe(true);
  return (await paired.json()) as { bridgeId: string; bridgeToken: string };
}

async function connectFakeBridge(
  bridgeToken: string,
  observed: { methods: string[]; timeouts: string[] }
) {
  const socket = new WebSocket(bridgeWebSocketUrl(), {
    headers: { Authorization: `Bridge ${bridgeToken}` }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  const artifactSha = createHash("sha256").update("dtbo-e2e").digest("hex");

  socket.on("message", (raw) => {
    const payload = typeof raw === "string" ? raw : raw.toString("utf8");
    let message: {
      type?: string;
      id?: string;
      method?: string;
      params?: Record<string, unknown>;
      deadlineAt?: string;
    } | null = null;
    try {
      message = JSON.parse(payload) as typeof message;
    } catch {
      return;
    }
    if (!message || message.type !== "rpc.request" || typeof message.id !== "string") {
      return;
    }

    observed.methods.push(message.method ?? "");
    if (typeof message.deadlineAt === "string") {
      observed.timeouts.push(message.deadlineAt);
    }

    const respond = (result: Record<string, unknown>) => {
      socket.send(JSON.stringify({ type: "rpc.response", id: message!.id, ok: true, result }));
    };

    if (message.method === "bridge.getCapabilities") {
      respond({
        methods: [
          "bridge.getCapabilities",
          "debug.detectTargets",
          "debug.readNode",
          ...DTS_RELOAD_BRIDGE_RPC_METHODS
        ]
      });
      return;
    }

    if (message.method === "debug.mountTarget") {
      respond({ ok: true, durationMs: 1 });
      return;
    }

    if (message.method === "debug.pushFile") {
      const contentSha256 =
        typeof message.params?.contentSha256 === "string" ? message.params.contentSha256 : artifactSha;
      respond({
        ok: true,
        localDigest: contentSha256,
        remoteDigest: contentSha256,
        integrityCheck: "sha256",
        durationMs: 2
      });
      return;
    }

    if (message.method === "debug.writeNode") {
      respond({
        ok: true,
        verified: true,
        writeResult: { ok: true, durationMs: 1 }
      });
      return;
    }

    if (message.method === "debug.readKernelLog") {
      respond({
        ok: true,
        text: "kernel: overlay applied\n",
        truncated: false,
        byteLength: 24,
        maxBytes: 256 * 1024,
        durationMs: 3
      });
      return;
    }

    socket.send(
      JSON.stringify({
        type: "rpc.response",
        id: message.id,
        ok: false,
        error: { code: "METHOD_NOT_FOUND", message: `Unhandled ${message.method}` }
      })
    );
  });

  return { socket, artifactSha };
}

async function seedValidatedReloadRun(input: {
  organizationId: string;
  projectId: string;
  userId: string;
  artifactSha: string;
  artifactBytes: Buffer;
}) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const runId = randomUUID();
  const sourceBytes = Buffer.from("/dts-v1/;\n/plugin/;\n");
  const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceKey = `${input.organizationId}/${sourceSha}-debug-overlay-${runId}.dts`;
  const artifactKey = `${input.organizationId}/${input.artifactSha}-debug-overlay-${runId}.dtbo`;
  try {
    const objectRoot = process.env.OBJECT_STORE_ROOT?.trim() || ".wiseeff-object-store";
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(objectRoot, input.organizationId), { recursive: true });
    await writeFile(join(objectRoot, sourceKey), sourceBytes);
    await writeFile(join(objectRoot, artifactKey), input.artifactBytes);

    // One library binding is required so behavioural verification can emit the
    // unbound outcome (no debug-node mapping) that DTS-RELOAD-VERIFY-001 asserts.
    const bindingResult = await client.query<{
      binding_id: string;
      property_key: string;
      node_path: string | null;
      baseline_value: string | null;
    }>(
      `
      select
        b.id as binding_id,
        coalesce(
          dps.property_key,
          nullif(
            (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/'))],
            ''
          ),
          'e2e_reload'
        ) as property_key,
        lnr.node_locator as node_path,
        br.raw_value as baseline_value
      from project_parameter_bindings b
      join parameter_specs ps on ps.id = b.parameter_spec_id
      left join dts_property_specs dps on dps.parameter_spec_id = b.parameter_spec_id
      left join lateral (
        select parameter_spec_version_id, config_revision_id, raw_value
        from project_parameter_binding_revisions
        where binding_id = b.id
        order by created_at desc
        limit 1
      ) br on true
      left join lateral (
        select node_locator
        from dts_logical_node_revisions
        where logical_node_id = b.logical_node_id
          and config_revision_id = br.config_revision_id
        limit 1
      ) lnr on true
      where b.organization_id = $1
        and b.project_id = $2
        and br.parameter_spec_version_id is not null
      order by coalesce(lnr.node_locator, ''), b.id
      limit 1
      `,
      [input.organizationId, input.projectId]
    );
    const binding = bindingResult.rows[0];
    if (!binding) {
      throw new Error(
        `No project_parameter_bindings available for ${input.projectId}; cannot seed DTS reload run targets.`
      );
    }

    await client.query(
      `
      insert into dts_reload_runs (
        id, organization_id, project_id, status, failure_code, steps, diagnostics, tool_versions,
        overlay_source_storage_key, overlay_source_sha256,
        overlay_artifact_storage_key, overlay_artifact_sha256, overlay_artifact_bytes,
        created_by_user_id, completed_at
      ) values (
        $1, $2, $3, 'validated', null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        $4, $5, $6, $7, $8, $9, now()
      )
      `,
      [
        runId,
        input.organizationId,
        input.projectId,
        sourceKey,
        sourceSha,
        artifactKey,
        input.artifactSha,
        input.artifactBytes.length,
        input.userId
      ]
    );

    const baselineValue = binding.baseline_value ?? "<1>";
    await client.query(
      `
      insert into dts_reload_run_targets (
        id, reload_run_id, binding_id, node_path, property_key, baseline_value, debug_value, sort_order
      ) values ($1, $2, $3, $4, $5, $6, $7, 0)
      `,
      [
        randomUUID(),
        runId,
        binding.binding_id,
        binding.node_path?.trim() || "/plugin/e2e-reload",
        binding.property_key || "e2e_reload",
        baselineValue,
        "<e2e-debug>"
      ]
    );
  } finally {
    await client.end();
  }
  return runId;
}

test.describe("DTS reload deploy fake-bridge wiring", () => {
  test.skip(!databaseUrl, "DATABASE_URL required");

  test("DTS-RELOAD-DEPLOY-001 mounts, pushes, and triggers through the real bridge RPC envelope", async ({
    page
  }) => {
    test.setTimeout(120_000);

    const pair = await pairBridge(page);
    const observed = { methods: [] as string[], timeouts: [] as string[] };
    const fake = await connectFakeBridge(pair.bridgeToken, observed);

    try {
      // Resolve org/project from seeded M0/M1 user context via /api/v1/me and projects list.
      const me = await page.request.get(apiRoute("/api/v1/me"), { headers: authHeaders() });
      expect(me.ok()).toBe(true);
      const meBody = (await me.json()) as {
        user?: { id?: string; organizationId?: string };
        organization?: { id?: string };
      };
      const organizationId = meBody.organization?.id ?? meBody.user?.organizationId;
      expect(organizationId).toBeTruthy();

      const projects = await page.request.get(apiRoute("/api/v1/projects"), { headers: authHeaders() });
      expect(projects.ok()).toBe(true);
      const projectBody = (await projects.json()) as { items?: Array<{ id: string }> };
      const projectId =
        projectBody.items?.find((item) => item.id === "aurora")?.id ?? projectBody.items?.[0]?.id;
      expect(projectId).toBeTruthy();

      const artifactBytes = Buffer.from("dtbo-e2e");
      const artifactSha = createHash("sha256").update(artifactBytes).digest("hex");
      const runId = await seedValidatedReloadRun({
        organizationId: organizationId!,
        projectId: projectId!,
        userId,
        artifactSha,
        artifactBytes
      });

      const deploy = await page.request.post(apiRoute(`/api/v1/dts-reload/runs/${runId}/deploy`), {
        headers: authHeaders(),
        data: {
          deviceId: `bridge:${pair.bridgeId}`,
          bridgeId: pair.bridgeId,
          targetRef: "AURORA-E2E",
          protocol: "hdc",
          confirmationTokens: ["confirm-dts-reload"]
        }
      });
      const deployBody = await deploy.json().catch(() => null);
      expect(deploy.ok(), `deploy failed: ${JSON.stringify(deployBody)}`).toBe(true);
      expect(deployBody).toMatchObject({
        item: {
          status: "unverifiable",
          integrityCheck: "sha256",
          reloadSnapshot: {
            kernelSignal: {
              command: "dmesg",
              captureStatus: "obtained",
              rawText: "kernel: overlay applied\n"
            },
            behaviouralVerification: {
              outcomes: [
                expect.objectContaining({
                  outcome: "unbound"
                })
              ]
            }
          }
        }
      });

      const residueResponse = await page.request.get(
        apiRoute(`/api/v1/dts-reload/residue?deviceId=${encodeURIComponent(`bridge:${pair.bridgeId}`)}`),
        { headers: authHeaders() }
      );
      const residueBody = await residueResponse.json().catch(() => null);
      expect(residueResponse.ok(), `residue failed: ${JSON.stringify(residueBody)}`).toBe(true);
      expect(residueBody).toMatchObject({
        item: {
          deviceId: `bridge:${pair.bridgeId}`,
          projectId,
          sourceRunId: runId
        }
      });

      expect(observed.methods).toEqual([
        "bridge.getCapabilities",
        "debug.mountTarget",
        "debug.pushFile",
        "debug.writeNode",
        "debug.readKernelLog"
      ]);
      // No binding → no debug.readNode; never invent a new verification RPC.
      expect(observed.methods).not.toContain("debug.readNode");
      expect(observed.timeouts.length).toBe(5);
    } finally {
      await new Promise<void>((resolve) => {
        if (fake.socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        fake.socket.once("close", () => resolve());
        fake.socket.close();
      });
    }
  });
});
