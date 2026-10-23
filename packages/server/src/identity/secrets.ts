function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function newSecret(prefix: 'hw_inv' | 'hw_ses'): string {
  return `${prefix}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(userId)
  const handle = new Uint8Array(bytes.length)
  handle.set(bytes)
  return handle
}
