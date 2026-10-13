import type { ContractDescription } from './description.ts'
import type { SchemaSnapshot } from './schema.ts'
import { compareText } from './text.ts'

/**
 * `contractsHash` (ADR-004): what a revision was checked against, in a short string. A stored
 * verdict says which rules it answered to, and a changed rule shows as another hash.
 */

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

/** The SHA-256 of a text, in lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The hash of the rules of a run: the input JSON Schema of the frontmatter and of each
 * component's props (`null` for one that does not convert), and the id, severity and phases of
 * every contract that was to run. Contracts go by id, so the order of the config does not matter,
 * and their descriptions are left out, because wording is no rule.
 */
export function hashContracts(
  snapshot: SchemaSnapshot,
  contracts: readonly ContractDescription[],
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      components: Object.fromEntries(snapshot.components),
      contracts: contracts
        .toSorted((left, right) => compareText(left.id, right.id))
        .map(({ id, phases, severity }) => ({ id, phases, severity })),
      frontmatter: snapshot.frontmatter,
    }),
  )
}
