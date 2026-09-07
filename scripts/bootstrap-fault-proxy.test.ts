import { readFileSync } from "node:fs";
import { connect, createServer, Socket, type Server } from "node:net";
import ts from "typescript";
import { expect, it, vi } from "vitest";

// Execute the actual test transport without importing its database setup. This
// does not emulate PostgreSQL authentication, SQL, or a successful fence.
const file = readFileSync(new URL("../server/modules/catalog-cutover/retirement/bootstrapCredentialFence.integration.test.ts", import.meta.url), "utf8");
const syntax = ts.createSourceFile("fixture.ts", file, ts.ScriptTarget.Latest, true);
const declaration = syntax.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "commitFaultProxy");
if (!declaration) throw new Error("bootstrap-fault-transport-not-found");
const transport = ts.transpile(declaration.getText(syntax), { target: ts.ScriptTarget.ES2022 });

function frame(kind: string, body: string) {
  const payload = Buffer.from(body), result = Buffer.alloc(payload.length + 5);
  result[0] = kind.charCodeAt(0); result.writeUInt32BE(payload.length + 4, 1); payload.copy(result, 5);
  return result;
}
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("synthetic-tcp-listen-failed"));
      else resolve(address.port);
    });
  });
}
type FaultProxy = { port: number; reached: Promise<void>; observed: boolean; close(): Promise<void> };

it.each([1, 2] as const)("uses immediate TCP writes while preserving actual transport commit %s interception", async ordinal => {
  const noDelay = new WeakMap<Socket, boolean>();
  const nativeNoDelay = Socket.prototype.setNoDelay;
  const spy = vi.spyOn(Socket.prototype, "setNoDelay").mockImplementation(function (this: Socket, value = true) {
    noDelay.set(this, value); return nativeNoDelay.call(this, value);
  });
  const proxySockets: Socket[] = [], sourceSockets = new Set<Socket>();
  let forwardedWithoutNoDelay = false;
  const track = (socket: Socket) => {
    proxySockets.push(socket);
    socket.write = new Proxy(socket.write, { apply(write, receiver, args) {
      if (noDelay.get(socket) !== true) forwardedWithoutNoDelay = true;
      return Reflect.apply(write, receiver, args);
    } });
    return socket;
  };
  const response = Buffer.concat([frame("D", "synthetic"), frame("C", "SELECT 1\0"), frame("Z", "I")]);
  const commit = Buffer.concat([frame("C", "COMMIT\0"), frame("Z", "I")]);
  const source = createServer(socket => {
    sourceSockets.add(socket); socket.setNoDelay(true);
    socket.on("error", () => {}); socket.on("close", () => sourceSockets.delete(socket));
    socket.on("data", bytes => { for (const byte of bytes) socket.write(byte === 67 ? commit : response); });
  });
  let proxy: FaultProxy | undefined, client: Socket | undefined, timer: NodeJS.Timeout | undefined;
  const parts: Buffer[] = [];
  let bytes = 0, expectedBytes = 0, complete: (() => void) | undefined;
  try {
    const port = await listen(source);
    const actual = new Function("connect", "createServer", "privateUrl", `${transport}; return commitFaultProxy;`)(
      (options: Parameters<typeof connect>[0]) => track(connect(options)),
      (callback: (socket: Socket) => void) => createServer(socket => callback(track(socket))),
      new URL(`postgres://127.0.0.1:${port}/synthetic-unused`),
    ) as (ordinal: 1 | 2) => Promise<FaultProxy>;
    proxy = await actual(ordinal);
    client = connect(proxy.port, "127.0.0.1"); client.setNoDelay(true); client.on("error", () => {});
    client.on("data", chunk => {
      parts.push(chunk); bytes += chunk.length;
      if (bytes >= expectedBytes) { complete?.(); complete = undefined; }
    });
    const active = client;
    const roundTrip = (input: string, reply: Buffer) => new Promise<void>(resolve => {
      expectedBytes += reply.length; complete = resolve; active.write(input);
    });
    const operation = (async () => {
      await roundTrip("Q", response);
      expect(proxySockets).toHaveLength(2);
      expect(proxySockets.map(socket => noDelay.get(socket))).toEqual([true, true]);
      expect(forwardedWithoutNoDelay).toBe(false);
      expect(Buffer.concat(parts)).toEqual(response);
      if (ordinal === 2) await roundTrip("C", commit);
      active.write("C");
      await proxy!.reached;
      expect(proxy!.observed).toBe(true);
      if (ordinal === 2 && !active.destroyed) await new Promise<void>(resolve => active.once("close", () => resolve()));
      expect(Buffer.concat(parts)).toEqual(ordinal === 1 ? response : Buffer.concat([response, commit]));
      expect(forwardedWithoutNoDelay).toBe(false);
      // Both the selected CommandComplete and following ReadyForQuery stay withheld.
      expect(active.destroyed).toBe(ordinal === 2);
    })();
    await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("synthetic-tcp-proxy-test-deadline")), 1500);
    })]);
  } finally {
    clearTimeout(timer); client?.destroy();
    try { await proxy?.close(); }
    finally {
      for (const socket of sourceSockets) socket.destroy();
      try {
        if (source.listening) await new Promise<void>((resolve, reject) => source.close(error => error ? reject(error) : resolve()));
      } finally { spy.mockRestore(); }
    }
  }
});
