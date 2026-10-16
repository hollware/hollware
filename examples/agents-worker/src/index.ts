import { createHollwareAgents } from '@hollware/agents'
import { WorkerEntrypoint } from 'cloudflare:workers'

declare global {
  // The secrets of the Worker, which `wrangler types` does not see.
  interface Env {
    readonly HOLLWARE_AGENT_TOKEN: string
    readonly AGENTS_WEBHOOK_URL?: string
  }
}

// The agents of the playground's blog. The reports of the auditor are drafts of `reports`.
const agents = createHollwareAgents({
  auditor: { collection: 'reports', locale: 'es' },
})

/**
 * What Hollware's cron calls over its AGENTS binding, every ten minutes: the agents need no cron
 * trigger of their own. With cron triggers to spare, add one and `scheduled` runs them instead.
 */
export class HollwareAgents extends WorkerEntrypoint<Env> {
  async run(): Promise<void> {
    await agents.run(this.env)
  }
}

export default {
  fetch: agents.fetch,
  scheduled: agents.scheduled,
} satisfies ExportedHandler<Env>
