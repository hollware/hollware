import { WorkerEntrypoint } from 'cloudflare:workers'
import type { HollwareEnv, HollwareRpc, HollwareWorker } from '../index.ts'
import { createRpc, type RpcDeps } from './methods.ts'

/**
 * The class a site reaches over a service binding: the user's Worker exports it as
 * `export class Hollware extends hollware.Hollware {}`. It is made here, closed over what the
 * four methods stand on, because that is known only once the config is resolved.
 *
 * It has the four methods of `HollwareRpc` and nothing else, and none of them writes. That is the
 * security surface of the binding: a Worker with a binding can call whatever is on this
 * prototype, so a helper method added here would be public. Anything else lives in `methods.ts`,
 * where `createRpc` does the work and runs in a test without a `WorkerEntrypoint`.
 */
export function createEntrypoint(deps: RpcDeps): HollwareWorker['Hollware'] {
  return class Hollware extends WorkerEntrypoint<HollwareEnv> implements HollwareRpc {
    getEntry(...args: Parameters<HollwareRpc['getEntry']>) {
      return createRpc(deps, this.env).getEntry(...args)
    }

    listEntries(...args: Parameters<HollwareRpc['listEntries']>) {
      return createRpc(deps, this.env).listEntries(...args)
    }

    getTranslations(...args: Parameters<HollwareRpc['getTranslations']>) {
      return createRpc(deps, this.env).getTranslations(...args)
    }

    describeSite(...args: Parameters<HollwareRpc['describeSite']>) {
      return createRpc(deps, this.env).describeSite(...args)
    }
  }
}
