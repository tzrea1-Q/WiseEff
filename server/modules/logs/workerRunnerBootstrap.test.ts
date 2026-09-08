import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";

// Resource-lifecycle unit tests at the env runtime constructor. These do not
// establish Catalog approval or replace actual production-process acceptance.
afterEach(() => {
  vi.doUnmock("../../config/env");
  vi.doUnmock("../../shared/database/runtimeConnection");
  vi.doUnmock("../parameter-kernel/parameterIdentityMode");
  for (const name of ["../../objectStoreFactory", "./analyzer/analyzerFromEnv", "../knowledge/indexing/embeddingClient", "./webhookDelivery", "./worker"]) vi.doUnmock(name);
  vi.resetModules();
});

async function admittedRuntime(startLoop: () => () => void | Promise<void> = vi.fn(() => vi.fn()), close = vi.fn(async () => {})) {
  vi.resetModules();
  vi.doMock("../../config/env", () => ({loadServerEnv: () => ({NODE_ENV:"production",DATABASE_URL:"private connection string",OBJECT_STORE_MODE:"local",OBJECT_STORE_ROOT:"/unused",LOG_ANALYSIS_QUEUE_MODE:"polling"})}));
  vi.doMock("../../shared/database/runtimeConnection", () => ({openRuntimeDatabase:async()=>({close})}));
  vi.doMock("../parameter-kernel/parameterIdentityMode", () => ({resolveParameterIdentityMode:async()=>"canonical"}));
  vi.doMock("../../objectStoreFactory", () => ({createObjectStoreFromEnv:()=>({})}));
  vi.doMock("./analyzer/analyzerFromEnv", () => ({createLogAnalyzerFromEnv:()=>({})}));
  vi.doMock("../knowledge/indexing/embeddingClient", () => ({resolveKnowledgeEmbeddingClient:()=>undefined}));
  vi.doMock("./webhookDelivery", () => ({createLogWebhookDeliverer:()=>undefined}));
  vi.doMock("./worker", () => ({startLogWorkerLoop:startLoop}));
  const module = await import("./workerRunner");
  return {module,close,startLoop};
}

it("owns the admitted database until consumers have stopped, and closes it only once",async()=>{
  let finish!:()=>void;
  const stopped=new Promise<void>(resolve=>{finish=resolve;});
  const stopWorker=vi.fn(()=>stopped);
  const fixture=await admittedRuntime(vi.fn(()=>stopWorker));
  const runtime=await fixture.module.createLogWorkerRuntimeFromEnv({});
  const stop=await runtime.start();
  const pending=stop();
  await Promise.resolve();
  expect(fixture.close).not.toHaveBeenCalled();
  finish();await pending;await stop();
  expect(stopWorker).toHaveBeenCalledOnce();expect(fixture.close).toHaveBeenCalledOnce();
});

it("closes the admitted pool after worker start fails without exposing the original private error",async()=>{
  const fixture=await admittedRuntime(vi.fn(()=>{throw new Error("private queue credential");}));
  const runtime=await fixture.module.createLogWorkerRuntimeFromEnv({});
  await expect(Promise.resolve().then(()=>runtime.start())).rejects.toThrow("PCAT-RUNTIME-WORKER-START-FAILED");
  expect(fixture.close).toHaveBeenCalledOnce();
});

it.each([false,true])("closes the admitted pool after consumer shutdown fails (pool close failure: %s)",async closeFails=>{
  const fixture=await admittedRuntime(vi.fn(()=>()=>{throw new Error("private consumer detail");}),vi.fn(async()=>{if(closeFails)throw new Error("private pool credential");}));
  const runtime=await fixture.module.createLogWorkerRuntimeFromEnv({});const stop=await runtime.start();
  await expect(stop()).rejects.toThrow("PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED");
  expect(fixture.close).toHaveBeenCalledOnce();
});

it("refuses a real occupied observability port before starting consumers and closes the admitted pool",async()=>{
  const occupied=createServer();await new Promise<void>(resolve=>occupied.listen(0,"127.0.0.1",resolve));
  try {
    const address=occupied.address();if(!address||typeof address==="string")throw new Error("fixture-port-unavailable");
    const fixture=await admittedRuntime();
    await expect(fixture.module.startLogWorkerProcess({LOG_WORKER_OBSERVABILITY_HOST:"127.0.0.1",LOG_WORKER_OBSERVABILITY_PORT:String(address.port)})).rejects.toThrow("PCAT-RUNTIME-WORKER-START-FAILED");
    expect(fixture.startLoop).not.toHaveBeenCalled();expect(fixture.close).toHaveBeenCalledOnce();
  }finally{await new Promise<void>(resolve=>occupied.close(()=>resolve()));}
});

it("can close an admitted runtime without starting and refuses reuse",async()=>{
  const fixture=await admittedRuntime();const runtime=await fixture.module.createLogWorkerRuntimeFromEnv({});
  await runtime.close();await runtime.close();
  await expect(runtime.start()).rejects.toThrow("PCAT-RUNTIME-WORKER-START-FAILED");
  expect(fixture.startLoop).not.toHaveBeenCalled();expect(fixture.close).toHaveBeenCalledOnce();
});

