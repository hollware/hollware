import { describe, expect, it } from 'vite-plus/test'

import { configWith, problemsOf } from './support.ts'

const authWith = (auth: unknown) => ({ ...configWith(), auth })

const SECRET_FIX =
  'Name the Worker secret that holds the client secret, such as "GOOGLE_CLIENT_SECRET", and set it with wrangler secret put.'
const TENANT_FIX = 'Use the id (a GUID) or the domain of your own Microsoft Entra directory.'
const KIND_FIX =
  'Use kind "google", "microsoft", "github", "oidc" or "cloudflare-access", as { kind: "google", clientId: "…", clientSecret: "GOOGLE_CLIENT_SECRET" }.'

const google = { kind: 'google', clientId: 'id', clientSecret: 'GOOGLE_SECRET' }
const microsoft = (tenant: unknown) => ({
  kind: 'microsoft',
  tenant,
  clientId: 'id',
  clientSecret: 'MS_SECRET',
})

describe('problems of the providers', () => {
  const cases: readonly {
    name: string
    auth: unknown
    path: string
    message: string
    fix: string
  }[] = [
    {
      name: 'the shared tenant common of Microsoft',
      auth: { providers: [microsoft('common')] },
      path: 'auth.providers[0].tenant',
      message:
        'is "common", which lets in accounts of any directory, whose email nobody verified for you',
      fix: TENANT_FIX,
    },
    {
      name: 'the shared tenant organizations, in capitals',
      auth: { providers: [microsoft('Organizations')] },
      path: 'auth.providers[0].tenant',
      message:
        'is "Organizations", which lets in accounts of any directory, whose email nobody verified for you',
      fix: TENANT_FIX,
    },
    {
      name: 'the shared tenant consumers',
      auth: { providers: [microsoft('consumers')] },
      path: 'auth.providers[0].tenant',
      message:
        'is "consumers", which lets in accounts of any directory, whose email nobody verified for you',
      fix: TENANT_FIX,
    },
    {
      name: 'no tenant',
      auth: { providers: [microsoft(undefined)] },
      path: 'auth.providers[0].tenant',
      message: 'is missing; it must be the id or domain of a directory',
      fix: TENANT_FIX,
    },
    {
      name: 'a client secret written in place of its name',
      auth: { providers: [{ ...google, clientSecret: 'GOCSPX-abc' }] },
      path: 'auth.providers[0].clientSecret',
      message: 'is "GOCSPX-abc"; it must be the name of a Worker secret',
      fix: SECRET_FIX,
    },
    {
      name: 'a secret of Hollware as the client secret',
      auth: { providers: [{ ...google, clientSecret: 'HOLLWARE_SECRET' }] },
      path: 'auth.providers[0].clientSecret',
      message: 'names "HOLLWARE_SECRET", a secret of Hollware or of Cloudflare',
      fix: SECRET_FIX,
    },
    {
      name: 'no client id',
      auth: { providers: [{ kind: 'github', clientSecret: 'GH_SECRET' }] },
      path: 'auth.providers[0].clientId',
      message: 'is missing; it must be a client id',
      fix: 'Copy the client id of the app you registered with the provider.',
    },
    {
      name: 'an unknown kind',
      auth: { providers: [{ kind: 'saml' }] },
      path: 'auth.providers[0].kind',
      message: 'is "saml"; it must be a kind of provider',
      fix: KIND_FIX,
    },
    {
      name: 'two providers with one id',
      auth: { providers: [google, { ...google, clientId: 'other' }] },
      path: 'auth.providers[1].id',
      message: '"google" is the id of another provider',
      fix: 'Give each provider an id of its own.',
    },
    {
      name: 'an OIDC issuer over http',
      auth: {
        providers: [
          {
            kind: 'oidc',
            id: 'okta',
            name: 'Okta',
            issuer: 'http://acme.okta.com',
            clientId: 'id',
            clientSecret: 'OKTA',
          },
        ],
      },
      path: 'auth.providers[0].issuer',
      message: 'is "http://acme.okta.com"; it must be an https:// issuer URL',
      fix: 'Write the issuer as the provider documents it, such as "https://accounts.example.com".',
    },
    {
      name: 'OIDC scopes without openid',
      auth: {
        providers: [
          {
            kind: 'oidc',
            id: 'okta',
            name: 'Okta',
            issuer: 'https://acme.okta.com',
            clientId: 'id',
            clientSecret: 'OKTA',
            scopes: ['email'],
          },
        ],
      },
      path: 'auth.providers[0].scopes',
      message: 'has no "openid"',
      fix: 'List the scopes to ask for, openid among them: ["openid", "email", "profile"].',
    },
    {
      name: 'an OIDC provider without an id',
      auth: {
        providers: [
          {
            kind: 'oidc',
            name: 'Okta',
            issuer: 'https://acme.okta.com',
            clientId: 'id',
            clientSecret: 'OKTA',
          },
        ],
      },
      path: 'auth.providers[0].id',
      message: 'is missing; it must be an id of lowercase letters and digits joined by hyphens',
      fix: 'Give the provider an id such as "okta"; it is part of the URL of its sign-in.',
    },
    {
      name: 'a team domain of Access that is not one',
      auth: {
        providers: [{ kind: 'cloudflare-access', teamDomain: 'acme.com', audience: 'aud' }],
      },
      path: 'auth.providers[0].teamDomain',
      message: 'is "acme.com"; it must be a team domain',
      fix: 'Write the team domain of Zero Trust, such as "example.cloudflareaccess.com".',
    },
    {
      name: 'passkeys off with no provider',
      auth: { passkeys: false },
      path: 'auth.passkeys',
      message: 'is false and no provider is configured, so nobody could sign in',
      fix: 'Configure a provider in auth.providers, or leave passkeys on.',
    },
  ]

  for (const { name, auth, path, message, fix } of cases) {
    it(`refuses ${name}`, () => {
      expect(problemsOf(authWith(auth))).toEqual([{ path, message, fix }])
    })
  }
})
