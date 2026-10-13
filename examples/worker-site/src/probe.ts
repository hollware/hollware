import { WorkerEntrypoint } from 'cloudflare:workers'

/**
 * For the tests of this repository only; a site of your own has no such class. It tells which
 * Node.js globals this isolate has, and nothing else: the harness asks the built Worker through
 * the `PROBE` service binding of wrangler.jsonc, which binds the Worker to its own entrypoint.
 */
export class Probe extends WorkerEntrypoint<Env> {
  nodeGlobals(): string[] {
    return ['process', 'Buffer', 'setImmediate'].filter((name) => name in globalThis)
  }
}
