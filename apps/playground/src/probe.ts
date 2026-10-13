import { WorkerEntrypoint } from 'cloudflare:workers'

/**
 * For the tests of this repository only; a Hollware project has no such class. It tells which
 * Node.js globals this isolate has, and nothing else.
 *
 * It is a named entrypoint, so it is no HTTP route: the gateway and its Host and Origin guard
 * stay as they are, and `Hollware` gains no method. The playground binds to it through its own
 * `PROBE` service binding (`wrangler.jsonc`), which is how a Node.js test reaches it.
 */
export class Probe extends WorkerEntrypoint<Env> {
  nodeGlobals(): string[] {
    return ['process', 'Buffer', 'setImmediate'].filter((name) => name in globalThis)
  }
}
