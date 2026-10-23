import { WorkerEntrypoint } from 'cloudflare:workers'

export class Probe extends WorkerEntrypoint<Env> {
  nodeGlobals(): string[] {
    return ['process', 'Buffer', 'setImmediate'].filter((name) => name in globalThis)
  }
}