it.each([false, true])("settles a database allocated after an early stop without opening a listener or consumer (close fails: %s)", async closeFails => {
  const fixture = await admittedRuntime(vi.fn(() => vi.fn()), vi.fn(async () => {
    if (closeFails) throw new Error("private pool shutdown detail");
  }));
  const signal = new AbortController(); signal.abort();
  await expect(fixture.module.startLogWorkerProcess({}, signal.signal)).rejects.toThrow(closeFails
    ? "PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED" : "PCAT-RUNTIME-INITIALIZATION-STOPPED");
  expect(fixture.startLoop).not.toHaveBeenCalled();
  expect(fixture.close).toHaveBeenCalledOnce();
});

it("serializes a close racing startup against the same consumer and pool",async()=>{
  const stopped=vi.fn();const fixture=await admittedRuntime(vi.fn(()=>stopped));
  const runtime=await fixture.module.createLogWorkerRuntimeFromEnv({});
  const starting=runtime.start();const closing=runtime.close();
  const stop=await starting;await closing;await stop();
  expect(stopped).toHaveBeenCalledOnce();expect(fixture.close).toHaveBeenCalledOnce();
});

it.each(["normal", "start-failure", "stop-failure"])("owns the real listener through %s without leaving an admitted pool",async mode=>{
  const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,"127.0.0.1",resolve));
  const address=reservation.address();if(!address||typeof address==="string")throw new Error("fixture-port-unavailable");
  await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const stop=vi.fn(async()=>{if(mode==="stop-failure")throw new Error("private stop diagnostic");});
  const fixture=await admittedRuntime(vi.fn(()=>{if(mode==="start-failure")throw new Error("private start diagnostic");return stop;}));
  const started=fixture.module.startLogWorkerProcess({LOG_WORKER_OBSERVABILITY_HOST:"127.0.0.1",LOG_WORKER_OBSERVABILITY_PORT:String(address.port)});
  if(mode==="start-failure") await expect(started).rejects.toThrow("PCAT-RUNTIME-WORKER-START-FAILED");
  else {
    const service=await started;
    try { expect((await fetch(`http://127.0.0.1:${address.port}/health/live`)).status).toBe(200); }
    finally {
      if(mode==="stop-failure")await expect(service.stop()).rejects.toThrow("PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED");
      else {await service.stop();await service.stop();}
    }
    expect(service.observabilityServer.listening).toBe(false);expect(stop).toHaveBeenCalledOnce();
  }
  expect(fixture.close).toHaveBeenCalledOnce();
  const reuse=createServer();try {await new Promise<void>((resolve,reject)=>{reuse.once("error",reject);reuse.listen(address.port,"127.0.0.1",resolve);});}
  finally {await new Promise<void>(resolve=>reuse.close(()=>resolve()));}
});

it.each([false, true])("closes an admitted pool and redacts initialization errors (close fails: %s)", async (closeFails) => {
  vi.resetModules();
  const close = vi.fn(async () => {
    if (closeFails) throw new Error("private cleanup connection string");
  });
  vi.doMock("../../config/env", () => ({ loadServerEnv: () => ({
    NODE_ENV: "production", DATABASE_URL: "private connection string",
    OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: "/unused",
  }) }));
  vi.doMock("../../shared/database/runtimeConnection", () => ({
    openRuntimeDatabase: async () => ({ close }),
  }));
  vi.doMock("../parameter-kernel/parameterIdentityMode", () => ({
    resolveParameterIdentityMode: async () => { throw new Error("private database diagnostic"); },
  }));
  const { createLogWorkerRuntimeFromEnv } = await import("./workerRunner");
  await expect(createLogWorkerRuntimeFromEnv({})).rejects.toMatchObject({
    message: "PCAT-RUNTIME-WORKER-INITIALIZATION-FAILED",
  });
  expect(close).toHaveBeenCalledOnce();
});

it("preserves the admission refusal before any worker initialization", async () => {
  vi.resetModules();
  const refusal = new Error("PCAT-RUNTIME-LIVE-PIN-ADAPTER-UNAVAILABLE");
  const initialize = vi.fn();
  vi.doMock("../../config/env", () => ({ loadServerEnv: () => ({
    NODE_ENV: "production", DATABASE_URL: "private connection string",
    OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: "/unused",
  }) }));
  vi.doMock("../../shared/database/runtimeConnection", () => ({
    openRuntimeDatabase: async () => { throw refusal; },
  }));
  vi.doMock("../parameter-kernel/parameterIdentityMode", () => ({ resolveParameterIdentityMode: initialize }));
  const { createLogWorkerRuntimeFromEnv } = await import("./workerRunner");
  await expect(createLogWorkerRuntimeFromEnv({})).rejects.toBe(refusal);
  expect(initialize).not.toHaveBeenCalled();
});
