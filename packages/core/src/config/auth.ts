import { ConfigError, Problems } from './config-error.ts'
import type { ResolvedAuth, ResolvedProvider } from './types.ts'
import { isRecord, itemPath, keyPath, quote, wrongType } from './values.ts'

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/
const RESERVED_SECRET = /^(HOLLWARE|CLOUDFLARE|CF)_/
const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/
const SHARED_TENANTS = ['common', 'organizations', 'consumers']
const DEFAULT_SCOPES = ['openid', 'email', 'profile']
const MAX_NAME = 60

const NAMES: Readonly<Record<string, string>> = {
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub',
  'cloudflare-access': 'Cloudflare Access',
}

const KIND_FIX =
  'Use kind "google", "microsoft", "github", "oidc" or "cloudflare-access", as { kind: "google", clientId: "…", clientSecret: "GOOGLE_CLIENT_SECRET" }.'

const OFF: ResolvedAuth = { dynamicClientRegistration: false, passkeys: true, providers: [] }

function readText(path: string, raw: unknown, what: string, fix: string, problems: Problems) {
  if (typeof raw === 'string' && raw.trim() !== '') return raw
  problems.add(path, wrongType(raw, what), fix)
  return null
}

function readSecretName(path: string, raw: unknown, problems: Problems): string | null {
  if (typeof raw === 'string' && SECRET_NAME.test(raw) && !RESERVED_SECRET.test(raw)) return raw
  problems.add(
    path,
    typeof raw === 'string' && RESERVED_SECRET.test(raw)
      ? `names ${quote(raw)}, a secret of Hollware or of Cloudflare`
      : wrongType(raw, 'the name of a Worker secret'),
    'Name the Worker secret that holds the client secret, such as "GOOGLE_CLIENT_SECRET", and set it with wrangler secret put.',
  )
  return null
}

function readClient(path: string, raw: Record<string, unknown>, problems: Problems) {
  const clientId = readText(
    keyPath(path, 'clientId'),
    raw['clientId'],
    'a client id',
    'Copy the client id of the app you registered with the provider.',
    problems,
  )
  const clientSecret = readSecretName(keyPath(path, 'clientSecret'), raw['clientSecret'], problems)
  return clientId === null || clientSecret === null ? null : { clientId, clientSecret }
}

function readTenant(path: string, raw: unknown, problems: Problems): string | null {
  if (typeof raw === 'string' && SHARED_TENANTS.includes(raw.toLowerCase())) {
    problems.add(
      path,
      `is ${quote(raw)}, which lets in accounts of any directory, whose email nobody verified for you`,
      'Use the id (a GUID) or the domain of your own Microsoft Entra directory.',
    )
    return null
  }
  if (typeof raw === 'string' && TENANT.test(raw)) return raw
  problems.add(
    path,
    wrongType(raw, 'the id or domain of a directory'),
    'Use the id (a GUID) or the domain of your own Microsoft Entra directory.',
  )
  return null
}

function readScopes(path: string, raw: unknown, problems: Problems): string[] | null {
  if (raw === undefined) return [...DEFAULT_SCOPES]
  const fix = 'List the scopes to ask for, openid among them: ["openid", "email", "profile"].'
  if (
    !Array.isArray(raw) ||
    !raw.every((scope) => typeof scope === 'string' && /^\S+$/.test(scope))
  ) {
    problems.add(path, wrongType(raw, 'an array of scopes'), fix)
    return null
  }
  const scopes: string[] = raw.filter((scope) => typeof scope === 'string')
  if (!scopes.includes('openid')) {
    problems.add(path, 'has no "openid"', fix)
    return null
  }
  return [...new Set(scopes)]
}

function readIssuer(path: string, raw: unknown, problems: Problems): string | null {
  const url = typeof raw === 'string' ? URL.parse(raw) : null
  if (url !== null && url.protocol === 'https:' && url.search === '' && url.hash === '') {
    return url.href.replace(/\/$/, '')
  }
  problems.add(
    path,
    wrongType(raw, 'an https:// issuer URL'),
    'Write the issuer as the provider documents it, such as "https://accounts.example.com".',
  )
  return null
}

function readId(path: string, raw: unknown, fallback: string | null, problems: Problems) {
  if (raw === undefined && fallback !== null) return fallback
  if (typeof raw === 'string' && PROVIDER_ID.test(raw) && raw.length <= 32) return raw
  problems.add(
    path,
    wrongType(raw, 'an id of lowercase letters and digits joined by hyphens'),
    'Give the provider an id such as "okta"; it is part of the URL of its sign-in.',
  )
  return null
}

