import type { HollwareRpc } from '@hollware/server'

export interface SiteEnv {
  readonly HOLLWARE: HollwareRpc
  readonly HOLLWARE_SITE: string
  readonly PAGE_SIZE: number
}
