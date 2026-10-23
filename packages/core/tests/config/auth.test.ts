import { describe, expect, it } from 'vite-plus/test'

import { resolveConfig } from '../../src/config/resolve.ts'
import { configWith, problemsOf } from './support.ts'

describe('auth of the config', () => {
  it('leaves dynamic client registration off unless the config turns it on', () => {
    expect(resolveConfig(configWith()).auth).toEqual({ dynamicClientRegistration: false })
    expect(resolveConfig({ ...configWith(), auth: {} }).auth).toEqual({
      dynamicClientRegistration: false,
    })
    expect(
      resolveConfig({ ...configWith(), auth: { dynamicClientRegistration: true } }).auth,
    ).toEqual({ dynamicClientRegistration: true })
  })

  it('refuses an auth that is not an object, and a value that is not a boolean', () => {
    expect(problemsOf({ ...configWith(), auth: 'yes' })).toEqual([
      {
        path: 'auth',
        message: 'is "yes"; it must be an object',
        fix: 'Write auth: { dynamicClientRegistration: true }, or leave auth out.',
      },
    ])
    expect(problemsOf({ ...configWith(), auth: { dynamicClientRegistration: 'true' } })).toEqual([
      {
        path: 'auth.dynamicClientRegistration',
        message: 'is "true"; it must be true or false',
        fix: 'Write true to let MCP clients register themselves, or leave it out.',
      },
    ])
  })
})
