import { describe, expect, it } from 'vite-plus/test'

import { resolveConfig } from '../../src/config/index.ts'
import { siteDefinitionData } from '../../src/structure/definition.ts'
import { configWith, problemsOf } from './support.ts'

// Fails when: readAudit (src/config/audit.ts) stops defaulting a site to no addresses and a log
// kept forever (ADR-037), stops reading "hashed" and a retention of 30 to 3650 whole days, or stops
// reporting at its path anything else; or when the definition as data (src/structure/definition.ts)
// stops taking the same bounds.

const audit = (overrides?: Record<string, unknown>) =>
  resolveConfig(configWith(overrides)).sites.get('demo')?.audit
const paths = (config: unknown) => problemsOf(config).map((problem) => problem.path)

describe('what the activity log of a site keeps', () => {
  it('keeps no address and every line by default', () => {
    expect([audit(), audit({ audit: null }), audit({ audit: {} })]).toEqual([
      { ipAddresses: 'off', retentionDays: null },
      { ipAddresses: 'off', retentionDays: null },
      { ipAddresses: 'off', retentionDays: null },
    ])
  })

  it('reads hashed addresses and a retention at both of its bounds', () => {
    expect([
      audit({ audit: { ipAddresses: 'hashed', retentionDays: 30 } }),
      audit({ audit: { retentionDays: 3650 } }),
    ]).toEqual([
      { ipAddresses: 'hashed', retentionDays: 30 },
      { ipAddresses: 'off', retentionDays: 3650 },
    ])
  })

  it.each([
    ['a list', { audit: [] }, ['sites.demo.audit']],
    ['raw addresses', { audit: { ipAddresses: 'raw' } }, ['sites.demo.audit.ipAddresses']],
    ['29 days', { audit: { retentionDays: 29 } }, ['sites.demo.audit.retentionDays']],
    ['3651 days', { audit: { retentionDays: 3651 } }, ['sites.demo.audit.retentionDays']],
    ['half a day more', { audit: { retentionDays: 30.5 } }, ['sites.demo.audit.retentionDays']],
    ['days as text', { audit: { retentionDays: '90' } }, ['sites.demo.audit.retentionDays']],
  ])('reports %s at its path', (_name, overrides, expected) => {
    expect(paths(configWith(overrides))).toEqual(expected)
  })

  it('takes the same bounds in the definition as data', () => {
    const accepts = (value: unknown) => siteDefinitionData.shape.audit.safeParse(value).success
    expect([
      accepts({ retentionDays: 30 }),
      accepts({ retentionDays: 3650 }),
      accepts({ retentionDays: 29 }),
      accepts({ retentionDays: 3651 }),
      accepts({ ipAddresses: 'raw' }),
    ]).toEqual([true, true, false, false, false])
  })
})
