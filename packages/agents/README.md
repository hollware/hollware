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

The guide is at <https://hollware.com/docs/agents/>.

## Links

- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
