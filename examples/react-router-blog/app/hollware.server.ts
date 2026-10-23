import { createHollware, hollwareBinding } from '@hollware/react'
import { env } from 'cloudflare:workers'

export const hollware = createHollware({
  site: 'playground',
  reader: () => hollwareBinding(env.HOLLWARE),
})
