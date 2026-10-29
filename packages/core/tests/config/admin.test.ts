import { describe, expect, it } from 'vite-plus/test'

import { ConfigError } from '../../src/config/config-error.ts'
import { resolveAdmin, resolveConfig } from '../../src/config/resolve.ts'
import { configWith, problemsOf } from './support.ts'

describe('admin of the config', () => {
  it("keeps Hollware's favicon unless the config names an https:// one", () => {
    expect(resolveConfig(configWith()).admin).toEqual({ favicon: null })
    expect(resolveAdmin({})).toEqual({ favicon: null })
    expect(
      resolveConfig({ ...configWith(), admin: { favicon: 'https://example.com/icon.png' } }).admin,
    ).toEqual({ favicon: 'https://example.com/icon.png' })
  })

  it('refuses an admin that is not an object, and a favicon that is not an https:// URL', () => {
    const fix = "Write admin: { favicon: 'https://example.com/icon.png' }, or leave it out."
    expect(problemsOf({ ...configWith(), admin: 'flame' })).toEqual([
      { path: 'admin', message: 'is "flame"; it must be an object', fix },
    ])
    expect(
      problemsOf({ ...configWith(), admin: { favicon: 'http://example.com/icon.png' } }),
    ).toEqual([
      {
        path: 'admin.favicon',
        message: 'is "http://example.com/icon.png"; it must be an https:// URL',
        fix,
      },
    ])
    expect(() => resolveAdmin({ favicon: '/icon.png' })).toThrow(ConfigError)
  })
})
