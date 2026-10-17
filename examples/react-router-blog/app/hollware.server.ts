import { createHollware, hollwareBinding } from '@hollware/react'
import { env } from 'cloudflare:workers'

// The blog of the playground, read at request time over the service binding HOLLWARE of
// wrangler.jsonc: no network and no token. `site` is the key of the site in the Hollware config.
// The `.server` suffix keeps this module, and the binding, out of the browser's bundle.
export const hollware = createHollware({
  site: 'playground',
  reader: () => hollwareBinding(env.HOLLWARE),
})
