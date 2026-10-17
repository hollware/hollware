/**
 * Reuse detection for the refresh tokens of the OAuth server (T-34 of
 * docs/security/threat-model.md). `@cloudflare/workers-oauth-provider` 1.2.3 rotates a refresh
 * token on each use, but accepts the one before the current one, so a client whose answer was lost
 * can try again; and each such use makes it the previous one again. A stolen refresh token would so
 * keep working for as long as the thief uses it, while the person's own client, whose token it
 * replaced, is refused. OAuth 2.1 asks a server to revoke the grant when a spent refresh token comes
 * back. This does it, around the library: a refresh with the previous token of a grant more than
 * `REUSE_GRACE_SECONDS` after the rotation that spent it revokes the grant, and every token of it.
 * Within the grace, the library's retry works as before.
 */

/** How long the token a refresh spent may still be tried again, for an answer that was lost. */
export const REUSE_GRACE_SECONDS = 60

/** The KV key that holds when a grant last rotated its refresh token, in seconds. */
const rotatedKey = (grantId: string) => `hollware:rotated:${grantId}`

/** The parts of a refresh token as the library makes them: `<userId>:<grantId>:<secret>`. */
interface RefreshToken {
  readonly token: string
  readonly userId: string
  readonly grantId: string
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The refresh token of a token request, or `null` for any other request. */
export async function refreshTokenOf(request: Request): Promise<RefreshToken | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/oauth/token') return null
  const type = request.headers.get('content-type') ?? ''
  if (!type.startsWith('application/x-www-form-urlencoded')) return null
  const form = new URLSearchParams(await request.clone().text())
  if (form.get('grant_type') !== 'refresh_token') return null
  const token = form.get('refresh_token') ?? ''
  const parts = token.split(':')
  const [userId, grantId] = parts
  if (parts.length !== 3 || userId === undefined || grantId === undefined) return null
  return { token, userId, grantId }
}

export interface ReusedGrant {
  readonly userId: string
  readonly grantId: string
  /** The site of the grant, from its metadata, or `null` when it names none. */
  readonly site: string | null
}

/**
 * The grant a refresh token belongs to when the token was already spent, past the grace: the
 * grant holds it as its previous token, and it rotated more than `REUSE_GRACE_SECONDS` ago (or so
 * long ago that the record of it expired). `null` for a token that is current, or unknown to the
 * grant, which the library answers as it does.
 */
export async function spentRefresh(
  kv: KVNamespace,
  refresh: RefreshToken,
  now: number,
): Promise<ReusedGrant | null> {
  const grant = await kv.get<Record<string, unknown>>(
    `grant:${refresh.userId}:${refresh.grantId}`,
    {
      type: 'json',
    },
  )
  if (grant === null || grant['previousRefreshTokenId'] !== (await sha256(refresh.token))) {
    return null
  }
  const rotated = Number(await kv.get(rotatedKey(refresh.grantId)))
  if (Number.isFinite(rotated) && rotated > 0 && now - rotated <= REUSE_GRACE_SECONDS) return null
  const metadata = grant['metadata']
  const site =
    typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'site') : null
  return {
    userId: refresh.userId,
    grantId: refresh.grantId,
    site: typeof site === 'string' ? site : null,
  }
}

/** Records that a grant rotated its refresh token now, for the grace of a retry. */
export async function recordRotation(kv: KVNamespace, grantId: string, now: number) {
  // KV keeps a key at least 60 seconds; twice the grace is enough to tell a retry from a reuse.
  await kv.put(rotatedKey(grantId), String(now), { expirationTtl: REUSE_GRACE_SECONDS * 2 })
}

/** The answer to a spent refresh token, as the library answers an invalid grant. */
export function reusedAnswer(): Response {
  return Response.json(
    {
      error: 'invalid_grant',
      error_description:
        'This refresh token was already used, so its grant was revoked. Connect the app again.',
    },
    { status: 400, headers: { 'cache-control': 'no-store' } },
  )
}
