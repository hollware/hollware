import type { Hollware, ToolOutput } from './hollware.ts'
import type { Memory } from './memory.ts'
import type { Model } from './model.ts'
import { entriesOf } from './listing.ts'
import { list, number, record, text, type Json } from './read.ts'

export const FIX_ROUNDS = 2

export const TRANSLATOR_PROMPT = [
  'You translate a Markdown file of a website into another language.',
  'Answer with the whole translated file and nothing else: no code fence around it, no comment.',
  'Keep the frontmatter between its --- lines, with the same keys. Translate the values a reader sees, such as title and description;',
  'keep dates, tags, identifiers and the value of the translation group exactly as they are.',
  'Put a frontmatter value in double quotes when it holds a colon or starts with a symbol.',
  'Keep Markdown structure, links, code blocks and components (lines that start with ::) as they are; translate only their text.',
  'Write naturally, as a native speaker would, in the voice of the style guide.',
].join(' ')

export function slugOf(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '') || 'translation'
  )
}

export function unfenced(answer: string): string {
  const trimmed = answer.trim()
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/.exec(trimmed)
  return `${(fenced?.[1] ?? trimmed).trimEnd()}\n`
}

function titleOf(markdown: string): string | null {
  return /^title:\s*["']?(.+?)["']?\s*$/m.exec(markdown)?.[1] ?? null
}

function problemsOf(verdict: Json): string {
  return list(verdict['errors'])
    .map(
      (error) =>
        `- ${String(error['path'])}: ${String(error['message'])} Fix: ${String(error['fix'])}`,
    )
    .join('\n')
}

export interface TranslatorDeps {
  readonly hollware: Hollware
  readonly model: Model
  readonly memory: Memory
}

/**
 * For each published entry of a collection with translations whose group lacks a locale of the
 * site, writes the translation as a draft, fixes what the contracts refuse up to `FIX_ROUNDS`
 * times, and asks a person to review it, at most `limit` a run. It reads each locale's entries in
 * one listing, so a run stays within the fifty calls a free Worker has; an entry of any status
 * in a locale counts as the translation, and the memory keeps what was tried, once it was saved or
 * refused: a run that stops before tries it again.
 */
export async function translateMissing(
  deps: TranslatorDeps,
  options: { readonly limit?: number } = {},
): Promise<{ readonly drafted: number; readonly sentToReview: number }> {
  const limit = options.limit ?? 2
  const site = record((await deps.hollware.call('describe_site', {}))['site'])
  const given: unknown = site['locales']
  const locales = Array.isArray(given)
    ? given.filter((one): one is string => typeof one === 'string')
    : []
  let drafted = 0
  let sentToReview = 0
  for (const collection of list(site['collections'])) {
    const name = text(collection['name'])
    if (name === null || text(collection['translationGroupField']) === null) continue
    const style = text(collection['styleGuide']) ?? text(site['styleGuide']) ?? '(none)'
    const byLocale = new Map<string, Json[]>()
    for (const locale of locales)
      byLocale.set(locale, await entriesOf(deps.hollware, { collection: name, locale }))
    const groupsIn = new Map(
      locales.map((locale) => [
        locale,
        new Set((byLocale.get(locale) ?? []).map((entry) => text(entry['translationGroup']))),
      ]),
    )
    for (const [source, entries] of byLocale) {
      for (const entry of entries) {
        const group = text(entry['translationGroup'])
        const id = text(entry['id'])
        if (entry['status'] !== 'published' || group === null || id === null) continue
        for (const locale of locales) {
          const present = groupsIn.get(locale)
          if (locale === source || present === undefined || present.has(group)) continue
          if (drafted >= limit) return { drafted, sentToReview }
          present.add(group)
          const key = `translated:${id}:${locale}`
          if ((await deps.memory.get(key)) !== null) continue
          const source_ = text(
            record(
              (
                await deps.hollware.call('get_entry', {
                  collection: name,
                  locale: source,
                  slug: entry['slug'],
                })
              )['entry'],
            )['markdown'],
          )
          if (source_ === null) continue
          const translated = unfenced(
            await deps.model([
              { role: 'system', content: TRANSLATOR_PROMPT },
              {
                role: 'user',
                content: `Translate from ${source} into ${locale}.\n\nStyle guide:\n${style}\n\nFile:\n\n${source_}`,
              },
            ]),
          )
          const slug = slugOf(titleOf(translated) ?? String(entry['slug']))
          let saved: ToolOutput = await deps.hollware.call('create_draft', {
            collection: name,
            locale,
            slug,
            markdown: translated,
          })
          if (saved['outcome'] === 'refused') {
            saved = await deps.hollware.call('create_draft', {
              collection: name,
              locale,
              slug: `${slug}-${locale}`,
              markdown: translated,
            })
          }
          await deps.memory.put(key, String(saved['outcome']), 90 * 86_400)
          if (saved['outcome'] !== 'saved') continue
          drafted += 1
          if (await fixAndAsk(deps, saved, name, locale)) sentToReview += 1
        }
      }
    }
  }
  return { drafted, sentToReview }
}

async function fixAndAsk(
  deps: TranslatorDeps,
  saved: ToolOutput,
  collection: string,
  locale: string,
): Promise<boolean> {
  let entry = record(saved['entry'])
  let verdict = record(saved['verdict'])
  for (let round = 0; round < FIX_ROUNDS && verdict['ok'] === false; round++) {
    const current = text(
      record(
        (await deps.hollware.call('get_entry', { collection, locale, slug: entry['slug'] }))[
          'entry'
        ],
      )['markdown'],
    )
    if (current === null) return false
    const fixed = unfenced(
      await deps.model([
        { role: 'system', content: TRANSLATOR_PROMPT },
        {
          role: 'user',
          content: `The contracts of the site refuse this file. Fix these problems, change nothing else, and answer with the whole file.\n\n${problemsOf(verdict)}\n\nFile:\n\n${current}`,
        },
      ]),
    )
    const updated = await deps.hollware.call('update_draft', {
      id: entry['id'],
      version: entry['version'],
      markdown: fixed,
    })
    if (updated['outcome'] !== 'saved') return false
    entry = record(updated['entry'])
    verdict = record(updated['verdict'])
  }
  if (verdict['ok'] === false) return false
  const version = number(entry['version'])
  let asked = await deps.hollware.call('request_review', { id: entry['id'], version })
  if (asked['outcome'] === 'needs_acknowledgement') {
    const warnings = list(record(asked['verdict'])['warnings']).map((warning) => ({
      contract: warning['contract'],
      path: warning['path'],
    }))
    asked = await deps.hollware.call('request_review', {
      id: entry['id'],
      version,
      acknowledgeWarnings: warnings,
    })
  }
  return asked['outcome'] === 'pending_review'
}
