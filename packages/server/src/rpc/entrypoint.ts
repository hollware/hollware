import { WorkerEntrypoint } from 'cloudflare:workers'
import type { HollwareEnv, HollwareRpc, HollwareWorker } from '../index.ts'
import { createRpc, type RpcDeps } from './methods.ts'

export function createEntrypoint(deps: RpcDeps): HollwareWorker['Hollware'] {
  return class Hollware extends WorkerEntrypoint<HollwareEnv> implements HollwareRpc {
    getEntry(...args: Parameters<HollwareRpc['getEntry']>) {
      return createRpc(deps, this.env).getEntry(...args)
    }

    listEntries(...args: Parameters<HollwareRpc['listEntries']>) {
      return createRpc(deps, this.env).listEntries(...args)
    }

    getNavigation(...args: Parameters<HollwareRpc['getNavigation']>) {
      return createRpc(deps, this.env).getNavigation(...args)
    }

    getTranslations(...args: Parameters<HollwareRpc['getTranslations']>) {
      return createRpc(deps, this.env).getTranslations(...args)
    }

    describeSite(...args: Parameters<HollwareRpc['describeSite']>) {
      return createRpc(deps, this.env).describeSite(...args)
    }
    search(...args: Parameters<HollwareRpc['search']>) {
      return createRpc(deps, this.env).search(...args)
    }

    listRedirects(...args: Parameters<HollwareRpc['listRedirects']>) {
      return createRpc(deps, this.env).listRedirects(...args)
    }
  }
}
