import { describe, expect, it } from 'vite-plus/test'

import { ConfigError } from '../../src/config/config-error.ts'
import { resolveAdmin, resolveConfig } from '../../src/config/resolve.ts'
import { configWith, problemsOf } from './support.ts'

describe('admin of the config', () => {
  it("keeps Hollware's favicon unless the config names an https:// one", () => {
    expect(resolveConfig(configWith()).admin).toEqual({ favicon: null, path: '/admin' })
    expect(resolveAdmin({})).toEqual({ favicon: null, path: '/admin' })
    expect(
      resolveConfig({ ...configWith(), admin: { favicon: 'https://example.com/icon.png' } }).admin,
    ).toEqual({ favicon: 'https://example.com/icon.png', path: '/admin' })
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
  it('puts the admin at /admin unless the config asks for the root of its origin', () => {
    expect(resolveAdmin({ path: '/' })).toEqual({ favicon: null, path: '/' })
    expect(resolveAdmin({ path: '/admin' })).toEqual({ favicon: null, path: '/admin' })
    expect(problemsOf({ ...configWith(), admin: { path: '/cms' } })).toEqual([
      {
        path: 'admin.path',
        message: `is "/cms"; it must be '/admin' or '/'`,
        fix: "Write admin: { path: '/' } for the admin at the root of its origin, or leave it out for /admin.",
      },
    ])
  })
})
