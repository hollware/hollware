# @hollware/agents

Agents for [Hollware](https://hollware.com), an open-source headless CMS for the agent era,
native to Cloudflare Workers. They run on a Worker of their own, next to your Hollware:

- **a reviewer**, which comments once on each pending review: clarity, the voice of the style
  guide, claims without an example; what the contracts cannot see;
- **a translator**, which drafts the missing translation of a published entry, fixes what the
  contracts refuse, and asks a person to review it;
- **a weekly auditor**, which reports the entries readers read most that have not changed in
  months, and the published entries the contracts refuse now, as a draft and, if you want, to a
  Slack webhook.

None of them publishes: their MCP client refuses every tool that publishes or decides, whatever
the token holds.

```ts
import { createHollwareAgents } from '@hollware/agents'

export default createHollwareAgents({
  auditor: { collection: 'reports', locale: 'en' },
})
```

Hollware can also deliver a review request to the reviewer as it happens: declare the agent on the
site (`agents: [{ name: 'reviewer', member: 'usr_…', events: ['review.requested'], delivery: { kind:
'binding', binding: 'AGENTS' } }]`) and expose `handle` on the entrypoint Hollware binds:

```ts
import { WorkerEntrypoint } from 'cloudflare:workers'
import { createHollwareAgents, type AgentGrant, type HollwareEvent } from '@hollware/agents'

const agents = createHollwareAgents()

export class HollwareAgents extends WorkerEntrypoint<Env> {
  async run() {
    await agents.run(this.env)
  }

  async handle(event: HollwareEvent, grant: AgentGrant) {
    await agents.handle(event, grant, this.env)
  }
}
```

The reviewer then comments on that review with the event's grant, which lasts an hour and only
reads and comments on it. An agent of your own does the same with `grantHollware(grant, fetch)` and
`reviewById(deps, id)`.

The guide is at <https://hollware.com/docs/agents/>.

## Links

- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
