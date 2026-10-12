export const PERSONAL_TOKEN_PREFIX = 'hw_pat_'

export interface PersonalToken {
  id: string
  userId: string
  scopes: string[]
  /** Seconds since the epoch; null never expires. */
  expiresAt: number | null
  revoked: boolean
}

// The fake of the D1 `tokens` table: sha256(token) -> row. The real table never holds the token.
const TABLE: Record<string, PersonalToken> = {
  // sha256('hw_pat_test')
  '73d2ce10ac39b8d03c554fc4a6b3d93b42b088a5fd6b2331eeacbd40c993bd87': {
    id: 'tok_test',
    userId: 'usr_pat',
    scopes: ['content:read', 'content:write'],
    expiresAt: null,
    revoked: false,
  },
  // sha256('hw_pat_expired'): expired on 2024-01-01
  '89334111885ef9bf310d6fa2bb8e3c2075585ea2a841bf8c007ca75d808da0a0': {
    id: 'tok_expired',
    userId: 'usr_pat',
    scopes: ['content:read'],
    expiresAt: 1_704_067_200,
    revoked: false,
  },
  // sha256('hw_pat_revoked')
  '6be1bd2bb6fdb4261e156b665faa65c18146d7a351ff85d0236ad252aec75739': {
    id: 'tok_revoked',
    userId: 'usr_pat',
    scopes: ['content:read'],
    expiresAt: null,
    revoked: true,
  },
}

export type PersonalTokenCheck =
  | { kind: 'valid'; token: PersonalToken }
  | { kind: 'rejected'; reason: 'unknown' | 'expired' | 'revoked' }

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Looks a presented `hw_pat_…` secret up by its hash, the way the D1 query will. */
export async function checkPersonalToken(
  secret: string,
  nowSeconds: number,
): Promise<PersonalTokenCheck> {
  if (!secret.startsWith(PERSONAL_TOKEN_PREFIX)) return { kind: 'rejected', reason: 'unknown' }
  const token = TABLE[await sha256Hex(secret)]
  if (token === undefined) return { kind: 'rejected', reason: 'unknown' }
  if (token.revoked) return { kind: 'rejected', reason: 'revoked' }
  if (token.expiresAt !== null && token.expiresAt <= nowSeconds) {
    return { kind: 'rejected', reason: 'expired' }
  }
  return { kind: 'valid', token }
}
