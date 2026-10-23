import { assetIdIn } from '../media/index.ts'
import { registerBuiltIn } from './registry.ts'
import { bannedWords, fieldLength, fieldPattern, requiredToPublish } from './rules.ts'
import { runtimeOf } from './runtime.ts'
import { clip, isRecord, pointer, quote } from './text.ts'
import type {
  Contract,
  ContractContext,
  ContractFinding,
  EntryRef,
  Phase,
  Severity,
} from './types.ts'

/**
 * The built-in contracts a collection opts into by listing them in its `contracts`, and the
 * factory for its own: `contracts.translationPair()`, `contracts.internalLinksResolve()`,
 * `contracts.imagesHaveAlt()` and `contracts.custom({ … })`.
 */

export interface BuiltInOptions {
  /** `error` unless given: an error blocks publishing, a warning has to be acknowledged. */
  readonly severity?: Severity
  /** The id of the contract, when a collection lists the rule twice; the rule's name otherwise. */
  readonly id?: string
}

function translationPair(options: BuiltInOptions = {}): Contract<unknown> {
  return registerBuiltIn(
    {
      id: options.id ?? 'translation-pair',
      rule: { name: 'translation-pair', params: {} },
      severity: options.severity ?? 'error',
      phases: ['publish'],
      description:
        'Every locale of the site has an entry in the translation group of this entry. Checked when publishing.',
      async check(context) {
        const { site, collection } = runtimeOf('translation-pair', context)
        const field = collection.translationGroupField
        if (field === null) return []
        const path = `/frontmatter${pointer([field])}`
        const group = isRecord(context.frontmatter) ? context.frontmatter[field] : undefined
        if (typeof group !== 'string' || group === '') {
          return [
            {
              path,
              message: `The entry has no translation group: its frontmatter field ${field} is empty.`,
              fix: `Set ${field} in the frontmatter to the key that all the translations of this entry share, then create the entries for the locales of the site: ${site.locales.join(', ')}.`,
            },
          ]
        }
        const found = await context.entries.translations(collection.name, group)
        const present = new Set([context.locale, ...found.map((entry) => entry.locale)])
        return site.locales
          .filter((locale) => !present.has(locale))
          .map((locale) => ({
            path,
            message: `The ${locale} version of the translation group ${quote(group)} does not exist.`,
            fix: `Create the entry in ${locale} with ${field}: ${quote(group)} in its frontmatter before publishing.`,
          }))
      },
    },
    { readsFrontmatter: true },
  )
}

function internalLinksResolve(options: BuiltInOptions = {}): Contract<unknown> {
  return registerBuiltIn(
    {
      id: options.id ?? 'internal-links-resolve',
      rule: { name: 'internal-links-resolve', params: {} },
      severity: options.severity ?? 'error',
      phases: ['publish'],
      description:
        'Every link to another entry of the site points at a published entry. Checked when publishing.',
      async check(context) {
        const links = context.markdown.extracted.links.flatMap((link) =>
          link.kind === 'internal' &&
          link.target !== undefined &&
          !isThisEntry(link.target, context)
            ? [{ link, target: link.target }]
            : [],
        )
        if (links.length === 0) return []

        const positions = new Map<string, number>()
        const refs: EntryRef[] = []
        for (const { target } of links) {
          const key = keyOf(target)
          if (positions.has(key)) continue
          positions.set(key, refs.length)
          refs.push({ collection: target.collection, locale: target.locale, slug: target.slug })
        }
        const facts = await context.entries.lookupMany(refs)

        const findings: ContractFinding[] = []
        for (const { link, target } of links) {
          const position = positions.get(keyOf(target))
          const found = (position === undefined ? undefined : facts[position]) ?? null
          if (found?.status === 'published') continue
          const entry = `the entry ${clip(`${target.collection}/${target.locale}/${target.slug}`)}`
          findings.push({
            path: '/body',
            message:
              found === null
                ? `The link ${quote(link.href)} points at ${entry}, which does not exist.`
                : `The link ${quote(link.href)} points at ${entry}, which is not published yet (${found.status}).`,
            fix:
              found === null
                ? `Create and publish ${entry}, point the link at an entry that is published, or remove the link.`
                : `Publish ${entry} first, point the link at an entry that is published, or remove the link.`,
            line: link.line,
          })
        }
        return findings
      },
    },
    { readsFrontmatter: false },
  )
}

type Target = { readonly collection: string; readonly locale: string; readonly slug: string }

function keyOf(target: Target): string {
  return JSON.stringify([target.collection, target.locale, target.slug])
}

function isThisEntry(target: Target, context: ContractContext<unknown>): boolean {
  return (
    target.collection === context.collection &&
    target.locale === context.locale &&
    target.slug === context.slug
  )
}

function imagesHaveAlt(options: BuiltInOptions = {}): Contract<unknown> {
  return registerBuiltIn(
    {
      id: options.id ?? 'images-have-alt',
      rule: { name: 'images-have-alt', params: {} },
      severity: options.severity ?? 'error',
      phases: ['write', 'publish'],
      description: 'Every image has alt text that describes it.',
      check: (context) =>
        context.markdown.extracted.images
          .filter((image) => image.alt.trim() === '' && assetIdIn(image.src) === null)
          .map((image) => ({
            path: '/body',
            message: `The image ${quote(image.src)} has no alt text.`,
            fix: `Add alt text that describes the image, as in ![a short description](${clip(image.src)}).`,
            line: image.line,
          })),
    },
    { readsFrontmatter: false },
  )
}

/** A text that may depend on the entry: `The title has ${frontmatter.title.length} characters.` */
export type ContractText<Frontmatter> = string | ((context: ContractContext<Frontmatter>) => string)

export interface CustomContractOptions<Frontmatter> {
  /** Lowercase words joined by hyphens, unique within the collection: `seo-title-length`. */
  readonly id: string
  readonly severity: Severity
  /** What the rule asks for, as `describe_site` shows it to agents. */
  readonly description: string
  /** The phases it runs in; both when absent. */
  readonly phases?: readonly Phase[]
  /** Whether the entry follows the rule: `true` passes, `false` reports the problem. */
  check(context: ContractContext<Frontmatter>): boolean | Promise<boolean>
  /** What is wrong, for the agent. */
  readonly message: ContractText<Frontmatter>
  /** What to change so that the problem goes away, for the agent. Never empty. */
  readonly fix: ContractText<Frontmatter>
  /** A JSON Pointer into `{ frontmatter, body }`: `/frontmatter/title`. The whole entry (`''`) when absent. */
  readonly path?: string
}

function custom<Frontmatter = Record<string, unknown>>(
  options: CustomContractOptions<Frontmatter>,
): Contract<Frontmatter> {
  const text = (value: ContractText<Frontmatter>, context: ContractContext<Frontmatter>) =>
    typeof value === 'function' ? value(context) : value
  return {
    id: options.id,
    severity: options.severity,
    ...(options.phases === undefined ? {} : { phases: options.phases }),
    description: options.description,
    async check(context) {
      if (await options.check(context)) return []
      return [
        {
          path: options.path ?? '',
          message: text(options.message, context),
          fix: text(options.fix, context),
        },
      ]
    },
  }
}

export const contracts = {
  bannedWords,
  custom,
  fieldLength,
  fieldPattern,
  imagesHaveAlt,
  internalLinksResolve,
  requiredToPublish,
  translationPair,
} as const