function readProvider(path: string, raw: unknown, problems: Problems): ResolvedProvider | null {
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object'), KIND_FIX)
    return null
  }
  const kind = raw['kind']
  if (kind === 'cloudflare-access') {
    const id = readId(keyPath(path, 'id'), raw['id'], kind, problems)
    const teamDomain = raw['teamDomain']
    const domain =
      typeof teamDomain === 'string' && TEAM_DOMAIN.test(teamDomain) ? teamDomain : null
    if (domain === null) {
      problems.add(
        keyPath(path, 'teamDomain'),
        wrongType(teamDomain, 'a team domain'),
        'Write the team domain of Zero Trust, such as "example.cloudflareaccess.com".',
      )
    }
    const audience = readText(
      keyPath(path, 'audience'),
      raw['audience'],
      'an audience tag',
      'Copy the Application Audience (AUD) tag of the Access application.',
      problems,
    )
    if (id === null || domain === null || audience === null) return null
    return { kind, id, name: NAMES[kind] ?? kind, teamDomain: domain, audience }
  }
  if (kind === 'google' || kind === 'github') {
    const id = readId(keyPath(path, 'id'), raw['id'], kind, problems)
    const client = readClient(path, raw, problems)
    if (id === null || client === null) return null
    return { kind, id, name: NAMES[kind] ?? kind, ...client }
  }
  if (kind === 'microsoft') {
    const id = readId(keyPath(path, 'id'), raw['id'], kind, problems)
    const tenant = readTenant(keyPath(path, 'tenant'), raw['tenant'], problems)
    const client = readClient(path, raw, problems)
    if (id === null || tenant === null || client === null) return null
    return { kind, id, name: NAMES[kind] ?? kind, tenant, ...client }
  }
  if (kind === 'oidc') {
    const id = readId(keyPath(path, 'id'), raw['id'], null, problems)
    const rawName = raw['name']
    const name =
      typeof rawName === 'string' && rawName.trim() !== '' && rawName.length <= MAX_NAME
        ? rawName.trim()
        : null
    if (name === null) {
      problems.add(
        keyPath(path, 'name'),
        wrongType(rawName, `a name of 1 to ${MAX_NAME} characters`),
        'Write what the sign-in page calls the provider, such as "Okta".',
      )
    }
    const issuer = readIssuer(keyPath(path, 'issuer'), raw['issuer'], problems)
    const scopes = readScopes(keyPath(path, 'scopes'), raw['scopes'], problems)
    const client = readClient(path, raw, problems)
    if (id === null || name === null || issuer === null || scopes === null || client === null) {
      return null
    }
    return { kind, id, name, issuer, scopes, ...client }
  }
  problems.add(keyPath(path, 'kind'), wrongType(kind, 'a kind of provider'), KIND_FIX)
  return null
}

function readProviders(path: string, raw: unknown, problems: Problems): ResolvedProvider[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    problems.add(path, wrongType(raw, 'an array of providers'), KIND_FIX)
    return []
  }
  const providers: ResolvedProvider[] = []
  const items: readonly unknown[] = raw
  items.forEach((item, index) => {
    const provider = readProvider(itemPath(path, index), item, problems)
    if (provider === null) return
    if (providers.some((other) => other.id === provider.id)) {
      problems.add(
        keyPath(itemPath(path, index), 'id'),
        `${quote(provider.id)} is the id of another provider`,
        'Give each provider an id of its own.',
      )
      return
    }
    providers.push(provider)
  })
  return providers
}

export function readAuth(raw: unknown, problems: Problems): ResolvedAuth {
  if (raw === undefined) return OFF
  if (!isRecord(raw)) {
    problems.add(
      'auth',
      wrongType(raw, 'an object'),
      'Write auth: { dynamicClientRegistration: true }, or leave auth out.',
    )
    return OFF
  }
  let dynamicClientRegistration = false
  const value = raw['dynamicClientRegistration']
  if (typeof value === 'boolean') dynamicClientRegistration = value
  else if (value !== undefined) {
    problems.add(
      'auth.dynamicClientRegistration',
      wrongType(value, 'true or false'),
      'Write true to let MCP clients register themselves, or leave it out.',
    )
  }
  let passkeys = true
  const rawPasskeys = raw['passkeys']
  if (typeof rawPasskeys === 'boolean') passkeys = rawPasskeys
  else if (rawPasskeys !== undefined) {
    problems.add(
      'auth.passkeys',
      wrongType(rawPasskeys, 'true or false'),
      'Write false to sign in only through providers, or leave it out.',
    )
  }
  const providers = readProviders('auth.providers', raw['providers'], problems)
  const listed: unknown = raw['providers']
  const none = Array.isArray(listed) ? listed.length === 0 : listed === undefined
  if (!passkeys && none) {
    problems.add(
      'auth.passkeys',
      'is false and no provider is configured, so nobody could sign in',
      'Configure a provider in auth.providers, or leave passkeys on.',
    )
  }
  return { dynamicClientRegistration, passkeys, providers }
}

/**
 * Checks `auth` of the config on its own, for a deployment whose sites already live in D1, and
 * throws a `ConfigError` that says what to change.
 */
export function resolveAuth(auth: unknown): ResolvedAuth {
  const problems = new Problems()
  const resolved = readAuth(auth, problems)
  if (problems.list.length > 0) throw new ConfigError(problems.list)
  return resolved
}
