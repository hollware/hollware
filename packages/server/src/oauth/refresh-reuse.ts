export const REUSE_GRACE_SECONDS = 60

const rotatedKey = (grantId: string) => `hollware:rotated:${grantId}`

interface RefreshToken {
  readonly token: string
  readonly userId: string
  readonly grantId: string
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function refreshTokenOf(request: Request): Promise<RefreshToken | null> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/oauth/token') return null
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  if (type !== 'application/x-www-form-urlencoded') return null
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
  readonly site: string | null
}

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

export async function recordRotation(kv: KVNamespace, grantId: string, now: number) {
  await kv.put(rotatedKey(grantId), String(now), { expirationTtl: REUSE_GRACE_SECONDS * 2 })
}

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
