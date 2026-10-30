import { describe, expect, it } from 'vite-plus/test'

import { ConfigError } from '../../src/config/config-error.ts'
import { resolveAuth } from '../../src/config/auth.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { configWith, problemsOf, thrownBy } from './support.ts'

const authWith = (auth: unknown) => ({ ...configWith(), auth })

describe('auth of the config', () => {
  it('leaves dynamic client registration off and passkeys on unless the config says otherwise', () => {
    expect(resolveConfig(configWith()).auth).toEqual({
      dynamicClientRegistration: false,
      passkeys: true,
      providers: [],
    })
    expect(resolveConfig(authWith({})).auth).toEqual({
      dynamicClientRegistration: false,
      passkeys: true,
      providers: [],
    })
    expect(resolveConfig(authWith({ dynamicClientRegistration: true })).auth).toEqual({
      dynamicClientRegistration: true,
      passkeys: true,
      providers: [],
    })
  })

  it('refuses an auth that is not an object, and a value that is not a boolean', () => {
    expect(problemsOf(authWith('yes'))).toEqual([
      {
        path: 'auth',
        message: 'is "yes"; it must be an object',
        fix: 'Write auth: { dynamicClientRegistration: true }, or leave auth out.',
      },
    ])
    expect(problemsOf(authWith({ dynamicClientRegistration: 'true' }))).toEqual([
      {
        path: 'auth.dynamicClientRegistration',
        message: 'is "true"; it must be true or false',
        fix: 'Write true to let MCP clients register themselves, or leave it out.',
      },
    ])
  })

  it('resolves each kind of provider, with the kind as the id of Google, Microsoft and GitHub', () => {
    const auth = resolveAuth({
      passkeys: false,
      providers: [
        { kind: 'google', clientId: 'g-id', clientSecret: 'GOOGLE_CLIENT_SECRET' },
        {
          kind: 'microsoft',
          tenant: 'contoso.onmicrosoft.com',
          clientId: 'm-id',
          clientSecret: 'MICROSOFT_CLIENT_SECRET',
        },
        { kind: 'github', id: 'gh', clientId: 'gh-id', clientSecret: 'GITHUB_CLIENT_SECRET' },
        {
          kind: 'oidc',
          id: 'okta',
          name: ' Okta ',
          issuer: 'https://acme.okta.com/',
          clientId: 'o-id',
          clientSecret: 'OKTA_CLIENT_SECRET',
        },
        { kind: 'cloudflare-access', teamDomain: 'acme.cloudflareaccess.com', audience: 'aud123' },
      ],
    })
    expect(auth).toEqual({
      dynamicClientRegistration: false,
      passkeys: false,
      providers: [
        {
          kind: 'google',
          id: 'google',
          name: 'Google',
          clientId: 'g-id',
          clientSecret: 'GOOGLE_CLIENT_SECRET',
        },
        {
          kind: 'microsoft',
          id: 'microsoft',
          name: 'Microsoft',
          tenant: 'contoso.onmicrosoft.com',
          clientId: 'm-id',
          clientSecret: 'MICROSOFT_CLIENT_SECRET',
        },
        {
          kind: 'github',
          id: 'gh',
          name: 'GitHub',
          clientId: 'gh-id',
          clientSecret: 'GITHUB_CLIENT_SECRET',
        },
        {
          kind: 'oidc',
          id: 'okta',
          name: 'Okta',
          issuer: 'https://acme.okta.com',
          scopes: ['openid', 'email', 'profile'],
          clientId: 'o-id',
          clientSecret: 'OKTA_CLIENT_SECRET',
        },
        {
          kind: 'cloudflare-access',
          id: 'cloudflare-access',
          name: 'Cloudflare Access',
          teamDomain: 'acme.cloudflareaccess.com',
          audience: 'aud123',
        },
      ],
    })
  })

  it('throws one ConfigError from resolveAuth for a deployment whose sites live in D1', () => {
    const thrown = thrownBy(() => resolveAuth({ passkeys: 'no' }))
    expect(thrown).toBeInstanceOf(ConfigError)
    expect(thrown instanceof ConfigError ? thrown.problems.map((p) => p.path) : []).toEqual([
      'auth.passkeys',
    ])
  })
})
