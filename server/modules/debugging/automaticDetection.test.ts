import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { buildTrustedAuditEventInput } from "../audit/trustedAudit";
import type { writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { DebugDeviceGateway } from "./gateway";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";
import { getDebugDevice, insertDebugEvent, upsertDetectedTargets } from "./repository";
import { createDebuggingService } from "./service";

vi.mock("./repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./repository")>(),
  getDebugDevice: vi.fn(),
  insertDebugEvent: vi.fn(),
  upsertDetectedTargets: vi.fn()
}));

const auth = makeTestAuthContext();
const db: Database = {
  query: async <Row,>(sql: string) => sql.includes("from public.organizations")
    ? { rows: [{ ...auth.organization, status: "active" }] as Row[], rowCount: 1 }
    : { rows: [], rowCount: 0 },
  transaction: async (fn) => fn(db)
};

function gateway(id: string): DebugDeviceGateway {
  return {
    detectTargets: vi.fn(async () => ({ ok: true, targets: [{ id, deviceId: "device", targetRef: id, label: id, online: true }] })),
    readNode: vi.fn(),
    writeNode: vi.fn()
  };
}

function setup(gateways: Parameters<typeof createDebugDeviceGatewayRegistry>[0]) {
  const audit = vi.fn<typeof writeTrustedAuditEventInTx>(async () => undefined);
  const service = createDebuggingService({ db, gatewayRegistry: createDebugDeviceGatewayRegistry(gateways), writeAuditEvent: audit });
  return { service, audit };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upsertDetectedTargets).mockImplementation(async (_tx, input) => input.targets.map((target) => {
    if (!target.protocol) throw new Error("Detection must persist the actual protocol");
    return { ...target, protocol: target.protocol, organizationId: input.organizationId, bridgeId: null,
      status: "detected", detectedAt: "2026-10-19T00:00:00Z" };
  }));
});

describe("automatic target detection", () => {
  it.each(["hdc", "adb"] as const)("uses only the registered %s gateway when protocol is omitted", async (protocol) => {
    const { service } = setup({ [protocol]: gateway(protocol) });
    expect(await service.detectTargets(auth, {})).toMatchObject([{ id: protocol, protocol, organizationId: auth.organization.id }]);
  });

  it("aggregates HDC before ADB and writes distinct audit events with the same request trace", async () => {
    const hdc = gateway("hdc");
    const adb = gateway("adb");
    const { service, audit } = setup({ adb, hdc });
    expect((await service.detectTargets(auth, { bridgeId: "bridge" }, { requestId: "same-request" })).map((target) => target.protocol)).toEqual(["hdc", "adb"]);
    expect(hdc.detectTargets).toHaveBeenCalledTimes(1);
    expect(adb.detectTargets).toHaveBeenCalledTimes(1);
    const events = audit.mock.calls.map(([, input]) => buildTrustedAuditEventInput(input));
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    expect(events.map((event) => event.traceId)).toEqual(["same-request", "same-request"]);
    expect(events.map((event) => event.metadata?.protocol)).toEqual(["hdc", "adb"]);
  });

  it("ignores an unavailable optional device tool while preserving the other transport", async () => {
    const hdc = gateway("hdc");
    vi.mocked(hdc.detectTargets).mockResolvedValue({ ok: false, targets: [], error: "Tool offline" });
    const { service } = setup({ hdc, adb: gateway("adb") });
    expect(await service.detectTargets(auth, {})).toMatchObject([{ protocol: "adb" }]);
    expect(insertDebugEvent).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: auth.organization.id, kind: "target-detect-failed" }));
  });

  it.each(["FORBIDDEN", "UNAUTHENTICATED", "INTERNAL_ERROR"] as const)("preserves %s failures even when another transport succeeds", async (code) => {
    const adb = gateway("adb");
    const error = new ApiError(code, "Detection rejected");
    vi.mocked(adb.detectTargets).mockRejectedValue(error);
    await expect(setup({ hdc: gateway("hdc"), adb }).service.detectTargets(auth, {})).rejects.toBe(error);
  });

  it("preserves unexpected gateway failures", async () => {
    const adb = gateway("adb");
    const error = new Error("Unexpected adapter failure");
    vi.mocked(adb.detectTargets).mockRejectedValue(error);
    await expect(setup({ hdc: gateway("hdc"), adb }).service.detectTargets(auth, {})).rejects.toBe(error);
  });

  it("returns no targets when all enabled optional tools are unavailable", async () => {
    const hdc = gateway("hdc");
    vi.mocked(hdc.detectTargets).mockResolvedValue({ ok: false, targets: [], error: "Tool offline" });
    expect(await setup({ hdc }).service.detectTargets(auth, {})).toEqual([]);
  });

  it("keeps explicitly unsupported protocols strict", async () => {
    await expect(setup({ hdc: gateway("hdc") }).service.detectTargets(auth, { protocol: "adb" })).rejects.toMatchObject({ code: "PROTOCOL_UNSUPPORTED" });
  });

  it("does not call any gateway without read permission", async () => {
    const hdc = gateway("hdc");
    await expect(setup({ hdc }).service.detectTargets(makeTestAuthContext({ permissions: [] }), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hdc.detectTargets).not.toHaveBeenCalled();
  });

  it("keeps a missing requested device rejected even when no gateway is registered", async () => {
    vi.mocked(getDebugDevice).mockResolvedValue(null);
    await expect(setup({}).service.detectTargets(auth, { deviceId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns no targets when no protocol is enabled", async () => {
    expect(await setup({}).service.detectTargets(auth, {})).toEqual([]);
  });
});
