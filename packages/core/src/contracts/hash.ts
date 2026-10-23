import type { ContractDescription } from './description.ts'
import type { SchemaSnapshot } from './schema.ts'
import { compareText } from './text.ts'

/**
 * JSON with the keys of every object in order and no spaces, so that equal values always give
 * the same text. Arrays keep their order, which means something there. An `undefined` member is
 * left out, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
    return `{${members.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hashContracts(
  snapshot: SchemaSnapshot,
  contracts: readonly (ContractDescription & {
    readonly params?: Readonly<Record<string, unknown>> | undefined
  })[],
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      components: Object.fromEntries(snapshot.components),
      contracts: contracts
        .toSorted((left, right) => compareText(left.id, right.id))
        .map(({ id, phases, severity, params }) => ({
          id,
          phases,
          severity,
          params: params === undefined || Object.keys(params).length === 0 ? undefined : params,
        })),
      frontmatter: snapshot.frontmatter,
    }),
  )
}
