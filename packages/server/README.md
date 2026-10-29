# @hollware/server

The Worker of [Hollware](https://hollware.com), an open-source headless CMS for the agent era,
native to Cloudflare Workers: MCP for agents, the read API and Workers RPC for sites, OAuth and
passkeys for people, and the D1 migrations, in `migrations/`.

A project made with `npm create hollware` is one file that builds it:

```ts
import { createHollware } from '@hollware/server'

const hollware = createHollware()

export default { fetch: hollware.fetch, scheduled: hollware.scheduled, queue: hollware.queue }
export class Hollware extends hollware.Hollware {}
export class HollwareOps extends hollware.HollwareOps {}
```

A site on the same account reads it over a service binding to the `Hollware` entrypoint; type the
binding with `HollwareRpc`.
Another Worker of the account runs any operation, or speaks MCP, over a service binding to the
`HollwareOps` entrypoint, always as a personal token; type the binding with `HollwareOpsRpc`.

Start with the [Quickstart](https://hollware.com/docs/quickstart/), and see
[Install](https://hollware.com/docs/install/) and [Upgrade](https://hollware.com/docs/upgrade/).

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- License: MIT
