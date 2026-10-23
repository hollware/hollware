const BEARER = /^bearer +(\S+)$/i

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  return BEARER.exec(header)?.[1] ?? null
}
