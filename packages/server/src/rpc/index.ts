/**
 * The read-only RPC surface: `createRpc` is the four methods of `HollwareRpc` over the bindings of
 * one invocation, and `createEntrypoint` is the `WorkerEntrypoint` class that exposes them.
 */
export { createEntrypoint } from './entrypoint.ts'
export { createRpc, type RpcDeps, type RpcEnv, type RpcLogEntry } from './methods.ts'
