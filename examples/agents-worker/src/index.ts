import { createHollwareAgents } from '@hollware/agents'
import { WorkerEntrypoint } from 'cloudflare:workers'

declare global {
  interface Env {
    readonly HOLLWARE_AGENT_TOKEN: string
    readonly AGENTS_WEBHOOK_URL?: string
  }
}

const agents = createHollwareAgents({
  auditor: { collection: 'reports', locale: 'es' },
})

export class HollwareAgents extends WorkerEntrypoint<Env> {
  async run(): Promise<void> {
    await agents.run(this.env)
  }
}

export default {
  fetch: agents.fetch,
  scheduled: agents.scheduled,
} satisfies ExportedHandler<Env>
