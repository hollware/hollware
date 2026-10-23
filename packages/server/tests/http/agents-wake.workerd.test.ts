import { describe, expect, it } from 'vitest'

import { boot } from './support.ts'

function controller(time: string): ScheduledController {
  return { scheduledTime: Date.parse(time), cron: '* * * * *', noRetry: () => undefined }
}

describe('the cron trigger and the agents', () => {
  it('wakes the agents every ten minutes, and on no other minute', async () => {
    let runs = 0
    const worker = boot({
      bindings: {
        AGENTS: {
          run: async () => {
            runs += 1
          },
        },
      },
    })

    for (const time of ['2026-10-15T10:10:00Z', '2026-10-15T10:13:00Z', '2026-10-15T10:20:00Z']) {
      await worker.worker.scheduled(controller(time), worker.env, worker.ctx)
    }
    await worker.settle()

    expect(runs).toBe(2)
  })

  it('logs a failure of the agents, and goes on', async () => {
    const worker = boot({
      bindings: {
        AGENTS: {
          run: async () => {
            throw new Error('the agents are down')
          },
        },
      },
    })

    await worker.worker.scheduled(controller('2026-10-15T10:10:00Z'), worker.env, worker.ctx)

    await expect(worker.settle()).resolves.toBeUndefined()
  })

  it('calls nothing on a binding without run', async () => {
    const worker = boot({ bindings: { AGENTS: {} } })

    await worker.worker.scheduled(controller('2026-10-15T10:10:00Z'), worker.env, worker.ctx)

    await expect(worker.settle()).resolves.toBeUndefined()
  })
})
